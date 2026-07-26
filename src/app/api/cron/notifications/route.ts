import {NextResponse} from "next/server";
import {verifyCronRequest} from "@/lib/crm/webhook-security";
import {sendNotificationEmail} from "@/lib/notifications/email";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PerformanceSettings = {
  organization_id: string;
  timezone: string;
  report_deadline_time: string;
  report_lock_enabled?: boolean;
};

type Schedule = {
  organization_id: string;
  user_id: string;
  timezone: string;
  work_days: number[];
  report_deadline_time: string;
  supervisor_id: string | null;
};

type Membership = {
  organization_id: string;
  user_id: string;
  role: string;
};

type NotificationRow = {
  id: string;
  organization_id: string;
  user_id: string;
  category: string;
  priority: string;
  title_fr: string;
  title_en: string;
  body_fr: string;
  body_en: string;
  action_url: string | null;
  email_attempts: number;
};

type PreferenceRow = {
  organization_id: string;
  user_id: string;
  email_enabled: boolean;
  email_frequency: string;
  locale: "fr" | "en";
  report_reminders: boolean;
  absence_updates: boolean;
  meeting_reminders: boolean;
  sales_updates: boolean;
  collection_updates: boolean;
  feedback_alerts: boolean;
  performance_updates: boolean;
  crm_updates: boolean;
};

function timeToMinutes(value: string) {
  const [hour = 0, minute = 0] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: weekdays[get("weekday")] ?? -1,
  };
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function categoryEnabled(preference: PreferenceRow | undefined, category: string) {
  if (!preference || category === "system") return true;
  const map: Record<string, keyof PreferenceRow> = {
    reports: "report_reminders",
    absences: "absence_updates",
    meetings: "meeting_reminders",
    sales: "sales_updates",
    collections: "collection_updates",
    feedback: "feedback_alerts",
    performance: "performance_updates",
    crm: "crm_updates",
  };
  const key = map[category];
  return key ? Boolean(preference[key]) : true;
}

async function generateReportReminders() {
  const admin = createAdminClient();
  const now = new Date();
  const [{data: memberships}, {data: settingsRows}, {data: scheduleRows}] = await Promise.all([
    admin.from("organization_members").select("organization_id,user_id,role").eq("is_active", true),
    admin.from("performance_settings").select("organization_id,timezone,report_deadline_time,report_lock_enabled"),
    admin.from("member_work_schedules").select("organization_id,user_id,timezone,work_days,report_deadline_time,supervisor_id").eq("is_active", true),
  ]);

  const settingsMap = new Map((settingsRows ?? []).map((row) => [row.organization_id, row as PerformanceSettings]));
  const scheduleMap = new Map((scheduleRows ?? []).map((row) => [`${row.organization_id}:${row.user_id}`, row as Schedule]));
  const members = (memberships ?? []) as Membership[];
  const candidateDates = new Set<string>();

  for (const member of members) {
    const setting = settingsMap.get(member.organization_id);
    if (!setting) continue;
    const schedule = scheduleMap.get(`${member.organization_id}:${member.user_id}`);
    const local = zonedParts(now, schedule?.timezone || setting.timezone || "Europe/Dublin");
    candidateDates.add(local.date);
  }

  const dates = [...candidateDates].sort();
  const minDate = dates[0] ?? now.toISOString().slice(0, 10);
  const maxDate = dates.at(-1) ?? minDate;
  const {data: reports} = await admin
    .from("daily_reports")
    .select("organization_id,user_id,report_date")
    .gte("report_date", minDate)
    .lte("report_date", maxDate);
  const reportKeys = new Set((reports ?? []).map((row) => `${row.organization_id}:${row.user_id}:${row.report_date}`));

  let created = 0;
  for (const member of members) {
    const setting = settingsMap.get(member.organization_id);
    if (!setting || setting.report_lock_enabled === false) continue;
    const schedule = scheduleMap.get(`${member.organization_id}:${member.user_id}`);
    const local = zonedParts(now, schedule?.timezone || setting.timezone || "Europe/Dublin");
    const workDays = schedule?.work_days?.length ? schedule.work_days : [1, 2, 3, 4, 5];
    if (!workDays.includes(local.weekday)) continue;
    if (reportKeys.has(`${member.organization_id}:${member.user_id}:${local.date}`)) continue;

    const deadline = (schedule?.report_deadline_time || setting.report_deadline_time).slice(0, 5);
    const remaining = timeToMinutes(deadline) - timeToMinutes(local.time);

    if (remaining >= 0 && remaining <= 120) {
      const id = await createNotification({
        organizationId: member.organization_id,
        userId: member.user_id,
        category: "reports",
        eventType: "daily_report_due",
        titleFr: "Rapport journalier à soumettre",
        titleEn: "Daily report due",
        bodyFr: `Votre rapport du ${local.date} doit être soumis avant ${deadline}.`,
        bodyEn: `Your report for ${local.date} must be submitted before ${deadline}.`,
        actionUrl: "/dashboard/performance?view=reports",
        priority: remaining <= 30 ? "urgent" : "warning",
        requiresAction: true,
        dedupeKey: `report-reminder:${member.user_id}:${local.date}`,
        metadata: {report_date: local.date, deadline},
      });
      if (id) created += 1;
    } else if (remaining < 0) {
      const employeeId = await createNotification({
        organizationId: member.organization_id,
        userId: member.user_id,
        category: "reports",
        eventType: "daily_report_missing",
        titleFr: "Rapport journalier non soumis",
        titleEn: "Daily report missing",
        bodyFr: `La journée du ${local.date} est clôturée et aucun rapport n’a été soumis.`,
        bodyEn: `The workday ${local.date} is closed and no report was submitted.`,
        actionUrl: "/dashboard/performance?view=reports",
        priority: "urgent",
        requiresAction: true,
        dedupeKey: `report-missing:${member.user_id}:${local.date}`,
        metadata: {report_date: local.date},
      });
      if (employeeId) created += 1;

      const supervisorId = schedule?.supervisor_id;
      if (supervisorId) {
        const supervisorNotificationId = await createNotification({
          organizationId: member.organization_id,
          userId: supervisorId,
          actorId: member.user_id,
          category: "reports",
          eventType: "supervised_report_missing",
          titleFr: "Rapport manquant à traiter",
          titleEn: "Missing report to review",
          bodyFr: `Un collaborateur supervisé n’a pas soumis son rapport du ${local.date}.`,
          bodyEn: `A supervised employee did not submit their report for ${local.date}.`,
          actionUrl: "/dashboard/performance?view=reports",
          priority: "urgent",
          requiresAction: true,
          dedupeKey: `supervisor-report-missing:${member.user_id}:${local.date}`,
          metadata: {employee_id: member.user_id, report_date: local.date},
        });
        if (supervisorNotificationId) created += 1;
      }
    }
  }

  return created;
}

async function generateMeetingReminders() {
  const admin = createAdminClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const {data: meetings} = await admin
    .from("performance_meetings")
    .select("id,organization_id,title,starts_at,mandatory")
    .gte("starts_at", now.toISOString())
    .lte("starts_at", horizon.toISOString());
  if (!meetings?.length) return 0;

  const meetingMap = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const {data: attendanceRows} = await admin
    .from("performance_meeting_attendance")
    .select("meeting_id,user_id,status")
    .in("meeting_id", meetings.map((meeting) => meeting.id))
    .eq("status", "invited");

  let created = 0;
  for (const attendance of attendanceRows ?? []) {
    const meeting = meetingMap.get(attendance.meeting_id);
    if (!meeting) continue;
    const id = await createNotification({
      organizationId: meeting.organization_id,
      userId: attendance.user_id,
      category: "meetings",
      eventType: "meeting_reminder",
      titleFr: "Rappel de réunion",
      titleEn: "Meeting reminder",
      bodyFr: `La réunion « ${meeting.title} » commence dans moins de 24 heures.`,
      bodyEn: `The meeting “${meeting.title}” starts in less than 24 hours.`,
      actionUrl: "/dashboard/performance?view=meetings",
      priority: meeting.mandatory ? "warning" : "info",
      requiresAction: meeting.mandatory,
      dedupeKey: `meeting-reminder:${meeting.id}:${attendance.user_id}`,
      metadata: {meeting_id: meeting.id, starts_at: meeting.starts_at},
    });
    if (id) created += 1;
  }
  return created;
}

async function generateCollectionReminders() {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = addDays(today, 3);
  const {data: scheduleRows} = await admin
    .from("sales_payment_schedule")
    .select("id,organization_id,sale_id,due_date,expected_amount,paid_amount,status")
    .lte("due_date", horizon)
    .in("status", ["upcoming", "partial", "overdue"]);
  if (!scheduleRows?.length) return 0;

  const saleIds = [...new Set(scheduleRows.map((row) => row.sale_id))];
  const {data: sales} = await admin
    .from("sales_records")
    .select("id,seller_id,collection_owner_id,customer_name,currency")
    .in("id", saleIds);
  const saleMap = new Map((sales ?? []).map((sale) => [sale.id, sale]));

  let created = 0;
  for (const item of scheduleRows) {
    const sale = saleMap.get(item.sale_id);
    if (!sale) continue;
    const recipient = sale.collection_owner_id || sale.seller_id;
    if (!recipient) continue;
    const overdue = item.due_date < today;
    const id = await createNotification({
      organizationId: item.organization_id,
      userId: recipient,
      category: "collections",
      eventType: overdue ? "collection_overdue" : "collection_due_soon",
      titleFr: overdue ? "Échéance de paiement en retard" : "Échéance de paiement proche",
      titleEn: overdue ? "Payment instalment overdue" : "Payment instalment due soon",
      bodyFr: `${sale.customer_name} : échéance de ${item.expected_amount} ${sale.currency} prévue le ${item.due_date}.`,
      bodyEn: `${sale.customer_name}: instalment of ${item.expected_amount} ${sale.currency} due on ${item.due_date}.`,
      actionUrl: "/dashboard/collections",
      priority: overdue ? "urgent" : "warning",
      requiresAction: true,
      dedupeKey: `collection-due:${item.id}:${item.due_date}`,
      metadata: {schedule_item_id: item.id, sale_id: item.sale_id, due_date: item.due_date},
    });
    if (id) created += 1;
  }
  return created;
}

async function generateCrmTaskReminders() {
  const admin = createAdminClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const {data: tasks} = await admin
    .from("crm_follow_up_tasks")
    .select("id,organization_id,assigned_to,title,due_at,priority,status")
    .not("assigned_to", "is", null)
    .not("due_at", "is", null)
    .lte("due_at", horizon.toISOString())
    .in("status", ["todo", "in_progress", "overdue"]);

  let created = 0;
  for (const task of tasks ?? []) {
    const overdue = Boolean(task.due_at && new Date(task.due_at).getTime() < now.getTime());
    const id = await createNotification({
      organizationId: task.organization_id,
      userId: task.assigned_to,
      category: "crm",
      eventType: overdue ? "crm_task_overdue" : "crm_task_due_soon",
      titleFr: overdue ? "Tâche CRM en retard" : "Tâche CRM à traiter",
      titleEn: overdue ? "CRM task overdue" : "CRM task due soon",
      bodyFr: `La tâche « ${task.title} » ${overdue ? "est en retard" : "arrive à échéance dans moins de 24 heures"}.`,
      bodyEn: `The task “${task.title}” ${overdue ? "is overdue" : "is due in less than 24 hours"}.`,
      actionUrl: "/dashboard/crm",
      priority: overdue || task.priority === "urgent" ? "urgent" : "warning",
      requiresAction: true,
      dedupeKey: `crm-task-due:${task.id}:${String(task.due_at).slice(0, 10)}`,
      metadata: {task_id: task.id, due_at: task.due_at},
    });
    if (id) created += 1;
  }
  return created;
}

async function deliverQueuedEmails() {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const {data: rows} = await admin
    .from("notifications")
    .select("id,organization_id,user_id,category,priority,title_fr,title_en,body_fr,body_en,action_url,email_attempts")
    .eq("email_requested", true)
    .in("email_status", ["queued", "failed"])
    .lte("scheduled_for", now)
    .lt("email_attempts", 3)
    .order("created_at", {ascending: true})
    .limit(100);
  const notifications = (rows ?? []) as NotificationRow[];
  if (!notifications.length) return {sent: 0, failed: 0, skipped: 0};

  const userIds = [...new Set(notifications.map((row) => row.user_id))];
  const organizationIds = [...new Set(notifications.map((row) => row.organization_id))];
  const [{data: profiles}, {data: organizations}, {data: preferences}] = await Promise.all([
    admin.from("profiles").select("id,email").in("id", userIds),
    admin.from("organizations").select("id,name").in("id", organizationIds),
    admin.from("notification_preferences").select("*").in("user_id", userIds),
  ]);
  const emailMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.email as string | null]));
  const orgMap = new Map((organizations ?? []).map((organization) => [organization.id, organization.name as string]));
  const preferenceMap = new Map(
    ((preferences ?? []) as PreferenceRow[]).map((preference) => [`${preference.organization_id}:${preference.user_id}`, preference]),
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const notification of notifications) {
    const preference = preferenceMap.get(`${notification.organization_id}:${notification.user_id}`);
    const email = emailMap.get(notification.user_id);
    const enabled = Boolean(email && preference?.email_enabled && preference.email_frequency !== "off" && categoryEnabled(preference, notification.category));

    if (!enabled) {
      await admin.from("notifications").update({
        email_status: "skipped",
        email_last_error: email ? "Disabled by notification preferences." : "Recipient email unavailable.",
      }).eq("id", notification.id);
      skipped += 1;
      continue;
    }

    const result = await sendNotificationEmail({
      to: email!,
      locale: preference?.locale ?? "fr",
      titleFr: notification.title_fr,
      titleEn: notification.title_en,
      bodyFr: notification.body_fr,
      bodyEn: notification.body_en,
      actionUrl: notification.action_url,
      priority: notification.priority,
      organizationName: orgMap.get(notification.organization_id) || "Super Leader",
    });

    if (result.sent) {
      await admin.from("notifications").update({
        email_status: "sent",
        email_attempts: notification.email_attempts + 1,
        email_last_error: null,
        email_sent_at: new Date().toISOString(),
      }).eq("id", notification.id);
      sent += 1;
    } else {
      await admin.from("notifications").update({
        email_status: result.configurationMissing ? "skipped" : "failed",
        email_attempts: notification.email_attempts + 1,
        email_last_error: result.error || "Unknown email delivery error.",
      }).eq("id", notification.id);
      if (result.configurationMissing) skipped += 1;
      else failed += 1;
    }
  }

  return {sent, failed, skipped};
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ok: false, error: "Unauthorized"}, {status: 401});
  }

  try {
    const [reports, meetings, collections, crmTasks] = await Promise.all([
      generateReportReminders(),
      generateMeetingReminders(),
      generateCollectionReminders(),
      generateCrmTaskReminders(),
    ]);
    const emails = await deliverQueuedEmails();

    return NextResponse.json({
      ok: true,
      generated: {reports, meetings, collections, crmTasks},
      emails,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Notification cron failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Notification automation failed.",
      },
      {status: 500},
    );
  }
}
