"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {hrDailyReportsCopy} from "@/i18n/hr-daily-reports";
import {createNotification} from "@/lib/notifications/service";
import {loadHrDailyReports} from "@/lib/performance/hr-daily-reports";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const allowedRoles = new Set(["owner", "admin", "hr"]);

type Membership = {organization_id: string; role: string};

function safeReturnTo(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw.startsWith("/dashboard/hr/daily-reports") ? raw : "/dashboard/hr/daily-reports";
}

function go(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const url = new URL(returnTo, "http://super-leader.local");
  url.searchParams.delete("success");
  url.searchParams.delete("error");
  url.searchParams.set(kind, message);
  redirect(`${url.pathname}${url.search}${url.hash}`);
}

export async function sendDailyReportReminderAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const {locale} = await getI18n();
  const copy = hrDailyReportsCopy(locale);
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) go(returnTo, copy.messages.invalidDate, "error");

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const actor = authData.user;

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", actor.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError) {
    throw new Error(`Vérification de l'appartenance indisponible : ${membershipError.message}`);
  }
  if (!membership || !allowedRoles.has(membership.role)) {
    go(returnTo, copy.messages.forbidden, "error");
  }

  const data = await loadHrDailyReports({
    admin,
    organizationId: membership.organization_id,
    filters: {
      date,
      team: String(formData.get("team") ?? ""),
      department: String(formData.get("department") ?? ""),
      manager: String(formData.get("manager") ?? ""),
      search: String(formData.get("search") ?? ""),
      quick: String(formData.get("quick") ?? ""),
    },
  });

  if (date > data.nowDate) go(returnTo, copy.messages.noReminderRecipient, "error");

  const requestedUserId = String(formData.get("userId") ?? "").trim();
  const recipients = data.rows.filter((row) => {
    if (requestedUserId && row.userId !== requestedUserId) return false;
    return row.expected && !row.report && ["pending", "missing"].includes(row.reportState);
  });
  if (!recipients.length) go(returnTo, copy.messages.noReminderRecipient, "error");

  const dedupeDate = data.nowDate;
  const notificationResults: Array<string | null> = [];
  const batchSize = 5;
  for (let index = 0; index < recipients.length; index += batchSize) {
    const batch = recipients.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((recipient) => createNotification({
      organizationId: membership.organization_id,
      userId: recipient.userId,
      actorId: actor.id,
      category: "reports",
      eventType: "daily_report_reminder",
      titleFr: "Rappel : rapport journalier à soumettre",
      titleEn: "Reminder: daily report to submit",
      bodyFr: `Votre rapport journalier du ${date} n'a pas encore été soumis. Merci de compléter les résultats de vos tâches et votre rapport dans Super Leader.`,
      bodyEn: `Your daily report for ${date} has not yet been submitted. Please complete your task outcomes and report in Super Leader.`,
      actionUrl: `/dashboard/performance?view=reports&reportDate=${encodeURIComponent(date)}`,
      priority: recipient.reportState === "missing" ? "urgent" : "warning",
      requiresAction: true,
      dedupeKey: `daily-report-reminder:${date}:${recipient.userId}:${dedupeDate}`,
      metadata: {report_date: date, source: "hr_daily_reports", report_state: recipient.reportState},
      emailRequested: true,
    })));
    notificationResults.push(...batchResults);
  }

  const sentCount = notificationResults.filter(Boolean).length;
  const {error: auditError} = await admin.from("performance_audit_log").insert({
    organization_id: membership.organization_id,
    actor_id: actor.id,
    subject_user_id: requestedUserId || null,
    entity_type: "daily_report_reminder",
    entity_id: null,
    action: "reminders_sent",
    details: {
      report_date: date,
      requested_count: recipients.length,
      sent_count: sentCount,
      recipient_ids: recipients.map((recipient) => recipient.userId),
      scope: requestedUserId ? "single" : "filtered_batch",
    },
  });
  if (auditError) console.error("Daily report reminder audit failed", auditError);

  revalidatePath("/dashboard/hr/daily-reports");
  revalidatePath("/dashboard/notifications");
  if (!sentCount) go(returnTo, copy.messages.noReminderRecipient, "error");
  go(returnTo, copy.messages.remindersSent(sentCount));
}
