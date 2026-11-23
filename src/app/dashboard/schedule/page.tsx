import Link from "next/link";
import {redirect} from "next/navigation";
import {
  applyScheduleTemplateAction,
  cancelScheduleEntryAction,
  createScheduleTemplateAction,
  deleteDraftScheduleEntryAction,
  publishMonthScheduleAction,
  publishScheduleEntryAction,
  saveScheduleEntryAction,
} from "@/app/actions/schedule";
import {getI18n} from "@/i18n/server";
import {scheduleText} from "@/i18n/schedule";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";
import AgendaDelegationCenter from "./agenda-delegation-center";

type SearchParams = {
  month?: string | string[];
  date?: string | string[];
  user?: string | string[];
  success?: string | string[];
  error?: string | string[];
  agendaOwner?: string | string[];
  appointment?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type BaseScheduleRow = {
  user_id: string;
  timezone: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
  supervisor_id: string | null;
};
type ScheduleEntryRow = {
  id: string;
  user_id: string;
  work_date: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  grace_minutes: number;
  report_deadline_time: string | null;
  work_mode: "onsite" | "remote" | "hybrid" | "off";
  location: string | null;
  supervisor_id: string | null;
  report_required: boolean;
  status: "draft" | "published" | "cancelled";
  source: string;
  template_id: string | null;
  notes: string | null;
  published_at: string | null;
};
type TemplateRow = {
  id: string;
  name: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  grace_minutes: number;
  report_deadline_time: string | null;
  work_mode: "onsite" | "remote" | "hybrid" | "off";
  location: string | null;
  report_required: boolean;
};
type LeaveRow = {user_id: string; start_date: string; end_date: string; leave_type: string};
type MeetingRow = {id: string; title: string; starts_at: string; ends_at: string | null; mandatory: boolean};
type MeetingAttendanceRow = {meeting_id: string; user_id: string};
type SettingsRow = {timezone: string; default_start_time: string; default_end_time: string; grace_minutes: number; report_deadline_time: string};

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function monthValue(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 7);
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  };
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function dateRange(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function time(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "—";
}

function tone(status: string) {
  if (status === "published") return "bg-emerald-100 text-emerald-800";
  if (status === "draft") return "bg-amber-100 text-amber-800";
  if (status === "cancelled") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function modeTone(mode: string) {
  if (mode === "remote") return "bg-indigo-100 text-indigo-800";
  if (mode === "hybrid") return "bg-violet-100 text-violet-800";
  if (mode === "off") return "bg-slate-200 text-slate-700";
  return "bg-cyan-100 text-cyan-800";
}

function dateOverlapsLeave(date: string, leaves: LeaveRow[]) {
  return leaves.some((leave) => date >= leave.start_date && date <= leave.end_date);
}

function getDateInTimezone(value: string, timezone: string) {
  const safeTimezone = normalizeTimeZone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: safeTimezone, year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function getTimeInTimezone(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {timeZone: normalizeTimeZone(timezone), hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(new Date(value));
}

function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <label className="block text-sm font-black text-slate-800">{label}{children}</label>;
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export default async function SchedulePage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const st = (key: string, values?: Record<string, string | number>) => scheduleText(locale, key, values);
  const params = (await searchParams) ?? {};
  const month = monthValue(firstValue(params.month));
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const bounds = monthBounds(month);
  const requestedDate = firstValue(params.date);
  const requestedUserId = firstValue(params.user);
  const requestedAgendaOwner = firstValue(params.agendaOwner);
  const requestedAppointment = firstValue(params.appointment);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) redirect("/dashboard/company");

  const schemaCheck = await admin.from("work_schedule_entries").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = schemaCheck.error.code === "42P01" || schemaCheck.error.code === "PGRST205";
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{st("eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black">{st("title")}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{missing ? st("databaseSetupTitle") : st("loadFailedTitle")}</h2>
            <p className="mt-3 leading-7 text-amber-900">{missing ? st("databaseSetupDescription") : schemaCheck.error.message}</p>
            {missing ? <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/016_planning_agenda_team_organization.sql</code> : null}
          </section>
        </div>
      </main>
    );
  }

  const isLeader = leaderRoles.has(membership.role);
  const [{data: settingsData}, {data: membersData}, {data: baseSchedulesData}] = await Promise.all([
    admin.from("performance_settings").select("timezone, default_start_time, default_end_time, grace_minutes, report_deadline_time").eq("organization_id", membership.organization_id).maybeSingle<SettingsRow>(),
    admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).order("created_at"),
    admin.from("member_work_schedules").select("user_id, timezone, work_days, start_time, end_time, grace_minutes, report_deadline_time, supervisor_id").eq("organization_id", membership.organization_id).eq("is_active", true),
  ]);

  const settings = settingsData ?? {timezone: "Europe/Dublin", default_start_time: "09:00", default_end_time: "17:00", grace_minutes: 10, report_deadline_time: "18:00"};
  settings.timezone = normalizeTimeZone(settings.timezone);
  const members = (membersData ?? []) as MemberRow[];
  const baseSchedules = (baseSchedulesData ?? []) as BaseScheduleRow[];
  const allMemberIds = members.map((member) => member.user_id);
  const managedMemberIds = membership.role === "manager"
    ? baseSchedules.filter((row) => row.supervisor_id === authData.user.id).map((row) => row.user_id)
    : isLeader ? allMemberIds : [];
  const visibleMemberIds = Array.from(new Set([authData.user.id, ...managedMemberIds]));

  const [{data: profilesData}, entriesResult, templatesResult, leavesResult, meetingsResult] = await Promise.all([
    allMemberIds.length ? admin.from("profiles").select("id, full_name, email").in("id", allMemberIds) : Promise.resolve({data: [] as ProfileRow[], error: null}),
    admin.from("work_schedule_entries").select("id, user_id, work_date, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, location, supervisor_id, report_required, status, source, template_id, notes, published_at").eq("organization_id", membership.organization_id).gte("work_date", bounds.start).lte("work_date", bounds.end).in("user_id", visibleMemberIds).order("work_date").order("start_time"),
    admin.from("schedule_templates").select("id, name, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, location, report_required").eq("organization_id", membership.organization_id).eq("is_active", true).order("name"),
    admin.from("leave_requests").select("user_id, start_date, end_date, leave_type").eq("organization_id", membership.organization_id).eq("status", "approved").lte("start_date", bounds.end).gte("end_date", bounds.start).in("user_id", visibleMemberIds),
    admin.from("performance_meetings").select("id, title, starts_at, ends_at, mandatory").eq("organization_id", membership.organization_id).gte("starts_at", `${bounds.start}T00:00:00Z`).lte("starts_at", `${bounds.end}T23:59:59Z`).order("starts_at"),
  ]);

  const loadError = [entriesResult.error, templatesResult.error, leavesResult.error, meetingsResult.error].find(Boolean);
  if (loadError) throw new Error(st("messages.loadFailed", {message: loadError.message}));

  const profiles = (profilesData ?? []) as ProfileRow[];
  const entries = (entriesResult.data ?? []) as ScheduleEntryRow[];
  const templates = (templatesResult.data ?? []) as TemplateRow[];
  const leaves = (leavesResult.data ?? []) as LeaveRow[];
  const meetings = (meetingsResult.data ?? []) as MeetingRow[];
  const meetingIds = meetings.map((meeting) => meeting.id);
  const {data: meetingAttendanceData} = meetingIds.length
    ? await admin.from("performance_meeting_attendance").select("meeting_id, user_id").in("meeting_id", meetingIds).in("user_id", visibleMemberIds)
    : {data: [] as MeetingAttendanceRow[]};
  const meetingAttendance = (meetingAttendanceData ?? []) as MeetingAttendanceRow[];

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const memberName = (id: string) => profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || t("common.member");
  const baseByUser = new Map(baseSchedules.map((schedule) => [schedule.user_id, schedule]));
  const visibleMembers = visibleMemberIds.map((id) => ({id, name: memberName(id), role: members.find((member) => member.user_id === id)?.role ?? "employee"})).sort((a, b) => a.name.localeCompare(b.name));
  const manageableMembers = visibleMembers.filter((member) => managedMemberIds.includes(member.id));

  const ownEntries = entries.filter((entry) => entry.user_id === authData.user.id && entry.status !== "cancelled");
  const publishedEntries = entries.filter((entry) => entry.status === "published");
  const draftEntries = entries.filter((entry) => entry.status === "draft");
  const cancelledEntries = entries.filter((entry) => entry.status === "cancelled");
  const leaveConflicts = entries.filter((entry) => entry.status !== "cancelled" && entry.work_mode !== "off" && dateOverlapsLeave(entry.work_date, leaves.filter((leave) => leave.user_id === entry.user_id)));

  const meetingConflicts = entries.filter((entry) => {
    if (entry.status === "cancelled" || entry.work_mode === "off" || !entry.start_time || !entry.end_time) return false;
    const assignedMeetingIds = new Set(meetingAttendance.filter((row) => row.user_id === entry.user_id).map((row) => row.meeting_id));
    return meetings.some((meeting) => {
      if (!meeting.mandatory || !assignedMeetingIds.has(meeting.id)) return false;
      if (getDateInTimezone(meeting.starts_at, entry.timezone) !== entry.work_date) return false;
      const starts = getTimeInTimezone(meeting.starts_at, entry.timezone);
      const ends = meeting.ends_at ? getTimeInTimezone(meeting.ends_at, entry.timezone) : starts;
      return starts < time(entry.start_time) || ends > time(entry.end_time);
    });
  });

  const conflictIds = new Set([...leaveConflicts, ...meetingConflicts].map((entry) => entry.id));
  const calendarDates = dateRange(bounds.start, bounds.end);
  const firstWeekday = new Date(`${bounds.start}T00:00:00Z`).getUTCDay();
  const leadingBlanks = (firstWeekday + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat(dateLocale, {month: "long", year: "numeric"}).format(new Date(`${bounds.start}T00:00:00Z`));
  const defaultMember = manageableMembers.find((member) => member.id === requestedUserId) ?? manageableMembers[0];
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= bounds.start && requestedDate <= bounds.end
    ? requestedDate
    : bounds.start;
  const selectedUserId = defaultMember?.id ?? "";
  const selectedEntry = selectedUserId
    ? entries.find((entry) => entry.user_id === selectedUserId && entry.work_date === selectedDate && entry.status !== "cancelled") ?? null
    : null;
  const defaultBase = selectedUserId ? baseByUser.get(selectedUserId) : null;

  const formatLongDate = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "full"}).format(new Date(`${value}T00:00:00Z`));
  const weekdayLabels = Array.from({length: 7}, (_, index) => new Intl.DateTimeFormat(dateLocale, {weekday: "short"}).format(new Date(Date.UTC(2026, 0, 5 + index))));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-[1500px]">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{st("eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black md:text-4xl">{st("title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{st("subtitle")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/schedule?month=${shiftMonth(month, -1)}`} className="rounded-xl border border-white/20 px-4 py-3 font-black hover:bg-white/10">←</Link>
              <div className="min-w-52 rounded-xl bg-white/10 px-5 py-3 text-center font-black capitalize">{monthLabel}</div>
              <Link href={`/dashboard/schedule?month=${shiftMonth(month, 1)}`} className="rounded-xl border border-white/20 px-4 py-3 font-black hover:bg-white/10">→</Link>
            </div>
          </div>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-900">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-900">{errorMessage}</div> : null}
        <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm font-bold text-indigo-950">{st("myDayLinkNotice")}</div>

        <AgendaDelegationCenter month={month} agendaOwner={requestedAgendaOwner} appointment={requestedAppointment} locale={locale} />

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {[
            [st("metrics.published"), publishedEntries.length, "text-emerald-700"],
            [st("metrics.drafts"), draftEntries.length, "text-amber-700"],
            [st("metrics.onsite"), publishedEntries.filter((entry) => entry.work_mode === "onsite").length, "text-cyan-700"],
            [st("metrics.remote"), publishedEntries.filter((entry) => entry.work_mode === "remote" || entry.work_mode === "hybrid").length, "text-indigo-700"],
            [st("metrics.daysOff"), publishedEntries.filter((entry) => entry.work_mode === "off").length, "text-slate-700"],
            [st("metrics.conflicts"), conflictIds.size, conflictIds.size ? "text-red-700" : "text-emerald-700"],
          ].map(([label, value, valueClass]) => (
            <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-bold text-slate-500">{label}</p>
              <p className={`mt-2 text-3xl font-black ${valueClass}`}>{value}</p>
            </article>
          ))}
        </section>


        {isLeader ? (
          <section className="mt-6">
            <article id="schedule-editor" className="scroll-mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{st("single.eyebrow")}</p>
                  <h2 className="mt-1 text-2xl font-black text-indigo-950">{selectedEntry ? st("single.editTitle") : st("single.title")}</h2>
                  <p className="mt-2 max-w-3xl text-sm text-indigo-800">{st("single.help")}</p>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-white/80 px-4 py-3 text-sm font-black text-indigo-950 shadow-sm">
                  {st("single.selectedDate", {date: formatLongDate(selectedDate)})}
                </div>
              </div>
              {selectedEntry ? <p className="mt-3 text-xs font-bold text-amber-800">{st("single.existingHelp")}</p> : null}
              {manageableMembers.length ? (
                <form action={saveScheduleEntryAction} className="mt-5 space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <Field label={st("fields.employee")}><select name="userId" defaultValue={selectedUserId} required className={inputClass}>{manageableMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></Field>
                    <Field label={st("fields.date")}><input name="workDate" type="date" defaultValue={selectedDate} required className={inputClass} /></Field>
                    <Field label={st("fields.mode")}><select name="workMode" defaultValue={selectedEntry?.work_mode ?? "onsite"} className={inputClass}><option value="onsite">{st("modes.onsite")}</option><option value="remote">{st("modes.remote")}</option><option value="hybrid">{st("modes.hybrid")}</option><option value="off">{st("modes.off")}</option></select></Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Field label={st("fields.startTime")}><input name="startTime" type="time" defaultValue={time(selectedEntry?.start_time || defaultBase?.start_time || settings.default_start_time)} className={inputClass} /></Field>
                    <Field label={st("fields.endTime")}><input name="endTime" type="time" defaultValue={time(selectedEntry?.end_time || defaultBase?.end_time || settings.default_end_time)} className={inputClass} /></Field>
                    <Field label={st("fields.grace")}><input name="graceMinutes" type="number" min="0" max="180" defaultValue={selectedEntry?.grace_minutes ?? defaultBase?.grace_minutes ?? settings.grace_minutes} className={inputClass} /></Field>
                    <Field label={st("fields.reportDeadline")}><input name="reportDeadline" type="time" defaultValue={time(selectedEntry?.report_deadline_time || defaultBase?.report_deadline_time || settings.report_deadline_time)} className={inputClass} /></Field>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label={st("fields.location")}><input name="location" defaultValue={selectedEntry?.location ?? ""} placeholder={st("fields.locationPlaceholder")} className={inputClass} /></Field>
                    <Field label={st("fields.timezone")}><input name="timezone" defaultValue={normalizeTimeZone(selectedEntry?.timezone || defaultBase?.timezone, settings.timezone)} className={inputClass} /></Field>
                  </div>
                  <Field label={st("fields.notes")}><textarea name="notes" rows={2} defaultValue={selectedEntry?.notes ?? ""} className={inputClass} /></Field>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px_260px] lg:items-end">
                    <label className="flex min-h-[50px] items-center gap-3 rounded-xl bg-white/70 p-4 text-sm font-bold text-indigo-950"><input name="reportRequired" type="checkbox" defaultChecked={selectedEntry ? selectedEntry.report_required : true} />{st("fields.reportRequired")}</label>
                    <Field label={st("fields.status")}><select name="status" defaultValue={selectedEntry?.status === "published" ? "published" : "draft"} className={inputClass}><option value="draft">{st("statuses.draft")}</option><option value="published">{st("statuses.published")}</option></select></Field>
                    <button className="min-h-[50px] w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800">{st("single.submit")}</button>
                  </div>
                </form>
              ) : <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm text-indigo-900">{st("noManagedMembers")}</p>}
            </article>
          </section>
        ) : null}

        <section className="mt-6 space-y-6">
            <article className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{isLeader ? st("calendar.teamEyebrow") : st("calendar.personalEyebrow")}</p>
                  <h2 className="mt-1 text-2xl font-black">{isLeader ? st("calendar.teamTitle") : st("calendar.personalTitle")}</h2>
                  {isLeader ? <p className="mt-2 text-sm text-slate-500">{st("calendar.clickHelp")}</p> : null}
                </div>
                {isLeader && draftEntries.length ? (
                  <form action={publishMonthScheduleAction}>
                    <input type="hidden" name="month" value={month} />
                    <button className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800">{st("publishMonth", {count: draftEntries.length})}</button>
                  </form>
                ) : null}
              </div>

              <div className="mt-5 overflow-x-auto">
                <div className="min-w-[900px] 2xl:min-w-0">
                  <div className="grid grid-cols-7 gap-2 text-center text-xs font-black uppercase tracking-wider text-slate-500">
                    {weekdayLabels.map((label) => <div key={label} className="py-2">{label}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({length: leadingBlanks}, (_, index) => <div key={`blank-${index}`} className="min-h-36 rounded-2xl bg-slate-50" />)}
                    {calendarDates.map((date) => {
                      const dayEntries = entries.filter((entry) => entry.work_date === date && entry.status !== "cancelled");
                      const dayLeaves = leaves.filter((leave) => date >= leave.start_date && date <= leave.end_date);
                      const dayMeetings = meetings.filter((meeting) => getDateInTimezone(meeting.starts_at, settings.timezone) === date);
                      const isSelected = selectedDate === date;
                      const newEntryHref = `/dashboard/schedule?month=${month}&date=${date}${selectedUserId ? `&user=${selectedUserId}` : ""}#schedule-editor`;
                      return (
                        <div key={date} className={`min-h-44 rounded-2xl border p-3 transition ${isSelected ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white"}`}>
                          <div className="flex items-center justify-between gap-2">
                            {isLeader ? (
                              <Link href={newEntryHref} className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-1 py-1 hover:bg-indigo-100">
                                <span className="text-sm font-black">{new Date(`${date}T00:00:00Z`).getUTCDate()}</span>
                                <span className="text-[10px] font-black text-indigo-700">+ {st("calendar.add")}</span>
                              </Link>
                            ) : <p className="text-sm font-black">{new Date(`${date}T00:00:00Z`).getUTCDate()}</p>}
                            {dayMeetings.length ? <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-black text-purple-800">{dayMeetings.length} {st("calendar.meetingsShort")}</span> : null}
                          </div>
                          <div className="mt-2 space-y-2">
                            {dayEntries.map((entry) => {
                              const entryContent = (
                                <>
                                  <div className="flex items-start justify-between gap-2"><p className="truncate font-black">{memberName(entry.user_id)}</p><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${tone(entry.status)}`}>{st(`statuses.${entry.status}`)}</span></div>
                                  <p className="mt-1 font-semibold text-slate-600">{entry.work_mode === "off" ? st("modes.off") : `${time(entry.start_time)}–${time(entry.end_time)}`}</p>
                                  <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-black ${modeTone(entry.work_mode)}`}>{st(`modes.${entry.work_mode}`)}</span>
                                  {conflictIds.has(entry.id) ? <p className="mt-1 font-black text-red-700">{st("conflict")}</p> : null}
                                </>
                              );
                              const entryClass = `block rounded-xl border p-2 text-xs transition ${conflictIds.has(entry.id) ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"}`;
                              return isLeader ? (
                                <Link key={entry.id} href={`/dashboard/schedule?month=${month}&date=${date}&user=${entry.user_id}#schedule-editor`} className={`${entryClass} hover:border-indigo-300 hover:bg-indigo-50`} title={st("calendar.edit")}>{entryContent}</Link>
                              ) : <div key={entry.id} className={entryClass}>{entryContent}</div>;
                            })}
                            {!dayEntries.length && dayLeaves.length ? <div className="rounded-xl bg-sky-50 p-2 text-xs font-bold text-sky-800">{st("calendar.approvedLeave")}</div> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{st("list.eyebrow")}</p><h2 className="mt-1 text-2xl font-black">{isLeader ? st("list.teamTitle") : st("list.personalTitle")}</h2></div><Link href="/dashboard/my-day" className="text-sm font-black text-indigo-700">{st("backToMyDay")}</Link></div>
              <div className="mt-5 space-y-3">
                {(isLeader ? entries : ownEntries).length ? (isLeader ? entries : ownEntries).map((entry) => {
                  const entryLeaves = leaves.filter((leave) => leave.user_id === entry.user_id);
                  const hasLeave = entry.work_mode !== "off" && dateOverlapsLeave(entry.work_date, entryLeaves);
                  return (
                    <div key={entry.id} className={`rounded-2xl border p-4 ${entry.status === "cancelled" ? "border-slate-200 bg-slate-50 opacity-70" : hasLeave || conflictIds.has(entry.id) ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><p className="font-black">{isLeader ? `${memberName(entry.user_id)} · ` : ""}{formatLongDate(entry.work_date)}</p><span className={`rounded-full px-2.5 py-1 text-xs font-black ${tone(entry.status)}`}>{st(`statuses.${entry.status}`)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-black ${modeTone(entry.work_mode)}`}>{st(`modes.${entry.work_mode}`)}</span></div>
                          <p className="mt-2 text-sm text-slate-600">{entry.work_mode === "off" ? st("dayOffDescription") : `${time(entry.start_time)}–${time(entry.end_time)} · ${entry.location || st("noLocation")} · ${normalizeTimeZone(entry.timezone, settings.timezone)}`}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{entry.report_required ? st("reportRequiredAt", {time: time(entry.report_deadline_time)}) : st("reportNotRequired")}</p>
                          {entry.notes ? <p className="mt-2 text-sm text-slate-600">{entry.notes}</p> : null}
                          {hasLeave ? <p className="mt-2 text-sm font-black text-red-700">{st("leaveConflict")}</p> : null}
                          {conflictIds.has(entry.id) && !hasLeave ? <p className="mt-2 text-sm font-black text-red-700">{st("meetingConflict")}</p> : null}
                        </div>
                        {isLeader ? (
                          <div className="flex flex-wrap gap-2">
                            {entry.status === "draft" ? <form action={publishScheduleEntryAction}><input type="hidden" name="entryId" value={entry.id} /><input type="hidden" name="month" value={month} /><button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white">{st("actions.publish")}</button></form> : null}
                            {entry.status === "draft" ? <form action={deleteDraftScheduleEntryAction}><input type="hidden" name="entryId" value={entry.id} /><input type="hidden" name="month" value={month} /><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-slate-700">{st("actions.delete")}</button></form> : null}
                            {entry.status !== "cancelled" ? <form action={cancelScheduleEntryAction} className="flex gap-2"><input type="hidden" name="entryId" value={entry.id} /><input type="hidden" name="month" value={month} /><input name="reason" placeholder={st("actions.cancelReason")} className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-xs" /><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700">{st("actions.cancel")}</button></form> : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                }) : <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{st("list.empty")}</p>}
              </div>
            </article>
        </section>

        {isLeader ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-2">
              <article className="rounded-3xl border border-violet-200 bg-violet-50 p-6 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{st("bulk.eyebrow")}</p>
                <h2 className="mt-1 text-2xl font-black text-violet-950">{st("bulk.title")}</h2>
                <p className="mt-2 text-sm text-violet-800">{st("bulk.help")}</p>
                {templates.length && manageableMembers.length ? (
                  <form action={applyScheduleTemplateAction} className="mt-5 space-y-4">
                    <Field label={st("fields.employee")}><select name="userId" defaultValue={selectedUserId} className={inputClass}>{manageableMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></Field>
                    <Field label={st("fields.template")}><select name="templateId" className={inputClass}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {st(`modes.${template.work_mode}`)}</option>)}</select></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label={st("fields.startDate")}><input name="startDate" type="date" defaultValue={bounds.start} className={inputClass} /></Field><Field label={st("fields.endDate")}><input name="endDate" type="date" defaultValue={bounds.end} className={inputClass} /></Field></div>
                    <div><p className="text-sm font-black text-violet-950">{st("fields.weekdays")}</p><div className="mt-2 grid grid-cols-4 gap-2">{[1,2,3,4,5,6,7].map((day) => <label key={day} className="flex items-center gap-2 rounded-lg bg-white px-2 py-2 text-xs font-bold"><input type="checkbox" name={`weekday-${day}`} defaultChecked={day <= 5} />{weekdayLabels[day - 1]}</label>)}</div></div>
                    <label className="flex items-center gap-3 rounded-xl bg-white/70 p-4 text-sm font-bold text-violet-950"><input name="publishNow" type="checkbox" />{st("bulk.publishNow")}</label>
                    <label className="flex items-center gap-3 rounded-xl bg-white/70 p-4 text-sm font-bold text-violet-950"><input name="replaceExisting" type="checkbox" />{st("bulk.replaceExisting")}</label>
                    <button className="w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white hover:bg-violet-800">{st("bulk.submit")}</button>
                  </form>
                ) : <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm text-violet-900">{templates.length ? st("noManagedMembers") : st("bulk.noTemplate")}</p>}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">{st("templates.eyebrow")}</p>
                <h2 className="mt-1 text-2xl font-black">{st("templates.title")}</h2>
                <form action={createScheduleTemplateAction} className="mt-5 space-y-4">
                  <Field label={st("fields.templateName")}><input name="name" placeholder={st("fields.templateNamePlaceholder")} required className={inputClass} /></Field>
                  <Field label={st("fields.mode")}><select name="workMode" defaultValue="onsite" className={inputClass}><option value="onsite">{st("modes.onsite")}</option><option value="remote">{st("modes.remote")}</option><option value="hybrid">{st("modes.hybrid")}</option><option value="off">{st("modes.off")}</option></select></Field>
                  <div className="grid gap-4 sm:grid-cols-2"><Field label={st("fields.startTime")}><input name="startTime" type="time" defaultValue={time(settings.default_start_time)} className={inputClass} /></Field><Field label={st("fields.endTime")}><input name="endTime" type="time" defaultValue={time(settings.default_end_time)} className={inputClass} /></Field></div>
                  <div className="grid gap-4 sm:grid-cols-2"><Field label={st("fields.grace")}><input name="graceMinutes" type="number" defaultValue={settings.grace_minutes} min="0" max="180" className={inputClass} /></Field><Field label={st("fields.reportDeadline")}><input name="reportDeadline" type="time" defaultValue={time(settings.report_deadline_time)} className={inputClass} /></Field></div>
                  <Field label={st("fields.location")}><input name="location" className={inputClass} /></Field><Field label={st("fields.timezone")}><input name="timezone" defaultValue={settings.timezone} className={inputClass} /></Field>
                  <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="reportRequired" type="checkbox" defaultChecked />{st("fields.reportRequired")}</label>
                  <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{st("templates.submit")}</button>
                </form>
                <div className="mt-5 space-y-2">{templates.map((template) => <div key={template.id} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="font-black">{template.name}</p><span className={`rounded-full px-2 py-1 text-xs font-black ${modeTone(template.work_mode)}`}>{st(`modes.${template.work_mode}`)}</span></div><p className="mt-1 text-xs text-slate-500">{template.work_mode === "off" ? st("modes.off") : `${time(template.start_time)}–${time(template.end_time)} · ${template.location || st("noLocation")}`}</p></div>)}</div>
              </article>
          </section>
        ) : null}

        {cancelledEntries.length ? <p className="mt-6 text-center text-xs font-semibold text-slate-400">{st("cancelledCount", {count: cancelledEntries.length})}</p> : null}
      </div>
    </main>
  );
}
