import Link from "next/link";
import { redirect } from "next/navigation";
import {
  archiveTeamAction,
  assignTeamManagerAction,
  assignTeamMemberAction,
  createTeamDirectAction,
  removeTeamMemberDirectAction,
  restoreTeamAction,
  updateTeamDetailsAction,
} from "@/app/actions/company";
import { getI18n } from "@/i18n/server";
import {
  canManageTeamAssignments,
  canManageTeamMembers,
  canManageTeamStructure,
  isTeamManager,
} from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{
  team?: string;
  q?: string;
  department?: string;
  status?: string;
  manager?: string;
  success?: string;
  error?: string;
}>;

type OrganizationRelation = { name?: string | null } | { name?: string | null }[] | null;

type Team = {
  id: string;
  organization_id: string;
  name: string;
  department: string | null;
  manager_id: string | null;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Membership = {
  user_id: string;
  role: string;
  is_active: boolean;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type TeamMember = {
  team_id: string;
  user_id: string;
  created_at: string;
};

type Activity = {
  id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function profileName(profile: Profile | undefined, fallback: string): string {
  return profile?.full_name?.trim() || profile?.email?.trim() || fallback;
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "SL";
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { t, locale } = await getI18n();
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: currentMembership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id,role,is_active,organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) throw new Error(membershipError.message);
  if (!currentMembership) redirect("/dashboard/company");
  if (!isTeamManager(currentMembership.role)) redirect("/dashboard");

  const organizationId = currentMembership.organization_id;
  const canEditStructure = canManageTeamStructure(currentMembership.role);
  const canEditManagerAssignments = canManageTeamAssignments(currentMembership.role);
  const canEditMemberAssignments = canManageTeamMembers(currentMembership.role);
  const organizationName =
    one(currentMembership.organizations as OrganizationRelation)?.name ??
    t("common.team");

  let teamsQuery = admin
    .from("teams")
    .select(
      "id,organization_id,name,department,manager_id,is_active,archived_at,created_at,updated_at",
    )
    .eq("organization_id", organizationId)
    .order("is_active", { ascending: false })
    .order("name");

  if (currentMembership.role === "manager") {
    teamsQuery = teamsQuery
      .eq("manager_id", authData.user.id)
      .eq("is_active", true);
  }

  const { data: teamRows, error: teamsError } = await teamsQuery;

  if (teamsError) {
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-6xl">
          <Link className="font-bold text-indigo-700" href="/dashboard">
            ← {t("common.backToDashboard")}
          </Link>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <p className="text-sm font-black uppercase text-amber-700">
              {t("teams.databaseSetupTitle")}
            </p>
            <h1 className="mt-2 text-2xl font-black">{t("teams.databaseSetupHeading")}</h1>
            <p className="mt-3 text-slate-700">{t("teams.databaseSetupDescription")}</p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
              supabase/020_team_management_v2_1.sql
            </code>
            <p className="mt-4 text-sm text-slate-600">{teamsError.message}</p>
          </section>
        </div>
      </main>
    );
  }

  const teams = (teamRows ?? []) as Team[];
  const teamIds = teams.map((team) => team.id);

  let assignments: TeamMember[] = [];
  if (teamIds.length) {
    const { data, error } = await admin
      .from("team_members")
      .select("team_id,user_id,created_at")
      .in("team_id", teamIds);
    if (error) throw new Error(error.message);
    assignments = (data ?? []) as TeamMember[];
  }

  const assignmentsByTeam = new Map<string, TeamMember[]>();
  assignments.forEach((assignment) => {
    const current = assignmentsByTeam.get(assignment.team_id) ?? [];
    current.push(assignment);
    assignmentsByTeam.set(assignment.team_id, current);
  });

  const selectedTeam = params.team
    ? teams.find((team) => team.id === params.team) ??
      teams.find((team) => team.is_active) ??
      teams[0] ??
      null
    : teams.find((team) => team.is_active) ?? teams[0] ?? null;
  const selectedAssignments = selectedTeam
    ? assignmentsByTeam.get(selectedTeam.id) ?? []
    : [];

  let activities: Activity[] = [];
  if (selectedTeam) {
    const { data, error } = await admin
      .from("team_activity_log")
      .select("id,actor_id,action,target_user_id,details,created_at")
      .eq("organization_id", organizationId)
      .eq("team_id", selectedTeam.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    activities = (data ?? []) as Activity[];
  }

  const managerVisibleUserIds = Array.from(
    new Set([
      authData.user.id,
      ...teams.flatMap((team) => (team.manager_id ? [team.manager_id] : [])),
      ...assignments.map((assignment) => assignment.user_id),
    ]),
  );

  let membershipQuery = admin
    .from("organization_members")
    .select("user_id,role,is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at");

  if (currentMembership.role === "manager") {
    membershipQuery = membershipQuery.in("user_id", managerVisibleUserIds);
  }

  const { data: membershipRows, error: membersError } = await membershipQuery;
  if (membersError) throw new Error(membersError.message);
  const memberships = (membershipRows ?? []) as Membership[];

  const allUserIds = Array.from(
    new Set([
      authData.user.id,
      ...memberships.map((membership) => membership.user_id),
      ...teams.flatMap((team) => (team.manager_id ? [team.manager_id] : [])),
      ...assignments.map((assignment) => assignment.user_id),
      ...activities.flatMap((activity) =>
        [activity.actor_id, activity.target_user_id].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ]),
  );

  const { data: profileRows, error: profilesError } = allUserIds.length
    ? await admin
        .from("profiles")
        .select("id,full_name,email")
        .in("id", allUserIds)
    : { data: [] as Profile[], error: null };
  if (profilesError) throw new Error(profilesError.message);

  const profiles = (profileRows ?? []) as Profile[];
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const membershipsById = new Map(
    memberships.map((membership) => [membership.user_id, membership]),
  );

  const assignedUserIds = new Set(selectedAssignments.map((row) => row.user_id));
  const managerOptions = memberships.filter((membership) => membership.role === "manager");
  const memberOptions = memberships.filter(
    (membership) =>
      membership.role !== "owner" &&
      membership.user_id !== selectedTeam?.manager_id &&
      !assignedUserIds.has(membership.user_id),
  );

  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const activeTeams = teams.filter((team) => team.is_active);
  const archivedTeams = teams.filter((team) => !team.is_active);
  const departments = Array.from(
    new Set(
      teams
        .map((team) => team.department?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, dateLocale));
  const assignedMemberCount = new Set(assignments.map((assignment) => assignment.user_id)).size;
  const activeTeamsWithManager = activeTeams.filter((team) => Boolean(team.manager_id)).length;

  const searchQuery = String(params.q ?? "").trim().toLocaleLowerCase(dateLocale);
  const departmentFilter = String(params.department ?? "").trim();
  const statusFilter = ["all", "active", "archived"].includes(String(params.status))
    ? String(params.status)
    : "active";
  const managerFilter = ["all", "assigned", "unassigned"].includes(String(params.manager))
    ? String(params.manager)
    : "all";

  const filteredTeams = teams.filter((team) => {
    const managerName = team.manager_id
      ? profileName(profilesById.get(team.manager_id), t("common.user"))
      : "";
    const searchable = [team.name, team.department ?? "", managerName]
      .join(" ")
      .toLocaleLowerCase(dateLocale);

    if (searchQuery && !searchable.includes(searchQuery)) return false;
    if (departmentFilter && team.department !== departmentFilter) return false;
    if (statusFilter === "active" && !team.is_active) return false;
    if (statusFilter === "archived" && team.is_active) return false;
    if (managerFilter === "assigned" && !team.manager_id) return false;
    if (managerFilter === "unassigned" && team.manager_id) return false;
    return true;
  });

  const filteredActiveTeams = filteredTeams.filter((team) => team.is_active);
  const filteredArchivedTeams = filteredTeams.filter((team) => !team.is_active);
  const hasFilters = Boolean(
    searchQuery ||
      departmentFilter ||
      statusFilter !== "active" ||
      managerFilter !== "all",
  );

  function teamHref(teamId: string): string {
    const query = new URLSearchParams({team: teamId});
    if (params.q) query.set("q", params.q);
    if (params.department) query.set("department", params.department);
    if (params.status) query.set("status", params.status);
    if (params.manager) query.set("manager", params.manager);
    return `/dashboard/team?${query.toString()}`;
  }

  const clearFiltersHref = selectedTeam
    ? `/dashboard/team?team=${encodeURIComponent(selectedTeam.id)}`
    : "/dashboard/team";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-[1600px]">
        <Link className="font-bold text-indigo-700" href="/dashboard">
          ← {t("common.backToDashboard")}
        </Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
          <p className="text-sm font-bold uppercase text-amber-400">
            {t("teams.eyebrow")} · {organizationName}
          </p>
          <h1 className="mt-2 text-3xl font-black">{t("teams.title")}</h1>
          <p className="mt-2 max-w-3xl text-slate-300">{t("teams.subtitle")}</p>
        </header>

        {params.success ? (
          <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">
            {params.success}
          </p>
        ) : null}
        {params.error ? (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">
            {params.error}
          </p>
        ) : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              {t("teams.metrics.departments")}
            </p>
            <p className="mt-3 text-3xl font-black">{departments.length}</p>
            <p className="mt-1 text-sm text-slate-500">{t("teams.metrics.departmentsHelp")}</p>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              {t("teams.metrics.activeTeams")}
            </p>
            <p className="mt-3 text-3xl font-black">{activeTeams.length}</p>
            <p className="mt-1 text-sm text-slate-500">{t("teams.metrics.activeTeamsHelp")}</p>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              {t("teams.metrics.assignedMembers")}
            </p>
            <p className="mt-3 text-3xl font-black">{assignedMemberCount}</p>
            <p className="mt-1 text-sm text-slate-500">{t("teams.metrics.assignedMembersHelp")}</p>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              {t("teams.metrics.managerCoverage")}
            </p>
            <p className="mt-3 text-3xl font-black">
              {activeTeamsWithManager}/{activeTeams.length}
            </p>
            <p className="mt-1 text-sm text-slate-500">{t("teams.metrics.managerCoverageHelp")}</p>
          </article>
        </section>

        {canEditStructure ? (
          <details className="group mt-6 rounded-3xl border border-indigo-100 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">
                  {t("teams.createTeamAction")}
                </p>
                <h2 className="mt-1 text-xl font-black">{t("teams.newTeam")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("teams.newTeamHelp")}</p>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-700 text-2xl font-black text-white transition group-open:rotate-45">
                +
              </span>
            </summary>
            <form
              action={createTeamDirectAction}
              className="grid gap-4 border-t border-slate-100 p-6 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <label className="grid gap-2 text-sm font-black">
                {t("teams.name")}
                <input
                  name="name"
                  required
                  maxLength={120}
                  className="rounded-xl border border-slate-300 px-4 py-3 font-medium"
                />
              </label>
              <label className="grid gap-2 text-sm font-black">
                {t("teams.department")}
                <input
                  name="department"
                  maxLength={120}
                  placeholder={t("teams.departmentPlaceholder")}
                  className="rounded-xl border border-slate-300 px-4 py-3 font-medium"
                />
              </label>
              <label className="grid gap-2 text-sm font-black">
                {t("teams.manager")}
                <select
                  name="managerId"
                  className="rounded-xl border border-slate-300 px-4 py-3 font-medium"
                >
                  <option value="">{t("teams.assignLater")}</option>
                  {managerOptions.map((manager) => (
                    <option key={manager.user_id} value={manager.user_id}>
                      {profileName(profilesById.get(manager.user_id), t("common.user"))}
                    </option>
                  ))}
                </select>
              </label>
              <button className="rounded-xl bg-indigo-700 px-6 py-3 font-black text-white hover:bg-indigo-800">
                {t("teams.createTeam")}
              </button>
            </form>
          </details>
        ) : (
          <section className="mt-6 rounded-3xl border border-indigo-100 bg-indigo-50 p-6">
            <p className="text-sm font-black uppercase text-indigo-700">
              {t("teams.yourScope")}
            </p>
            <p className="mt-2 text-slate-700">{t("teams.managerScopeHelp")}</p>
          </section>
        )}

        <section className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(390px,440px)_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6 xl:flex xl:max-h-[calc(100vh-3rem)] xl:flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">
                  {t("teams.directoryEyebrow")}
                </p>
                <h2 className="mt-1 text-xl font-black">
                  {t("teams.visibleTeams", {count: filteredTeams.length})}
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                {teams.length}
              </span>
            </div>

            <form action="/dashboard/team" method="get" className="mt-5 grid gap-3">
              {selectedTeam ? <input type="hidden" name="team" value={selectedTeam.id} /> : null}
              <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                {t("teams.searchLabel")}
                <input
                  type="search"
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder={t("teams.searchPlaceholder")}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium normal-case tracking-normal text-slate-950"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  {t("teams.department")}
                  <select
                    name="department"
                    defaultValue={departmentFilter}
                    className="min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium normal-case tracking-normal text-slate-950"
                  >
                    <option value="">{t("teams.allDepartments")}</option>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  {t("common.status")}
                  <select
                    name="status"
                    defaultValue={statusFilter}
                    className="min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium normal-case tracking-normal text-slate-950"
                  >
                    <option value="all">{t("teams.allStatuses")}</option>
                    <option value="active">{t("teams.active")}</option>
                    <option value="archived">{t("teams.archived")}</option>
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  {t("teams.manager")}
                  <select
                    name="manager"
                    defaultValue={managerFilter}
                    className="min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium normal-case tracking-normal text-slate-950"
                  >
                    <option value="all">{t("teams.allManagers")}</option>
                    <option value="assigned">{t("teams.managerAssigned")}</option>
                    <option value="unassigned">{t("teams.managerUnassigned")}</option>
                  </select>
                </label>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800">
                  {t("teams.applyFilters")}
                </button>
                {hasFilters ? (
                  <Link
                    href={clearFiltersHref}
                    className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"
                  >
                    {t("teams.clearFilters")}
                  </Link>
                ) : null}
              </div>
            </form>

            <div className="mt-5 space-y-5 xl:min-h-0 xl:flex-1 xl:overflow-x-hidden xl:overflow-y-auto xl:pr-2">
              {filteredActiveTeams.length ? (
                <section>
                  <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    {t("teams.activeTeams", {count: filteredActiveTeams.length})}
                  </h3>
                  <div className="mt-3 grid gap-3">
                    {filteredActiveTeams.map((team) => {
                      const manager = team.manager_id
                        ? profilesById.get(team.manager_id)
                        : undefined;
                      const memberCount = assignmentsByTeam.get(team.id)?.length ?? 0;
                      const selected = selectedTeam?.id === team.id;
                      return (
                        <Link
                          key={team.id}
                          href={teamHref(team.id)}
                          className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md ${
                            selected
                              ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-black">{team.name}</p>
                              <p className="mt-1 truncate text-sm text-slate-500">
                                {team.department || t("teams.noDepartment")}
                              </p>
                            </div>
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-800">
                              {t("teams.active")}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="font-black text-slate-500">{t("teams.manager")}</p>
                              <p className="mt-1 truncate font-bold text-slate-800">
                                {manager
                                  ? profileName(manager, t("common.user"))
                                  : t("teams.notAssigned")}
                              </p>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="font-black text-slate-500">{t("teams.members")}</p>
                              <p className="mt-1 font-bold text-slate-800">{memberCount}</p>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {filteredArchivedTeams.length ? (
                <section>
                  <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    {t("teams.archivedTeams", {count: filteredArchivedTeams.length})}
                  </h3>
                  <div className="mt-3 grid gap-3">
                    {filteredArchivedTeams.map((team) => {
                      const selected = selectedTeam?.id === team.id;
                      return (
                        <Link
                          key={team.id}
                          href={teamHref(team.id)}
                          className={`rounded-2xl border p-4 transition hover:border-slate-400 ${
                            selected
                              ? "border-slate-500 bg-slate-100 ring-2 ring-slate-200"
                              : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-black">{team.name}</p>
                              <p className="mt-1 truncate text-sm text-slate-500">
                                {team.department || t("teams.noDepartment")}
                              </p>
                            </div>
                            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-700">
                              {t("teams.archived")}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {!filteredTeams.length ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="font-black">{t("teams.noFilteredTeams")}</p>
                  <p className="mt-2 text-sm text-slate-500">{t("teams.noFilteredTeamsHelp")}</p>
                  {hasFilters ? (
                    <Link
                      href={clearFiltersHref}
                      className="mt-4 inline-flex rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white"
                    >
                      {t("teams.clearFilters")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>

          <div className="min-w-0">
            {!selectedTeam ? (
              <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100 text-2xl">
                  👥
                </div>
                <h2 className="mt-5 text-2xl font-black">{t("teams.selectTeamTitle")}</h2>
                <p className="mx-auto mt-2 max-w-xl text-slate-600">
                  {t("teams.selectTeamHelp")}
                </p>
              </section>
            ) : (
              <section className="space-y-6">
                <article className="rounded-3xl bg-slate-950 p-7 text-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-black uppercase text-amber-400">
                        {selectedTeam.department || t("teams.noDepartment")}
                      </p>
                      <h2 className="mt-2 text-3xl font-black">{selectedTeam.name}</h2>
                      <p className="mt-2 text-slate-300">
                        {t("teams.teamSummary", {
                          members: selectedAssignments.length,
                          manager: selectedTeam.manager_id
                            ? profileName(
                                profilesById.get(selectedTeam.manager_id),
                                t("common.user"),
                              )
                            : t("teams.notAssigned"),
                        })}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-4 py-2 text-sm font-black ${
                        selectedTeam.is_active
                          ? "bg-emerald-400 text-emerald-950"
                          : "bg-slate-700 text-white"
                      }`}
                    >
                      {selectedTeam.is_active
                        ? t("teams.active")
                        : t("teams.archived")}
                    </span>
                  </div>
                </article>

                <div className="grid gap-6 lg:grid-cols-2">
                  <article className="rounded-3xl bg-white p-6 shadow-sm">
                    <h3 className="text-xl font-black">{t("teams.teamDetails")}</h3>
                    {canEditStructure ? (
                      <form action={updateTeamDetailsAction} className="mt-5 space-y-4">
                        <input type="hidden" name="teamId" value={selectedTeam.id} />
                        <label className="grid gap-2 text-sm font-black">
                          {t("teams.name")}
                          <input
                            name="name"
                            required
                            maxLength={120}
                            defaultValue={selectedTeam.name}
                            disabled={!selectedTeam.is_active}
                            className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                          />
                        </label>
                        <label className="grid gap-2 text-sm font-black">
                          {t("teams.department")}
                          <input
                            name="department"
                            maxLength={120}
                            defaultValue={selectedTeam.department ?? ""}
                            disabled={!selectedTeam.is_active}
                            className="rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100"
                          />
                        </label>
                        <button
                          disabled={!selectedTeam.is_active}
                          className="w-full rounded-xl bg-slate-950 px-4 py-3 font-black text-white disabled:opacity-40"
                        >
                          {t("teams.saveChanges")}
                        </button>
                      </form>
                    ) : (
                      <dl className="mt-5 grid gap-4 text-sm">
                        <div>
                          <dt className="font-black text-slate-500">{t("teams.name")}</dt>
                          <dd className="mt-1 text-lg font-bold">{selectedTeam.name}</dd>
                        </div>
                        <div>
                          <dt className="font-black text-slate-500">
                            {t("teams.department")}
                          </dt>
                          <dd className="mt-1 text-lg font-bold">
                            {selectedTeam.department || t("teams.noDepartment")}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </article>

                  <article className="rounded-3xl bg-white p-6 shadow-sm">
                    <h3 className="text-xl font-black">{t("teams.teamManager")}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {t("teams.teamManagerHelp")}
                    </p>
                    {selectedTeam.manager_id ? (
                      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-indigo-50 p-4">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-700 font-black text-white">
                          {initials(
                            profileName(
                              profilesById.get(selectedTeam.manager_id),
                              t("common.user"),
                            ),
                          )}
                        </span>
                        <div>
                          <p className="font-black">
                            {profileName(
                              profilesById.get(selectedTeam.manager_id),
                              t("common.user"),
                            )}
                          </p>
                          <p className="text-sm text-indigo-700">{t("roles.manager")}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                        {t("teams.noManagerWarning")}
                      </p>
                    )}
                    {canEditManagerAssignments && selectedTeam.is_active ? (
                      <form action={assignTeamManagerAction} className="mt-4 flex gap-2">
                        <input type="hidden" name="teamId" value={selectedTeam.id} />
                        <select
                          name="managerId"
                          defaultValue={selectedTeam.manager_id ?? ""}
                          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3"
                        >
                          <option value="">{t("teams.noManager")}</option>
                          {managerOptions.map((manager) => (
                            <option key={manager.user_id} value={manager.user_id}>
                              {profileName(
                                profilesById.get(manager.user_id),
                                t("common.user"),
                              )}
                            </option>
                          ))}
                        </select>
                        <button className="rounded-xl bg-indigo-700 px-4 py-3 font-black text-white">
                          {t("teams.assign")}
                        </button>
                      </form>
                    ) : null}
                  </article>
                </div>

                <article className="rounded-3xl bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-black">
                        {t("teams.teamMembers", { count: selectedAssignments.length })}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {t("teams.teamMembersHelp")}
                      </p>
                    </div>
                    {canEditMemberAssignments && selectedTeam.is_active ? (
                      <form action={assignTeamMemberAction} className="flex min-w-72 gap-2">
                        <input type="hidden" name="teamId" value={selectedTeam.id} />
                        <select
                          name="userId"
                          required
                          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2"
                        >
                          <option value="">{t("teams.chooseMember")}</option>
                          {memberOptions.map((membership) => (
                            <option key={membership.user_id} value={membership.user_id}>
                              {profileName(
                                profilesById.get(membership.user_id),
                                t("common.user"),
                              )}{" "}
                              · {t(`roles.${membership.role}`)}
                            </option>
                          ))}
                        </select>
                        <button className="rounded-xl bg-indigo-700 px-4 py-2 font-black text-white">
                          {t("teams.add")}
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-3">
                    {selectedAssignments.map((assignment) => {
                      const memberProfile = profilesById.get(assignment.user_id);
                      const memberMembership = membershipsById.get(assignment.user_id);
                      const name = profileName(memberProfile, t("common.user"));
                      return (
                        <div
                          key={assignment.user_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white">
                              {initials(name)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-black">{name}</p>
                              <p className="truncate text-sm text-slate-500">
                                {memberProfile?.email || t("members.emailUnavailable")}
                                {memberMembership
                                  ? ` · ${t(`roles.${memberMembership.role}`)}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          {canEditMemberAssignments && selectedTeam.is_active ? (
                            <form action={removeTeamMemberDirectAction}>
                              <input type="hidden" name="teamId" value={selectedTeam.id} />
                              <input type="hidden" name="userId" value={assignment.user_id} />
                              <button className="rounded-xl border border-red-200 px-4 py-2 text-sm font-black text-red-700 hover:bg-red-50">
                                {t("teams.remove")}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      );
                    })}
                    {!selectedAssignments.length ? (
                      <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">
                        {t("teams.noMembers")}
                      </p>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-3xl bg-white p-6 shadow-sm">
                  <h3 className="text-xl font-black">{t("teams.history")}</h3>
                  <p className="mt-1 text-sm text-slate-500">{t("teams.historyHelp")}</p>
                  <div className="mt-5 grid gap-3">
                    {activities.map((activity) => {
                      const actor = activity.actor_id
                        ? profileName(profilesById.get(activity.actor_id), t("common.user"))
                        : t("teams.system");
                      const target = activity.target_user_id
                        ? profileName(
                            profilesById.get(activity.target_user_id),
                            t("common.user"),
                          )
                        : "";
                      return (
                        <div
                          key={activity.id}
                          className="rounded-2xl border border-slate-200 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="font-black">
                              {t(`teams.activity.${activity.action}`)}
                            </p>
                            <time className="text-xs text-slate-500">
                              {new Intl.DateTimeFormat(dateLocale, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(activity.created_at))}
                            </time>
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            {t("teams.activityBy", { actor })}
                            {target ? ` · ${target}` : ""}
                          </p>
                        </div>
                      );
                    })}
                    {!activities.length ? (
                      <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                        {t("teams.noHistory")}
                      </p>
                    ) : null}
                  </div>
                </article>

                {canEditStructure ? (
                  <article className="rounded-3xl border border-red-200 bg-red-50 p-6">
                    <h3 className="text-xl font-black text-red-900">
                      {t("teams.lifecycle")}
                    </h3>
                    <p className="mt-2 text-sm text-red-800">
                      {selectedTeam.is_active
                        ? t("teams.archiveHelp")
                        : t("teams.restoreHelp")}
                    </p>
                    <form
                      action={selectedTeam.is_active ? archiveTeamAction : restoreTeamAction}
                      className="mt-4"
                    >
                      <input type="hidden" name="teamId" value={selectedTeam.id} />
                      <button
                        className={`rounded-xl px-5 py-3 font-black text-white ${
                          selectedTeam.is_active ? "bg-red-700" : "bg-emerald-700"
                        }`}
                      >
                        {selectedTeam.is_active
                          ? t("teams.archiveTeam")
                          : t("teams.restoreTeam")}
                      </button>
                    </form>
                  </article>
                ) : null}
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
