import Link from "next/link";
import {redirect} from "next/navigation";
import {
  assignAcademyResponsibilityAction,
  deactivateAcademyResponsibilityAction,
} from "@/app/actions/academy-responsibilities";
import {
  academyStaffRoleToResponsibilityCode,
  buildEffectiveAcademyResponsibilityProfiles,
  getAcademyResponsibilityProfileFrom,
  type AcademyResponsibilityProfileOverrideRow,
  type LocalizedText,
} from "@/lib/academy/responsibilities";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type AssignmentRow = {
  id: string;
  user_id: string;
  role_code: string;
  context_label: string;
  notes: string | null;
  assigned_at: string;
  is_active: boolean;
  source: "responsibility" | "academy_staff";
  school_id: string | null;
};
type StaffAssignmentRow = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  user_id: string;
  assignment_role: string;
  created_at: string;
  is_active: boolean;
};
type ProfileRow = {id: string; full_name: string | null; email: string | null};

type Locale = "fr" | "en";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function text(value: LocalizedText, locale: Locale) {
  return locale === "fr" ? value.fr : value.en;
}

function dateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(value));
}

function SectionList({title, items, locale}: {title: string; items: LocalizedText[]; locale: Locale}) {
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">{title}</h3>
      <ul className="mt-4 space-y-2">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
            <span>{text(item, locale)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function AcademyResponsibilitiesPage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const success = first(params.success);
  const errorMessage = first(params.error);
  const selectedRole = first(params.role);
  const {locale: rawLocale} = await getI18n();
  const locale: Locale = rawLocale === "fr" ? "fr" : "en";

  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");

  const schemaCheck = await admin
    .from("academy_responsibility_assignments")
    .select("id", {head: true, count: "exact"})
    .limit(1);

  if (schemaCheck.error) {
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-5xl">
          <Link href="/dashboard/academy" className="font-bold text-indigo-700">← {locale === "fr" ? "Retour à l’Académie" : "Back to Academy"}</Link>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h1 className="text-2xl font-black text-amber-950">{locale === "fr" ? "Activation requise" : "Setup required"}</h1>
            <p className="mt-3 leading-7 text-amber-900">
              {locale === "fr"
                ? "Exécutez la migration ci-dessous dans Supabase avant d’utiliser Mes responsabilités."
                : "Run the migration below in Supabase before using My responsibilities."}
            </p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/124_academy_responsibilities_v4_8_85.sql</code>
          </section>
        </div>
      </main>
    );
  }

  const globalAcademyGovernance = ["owner", "admin", "hr"].includes(membership.role);
  const canEditResponsibilityReference = ["owner", "admin"].includes(membership.role);

  const referenceOverrideResult = await admin
    .from("academy_responsibility_profile_overrides")
    .select("role_code, profile_json, revision, is_customized")
    .eq("organization_id", membership.organization_id);
  const effectiveProfiles = buildEffectiveAcademyResponsibilityProfiles(
    referenceOverrideResult.error
      ? []
      : ((referenceOverrideResult.data ?? []) as AcademyResponsibilityProfileOverrideRow[]),
  );
  const getProfile = (code: string) => getAcademyResponsibilityProfileFrom(effectiveProfiles, code);

  const [ownManualResult, ownStaffResult, schoolsResult, programsResult, cohortsResult] = await Promise.all([
    admin
      .from("academy_responsibility_assignments")
      .select("id, user_id, role_code, context_label, notes, assigned_at, is_active")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .order("assigned_at", {ascending: false}),
    admin
      .from("academy_staff_assignments")
      .select("id, school_id, program_id, cohort_id, user_id, assignment_role, created_at, is_active")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .order("created_at", {ascending: false}),
    admin.from("academy_schools").select("id, name").eq("organization_id", membership.organization_id),
    admin.from("academy_programs").select("id, name").eq("organization_id", membership.organization_id),
    admin.from("academy_cohorts").select("id, name").eq("organization_id", membership.organization_id),
  ]);

  if (ownManualResult.error) throw new Error(ownManualResult.error.message);
  if (ownStaffResult.error) throw new Error(ownStaffResult.error.message);
  if (schoolsResult.error) throw new Error(schoolsResult.error.message);
  if (programsResult.error) throw new Error(programsResult.error.message);
  if (cohortsResult.error) throw new Error(cohortsResult.error.message);

  const schoolById = new Map((schoolsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const programById = new Map((programsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  const cohortById = new Map((cohortsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  const mapManualAssignment = (row: Omit<AssignmentRow, "source" | "school_id">): AssignmentRow => ({
    ...row,
    source: "responsibility",
    school_id: null,
  });

  const mapStaffAssignment = (row: StaffAssignmentRow): AssignmentRow | null => {
    const roleCode = academyStaffRoleToResponsibilityCode(row.assignment_role);
    if (!roleCode) return null;
    const contextParts = [
      schoolById.get(row.school_id),
      row.program_id ? programById.get(row.program_id) : null,
      row.cohort_id ? cohortById.get(row.cohort_id) : null,
    ].filter((value): value is string => Boolean(value));
    return {
      id: `staff:${row.id}`,
      user_id: row.user_id,
      role_code: roleCode,
      context_label: contextParts.join(" · "),
      notes: null,
      assigned_at: row.created_at,
      is_active: row.is_active,
      source: "academy_staff",
      school_id: row.school_id,
    };
  };

  const mergeAssignments = (rows: AssignmentRow[]) => {
    const merged = new Map<string, AssignmentRow>();
    for (const row of rows) {
      const key = `${row.user_id}|${row.role_code}|${row.context_label.trim().toLocaleLowerCase()}`;
      const existing = merged.get(key);
      if (!existing || row.source === "academy_staff") merged.set(key, row);
    }
    return [...merged.values()].sort((a, b) => Date.parse(b.assigned_at) - Date.parse(a.assigned_at));
  };

  const ownManualAssignments = ((ownManualResult.data ?? []) as Omit<AssignmentRow, "source" | "school_id">[]).map(mapManualAssignment);
  const ownStaffRows = (ownStaffResult.data ?? []) as StaffAssignmentRow[];
  const ownStaffAssignments = ownStaffRows.map(mapStaffAssignment).filter((row): row is AssignmentRow => Boolean(row));
  const ownAssignments = mergeAssignments([...ownStaffAssignments, ...ownManualAssignments]);
  const directorSchoolIds = new Set(
    ownStaffRows.filter((row) => row.assignment_role === "director").map((row) => row.school_id),
  );
  const canViewTeamAssignments = globalAcademyGovernance || directorSchoolIds.size > 0;
  const canCreateManualAssignment = globalAcademyGovernance;

  let profiles: ProfileRow[] = [];
  let activeAssignments: AssignmentRow[] = ownAssignments;

  if (canViewTeamAssignments) {
    const [allStaffResult, allManualResult] = await Promise.all([
      admin
        .from("academy_staff_assignments")
        .select("id, school_id, program_id, cohort_id, user_id, assignment_role, created_at, is_active")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .order("created_at", {ascending: false}),
      globalAcademyGovernance
        ? admin
            .from("academy_responsibility_assignments")
            .select("id, user_id, role_code, context_label, notes, assigned_at, is_active")
            .eq("organization_id", membership.organization_id)
            .eq("is_active", true)
            .order("assigned_at", {ascending: false})
        : Promise.resolve({data: ownManualResult.data ?? [], error: null}),
    ]);

    if (allStaffResult.error) throw new Error(allStaffResult.error.message);
    if (allManualResult.error) throw new Error(allManualResult.error.message);

    const visibleStaffRows = ((allStaffResult.data ?? []) as StaffAssignmentRow[]).filter(
      (row) => globalAcademyGovernance || directorSchoolIds.has(row.school_id),
    );
    const visibleStaffAssignments = visibleStaffRows
      .map(mapStaffAssignment)
      .filter((row): row is AssignmentRow => Boolean(row));
    const visibleManualAssignments = ((allManualResult.data ?? []) as Omit<AssignmentRow, "source" | "school_id">[]).map(mapManualAssignment);
    activeAssignments = mergeAssignments([...visibleStaffAssignments, ...visibleManualAssignments]);

    const visibleUserIds = [...new Set(activeAssignments.map((row) => row.user_id))];
    if (globalAcademyGovernance) {
      const {data: memberRows, error: memberError} = await admin
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true);
      if (memberError) throw new Error(memberError.message);
      for (const row of memberRows ?? []) visibleUserIds.push(String(row.user_id));
    }

    const uniqueUserIds = [...new Set(visibleUserIds)];
    if (uniqueUserIds.length) {
      const profilesResult = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", uniqueUserIds)
        .order("full_name");
      if (profilesResult.error) throw new Error(profilesResult.error.message);
      profiles = (profilesResult.data ?? []) as ProfileRow[];
    }
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const ownRoleCodes = new Set(ownAssignments.map((assignment) => assignment.role_code));
  if (selectedRole && !ownRoleCodes.has(selectedRole)) {
    redirect("/dashboard/academy/responsibilities");
  }
  const focusedProfile = selectedRole ? getProfile(selectedRole) : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/academy" className="font-bold text-indigo-700">← {locale === "fr" ? "Retour à l’Académie" : "Back to Academy"}</Link>
          <div className="flex flex-wrap items-center gap-2">
            {canEditResponsibilityReference ? (
              <Link href="/dashboard/academy/responsibilities/manage" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm">
                {locale === "fr" ? "Modifier le référentiel" : "Edit responsibility catalogue"}
              </Link>
            ) : null}
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-violet-700">V4.8.89</span>
          </div>
        </div>

        <header className="mt-5 overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl shadow-slate-950/10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">Super Leader Académie</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">{locale === "fr" ? "Mes responsabilités" : "My responsibilities"}</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
            {locale === "fr"
              ? "Chaque poste doit répondre à quatre questions : quelle est ma mission, que dois-je faire, quels résultats dois-je produire et à qui dois-je rendre compte."
              : "Each role must answer four questions: what is my mission, what must I do, what results must I produce, and who am I accountable to."}
          </p>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{locale === "fr" ? "Mes postes actifs" : "My active roles"}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{ownAssignments.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{locale === "fr" ? "Actions quotidiennes" : "Daily actions"}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{ownAssignments.reduce((total, assignment) => total + (getProfile(assignment.role_code)?.daily?.length ?? 0), 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">KPI</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{ownAssignments.reduce((total, assignment) => total + (getProfile(assignment.role_code)?.kpis.length ?? 0), 0)}</p>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">{locale === "fr" ? "Personnel" : "Personal"}</p>
              <h2 className="mt-1 text-2xl font-black">{locale === "fr" ? "Ce que je dois faire" : "What I need to do"}</h2>
            </div>
          </div>

          {ownAssignments.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <h3 className="text-lg font-black">{locale === "fr" ? "Aucune responsabilité académique active" : "No active academy responsibility"}</h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {locale === "fr" ? "Lorsqu’un poste vous sera attribué, sa mission, ses actions et ses KPI apparaîtront ici." : "When a role is assigned to you, its mission, actions and KPIs will appear here."}
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-6">
              {ownAssignments.map((assignment) => {
                const profile = getProfile(assignment.role_code);
                if (!profile) return null;
                return (
                  <article key={assignment.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-600">{assignment.context_label || (locale === "fr" ? "Super Leader Académie" : "Super Leader Academy")}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="mt-1 text-2xl font-black">{text(profile.title, locale)}</h3>
                            <span className="mt-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-indigo-700">
                              {assignment.source === "academy_staff"
                                ? (locale === "fr" ? "Affectation Académie existante" : "Existing Academy assignment")
                                : (locale === "fr" ? "Responsabilité complémentaire" : "Additional responsibility")}
                            </span>
                          </div>
                          <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-600">{text(profile.mission, locale)}</p>
                        </div>
                        <Link href={`/dashboard/academy/responsibilities?role=${profile.code}`} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-indigo-700 shadow-sm ring-1 ring-slate-200">
                          {locale === "fr" ? "Voir la fiche complète" : "View full profile"}
                        </Link>
                      </div>
                    </div>
                    <div className="grid gap-4 p-6 lg:grid-cols-2 xl:grid-cols-3">
                      <SectionList title={locale === "fr" ? "Aujourd’hui" : "Today"} items={profile.daily ?? []} locale={locale} />
                      <SectionList title={locale === "fr" ? "Cette semaine" : "This week"} items={profile.weekly ?? []} locale={locale} />
                      <SectionList title={locale === "fr" ? "Ce mois" : "This month"} items={profile.monthly ?? []} locale={locale} />
                      <SectionList title={locale === "fr" ? "Avant chaque session" : "Before each session"} items={profile.beforeSession ?? []} locale={locale} />
                      <SectionList title={locale === "fr" ? "Après chaque session" : "After each session"} items={profile.afterSession ?? []} locale={locale} />
                      <SectionList title="KPI" items={profile.kpis} locale={locale} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {focusedProfile ? (
          <section className="mt-8 rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">{locale === "fr" ? "Fiche de fonction" : "Role profile"}</p>
                <h2 className="mt-1 text-2xl font-black text-indigo-950">{text(focusedProfile.title, locale)}</h2>
                <p className="mt-3 max-w-4xl font-semibold leading-7 text-indigo-900">{text(focusedProfile.mission, locale)}</p>
              </div>
              <Link href="/dashboard/academy/responsibilities" className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-black text-indigo-700">{locale === "fr" ? "Fermer" : "Close"}</Link>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <SectionList title={locale === "fr" ? "Responsabilités principales" : "Main responsibilities"} items={focusedProfile.responsibilities} locale={locale} />
              <SectionList title="KPI" items={focusedProfile.kpis} locale={locale} />
              <SectionList title={locale === "fr" ? "Aujourd’hui" : "Today"} items={focusedProfile.daily ?? []} locale={locale} />
              <SectionList title={locale === "fr" ? "Cette semaine" : "This week"} items={focusedProfile.weekly ?? []} locale={locale} />
              <SectionList title={locale === "fr" ? "Ce mois" : "This month"} items={focusedProfile.monthly ?? []} locale={locale} />
              <SectionList title={locale === "fr" ? "Avant chaque session" : "Before each session"} items={focusedProfile.beforeSession ?? []} locale={locale} />
              <SectionList title={locale === "fr" ? "Après chaque session" : "After each session"} items={focusedProfile.afterSession ?? []} locale={locale} />
              <SectionList title={locale === "fr" ? "Restrictions" : "Restrictions"} items={focusedProfile.restrictions ?? []} locale={locale} />
            </div>
          </section>
        ) : null}

        {canViewTeamAssignments ? (
          <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-600">{locale === "fr" ? "Gouvernance" : "Governance"}</p>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="mt-1 text-2xl font-black">{locale === "fr" ? "Affectations et responsabilités actives" : "Active assignments and responsibilities"}</h2>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
                  {locale === "fr"
                    ? "Les fonctions déjà attribuées dans Formateurs et responsables sont reprises automatiquement ici. Elles restent liées à leur école, programme et cohorte d’origine."
                    : "Roles already assigned in Trainers and school leads are automatically shown here and remain linked to their original school, program and cohort."}
                </p>
              </div>
              <Link href="/dashboard/academy/trainers" className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white">
                {locale === "fr" ? "Gérer les affectations d’école" : "Manage school assignments"}
              </Link>
            </div>

            {canCreateManualAssignment ? (
              <details className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <summary className="cursor-pointer font-black text-slate-900">
                  {locale === "fr" ? "Ajouter une responsabilité complémentaire" : "Add an additional responsibility"}
                </summary>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {locale === "fr"
                    ? "Utilisez ceci uniquement pour une responsabilité qui n’est pas déjà une affectation officielle d’école. Les nominations Direction, Formateur, Suivi, Finance, Communication, Marketing, Data et Observation se gèrent de préférence dans Formateurs et responsables."
                    : "Use this only for a responsibility that is not already an official school assignment. Formal school roles should preferably be managed in Trainers and school leads."}
                </p>
                <form action={assignAcademyResponsibilityAction} className="mt-5 grid gap-4 lg:grid-cols-2">
                  <label className="text-sm font-black text-slate-700">
                    {locale === "fr" ? "Collaborateur" : "Member"}
                    <select name="userId" required className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500">
                      <option value="">{locale === "fr" ? "Sélectionner" : "Select"}</option>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email || profile.id}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-black text-slate-700">
                    {locale === "fr" ? "Poste" : "Role"}
                    <select name="roleCode" required className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500">
                      <option value="">{locale === "fr" ? "Sélectionner" : "Select"}</option>
                      {effectiveProfiles.map((profile) => <option key={profile.code} value={profile.code}>{text(profile.title, locale)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-black text-slate-700">
                    {locale === "fr" ? "Contexte" : "Context"}
                    <input name="contextLabel" maxLength={160} placeholder={locale === "fr" ? "Ex. Comité académique transversal" : "e.g. Cross-school academic committee"} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500" />
                  </label>
                  <label className="text-sm font-black text-slate-700">
                    {locale === "fr" ? "Note d’affectation" : "Assignment note"}
                    <input name="notes" maxLength={500} placeholder={locale === "fr" ? "Optionnel" : "Optional"} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500" />
                  </label>
                  <div className="lg:col-span-2">
                    <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-indigo-700">{locale === "fr" ? "Ajouter la responsabilité" : "Add responsibility"}</button>
                  </div>
                </form>
              </details>
            ) : (
              <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm font-semibold leading-6 text-violet-900">
                {locale === "fr"
                  ? "En tant que Direction d’école, vous voyez les affectations de votre école ici. Pour nommer ou retirer un formateur ou un responsable, utilisez Formateurs et responsables : les permissions de l’école y sont appliquées automatiquement."
                  : "As School Leadership, you can see your school assignments here. Use Trainers and school leads to appoint or remove staff; school permissions are enforced there automatically."}
              </div>
            )}

            <div className="mt-8 border-t border-slate-100 pt-6">
              <h3 className="text-lg font-black">{locale === "fr" ? "Affectations actives" : "Active assignments"}</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-3 py-2">{locale === "fr" ? "Collaborateur" : "Member"}</th>
                      <th className="px-3 py-2">{locale === "fr" ? "Poste" : "Role"}</th>
                      <th className="px-3 py-2">{locale === "fr" ? "École / Contexte" : "School / Context"}</th>
                      <th className="px-3 py-2">{locale === "fr" ? "Source" : "Source"}</th>
                      <th className="px-3 py-2">{locale === "fr" ? "Depuis" : "Since"}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {activeAssignments.map((assignment) => {
                      const roleProfile = getProfile(assignment.role_code);
                      const memberProfile = profileById.get(assignment.user_id);
                      const canManageSchoolAssignment = assignment.source === "academy_staff" && (
                        globalAcademyGovernance || Boolean(assignment.school_id && directorSchoolIds.has(assignment.school_id))
                      );
                      return (
                        <tr key={assignment.id} className="border-t border-slate-100">
                          <td className="px-3 py-3 font-bold">{memberProfile?.full_name || memberProfile?.email || assignment.user_id}</td>
                          <td className="px-3 py-3 font-semibold text-slate-600">{roleProfile ? text(roleProfile.title, locale) : assignment.role_code}</td>
                          <td className="px-3 py-3 font-semibold text-slate-500">{assignment.context_label || "—"}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${assignment.source === "academy_staff" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                              {assignment.source === "academy_staff"
                                ? (locale === "fr" ? "Académie existante" : "Existing Academy")
                                : (locale === "fr" ? "Complémentaire" : "Additional")}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-500">{dateLabel(assignment.assigned_at, locale)}</td>
                          <td className="px-3 py-3 text-right">
                            {assignment.source === "responsibility" && canCreateManualAssignment ? (
                              <form action={deactivateAcademyResponsibilityAction}>
                                <input type="hidden" name="assignmentId" value={assignment.id} />
                                <button type="submit" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700">{locale === "fr" ? "Clôturer" : "Close"}</button>
                              </form>
                            ) : canManageSchoolAssignment ? (
                              <Link href="/dashboard/academy/trainers" className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700">
                                {locale === "fr" ? "Gérer" : "Manage"}
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {activeAssignments.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center font-semibold text-slate-400">{locale === "fr" ? "Aucune affectation active." : "No active assignment."}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
