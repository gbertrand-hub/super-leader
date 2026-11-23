import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {loadHrDailyReports, type HrDailyReportRow} from "@/lib/performance/hr-daily-reports";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type BreakRow = {attendance_id: string; started_at: string; ended_at: string | null};

const allowedRoles = new Set(["owner", "admin", "hr", "manager"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function minutesLabel(value: number) {
  const safe = Math.max(0, Math.round(value));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (!hours) return `${minutes} min`;
  return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
}

function personHref(row: HrDailyReportRow) {
  return row.report?.id
    ? `/dashboard/hr/daily-reports?date=${row.report.report_date}&report=${row.report.id}`
    : `/dashboard/hr/daily-reports?date=${encodeURIComponent(new Date().toISOString().slice(0, 10))}&search=${encodeURIComponent(row.email || row.fullName)}`;
}

export default async function HrDashboardPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const {locale} = await getI18n();
  const fr = locale === "fr";
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
  if (membershipError || !membership) redirect("/dashboard/company");
  if (!allowedRoles.has(membership.role)) redirect("/dashboard?error=access-denied");
  await enforceOrganizationFeature(membership.organization_id, "performance");

  const filters = {
    date: first(params.date),
    team: first(params.team),
    manager: first(params.manager),
    search: first(params.search),
  };
  const data = await loadHrDailyReports({admin, organizationId: membership.organization_id, filters});
  const visibleIds = membership.role === "manager"
    ? new Set(await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role}))
    : null;
  const rows = data.rows.filter((row) => !visibleIds || visibleIds.has(row.userId));
  const attendanceIds = rows.flatMap((row) => row.attendance?.id ? [row.attendance.id] : []);
  let breaks: BreakRow[] = [];
  if (attendanceIds.length) {
    const {data: breakData, error: breakError} = await admin
      .from("attendance_breaks")
      .select("attendance_id, started_at, ended_at")
      .in("attendance_id", attendanceIds);
    if (!breakError) breaks = (breakData ?? []) as BreakRow[];
  }
  const activeBreakIds = new Set(breaks.filter((entry) => !entry.ended_at).map((entry) => entry.attendance_id));

  const expected = rows.filter((row) => row.expected);
  const present = expected.filter((row) => row.attendance?.clock_in_at && !row.attendance.clock_out_at);
  const completedDay = expected.filter((row) => row.attendance?.clock_out_at);
  const late = expected.filter((row) => row.attendance?.status === "late" || Number(row.attendance?.late_minutes ?? 0) > 0);
  const absent = expected.filter((row) => !row.attendance?.clock_in_at);
  const paused = present.filter((row) => row.attendance && activeBreakIds.has(row.attendance.id));
  const blocked = expected.filter((row) => row.blockedTaskCount > 0);
  const missingReports = expected.filter((row) => ["missing", "pending"].includes(row.reportState) && !row.report);
  const noPlan = expected.filter((row) => !row.taskPlanValid);
  const anomalies = expected.filter((row) => {
    const worked = Number(row.attendance?.total_work_minutes ?? 0);
    const scheduled = Number(row.attendance?.scheduled_work_minutes ?? 0);
    const pausedMinutes = Number(row.attendance?.pause_minutes ?? 0);
    return worked > Math.max(720, scheduled + 240) || pausedMinutes > 240;
  });
  const workedMinutes = rows.reduce((sum, row) => sum + Number(row.attendance?.total_work_minutes ?? 0), 0);
  const reportSubmitted = expected.filter((row) => Boolean(row.report)).length;
  const reportRate = expected.length ? Math.round((reportSubmitted / expected.length) * 100) : 0;

  const priorityRows = rows
    .map((row) => {
      const reasons: string[] = [];
      if (anomalies.some((item) => item.userId === row.userId)) reasons.push(fr ? "durée anormale" : "abnormal duration");
      if (row.blockedTaskCount) reasons.push(fr ? `${row.blockedTaskCount} tâche(s) bloquée(s)` : `${row.blockedTaskCount} blocked task(s)`);
      if (row.reportState === "missing") reasons.push(fr ? "rapport manquant" : "missing report");
      if (row.expected && !row.taskPlanValid) reasons.push(fr ? "plan du jour incomplet" : "incomplete daily plan");
      if (row.attendance?.status === "late" || Number(row.attendance?.late_minutes ?? 0) > 0) reasons.push(fr ? "retard" : "late arrival");
      if (row.expected && !row.attendance?.clock_in_at) reasons.push(fr ? "présence non enregistrée" : "attendance not recorded");
      return {row, reasons};
    })
    .filter((item) => item.reasons.length)
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, 10);

  const queryForReports = new URLSearchParams({date: data.date});
  if (filters.team) queryForReports.set("team", filters.team);
  if (filters.manager) queryForReports.set("manager", filters.manager);
  if (filters.search) queryForReports.set("search", filters.search);

  // HR_OPERATIONAL_OFFICE_V4_8_66
  // HR_OPERATIONAL_OFFICE_V4_8_66_RECOVERY
  const isHrAdmin = ["owner", "admin", "hr"].includes(membership.role);
  const operationalScopeRows = data.allRows.filter((row) => !visibleIds || visibleIds.has(row.userId));
  const operationalUserIds = Array.from(new Set(operationalScopeRows.map((row) => row.userId)));

  let operationalSchedules: Array<{user_id: string; work_policy: string | null; supervisor_id: string | null}> = [];
  let pendingLeaveCount = 0;
  let pendingInvitationCount = 0;
  let pendingAccessCount = 0;
  let reviewingAccessCount = 0;

  if (operationalUserIds.length) {
    const {data: scheduleData} = await admin
      .from("member_work_schedules")
      .select("user_id,work_policy,supervisor_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .in("user_id", operationalUserIds);
    operationalSchedules = (scheduleData ?? []) as Array<{user_id: string; work_policy: string | null; supervisor_id: string | null}>;

    if (isHrAdmin) {
      const {count} = await admin
        .from("leave_requests")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .eq("status", "pending")
        .in("user_id", operationalUserIds);
      pendingLeaveCount = count ?? 0;
    }
  }

  if (isHrAdmin) {
    const [{count: invitationCount}, {count: accessPending}, {count: accessReviewing}] = await Promise.all([
      admin
        .from("organization_invitations")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .in("status", ["pending", "expired"]),
      admin
        .from("internal_access_requests")
        .select("id", {count: "exact", head: true})
        .eq("status", "pending"),
      admin
        .from("internal_access_requests")
        .select("id", {count: "exact", head: true})
        .eq("status", "reviewing"),
    ]);
    pendingInvitationCount = invitationCount ?? 0;
    pendingAccessCount = accessPending ?? 0;
    reviewingAccessCount = accessReviewing ?? 0;
  }

  const scheduleByUser = new Map(operationalSchedules.map((row) => [row.user_id, row]));
  const fixedScheduleCount = operationalSchedules.filter((row) => (row.work_policy || "fixed") === "fixed").length;
  const flexibleScheduleCount = operationalSchedules.filter((row) => row.work_policy === "flexible").length;
  const autonomousScheduleCount = operationalSchedules.filter((row) => row.work_policy === "autonomous").length;
  const unconfiguredScheduleCount = operationalScopeRows.filter((row) => !scheduleByUser.has(row.userId)).length;
  const missingReportCount = operationalScopeRows.filter((row) => row.expected && row.reportState === "missing" && !row.report).length;
  const reviewReportCount = operationalScopeRows.filter((row) => row.reviewRequired).length;
  const attendanceIssueCount = operationalScopeRows.filter((row) => row.expected && (row.attendance?.status === "late" || row.attendance?.status === "absent" || Number(row.attendance?.late_minutes ?? 0) > 0)).length;
  const noTeamCount = operationalScopeRows.filter((row) => !row.teamNames.length && !["owner", "admin"].includes(row.role)).length;
  const noManagerCount = operationalScopeRows.filter((row) => !row.managerNames.length && !["owner", "admin", "hr"].includes(row.role)).length;
  const accessWorkCount = pendingAccessCount + reviewingAccessCount;
  const urgentHrSignals = missingReportCount + reviewReportCount + attendanceIssueCount + unconfiguredScheduleCount + noManagerCount + (isHrAdmin ? pendingLeaveCount + accessWorkCount : 0);

  const hrQuickTiles = [
    {
      key: "reports",
      visible: true,
      href: `/dashboard/hr/daily-reports?date=${encodeURIComponent(data.date)}#team-status`,
      eyebrow: fr ? "Rapports" : "Reports",
      title: fr ? "Rapports de la journée" : "Daily reports",
      description: fr ? "Réouvrir, compléter à la place, rappeler et contrôler les rapports." : "Reopen, complete on behalf, remind and review daily reports.",
      stats: [
        [fr ? "Manquants" : "Missing", missingReportCount],
        [fr ? "À contrôler" : "To review", reviewReportCount],
      ],
      tone: "border-amber-200 bg-amber-50 hover:border-amber-400",
    },
    {
      key: "daily-priorities",
      visible: true,
      href: `/dashboard/hr/daily-priorities?from=${encodeURIComponent(data.date)}&to=${encodeURIComponent(data.date)}#reopen-priorities`,
      eyebrow: fr ? "Priorités du matin" : "Morning priorities",
      title: fr ? "Réouvrir les priorités" : "Reopen priorities",
      description: fr ? "Après l’heure limite, réouvrir individuellement la saisie d’un collaborateur avec motif, durée et audit." : "After the deadline, reopen one employee’s submission with a reason, duration and audit trail.",
      stats: [[fr ? "Sans plan" : "Missing plan", noPlan.length]],
      tone: "border-yellow-200 bg-yellow-50 hover:border-yellow-400",
    },
    {
      key: "schedules",
      visible: isHrAdmin,
      href: "/dashboard/performance?view=settings",
      eyebrow: fr ? "Organisation du travail" : "Work organization",
      title: fr ? "Horaires de travail" : "Work schedules",
      description: fr ? "Changer Fixe, Flexible ou Autonome et définir les règles de pointage." : "Switch Fixed, Flexible or Autonomous and configure attendance rules.",
      stats: [
        [fr ? "Fixes" : "Fixed", fixedScheduleCount],
        [fr ? "Flexibles" : "Flexible", flexibleScheduleCount],
        [fr ? "Non configurés" : "Unconfigured", unconfiguredScheduleCount],
      ],
      tone: "border-indigo-200 bg-indigo-50 hover:border-indigo-400",
    },
    {
      key: "attendance",
      visible: true,
      href: "/dashboard/performance?view=attendance",
      eyebrow: fr ? "Temps & présence" : "Time & attendance",
      title: fr ? "Présences & ponctualité" : "Attendance & punctuality",
      description: fr ? "Traiter les retards, absences et anomalies de pointage." : "Handle lateness, absences and clocking anomalies.",
      stats: [[fr ? "Anomalies" : "Issues", attendanceIssueCount]],
      tone: "border-rose-200 bg-rose-50 hover:border-rose-400",
    },
    {
      key: "leave",
      visible: isHrAdmin,
      href: "/dashboard/hr/leave",
      eyebrow: fr ? "Disponibilités" : "Availability",
      title: fr ? "Congés & absences" : "Leave & absence",
      description: fr ? "Examiner les demandes et sécuriser la continuité des équipes." : "Review requests and protect team continuity.",
      stats: [[fr ? "En attente" : "Pending", pendingLeaveCount]],
      tone: "border-sky-200 bg-sky-50 hover:border-sky-400",
    },
    {
      key: "members",
      visible: true,
      href: "/dashboard/members",
      eyebrow: fr ? "Structure" : "Structure",
      title: fr ? "Employés & affectations" : "Employees & assignments",
      description: fr ? "Retrouver les personnes sans équipe et corriger leurs affectations." : "Find people without a team and correct their assignments.",
      stats: [[fr ? "Sans équipe" : "No team", noTeamCount]],
      tone: "border-emerald-200 bg-emerald-50 hover:border-emerald-400",
    },
    {
      key: "access",
      visible: isHrAdmin,
      href: `/dashboard/acquisition?view=internal&organization=${encodeURIComponent(membership.organization_id)}`,
      eyebrow: fr ? "Accès Super Leader" : "Super Leader access",
      title: fr ? "Demandes d’accès" : "Access requests",
      description: fr ? "Vérifier, approuver, refuser et activer les nouveaux accès iLEAD." : "Review, approve, reject and activate new iLEAD access requests.",
      stats: [
        [fr ? "En attente" : "Pending", pendingAccessCount],
        [fr ? "À vérifier" : "Reviewing", reviewingAccessCount],
      ],
      tone: "border-violet-200 bg-violet-50 hover:border-violet-400",
    },
    {
      key: "invitations",
      visible: isHrAdmin,
      href: "/dashboard/members",
      eyebrow: fr ? "Onboarding" : "Onboarding",
      title: fr ? "Invitations & première connexion" : "Invitations & first login",
      description: fr ? "Renvoyer une invitation, réactiver un accès ou gérer un mot de passe temporaire." : "Resend an invitation, reactivate access or manage a temporary password.",
      stats: [[fr ? "À suivre" : "To follow", pendingInvitationCount]],
      tone: "border-fuchsia-200 bg-fuchsia-50 hover:border-fuchsia-400",
    },
    {
      key: "supervision",
      visible: true,
      href: "/dashboard/members",
      eyebrow: fr ? "Management" : "Management",
      title: fr ? "Managers & supervision" : "Managers & supervision",
      description: fr ? "Identifier les collaborateurs sans responsable et organiser la supervision." : "Identify employees without a supervisor and organize management coverage.",
      stats: [[fr ? "Sans responsable" : "No supervisor", noManagerCount]],
      tone: "border-orange-200 bg-orange-50 hover:border-orange-400",
    },
    {
      key: "planning",
      visible: true,
      href: "/dashboard/schedule",
      eyebrow: fr ? "Planning" : "Planning",
      title: fr ? "Planning de l’équipe" : "Team planning",
      description: fr ? "Ouvrir le calendrier et compléter les horaires manquants." : "Open the calendar and complete missing schedules.",
      stats: [
        [fr ? "Non configurés" : "Unconfigured", unconfiguredScheduleCount],
        [fr ? "Autonomes" : "Autonomous", autonomousScheduleCount],
      ],
      tone: "border-cyan-200 bg-cyan-50 hover:border-cyan-400",
    },
  ].filter((tile) => tile.visible);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-[1600px]">
        <header className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">{fr ? "Pilotage des équipes" : "People operations"}</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">{fr ? "Tableau de bord RH" : "HR dashboard"}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">{fr ? "Les personnes qui ont besoin d’aide aujourd’hui, les présences et les actions prioritaires réunies au même endroit." : "People who need help today, attendance and priority actions in one place."}</p>
              <p className="mt-3 text-sm font-bold text-emerald-300">{data.date} · {data.timezone} · {membership.role === "manager" ? (fr ? "Mes équipes" : "My teams") : (fr ? "Toute l’organisation" : "Whole organization")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/hr/daily-reports?${queryForReports.toString()}`} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950">{fr ? "Contrôler les rapports" : "Review reports"}</Link>
              <Link href="/dashboard/performance?view=attendance" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black hover:bg-white/10">{fr ? "Voir les présences" : "View attendance"}</Link>
            </div>
          </div>
        </header>

        <form className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
          <label className="text-xs font-black text-slate-600">{fr ? "Date" : "Date"}<input name="date" type="date" defaultValue={data.date} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs font-black text-slate-600">{fr ? "Équipe" : "Team"}<select name="team" defaultValue={filters.team || "all"} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="all">{fr ? "Toutes" : "All"}</option>{data.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label className="text-xs font-black text-slate-600">Manager<select name="manager" defaultValue={filters.manager || "all"} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="all">{fr ? "Tous" : "All"}</option>{data.options.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
          <label className="text-xs font-black text-slate-600">{fr ? "Employé" : "Employee"}<input name="search" defaultValue={filters.search} placeholder={fr ? "Nom ou e-mail" : "Name or email"} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <button className="self-end rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{fr ? "Actualiser" : "Refresh"}</button>
        </form>

        <section id="hr-quick-actions" className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "Bureau RH opérationnel" : "HR operations office"}</p>
              <h2 className="mt-1 text-2xl font-black sm:text-3xl">{fr ? "Actions rapides" : "Quick actions"}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {fr ? "Les fonctions RH les plus demandées sont réunies ici : un clic doit conduire directement à l’action, sans chercher dans les menus." : "The most requested HR functions are gathered here: one click should lead directly to the action, without hunting through menus."}
              </p>
            </div>
            <a href="#hr-priority-actions" className={`rounded-2xl px-4 py-3 text-sm font-black ${urgentHrSignals ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-800"}`}>
              {urgentHrSignals ? (fr ? `${urgentHrSignals} signal(aux) à traiter ↓` : `${urgentHrSignals} signal(s) to handle ↓`) : (fr ? "Aucune urgence détectée" : "No urgent issue detected")}
            </a>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {hrQuickTiles.map((tile) => (
              <Link key={tile.key} href={tile.href} className={`group rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-md ${tile.tone}`}>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{tile.eyebrow}</p>
                <h3 className="mt-2 text-xl font-black text-slate-950">{tile.title}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{tile.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {tile.stats.map(([label, value]) => (
                    <span key={String(label)} className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-black text-slate-700 shadow-sm">
                      {label}: {value}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-sm font-black text-slate-950 group-hover:underline">{fr ? "Ouvrir →" : "Open →"}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [fr ? "Effectif attendu" : "Expected staff", expected.length, "border-indigo-200 bg-indigo-50 text-indigo-800"],
            [fr ? "Au travail maintenant" : "Working now", present.length, "border-emerald-200 bg-emerald-50 text-emerald-800"],
            [fr ? "Absence de pointage" : "No clock-in", absent.length, absent.length ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-800"],
            [fr ? "En retard" : "Late", late.length, late.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-800"],
            [fr ? "En pause" : "On break", paused.length, "border-amber-200 bg-amber-50 text-amber-900"],
            [fr ? "Journées terminées" : "Days completed", completedDay.length, "border-sky-200 bg-sky-50 text-sky-800"],
            [fr ? "Rapports soumis" : "Reports submitted", `${reportRate}%`, reportRate < 80 ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"],
            [fr ? "Temps travaillé" : "Time worked", minutesLabel(workedMinutes), "border-violet-200 bg-violet-50 text-violet-800"],
          ].map(([label, value, tone]) => <article key={String(label)} className={`rounded-2xl border p-5 ${tone}`}><p className="text-xs font-black uppercase tracking-wide opacity-75">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>)}
        </section>

        <section id="hr-priority-actions" className="mt-5 scroll-mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-red-600">{fr ? "Assistance immédiate" : "Immediate assistance"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Employés à accompagner" : "Employees needing support"}</h2></div><span className="rounded-full bg-red-100 px-3 py-1 text-sm font-black text-red-800">{priorityRows.length}</span></div>
            <div className="mt-5 space-y-3">
              {priorityRows.map(({row, reasons}) => <Link key={row.userId} href={personHref(row)} className="block rounded-2xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{row.fullName}</p><p className="mt-1 text-xs text-slate-500">{row.teamNames.join(" · ") || (fr ? "Aucune équipe" : "No team")} · {row.timezone}</p></div><span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-800">{reasons.length} {fr ? "alerte(s)" : "alert(s)"}</span></div><p className="mt-3 text-sm font-bold text-slate-700">{reasons.join(" · ")}</p></Link>)}
              {!priorityRows.length ? <div className="rounded-2xl bg-emerald-50 p-6 text-center font-bold text-emerald-800">{fr ? "Aucune urgence détectée pour les filtres sélectionnés." : "No urgent issue detected for the selected filters."}</div> : null}
            </div>
          </article>

          <aside className="space-y-5">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "Actions RH" : "HR actions"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "À traiter aujourd’hui" : "Handle today"}</h2><div className="mt-5 space-y-3">{[
              [fr ? "Rapports à obtenir" : "Reports to obtain", missingReports.length, "/dashboard/hr/daily-reports?status=missing"],
              [fr ? "Plans incomplets" : "Incomplete plans", noPlan.length, `/dashboard/hr/daily-reports?date=${data.date}`],
              [fr ? "Tâches bloquées" : "Blocked tasks", blocked.length, `/dashboard/hr/daily-reports?date=${data.date}`],
              [fr ? "Anomalies d’heures" : "Time anomalies", anomalies.length, "/dashboard/performance?view=attendance"],
            ].map(([label, count, href]) => <Link key={String(label)} href={String(href)} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 font-bold hover:bg-slate-100"><span>{label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-black ${Number(count) ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{count}</span></Link>)}</div></article>
            <article className="rounded-3xl bg-emerald-900 p-6 text-white shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">{fr ? "Routine recommandée" : "Recommended routine"}</p><ol className="mt-4 space-y-3 text-sm font-bold"><li>1. {fr ? "Vérifier les absences et retards." : "Check absences and late arrivals."}</li><li>2. {fr ? "Aider les employés bloqués." : "Support blocked employees."}</li><li>3. {fr ? "Corriger les sessions anormales." : "Correct abnormal sessions."}</li><li>4. {fr ? "Obtenir les rapports avant la clôture." : "Collect reports before closing."}</li></ol></article>
          </aside>
        </section>
      </div>
    </main>
  );
}
