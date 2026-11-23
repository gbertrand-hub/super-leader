import {Fragment} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {sendDailyReportReminderAction} from "@/app/actions/hr-daily-reports";
import {completeDailyReportForEmployeeAction, reopenDailyReportAction} from "@/app/actions/performance";
import {ConfirmSubmitButton} from "@/components/confirm-submit-button";
import {PrintPageButton} from "@/components/hr/print-page-button";
import {getI18n} from "@/i18n/server";
import {hrDailyReportsCopy} from "@/i18n/hr-daily-reports";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {loadHrDailyReports, type HrDailyReportState} from "@/lib/performance/hr-daily-reports";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};

const allowedRoles = new Set(["owner", "admin", "hr"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function statusTone(status: HrDailyReportState) {
  if (status === "validated") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "submitted") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-900";
  if (["late", "missing", "needs_revision", "incomplete"].includes(status)) return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function attendanceTone(status: string) {
  if (["present", "remote"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (status === "late") return "bg-amber-100 text-amber-900";
  if (["absent", "excused"].includes(status)) return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function metricTone(tone: "indigo" | "emerald" | "amber" | "red" | "slate") {
  return {
    indigo: "border-indigo-200 bg-indigo-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
    slate: "border-slate-200 bg-white",
  }[tone];
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string | null, locale: string, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function buildReturnTo(params: Record<string, string>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
  const value = query.toString();
  return `/dashboard/hr/daily-reports${value ? `?${value}` : ""}`;
}

export default async function HrDailyReportsPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const {locale} = await getI18n();
  const copy = hrDailyReportsCopy(locale);

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
  if (membershipError) throw new Error(`Vérification de l'appartenance indisponible : ${membershipError.message}`);
  if (!membership) redirect("/dashboard/company");
  if (!allowedRoles.has(membership.role)) redirect("/dashboard/performance?view=reports");
  await enforceOrganizationFeature(membership.organization_id, "performance");

  const filters = {
    date: first(params.date),
    status: first(params.status),
    team: first(params.team),
    department: first(params.department),
    manager: first(params.manager),
    search: first(params.search),
    quick: first(params.quick),
  };
  const data = await loadHrDailyReports({admin, organizationId: membership.organization_id, filters});
  const selectedReportId = first(params.report);
  const selectedRow = selectedReportId
    ? data.allRows.find((row) => row.report?.id === selectedReportId) ?? null
    : null;
  const success = first(params.success);
  const error = first(params.error);
  const governanceActionRaw = first(params.action);
  const governanceAction = governanceActionRaw === "reopen" || governanceActionRaw === "complete" ? governanceActionRaw : "";
  const governanceUserId = first(params.user);

  const currentParams = {
    date: data.date,
    status: filters.status,
    team: filters.team,
    department: filters.department,
    manager: filters.manager,
    search: filters.search,
    quick: filters.quick,
  };
  const returnTo = buildReturnTo(currentParams);
  const exportQuery = new URLSearchParams();
  Object.entries(currentParams).forEach(([key, value]) => { if (value) exportQuery.set(key, value); });

  const quickHref = (quick: string) => {
    const query = new URLSearchParams();
    const base = {date: data.date, team: filters.team, department: filters.department, manager: filters.manager, search: filters.search};
    Object.entries(base).forEach(([key, value]) => { if (value) query.set(key, value); });
    query.set("quick", quick);
    return `/dashboard/hr/daily-reports?${query.toString()}#team-status`;
  };
  const governanceHref = (userId: string, action: "reopen" | "complete") => {
    const query = new URLSearchParams();
    Object.entries(currentParams).forEach(([key, value]) => { if (value) query.set(key, value); });
    query.set("user", userId);
    query.set("action", action);
    return `/dashboard/hr/daily-reports?${query.toString()}#governance-${userId}`;
  };
  const governanceReturnTo = buildReturnTo(currentParams);

  const stateOptions: HrDailyReportState[] = ["submitted", "validated", "pending", "missing", "late", "needs_revision", "incomplete", "not_required"];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-[1600px]">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8 print:rounded-none print:bg-white print:p-0 print:text-slate-950 print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400 print:text-slate-500">{copy.eyebrow}</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">{copy.title}</h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 sm:text-base print:text-slate-600">{copy.subtitle}</p>
              <p className="mt-3 text-sm font-bold text-emerald-300 print:text-slate-700">{formatDate(data.date, locale)} · {data.timezone}</p>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <Link href="/dashboard/performance?view=reports" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black hover:bg-white/10">{copy.backToPerformance}</Link>
              <a href={`/api/hr/daily-reports/export?${exportQuery.toString()}`} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950">{copy.exportCsv}</a>
              <PrintPageButton label={copy.printPdf} />
            </div>
          </div>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800 print:hidden">{success}</div> : null}
        {error ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800 print:hidden">{error}</div> : null}

        <section className="mt-6">
          <p className="mb-3 text-sm font-bold text-slate-500 print:hidden">{copy.quickFilterHint}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
            {[
              [copy.expected, data.metrics.expected, "indigo", "expected"],
              [copy.submitted, data.metrics.submitted, "emerald", "submitted"],
              [copy.pending, data.metrics.pending, "amber", "pending"],
              [copy.missing, data.metrics.missing, "red", "missing"],
              [copy.submittedLate, data.metrics.submittedLate, "red", "submittedLate"],
              [copy.reviewRequired, data.metrics.reviewRequired, "amber", "reviewRequired"],
              [copy.noPlan, data.metrics.noPlan, "slate", "noPlan"],
            ].map(([label, value, tone, quick]) => {
              const active = filters.quick === quick;
              return (
                <Link
                  key={String(label)}
                  href={quickHref(String(quick))}
                  title={`${copy.quickFilterActive}: ${label}`}
                  className={`block rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${metricTone(tone as "indigo" | "emerald" | "amber" | "red" | "slate")} ${active ? "ring-2 ring-slate-950 ring-offset-2" : ""}`}
                >
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-2 text-3xl font-black">{value}</p>
                  <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-500 print:hidden">{active ? copy.quickFilterActive : `${copy.filterNow} →`}</p>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">{copy.filters}</h2>
              <p className="mt-1 text-sm text-slate-500">{data.rows.length} {copy.rowsShown}</p>
            </div>
            <form action={sendDailyReportReminderAction}>
              <input type="hidden" name="date" value={data.date} />
              <input type="hidden" name="team" value={filters.team} />
              <input type="hidden" name="department" value={filters.department} />
              <input type="hidden" name="manager" value={filters.manager} />
              <input type="hidden" name="search" value={filters.search} />
              <input type="hidden" name="quick" value={filters.quick} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <ConfirmSubmitButton confirmation={copy.reminderConfirmation} confirmLabel={copy.confirm} cancelLabel={copy.cancel} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950" title={copy.reminderHelp}>{copy.sendReminders}</ConfirmSubmitButton>
            </form>
          </div>
          <form method="get" className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <label className="text-sm font-black">{copy.date}<input name="date" type="date" defaultValue={data.date} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
            <label className="text-sm font-black">{copy.status}<select name="status" defaultValue={filters.status || "all"} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="all">{copy.all}</option>{stateOptions.map((state) => <option key={state} value={state}>{copy.reportStates[state]}</option>)}</select></label>
            <label className="text-sm font-black">{copy.team}<select name="team" defaultValue={filters.team || "all"} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="all">{copy.all}</option>{data.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label className="text-sm font-black">{copy.department}<select name="department" defaultValue={filters.department || "all"} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="all">{copy.all}</option>{data.options.departments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
            <label className="text-sm font-black">{copy.manager}<select name="manager" defaultValue={filters.manager || "all"} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="all">{copy.all}</option>{data.options.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
            <label className="text-sm font-black">{copy.search}<input name="search" defaultValue={filters.search} placeholder={copy.searchPlaceholder} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
            <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-6">
              <button className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white">{copy.apply}</button>
              <Link href="/dashboard/hr/daily-reports" className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-700">{copy.reset}</Link>
            </div>
          </form>
        </section>

        <section id="team-status" className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-slate-300 print:shadow-none">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-xl font-black">{copy.teamStatus}</h2>
            <p className="mt-1 text-sm text-slate-500">{data.rows.length} {copy.rowsShown}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-left text-sm print:min-w-0 print:text-[9px]">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{copy.employee}</th>
                  <th className="px-4 py-3">{copy.schedule}</th>
                  <th className="px-4 py-3">{copy.attendance}</th>
                  <th className="px-4 py-3">{copy.priorities}</th>
                  <th className="px-4 py-3">{copy.report}</th>
                  <th className="px-4 py-3 print:hidden">{copy.action}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const detailHref = `${returnTo}${returnTo.includes("?") ? "&" : "?"}report=${encodeURIComponent(row.report?.id ?? "")}#report-detail`;
                  const canGovernMissing = row.expected && !row.report && row.reportState === "missing";
                  const actionPanelOpen = governanceUserId === row.userId && canGovernMissing && Boolean(governanceAction);
                  const sourceLabel = row.scheduleSource === "published" ? copy.publishedSchedule : row.scheduleSource === "draft" ? copy.draftSchedule : row.scheduleSource === "recurring" ? copy.recurringSchedule : row.scheduleSource === "default" ? copy.defaultSchedule : row.scheduleSource === "leave" ? copy.leave : copy.off;
                  return (
                    <Fragment key={row.userId}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="px-4 py-4">
                        <p className="font-black">{row.fullName}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.email || "—"}</p>
                        <p className="mt-2 text-xs font-bold text-indigo-700">{copy.roles[row.role as keyof typeof copy.roles] ?? row.role}</p>
                        <p className="mt-2 text-xs text-slate-500">{row.teamNames.length ? row.teamNames.join(" · ") : copy.noTeam}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.managerNames.length ? `${copy.manager}: ${row.managerNames.join(" · ")}` : copy.noManager}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-black">{sourceLabel}</p>
                        {row.expected ? <p className="mt-1 text-sm">{row.startTime?.slice(0, 5)} - {row.endTime?.slice(0, 5)}</p> : null}
                        <p className="mt-1 text-xs text-slate-500">{copy.workModes[row.workMode as keyof typeof copy.workModes] ?? row.workMode}{row.location ? ` · ${row.location}` : ""}</p>
                        <p className="mt-2 text-xs font-bold text-amber-800">{copy.reportDeadline}: {row.deadline}</p>
                      </td>
                      <td className="px-4 py-4">
                        {row.attendance ? <><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${attendanceTone(row.attendance.status)}`}>{copy.attendanceStates[row.attendance.status as keyof typeof copy.attendanceStates] ?? row.attendance.status}</span><p className="mt-2 text-xs text-slate-500">{formatDateTime(row.attendance.clock_in_at, locale, row.timezone)}{row.attendance.clock_out_at ? ` → ${formatDateTime(row.attendance.clock_out_at, locale, row.timezone)}` : ""}</p>{row.attendance.late_minutes ? <p className="mt-1 text-xs font-bold text-amber-700">+{row.attendance.late_minutes} min</p> : null}</> : <span className="text-sm font-bold text-slate-500">{copy.noAttendance}</span>}
                      </td>
                      <td className="px-4 py-4">
                        {row.plan ? <><p className={`font-black ${row.taskPlanValid ? "text-emerald-700" : "text-red-700"}`}>{row.taskCount} {copy.tasks}</p><p className="mt-1 text-xs text-slate-500">{row.completedTaskCount} {copy.completed} · {row.blockedTaskCount} {copy.blocked}</p><p className="mt-2 text-xs font-bold text-slate-600">{row.plan.status}</p></> : <span className="font-bold text-red-700">{copy.noPlanText}</span>}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(row.reportState)}`}>{copy.reportStates[row.reportState]}</span>
                        {row.report ? <p className="mt-2 text-xs text-slate-500">{formatDateTime(row.report.submitted_at, locale, row.timezone)}</p> : null}
                        {row.reviewRequired ? <p className="mt-2 text-xs font-black text-amber-800">{copy.reviewRequired}</p> : null}
                      </td>
                      <td className="px-4 py-4 print:hidden">
                        <div className="flex min-w-[145px] flex-col gap-2">
                          {row.report ? <Link href={detailHref} className="rounded-lg bg-indigo-700 px-3 py-2 text-center text-xs font-black text-white">{copy.open}</Link> : null}
                          {row.expected && !row.report ? <form action={sendDailyReportReminderAction}><input type="hidden" name="date" value={data.date} /><input type="hidden" name="userId" value={row.userId} /><input type="hidden" name="returnTo" value={returnTo} /><button className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900">{copy.remindOne}</button></form> : null}
                          {canGovernMissing ? <Link href={governanceHref(row.userId, "reopen")} className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-center text-xs font-black text-indigo-900">{copy.reopen}</Link> : null}
                          {canGovernMissing ? <Link href={governanceHref(row.userId, "complete")} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-xs font-black text-emerald-900">{copy.submitForEmployee}</Link> : null}
                        </div>
                      </td>
                    </tr>
                    {actionPanelOpen ? (
                      <tr id={`governance-${row.userId}`} className="border-t border-slate-200 bg-slate-50 print:hidden">
                        <td colSpan={6} className="px-4 py-5">
                          <div className={`rounded-2xl border p-5 ${governanceAction === "reopen" ? "border-indigo-200 bg-indigo-50" : "border-emerald-200 bg-emerald-50"}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{row.fullName} · {formatDate(data.date, locale)}</p>
                                <h3 className="mt-1 text-xl font-black">{governanceAction === "reopen" ? copy.reopenPanelTitle : copy.completePanelTitle}</h3>
                                <p className="mt-1 max-w-4xl text-sm text-slate-600">{governanceAction === "reopen" ? copy.reopenPanelHelp : copy.completePanelHelp}</p>
                              </div>
                              <Link href={returnTo} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">{copy.closeActionPanel}</Link>
                            </div>
                            {governanceAction === "reopen" ? (
                              <form action={reopenDailyReportAction} className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr_auto] lg:items-end">
                                <input type="hidden" name="userId" value={row.userId} />
                                <input type="hidden" name="reportDate" value={data.date} />
                                <input type="hidden" name="returnTo" value={governanceReturnTo} />
                                <label className="text-sm font-black">{copy.durationHours}<input name="durationHours" type="number" min="1" max="168" defaultValue="24" required className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                                <label className="text-sm font-black">{copy.reopeningReason}<textarea name="reason" minLength={10} rows={2} required className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                                <div className="flex flex-col gap-3">
                                  <label className="flex items-center gap-2 text-xs font-bold"><input name="justified" type="checkbox" />{copy.justifiedReopening}</label>
                                  <ConfirmSubmitButton confirmation={copy.reopenPanelHelp} confirmLabel={copy.confirm} cancelLabel={copy.cancel} className="rounded-xl bg-indigo-700 px-4 py-3 text-sm font-black text-white">{copy.saveReopening}</ConfirmSubmitButton>
                                </div>
                              </form>
                            ) : (
                              <form action={completeDailyReportForEmployeeAction} className="mt-5 grid gap-4 lg:grid-cols-2">
                                <input type="hidden" name="userId" value={row.userId} />
                                <input type="hidden" name="reportDate" value={data.date} />
                                <input type="hidden" name="returnTo" value={governanceReturnTo} />
                                <label className="text-sm font-black lg:col-span-2">{copy.supervisorReason}<textarea name="supervisorReason" minLength={10} rows={2} required className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                                <label className="text-sm font-black">{copy.accomplishments}<textarea name="accomplishments" minLength={3} rows={3} required className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                                <label className="text-sm font-black">{copy.results}<textarea name="results" minLength={3} rows={3} required className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                                <label className="text-sm font-black">{copy.blockers}<textarea name="blockers" rows={2} className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                                <label className="text-sm font-black">{copy.nextPriorities}<textarea name="nextPriorities" minLength={3} rows={2} required className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                                <div className="lg:col-span-2"><ConfirmSubmitButton confirmation={copy.completePanelHelp} confirmLabel={copy.confirm} cancelLabel={copy.cancel} className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white">{copy.saveSupervisorReport}</ConfirmSubmitButton></div>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!data.rows.length ? <p className="py-14 text-center text-slate-500">{copy.noRows}</p> : null}
          </div>
        </section>

        {selectedRow?.report ? (
          <section id="report-detail" className="mt-6 rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm print:break-before-page print:rounded-none print:border-slate-300 print:shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{copy.reportDetails}</p>
                <h2 className="mt-2 text-2xl font-black">{selectedRow.fullName}</h2>
                <p className="mt-1 text-sm text-slate-500">{formatDate(data.date, locale)} · {formatDateTime(selectedRow.report.submitted_at, locale, selectedRow.timezone)}</p>
              </div>
              <div className="flex gap-2 print:hidden">
                <Link href={`/dashboard/performance?view=reports&month=${data.date.slice(0, 7)}&report=${selectedRow.report.id}#report-${selectedRow.report.id}`} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{copy.backToPerformance}</Link>
                <Link href={returnTo} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700">{copy.closeDetail}</Link>
              </div>
            </div>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {[
                [copy.accomplishments, selectedRow.report.accomplishments],
                [copy.results, selectedRow.report.results],
                [copy.blockers, selectedRow.report.blockers],
                [copy.nextPriorities, selectedRow.report.next_priorities],
              ].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><h3 className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value || "—"}</p></article>)}
            </div>
            {selectedRow.outcomes.length ? <div className="mt-6"><h3 className="text-xl font-black">{copy.taskOutcomes}</h3><div className="mt-4 grid gap-4 lg:grid-cols-2">{selectedRow.outcomes.map((outcome) => <article key={outcome.id} className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><div className="flex items-start justify-between gap-3"><p className="font-black">#{outcome.position} · {outcome.title}</p><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-indigo-800">{copy.taskStatuses[outcome.final_status as keyof typeof copy.taskStatuses] ?? outcome.final_status}</span></div><p className="mt-3 text-sm text-slate-700"><strong>{copy.expectedOutcome}:</strong> {outcome.expected_outcome}</p><p className="mt-2 text-sm text-slate-900"><strong>{copy.actualOutcome}:</strong> {outcome.actual_outcome}</p>{outcome.outcome_reason ? <p className="mt-2 text-sm text-amber-900"><strong>{copy.reason}:</strong> {outcome.outcome_reason}</p> : null}</article>)}</div></div> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
