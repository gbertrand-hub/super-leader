import Link from "next/link";
import { redirect } from "next/navigation";
import {
  assignMemberToTeamAction,
  cancelInvitationAction,
  removeMemberFromTeamAction,
  resendInvitationAction,
  toggleMemberStatusAction,
  updateMemberRoleAction,
} from "@/app/actions/members";
import { ManualAccessControls } from "@/components/members/manual-access-controls";
import { MemberAccessResetControls } from "@/components/members/member-access-reset-controls";
import { getI18n } from "@/i18n/server";
import { assignableRolesFor, canManageTargetRole, type AppRole } from "@/lib/auth/access-control";
import {
  canManageTeamMembers,
  isPeopleAdmin,
  isTeamManager,
} from "@/lib/auth/permissions";
import { getVisibleUserIds } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ success?: string; error?: string; organization?: string; focus?: string; filter?: string; onboarding?: string }>;

type Profile = { full_name: string | null; email: string | null; must_change_password: boolean | null };
type MembershipRow = {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
};
type Membership = MembershipRow & {
  profiles: Profile | null;
};
type ProfileRow = Profile & { id: string };
type Team = {
  id: string;
  name: string;
  department: string | null;
  manager_id?: string | null;
  is_active?: boolean;
};
type Assignment = {
  team_id: string;
  user_id: string;
  teams: Team | Team[] | null;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function MembersPage({
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
  const { data: membershipRowsForUser, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role, is_active, organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true);

  const requestedOrganizationId = String(params.organization ?? "").trim();
  const activeMemberships = membershipRowsForUser ?? [];
  const currentMembership = requestedOrganizationId
    ? activeMemberships.find(
        (row) => String(row.organization_id) === requestedOrganizationId,
      ) ?? null
    : activeMemberships.find((row) => {
        const raw = row.organizations as { name?: string } | { name?: string }[] | null;
        return one(raw)?.name?.trim().toLowerCase() === "ilead global";
      }) ?? activeMemberships[0] ?? null;

  if (membershipError) {
    throw new Error(
      t("recognition.actionMessages.organisationLoadImpossible", {
        message: membershipError.message,
      }),
    );
  }

  if (!currentMembership) redirect("/dashboard/company");

  if (!isTeamManager(currentMembership.role)) redirect("/dashboard");

  const organizationId = currentMembership.organization_id;
  const canManagePeople = isPeopleAdmin(currentMembership.role);
  const canManageMemberAssignments = canManageTeamMembers(currentMembership.role);
  const isManagerView = currentMembership.role === "manager";
  const isScopedLeaderView = ["manager", "executive"].includes(currentMembership.role);
  const assignableRoles = assignableRolesFor(currentMembership.role);
  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId,
    actorId: authData.user.id,
    role: currentMembership.role,
    includeInactive: canManagePeople,
  });

  const [membersResult, teamsResult, assignmentsResult, invitationsResult] =
    await Promise.all([
      admin
        .from("organization_members")
        .select("id,user_id,role,is_active")
        .eq("organization_id", organizationId)
        .in("user_id", visibleUserIds)
        .order("created_at"),
      admin
        .from("teams")
        .select("id,name,department,manager_id,is_active")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name"),
      admin
        .from("team_members")
        .select("team_id,user_id,teams(id,name,department)")
        .in(
          "team_id",
          (
            await admin
              .from("teams")
              .select("id")
              .eq("organization_id", organizationId)
          ).data?.map((team) => team.id) ?? [],
        ),
      admin
        .from("organization_invitations")
        .select("id,email,role,status,expires_at,created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);

  if (membersResult.error) throw new Error(membersResult.error.message);
  if (teamsResult.error) throw new Error(teamsResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (invitationsResult.error && canManagePeople) {
    throw new Error(invitationsResult.error.message);
  }

  const membershipRows = (membersResult.data ?? []) as MembershipRow[];
  const memberUserIds = membershipRows.map((member) => member.user_id);
  const profilesResult = memberUserIds.length
    ? await admin
        .from("profiles")
        .select("id,full_name,email,must_change_password")
        .in("id", memberUserIds)
    : { data: [] as ProfileRow[], error: null };

  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const profilesById = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [
      profile.id,
      { full_name: profile.full_name, email: profile.email, must_change_password: profile.must_change_password } satisfies Profile,
    ]),
  );

  const members = membershipRows
    .filter(
      (member) =>
        !isScopedLeaderView || member.user_id !== authData.user.id,
    )
    .map((member): Membership => ({
      ...member,
      profiles: profilesById.get(member.user_id) ?? null,
    }));
  const allTeams = (teamsResult.data ?? []) as Team[];
  const allAssignments = (assignmentsResult.data ?? []) as unknown as Assignment[];
  const assignments = allAssignments.filter((assignment) =>
    visibleUserIds.includes(assignment.user_id),
  );
  const teams = currentMembership.role === "manager"
    ? allTeams.filter((team) => team.manager_id === authData.user.id)
    : currentMembership.role === "executive"
      ? allTeams.filter((team) => Boolean(team.manager_id && visibleUserIds.includes(team.manager_id)))
      : allTeams;
  const invitations = canManagePeople
    ? ((invitationsResult.data ?? []) as Invitation[])
    : [];
  const rawOrg = currentMembership.organizations as
    | { name?: string }
    | { name?: string }[]
    | null;
  const organizationName = one(rawOrg)?.name ?? "Organisation";
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";

  const assignmentsByUser = new Map<string, Team[]>();
  assignments.forEach((assignment) => {
    const team = one(assignment.teams);
    if (!team) return;
    const current = assignmentsByUser.get(assignment.user_id) ?? [];
    current.push(team);
    assignmentsByUser.set(assignment.user_id, current);
  });

  const assignedUserIds = new Set(assignments.map((assignment) => assignment.user_id));
  const managerUserIds = new Set(
    teams
      .map((team) => team.manager_id)
      .filter((managerId): managerId is string => Boolean(managerId)),
  );
  const needsTeam = (member: Membership) =>
    member.is_active && !["owner", "admin"].includes(member.role);
  const isWithoutTeam = (member: Membership) =>
    needsTeam(member) &&
    !assignedUserIds.has(member.user_id) &&
    !managerUserIds.has(member.user_id);
  const isAssigned = (member: Membership) =>
    needsTeam(member) &&
    (assignedUserIds.has(member.user_id) || managerUserIds.has(member.user_id));
  const isManager = (member: Membership) =>
    member.is_active && managerUserIds.has(member.user_id);

  const requestedFilter = String(params.filter ?? "all").trim().toLowerCase();
  const activeFilter = ["without-team", "assigned", "managers"].includes(requestedFilter)
    ? requestedFilter
    : "all";
  const isOnboardingFocus = canManagePeople && String(params.focus ?? "").trim().toLowerCase() === "onboarding";
  const requestedOnboarding = String(params.onboarding ?? "all").trim().toLowerCase();
  const activeOnboarding = ["invitations", "first-login"].includes(requestedOnboarding)
    ? requestedOnboarding
    : "all";
  const invitationsNeedingAction = invitations.filter((invitation) =>
    ["pending", "expired"].includes(invitation.status),
  );
  const firstLoginMembers = members.filter(
    (member) => member.is_active && Boolean(member.profiles?.must_change_password),
  );
  const onboardingTotal = invitationsNeedingAction.length + firstLoginMembers.length;
  const withoutTeamMembers = members.filter(isWithoutTeam);
  const assignedMembers = members.filter(isAssigned);
  const managerMembers = members.filter(isManager);
  const filteredMembers =
    activeFilter === "without-team"
      ? withoutTeamMembers
      : activeFilter === "assigned"
        ? assignedMembers
        : activeFilter === "managers"
          ? managerMembers
          : members;

  const filterOptions = [
    { key: "all", fr: "Tous", en: "All", count: members.length },
    { key: "without-team", fr: "Sans équipe", en: "Without team", count: withoutTeamMembers.length },
    { key: "assigned", fr: "Affectés", en: "Assigned", count: assignedMembers.length },
    { key: "managers", fr: "Managers", en: "Managers", count: managerMembers.length },
  ];
  const filterTitle =
    activeFilter === "without-team"
      ? locale === "fr" ? "Collaborateurs sans équipe" : "Staff without a team"
      : activeFilter === "assigned"
        ? locale === "fr" ? "Collaborateurs affectés" : "Assigned staff"
        : activeFilter === "managers"
          ? locale === "fr" ? "Managers d'équipe" : "Team managers"
          : locale === "fr" ? "Tous les collaborateurs" : "All colleagues";
  const filterHelp =
    activeFilter === "without-team"
      ? locale === "fr"
        ? "Uniquement les collaborateurs actifs qui doivent encore recevoir une affectation d'équipe."
        : "Only active staff who still need a team assignment."
      : activeFilter === "assigned"
        ? locale === "fr"
          ? "Collaborateurs actifs déjà membres d'une équipe ou responsables d'une équipe."
          : "Active staff already assigned to a team or managing one."
        : activeFilter === "managers"
          ? locale === "fr"
            ? "Responsables d'une ou plusieurs équipes dans votre périmètre."
            : "People managing one or more teams in your scope."
          : t(isManagerView ? "members.managerCollaboratorsHelp" : "members.disabledHistory");
  const membersQueryBase = `/dashboard/members?organization=${encodeURIComponent(organizationId)}`;
  const onboardingQueryBase = `${membersQueryBase}&focus=onboarding`;
  const onboardingOptions = [
    { key: "all", fr: "À traiter", en: "To handle", count: onboardingTotal },
    { key: "invitations", fr: "Invitations", en: "Invitations", count: invitationsNeedingAction.length },
    { key: "first-login", fr: "Première connexion", en: "First login", count: firstLoginMembers.length },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <Link className="font-bold text-indigo-700" href="/dashboard">
          ← {t("common.backToDashboard")}
        </Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
          <p className="text-sm font-bold text-amber-400">
            {t("members.eyebrow", { organization: organizationName })}
          </p>
          <h1 className="mt-2 text-3xl font-black">
            {t(isManagerView ? "members.managerTitle" : "members.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-slate-300">
            {t(isManagerView ? "members.managerSubtitle" : "members.subtitle")}
          </p>
        </header>

        {params.success && (
          <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">
            {params.success}
          </p>
        )}
        {params.error && (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">
            {params.error}
          </p>
        )}

        {isOnboardingFocus ? (
          <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">
                  {locale === "fr" ? "Administration · Onboarding" : "Administration · Onboarding"}
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {locale === "fr" ? "Invitations & première connexion" : "Invitations & first login"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {locale === "fr"
                    ? "Uniquement les personnes qui nécessitent encore une action d’onboarding sont affichées ici."
                    : "Only people who still need an onboarding action are shown here."}
                </p>
              </div>
              <Link
                href={`${membersQueryBase}&filter=all`}
                className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
              >
                {locale === "fr" ? "Voir tous les membres →" : "View all members →"}
              </Link>
            </div>

            <nav className="mt-5 flex flex-wrap gap-2" aria-label={locale === "fr" ? "Filtres onboarding" : "Onboarding filters"}>
              {onboardingOptions.map((option) => (
                <Link
                  key={option.key}
                  href={`${onboardingQueryBase}&onboarding=${option.key}`}
                  className={`rounded-xl border px-4 py-2 text-sm font-black transition ${
                    activeOnboarding === option.key
                      ? "border-amber-600 bg-amber-500 text-slate-950"
                      : "border-slate-200 bg-white text-slate-700 hover:border-amber-300"
                  }`}
                >
                  {locale === "fr" ? option.fr : option.en} ({option.count})
                </Link>
              ))}
            </nav>

            {(activeOnboarding === "all" || activeOnboarding === "invitations") ? (
              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black">
                      {locale === "fr" ? "Invitations à traiter" : "Invitations to handle"} ({invitationsNeedingAction.length})
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {locale === "fr" ? "Invitations non acceptées ou expirées." : "Invitations that are still pending or have expired."}
                    </p>
                  </div>
                  <Link href="/dashboard/company" className="text-sm font-black text-indigo-700 hover:underline">
                    {locale === "fr" ? "Inviter un collègue →" : "Invite a colleague →"}
                  </Link>
                </div>

                <div className="mt-4 grid gap-3">
                  {invitationsNeedingAction.length ? invitationsNeedingAction.map((invitation) => (
                    <article key={invitation.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-slate-950">{invitation.email}</p>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${invitation.status === "expired" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                              {t(`members.statuses.${invitation.status}`)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            {t(`roles.${invitation.role}`)} · {locale === "fr" ? "Expire" : "Expires"}: {new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium" }).format(new Date(invitation.expires_at))}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-start gap-3">
                          <form action={resendInvitationAction}>
                            <input type="hidden" name="invitationId" value={invitation.id} />
                            <input type="hidden" name="organizationId" value={organizationId} />
                            <input type="hidden" name="returnFocus" value="onboarding" />
                            <input type="hidden" name="returnOnboarding" value={activeOnboarding} />
                            <button className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white">
                              {locale === "fr" ? "Renvoyer l’invitation" : "Resend invitation"}
                            </button>
                          </form>
                          {invitation.status === "pending" ? (
                            <form action={cancelInvitationAction}>
                              <input type="hidden" name="invitationId" value={invitation.id} />
                              <input type="hidden" name="organizationId" value={organizationId} />
                              <input type="hidden" name="returnFocus" value="onboarding" />
                              <input type="hidden" name="returnOnboarding" value={activeOnboarding} />
                              <button className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-700">
                                {locale === "fr" ? "Annuler" : "Cancel"}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </div>
                      <ManualAccessControls
                        invitationId={invitation.id}
                        email={invitation.email}
                        status={invitation.status}
                        canManage={canManagePeople}
                      />
                    </article>
                  )) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                      {locale === "fr" ? "Aucune invitation ne nécessite d’action." : "No invitation currently needs action."}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {(activeOnboarding === "all" || activeOnboarding === "first-login") ? (
              <div className="mt-6">
                <h3 className="text-xl font-black">
                  {locale === "fr" ? "Premières connexions à finaliser" : "First logins to complete"} ({firstLoginMembers.length})
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {locale === "fr"
                    ? "Comptes déjà créés qui doivent encore changer leur mot de passe temporaire."
                    : "Accounts already created that still need to change their temporary password."}
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {firstLoginMembers.length ? firstLoginMembers.map((member) => {
                    const profile = member.profiles;
                    return (
                      <article key={member.id} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-slate-950">{profile?.full_name || profile?.email || t("common.user")}</p>
                            <p className="mt-1 text-sm text-slate-600">{profile?.email || "—"}</p>
                            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-violet-700">{t(`roles.${member.role}`)}</p>
                          </div>
                          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">
                            {locale === "fr" ? "1re connexion à terminer" : "First login pending"}
                          </span>
                        </div>
                        <MemberAccessResetControls
                          memberId={member.id}
                          email={profile?.email || ""}
                          fullName={profile?.full_name || t("common.user")}
                          canReset={Boolean(member.is_active && member.role !== "owner" && member.user_id !== authData.user.id && profile?.email)}
                        />
                      </article>
                    );
                  }) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 md:col-span-2">
                      {locale === "fr" ? "Toutes les premières connexions sont finalisées." : "All first logins are complete."}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!isOnboardingFocus ? (
        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">
                {filterTitle} ({filteredMembers.length})
              </h2>
              <p className="text-sm text-slate-500">{filterHelp}</p>
            </div>
            {canManagePeople ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/dashboard/badges/manage"
                  className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 font-bold text-cyan-900"
                >
                  {locale === "fr" ? "Badges collaborateurs" : "Employee badges"}
                </Link>
                <Link
                  href="/dashboard/company"
                  className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white"
                >
                  {t("members.inviteColleague")}
                </Link>
              </div>
            ) : null}
          </div>

          <nav className="mt-5 flex flex-wrap gap-2" aria-label={locale === "fr" ? "Filtres des affectations" : "Assignment filters"}>
            {filterOptions.map((option) => (
              <Link
                key={option.key}
                href={`${membersQueryBase}&filter=${option.key}`}
                className={`rounded-xl border px-4 py-2 text-sm font-black transition ${
                  activeFilter === option.key
                    ? "border-indigo-700 bg-indigo-700 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                }`}
              >
                {locale === "fr" ? option.fr : option.en} ({option.count})
              </Link>
            ))}
          </nav>

          <div className="mt-5 grid gap-4">
            {!filteredMembers.length ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-800">
                {activeFilter === "without-team"
                  ? locale === "fr"
                    ? "Tous les collaborateurs de ce périmètre ont une affectation d'équipe."
                    : "All staff in this scope have a team assignment."
                  : locale === "fr"
                    ? "Aucun collaborateur ne correspond à ce filtre."
                    : "No staff member matches this filter."}
              </div>
            ) : null}
            {filteredMembers.map((member) => {
              const profile = one(member.profiles);
              const memberTeams = assignmentsByUser.get(member.user_id) ?? [];
              const managedTeams = teams.filter(
                (team) => team.manager_id === member.user_id,
              );
              const managedOnlyTeams = managedTeams.filter(
                (team) => !memberTeams.some((assigned) => assigned.id === team.id),
              );
              const availableTeams = teams.filter(
                (team) =>
                  team.manager_id !== member.user_id &&
                  !memberTeams.some((assigned) => assigned.id === team.id),
              );
              const canAssignTargetToTeam = member.role !== "owner";
              const targetManageable = canManageTargetRole(currentMembership.role, member.role);
              const roleOptions: AppRole[] = assignableRoles.includes(member.role as AppRole)
                ? assignableRoles
                : [member.role as AppRole, ...assignableRoles];
              return (
                <article
                  id={`member-${member.user_id}`}
                  key={member.id}
                  className={`scroll-mt-6 rounded-2xl border p-5 ${
                    params.focus === member.user_id && params.error
                      ? "border-red-300 bg-red-50/40 ring-2 ring-red-100"
                      : params.focus === member.user_id && params.success
                        ? "border-emerald-300 bg-emerald-50/30 ring-2 ring-emerald-100"
                        : member.is_active
                          ? "border-slate-200"
                          : "border-red-200 bg-red-50/40"
                  }`}
                >
                  {params.focus === member.user_id && (params.success || params.error) ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold ${
                        params.error
                          ? "bg-red-100 text-red-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {params.error ? "❌ " : "✅ "}
                      {params.error || params.success}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black">
                          {profile?.full_name || t("common.user")}
                        </h3>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            member.is_active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {member.is_active
                            ? t("members.active")
                            : t("members.disabled")}
                        </span>
                        {member.is_active ? (
                          member.role === "owner" || member.role === "admin" ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                              {locale === "fr" ? "Affectation non requise" : "Team assignment not required"}
                            </span>
                          ) : memberTeams.length || managedOnlyTeams.length ? (
                            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">
                              {managedOnlyTeams.length
                                ? locale === "fr" ? "Manager d'équipe" : "Team manager"
                                : locale === "fr" ? "Affecté" : "Assigned"}
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                              {locale === "fr" ? "Sans équipe" : "Without team"}
                            </span>
                          )
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {profile?.email || t("members.emailUnavailable")}
                      </p>
                      <div className="mt-3 rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                          {t("members.currentTeamLabel")}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                        {memberTeams.map((team) => (
                          <form
                            key={team.id}
                            action={removeMemberFromTeamAction}
                            className="inline-flex"
                          >
                            <input
                              type="hidden"
                              name="userId"
                              value={member.user_id}
                            />
                            <input type="hidden" name="teamId" value={team.id} />
                            <input
                              type="hidden"
                              name="organizationId"
                              value={organizationId}
                            />
                            <button
                              disabled={!canManageMemberAssignments}
                              className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                              title={t("members.removeFromTeam")}
                            >
                              {team.name} ×
                            </button>
                          </form>
                        ))}
                        {managedOnlyTeams.map((team) => (
                          <span
                            key={`manager-${team.id}`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800"
                          >
                            {t("members.managedTeam", { team: team.name })}
                          </span>
                        ))}
                        {!memberTeams.length && !managedOnlyTeams.length ? (
                          <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-500 ring-1 ring-slate-200">
                            {member.role === "owner"
                              ? t("members.ownerTeamNotRequired")
                              : t("members.noTeam")}
                          </span>
                        ) : null}
                        </div>
                        {managedOnlyTeams.length ? (
                          <p className="mt-2 text-xs font-semibold text-amber-800">
                            {t("members.managerResponsibilityHelp")}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {canManagePeople ? (
                      <div className="grid w-full gap-3 md:grid-cols-3 xl:max-w-3xl">
                        <form action={updateMemberRoleAction} className="flex gap-2">
                          <input type="hidden" name="memberId" value={member.id} />
                          <select
                            name="role"
                            defaultValue={member.role}
                            disabled={!targetManageable}
                            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                          >
                            {roleOptions.map((roleOption) => (
                              <option key={roleOption} value={roleOption}>
                                {t(`roles.${roleOption}`)}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!targetManageable}
                            className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
                          >
                            {t("members.modify")}
                          </button>
                        </form>

                        <div>
                        <form action={assignMemberToTeamAction} className="flex gap-2">
                          <input type="hidden" name="userId" value={member.user_id} />
                          <input type="hidden" name="organizationId" value={organizationId} />
                          <input type="hidden" name="returnFilter" value={activeFilter} />
                          <select
                            name="teamId"
                            required
                            disabled={!member.is_active || !availableTeams.length || !canAssignTargetToTeam}
                            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                          >
                            <option value="">
                              {availableTeams.length
                                ? t("members.chooseTeam")
                                : t("members.noOtherManagedTeam")}
                            </option>
                            {availableTeams.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!member.is_active || !availableTeams.length || !canAssignTargetToTeam}
                            className="rounded-xl bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
                          >
                            {t("members.assign")}
                          </button>
                        </form>
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          {member.role === "owner"
                            ? t("members.assignmentOwnerHelp")
                            : availableTeams.length
                              ? t("members.assignmentFeedbackHelp")
                              : t("members.assignmentNoTeamHelp")}
                        </p>
                        </div>

                        <form action={toggleMemberStatusAction}>
                          <input type="hidden" name="memberId" value={member.id} />
                          <input
                            type="hidden"
                            name="activate"
                            value={String(!member.is_active)}
                          />
                          <button
                            disabled={
                              !targetManageable ||
                              member.user_id === authData.user.id
                            }
                            className={`w-full rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-40 ${
                              member.is_active ? "bg-red-600" : "bg-emerald-700"
                            }`}
                          >
                            {member.is_active
                              ? t("members.deactivate")
                              : t("members.reactivate")}
                          </button>
                        </form>
                      </div>
                    ) : (
                      <aside className="w-full rounded-2xl border border-indigo-100 bg-indigo-50 p-4 xl:max-w-xl">
                        <p className="text-xs font-black uppercase tracking-wide text-indigo-700">
                          {t("members.managerAssignmentLabel")}
                        </p>
                        <p className="mt-2 text-sm text-slate-700">
                          {t("members.managerReadOnlyHelp")}
                        </p>
                        {canManageMemberAssignments ? (
                          <form action={assignMemberToTeamAction} className="mt-4 flex gap-2">
                            <input type="hidden" name="userId" value={member.user_id} />
                            <input type="hidden" name="organizationId" value={organizationId} />
                            <input type="hidden" name="returnFilter" value={activeFilter} />
                            <select
                              name="teamId"
                              required
                              disabled={!member.is_active || !availableTeams.length}
                              className="min-w-0 flex-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 disabled:bg-slate-100"
                            >
                              <option value="">
                                {availableTeams.length
                                  ? t("members.chooseManagedTeam")
                                  : t("members.noOtherManagedTeam")}
                              </option>
                              {availableTeams.map((team) => (
                                <option key={team.id} value={team.id}>
                                  {team.name}
                                </option>
                              ))}
                            </select>
                            <button
                              disabled={!member.is_active || !availableTeams.length}
                              className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t("members.assign")}
                            </button>
                          </form>
                        ) : null}
                        <p className="mt-3 text-xs text-indigo-800">
                          {t("members.managerAssignmentHelp")}
                        </p>
                      </aside>
                    )}
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t("members.currentRole", {
                      role: t(`roles.${member.role}`),
                    })}
                  </p>
                  <MemberAccessResetControls
                    memberId={member.id}
                    email={profile?.email || ""}
                    fullName={profile?.full_name || t("common.user")}
                    canReset={
                      canManagePeople &&
                      member.is_active &&
                      member.role !== "owner" &&
                      member.user_id !== authData.user.id &&
                      Boolean(profile?.email)
                    }
                  />
                </article>
              );
            })}
          </div>
        </section>
        ) : null}

        {canManagePeople && activeFilter === "all" && !isOnboardingFocus ? (
          <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">{t("members.invitations")}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {t("members.invitationHelp")}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="p-3">{t("common.email")}</th>
                  <th className="p-3">{t("common.role")}</th>
                  <th className="p-3">{t("common.status")}</th>
                  <th className="p-3">{t("common.expiration")}</th>
                  <th className="p-3">{t("common.action")}</th>
                </tr>
              </thead>
              <tbody>
                {invitations.length ? (
                  invitations.map((invitation) => (
                    <tr key={invitation.id} className="border-b border-slate-100">
                      <td className="p-3 font-semibold">{invitation.email}</td>
                      <td className="p-3">{t(`roles.${invitation.role}`)}</td>
                      <td className="p-3">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase">
                          {t(`members.statuses.${invitation.status}`)}
                        </span>
                      </td>
                      <td className="p-3">
                        {new Intl.DateTimeFormat(dateLocale, {
                          dateStyle: "medium",
                        }).format(new Date(invitation.expires_at))}
                      </td>
                      <td className="p-3 align-top">
                        {["pending", "expired"].includes(invitation.status) &&
                        canManagePeople ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <form action={resendInvitationAction}>
                              <input
                                type="hidden"
                                name="invitationId"
                                value={invitation.id}
                              />
                              <button className="font-bold text-indigo-700">
                                {t("members.resend")}
                              </button>
                            </form>
                            {invitation.status === "pending" && (
                              <form action={cancelInvitationAction}>
                                <input
                                  type="hidden"
                                  name="invitationId"
                                  value={invitation.id}
                                />
                                <button className="font-bold text-red-600">
                                  {t("members.cancel")}
                                </button>
                              </form>
                            )}
                          </div>
                        ) : invitation.status === "accepted" ? (
                          <span className="text-xs font-semibold text-emerald-700">
                            {t("members.accountActivated")}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}

                        <ManualAccessControls
                          invitationId={invitation.id}
                          email={invitation.email}
                          status={invitation.status}
                          canManage={canManagePeople}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={5}>
                      {t("members.noInvitations")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
