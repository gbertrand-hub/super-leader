import Link from "next/link";
import {redirect} from "next/navigation";
import {
  assignManagerToExecutiveAction,
  removeManagerFromExecutiveAction,
} from "@/app/actions/executive";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type SearchParams = Promise<{
  month?: string | string[];
  success?: string | string[];
  error?: string | string[];
}>;

type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type AssignmentRow = {
  id: string;
  executive_user_id: string;
  manager_user_id: string;
  assigned_at: string;
};
type TeamRow = {id: string; name: string; department: string | null; manager_id: string | null};
type TeamMemberRow = {team_id: string; user_id: string};
type ScheduleRow = {user_id: string; supervisor_id: string | null};
type ScoreRow = {
  user_id: string;
  total_score: number | string;
  scheduled_days: number;
  attended_days: number;
  late_days: number;
  unexcused_absences: number;
  reports_expected: number;
  reports_submitted: number;
  mandatory_meetings: number;
  meetings_attended: number;
  eligible: boolean;
};
type ActionPlanRow = {owner_id: string; status: string; due_date: string | null};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 7);
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function Metric({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "slate" | "indigo" | "emerald" | "amber" | "red";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    indigo: "border-indigo-200 bg-indigo-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  };
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
      {detail ? <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p> : null}
    </article>
  );
}

export default async function ExecutivePage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const params = await searchParams;
  const month = normalizeMonth(firstValue(params.month));
  const scoreMonth = `${month}-01`;
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const today = new Date().toISOString().slice(0, 10);

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
    .maybeSingle<{organization_id: string; role: string}>();

  if (membershipError || !membership) redirect("/dashboard/company");
  if (!["owner", "admin", "hr", "executive"].includes(membership.role)) {
    redirect("/dashboard/my-day");
  }

  const schemaCheck = await admin
    .from("executive_manager_assignments")
    .select("id", {head: true, count: "exact"})
    .limit(1);

  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
              {fr ? "Gouvernance exécutive" : "Executive governance"}
            </p>
            <h1 className="mt-2 text-3xl font-black">
              {fr ? "Centre Exécutif" : "Executive Centre"}
            </h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">
              {fr ? "Activation de la V2.9.4 requise" : "V2.9.4 setup required"}
            </h2>
            <p className="mt-3 leading-7 text-amber-900">
              {fr
                ? "Exécute la migration Supabase ci-dessous avant d’utiliser le rôle Exécutif."
                : "Run the Supabase migration below before using the Executive role."}
            </p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
              supabase/040_executive_role_supervision_v2_9_4.sql
            </code>
          </section>
        </div>
      </main>
    );
  }

  const [membersResult, assignmentsResult, teamsResult, schedulesResult, scoresResult, actionsResult] =
    await Promise.all([
      admin
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .in("role", ["executive", "manager"])
        .order("created_at"),
      admin
        .from("executive_manager_assignments")
        .select("id, executive_user_id, manager_user_id, assigned_at")
        .eq("organization_id", membership.organization_id)
        .order("assigned_at"),
      admin
        .from("teams")
        .select("id, name, department, manager_id")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .order("name"),
      admin
        .from("member_work_schedules")
        .select("user_id, supervisor_id")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true),
      admin
        .from("employee_month_scores")
        .select("user_id,total_score,scheduled_days,attended_days,late_days,unexcused_absences,reports_expected,reports_submitted,mandatory_meetings,meetings_attended,eligible")
        .eq("organization_id", membership.organization_id)
        .eq("score_month", scoreMonth),
      admin
        .from("action_plans")
        .select("owner_id,status,due_date")
        .eq("organization_id", membership.organization_id)
        .not("status", "in", "(completed,cancelled)"),
    ]);

  const loadError = [
    membersResult.error,
    assignmentsResult.error,
    teamsResult.error,
    schedulesResult.error,
    scoresResult.error,
    actionsResult.error,
  ].find(Boolean);
  if (loadError) throw new Error(loadError.message);

  const members = (membersResult.data ?? []) as MemberRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const teams = (teamsResult.data ?? []) as TeamRow[];
  const schedules = (schedulesResult.data ?? []) as ScheduleRow[];
  const scores = (scoresResult.data ?? []) as ScoreRow[];
  const actionPlans = (actionsResult.data ?? []) as ActionPlanRow[];

  const relevantAssignments = membership.role === "executive"
    ? assignments.filter((assignment) => assignment.executive_user_id === authData.user.id)
    : assignments;
  const managerIds = Array.from(new Set(relevantAssignments.map((assignment) => assignment.manager_user_id)));
  const executiveIds = members.filter((member) => member.role === "executive").map((member) => member.user_id);
  const allManagerIds = members.filter((member) => member.role === "manager").map((member) => member.user_id);
  const profileIds = Array.from(new Set([...executiveIds, ...allManagerIds]));

  const [profilesResult, teamMembersResult] = await Promise.all([
    profileIds.length
      ? admin.from("profiles").select("id,full_name,email").in("id", profileIds)
      : Promise.resolve({data: [] as ProfileRow[], error: null}),
    teams.length
      ? admin.from("team_members").select("team_id,user_id").in("team_id", teams.map((team) => team.id))
      : Promise.resolve({data: [] as TeamMemberRow[], error: null}),
  ]);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (teamMembersResult.error) throw new Error(teamMembersResult.error.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const teamMembers = (teamMembersResult.data ?? []) as TeamMemberRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const scoreById = new Map(scores.map((score) => [score.user_id, score]));
  const assignmentByManager = new Map(assignments.map((assignment) => [assignment.manager_user_id, assignment]));

  const managerSummaries = managerIds.map((managerId) => {
    const managerTeams = teams.filter((team) => team.manager_id === managerId);
    const teamIds = new Set(managerTeams.map((team) => team.id));
    const directReportIds = Array.from(
      new Set([
        ...schedules.filter((schedule) => schedule.supervisor_id === managerId).map((schedule) => schedule.user_id),
        ...teamMembers.filter((row) => teamIds.has(row.team_id)).map((row) => row.user_id),
      ]),
    ).filter((id) => id !== managerId);
    const scopeIds = new Set([managerId, ...directReportIds]);
    const managerScore = scoreById.get(managerId);
    const overduePlans = actionPlans.filter(
      (plan) => scopeIds.has(plan.owner_id) && Boolean(plan.due_date) && plan.due_date! < today,
    ).length;
    const profile = profileById.get(managerId);
    return {
      id: managerId,
      name: profile?.full_name?.trim() || profile?.email || (fr ? "Manager" : "Manager"),
      email: profile?.email ?? "",
      teamNames: managerTeams.map((team) => team.department ? `${team.department} - ${team.name}` : team.name),
      employeeCount: directReportIds.length,
      score: numeric(managerScore?.total_score),
      attendanceRate: percent(managerScore?.attended_days ?? 0, managerScore?.scheduled_days ?? 0),
      reportRate: percent(managerScore?.reports_submitted ?? 0, managerScore?.reports_expected ?? 0),
      meetingRate: percent(managerScore?.meetings_attended ?? 0, managerScore?.mandatory_meetings ?? 0),
      lateDays: managerScore?.late_days ?? 0,
      absences: managerScore?.unexcused_absences ?? 0,
      eligible: Boolean(managerScore?.eligible),
      overduePlans,
      executiveId: assignmentByManager.get(managerId)?.executive_user_id ?? null,
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const totalEmployees = new Set(
    managerIds.flatMap((managerId) => {
      const managerTeamIds = new Set(teams.filter((team) => team.manager_id === managerId).map((team) => team.id));
      return [
        ...schedules.filter((schedule) => schedule.supervisor_id === managerId).map((schedule) => schedule.user_id),
        ...teamMembers.filter((row) => managerTeamIds.has(row.team_id)).map((row) => row.user_id),
      ];
    }),
  ).size;

  const canConfigureAssignments = ["owner", "admin", "hr"].includes(membership.role);
  const executiveOptions = executiveIds.map((id) => ({
    id,
    name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || (fr ? "Exécutif" : "Executive"),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const managerOptions = allManagerIds.map((id) => ({
    id,
    name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || "Manager",
    assignedExecutiveId: assignmentByManager.get(id)?.executive_user_id ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
                {fr ? "Gouvernance exécutive" : "Executive governance"}
              </p>
              <h1 className="mt-2 text-3xl font-black">
                {fr ? "Centre Exécutif" : "Executive Centre"}
              </h1>
              <p className="mt-2 max-w-3xl text-slate-300">
                {fr
                  ? "Supervise les managers, consolide les KPI de leurs équipes et identifie rapidement les actions prioritaires."
                  : "Supervise managers, consolidate team KPIs and identify priority actions quickly."}
              </p>
            </div>
            <form method="get" className="flex items-end gap-3">
              <label className="text-sm font-bold text-slate-300">
                {fr ? "Mois" : "Month"}
                <input name="month" type="month" defaultValue={month} className="mt-2 block rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white" />
              </label>
              <button className="rounded-xl bg-amber-400 px-4 py-2.5 font-black text-slate-950">
                {fr ? "Appliquer" : "Apply"}
              </button>
            </form>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label={fr ? "Managers supervisés" : "Supervised managers"} value={managerSummaries.length} tone="indigo" />
          <Metric label={fr ? "Effectif indirect" : "Indirect workforce"} value={totalEmployees} />
          <Metric label={fr ? "Score moyen managers" : "Average manager score"} value={`${average(managerSummaries.map((item) => item.score)).toFixed(1)}/100`} tone="emerald" />
          <Metric label={fr ? "Rapports remis" : "Reports submitted"} value={`${average(managerSummaries.map((item) => item.reportRate)).toFixed(0)}%`} tone="amber" />
          <Metric label={fr ? "Retards managers" : "Manager late days"} value={managerSummaries.reduce((sum, item) => sum + item.lateDays, 0)} tone="amber" />
          <Metric label={fr ? "Plans en retard" : "Overdue plans"} value={managerSummaries.reduce((sum, item) => sum + item.overduePlans, 0)} tone={managerSummaries.some((item) => item.overduePlans > 0) ? "red" : "slate"} />
        </section>

        <section className="mt-6 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Link href={`/dashboard/performance?view=ranking&month=${month}`} className="rounded-xl bg-indigo-700 px-4 py-2.5 font-black text-white">
            {fr ? "Voir les KPI détaillés" : "View detailed KPIs"}
          </Link>
          <Link href="/dashboard/reports" className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 font-black text-emerald-900">
            {fr ? "Ouvrir les rapports consolidés" : "Open consolidated reports"}
          </Link>
          <Link href="/dashboard/members" className="rounded-xl border border-slate-300 px-4 py-2.5 font-black text-slate-800">
            {fr ? "Voir le périmètre humain" : "View people scope"}
          </Link>
        </section>

        {canConfigureAssignments ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
            <form action={assignManagerToExecutiveAction} className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">
                {fr ? "Architecture hiérarchique" : "Reporting structure"}
              </p>
              <h2 className="mt-2 text-2xl font-black">
                {fr ? "Affecter un Manager à un Exécutif" : "Assign a Manager to an Executive"}
              </h2>
              <label className="mt-5 grid gap-2 text-sm font-bold">
                {fr ? "Exécutif" : "Executive"}
                <select name="executiveUserId" required className="rounded-xl border border-indigo-200 bg-white px-4 py-3">
                  <option value="">{fr ? "Sélectionner" : "Select"}</option>
                  {executiveOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <label className="mt-4 grid gap-2 text-sm font-bold">
                Manager
                <select name="managerUserId" required className="rounded-xl border border-indigo-200 bg-white px-4 py-3">
                  <option value="">{fr ? "Sélectionner" : "Select"}</option>
                  {managerOptions.map((option) => {
                    const currentExecutive = option.assignedExecutiveId
                      ? executiveOptions.find((item) => item.id === option.assignedExecutiveId)?.name
                      : null;
                    return <option key={option.id} value={option.id}>{option.name}{currentExecutive ? ` - ${currentExecutive}` : ""}</option>;
                  })}
                </select>
              </label>
              <button disabled={!executiveOptions.length || !managerOptions.length} className="mt-5 w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                {fr ? "Enregistrer l’affectation" : "Save assignment"}
              </button>
              {!executiveOptions.length ? <p className="mt-3 text-sm font-semibold text-amber-800">{fr ? "Crée ou attribue d’abord le rôle Exécutif à un membre." : "Create or assign the Executive role first."}</p> : null}
            </form>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{fr ? "Affectations actives" : "Active assignments"}</h2>
              <div className="mt-4 space-y-3">
                {assignments.length ? assignments.map((assignment) => {
                  const executive = profileById.get(assignment.executive_user_id);
                  const manager = profileById.get(assignment.manager_user_id);
                  return (
                    <div key={assignment.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-black">{manager?.full_name || manager?.email || "Manager"}</p>
                        <p className="mt-1 text-sm text-slate-500">{fr ? "Supervisé par" : "Supervised by"} {executive?.full_name || executive?.email || (fr ? "Exécutif" : "Executive")}</p>
                      </div>
                      <form action={removeManagerFromExecutiveAction}>
                        <input type="hidden" name="assignmentId" value={assignment.id} />
                        <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-800">
                          {fr ? "Retirer" : "Remove"}
                        </button>
                      </form>
                    </div>
                  );
                }) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{fr ? "Aucune affectation exécutive." : "No executive assignments."}</p>}
              </div>
            </article>
          </section>
        ) : null}

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{fr ? "Performance managériale" : "Manager performance"}</p>
              <h2 className="mt-1 text-3xl font-black">{fr ? "Managers sous supervision" : "Managers in scope"}</h2>
            </div>
            <p className="text-sm font-semibold text-slate-500">{month}</p>
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            {managerSummaries.length ? managerSummaries.map((manager) => (
              <article key={manager.id} className="rounded-3xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black">{manager.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{manager.email}</p>
                    <p className="mt-2 text-xs font-bold uppercase tracking-wide text-indigo-700">
                      {manager.teamNames.length ? manager.teamNames.join(" · ") : (fr ? "Aucune équipe officielle" : "No official team")}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${manager.eligible ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                    {manager.score ? `${manager.score.toFixed(1)}/100` : "-"}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{fr ? "Équipe" : "Team"}</p><p className="mt-1 text-xl font-black">{manager.employeeCount}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{fr ? "Présence" : "Attendance"}</p><p className="mt-1 text-xl font-black">{manager.attendanceRate}%</p></div>
                  <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{fr ? "Rapports" : "Reports"}</p><p className="mt-1 text-xl font-black">{manager.reportRate}%</p></div>
                  <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{fr ? "Réunions" : "Meetings"}</p><p className="mt-1 text-xl font-black">{manager.meetingRate}%</p></div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                  <span className={`rounded-full px-3 py-1 ${manager.lateDays ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{fr ? "Retards" : "Late"}: {manager.lateDays}</span>
                  <span className={`rounded-full px-3 py-1 ${manager.absences ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{fr ? "Absences" : "Absences"}: {manager.absences}</span>
                  <span className={`rounded-full px-3 py-1 ${manager.overduePlans ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{fr ? "Plans en retard" : "Overdue plans"}: {manager.overduePlans}</span>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href={`/dashboard/performance?view=reports&month=${month}`} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">
                    {fr ? "Rapports" : "Reports"}
                  </Link>
                  <Link href={`/dashboard/performance?view=ranking&month=${month}`} className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-800">
                    KPI
                  </Link>
                  <Link href={`/dashboard/members`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700">
                    {fr ? "Équipe" : "Team"}
                  </Link>
                </div>
              </article>
            )) : (
              <p className="rounded-2xl bg-slate-50 p-8 text-center text-slate-500 xl:col-span-2">
                {membership.role === "executive"
                  ? (fr ? "Aucun Manager ne t’est encore affecté." : "No Manager has been assigned to you yet.")
                  : (fr ? "Aucun Manager n’est encore affecté à un Exécutif." : "No Manager has been assigned to an Executive yet.")}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
