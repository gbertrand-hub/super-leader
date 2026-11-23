import Link from "next/link";
import {redirect} from "next/navigation";
import {
  academyGlobalRoles,
  enrollmentVisibleTo,
  getAcademyAssignments,
  type AcademyAssignment,
} from "@/lib/academy/access";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type School = {id: string; code: string; name: string; description: string; color: string};
type Program = {id: string; school_id: string; name: string; status: string};
type Cohort = {id: string; school_id: string; program_id: string | null; name: string; status: string};
type Enrollment = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  user_id: string | null;
  crm_client_id: string | null;
  academic_status: string;
  assigned_follow_up_user_id: string | null;
};
type SchoolStats = {
  programs: number;
  cohorts: number;
  internalStudents: number;
  externalStudents: number;
};

const schoolTone: Record<string, string> = {
  violet: "border-violet-200 bg-violet-50 text-violet-950",
  blue: "border-blue-200 bg-blue-50 text-blue-950",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-950",
};

function roleLabel(role: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    director: ["Directeur / Directrice d’école", "School director"],
    academic_coordinator: ["Coordination académique", "Academic coordinator"],
    instructor: ["Formateur / Formatrice", "Instructor"],
    follow_up: ["Responsable du suivi", "Student follow-up"],
    finance: ["Responsable financier", "Finance officer"],
    communication: ["Responsable communication", "Communications officer"],
    marketing: ["Responsable marketing", "Marketing officer"],
    data_analyst: ["Analyste de données", "Data analyst"],
    observer: ["Observateur", "Observer"],
  };
  const label = labels[role];
  return label ? (fr ? label[0] : label[1]) : role.replaceAll("_", " ");
}

function organizationRoleLabel(role: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    owner: ["Propriétaire — vue Institut complète", "Owner — full Institute view"],
    admin: ["Administrateur — vue Institut complète", "Administrator — full Institute view"],
    hr: ["RH — gouvernance Academy", "HR — Academy governance"],
  };
  const label = labels[role];
  return label ? (fr ? label[0] : label[1]) : role;
}

function schoolIcon(code: string) {
  if (code.includes("coaches")) return "🧭";
  if (code.includes("business")) return "💼";
  if (code.includes("real_estate") || code.includes("experts")) return "🏙️";
  if (code.includes("breeders")) return "🌱";
  if (code.includes("youth")) return "🌟";
  return "🎓";
}

export async function IleadInstituteHub() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
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
  if (!membership) return null;

  const schemaCheck = await admin.from("academy_schools").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205", "42703"].includes(schemaCheck.error.code);
    return (
      <section id="ilead-global-institute" className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">iLEAD Global Institute</p>
        <h2 className="mt-1 text-2xl font-black text-amber-950">{fr ? "Grandes Écoles & rôles académiques" : "Schools & academic roles"}</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          {missing
            ? (fr ? "La fondation des Grandes Écoles n’est pas encore disponible dans cette base. Exécutez la migration 075 avant d’utiliser cet espace." : "The Schools foundation is not available in this database yet. Run migration 075 before using this area.")
            : schemaCheck.error.message}
        </p>
        {missing ? <code className="mt-4 block rounded-xl bg-slate-950 px-4 py-3 text-xs font-bold text-white">supabase/075_grandes_ecoles_foundation_v4_8_13.sql</code> : null}
      </section>
    );
  }

  const global = academyGlobalRoles.has(membership.role);
  const assignments = await getAcademyAssignments(admin, membership.organization_id, auth.user.id);

  const [schoolsResult, programsResult, cohortsResult, enrollmentsResult, staffResult] = await Promise.all([
    admin.from("academy_schools").select("id, code, name, description, color").eq("organization_id", membership.organization_id).eq("is_active", true).order("name"),
    admin.from("academy_programs").select("id, school_id, name, status").eq("organization_id", membership.organization_id).neq("status", "archived").order("name"),
    admin.from("academy_cohorts").select("id, school_id, program_id, name, status").eq("organization_id", membership.organization_id).neq("status", "archived").order("name"),
    admin.from("academy_school_enrollments").select("id, school_id, program_id, cohort_id, user_id, crm_client_id, academic_status, assigned_follow_up_user_id").eq("organization_id", membership.organization_id).in("academic_status", ["admitted", "enrolled", "active"]),
    admin.from("academy_staff_assignments").select("school_id, program_id, cohort_id, user_id, assignment_role, is_active").eq("organization_id", membership.organization_id).eq("is_active", true),
  ]);

  const schools = (schoolsResult.data ?? []) as School[];
  const programs = (programsResult.data ?? []) as Program[];
  const cohorts = (cohortsResult.data ?? []) as Cohort[];
  const enrollments = (enrollmentsResult.data ?? []) as Enrollment[];
  const staffRows = (staffResult.data ?? []) as Array<AcademyAssignment & {user_id: string; is_active: boolean}>;

  const assignedSchoolIds = new Set(assignments.map((row) => row.school_id));
  const ownStudentEnrollments = enrollments.filter((row) => row.user_id === auth.user.id);
  const ownStudentSchoolIds = new Set(ownStudentEnrollments.map((row) => row.school_id));
  const visibleSchools = schools.filter((school) => global || assignedSchoolIds.has(school.id) || ownStudentSchoolIds.has(school.id));
  const schoolById = new Map(schools.map((school) => [school.id, school]));
  const programById = new Map(programs.map((program) => [program.id, program]));
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));

  const statsBySchool = new Map<string, SchoolStats>();
  for (const school of visibleSchools) {
    const hasStaffAccess = global || assignedSchoolIds.has(school.id);
    const schoolEnrollments = enrollments.filter((row) => row.school_id === school.id);
    const scopedEnrollments = hasStaffAccess
      ? (global ? schoolEnrollments : schoolEnrollments.filter((row) => enrollmentVisibleTo(auth.user.id, membership.role, assignments, school.id, row)))
      : schoolEnrollments.filter((row) => row.user_id === auth.user.id);
    const schoolAssignments = assignments.filter((row) => row.school_id === school.id);
    const fullSchoolScope = global || schoolAssignments.some((row) => !row.program_id && !row.cohort_id);
    const scopedProgramIds = new Set([
      ...schoolAssignments.map((row) => row.program_id).filter(Boolean) as string[],
      ...scopedEnrollments.map((row) => row.program_id).filter(Boolean) as string[],
    ]);
    const scopedCohortIds = new Set([
      ...schoolAssignments.map((row) => row.cohort_id).filter(Boolean) as string[],
      ...scopedEnrollments.map((row) => row.cohort_id).filter(Boolean) as string[],
    ]);
    statsBySchool.set(school.id, {
      programs: fullSchoolScope
        ? programs.filter((row) => row.school_id === school.id && row.status === "active").length
        : scopedProgramIds.size,
      cohorts: fullSchoolScope
        ? cohorts.filter((row) => row.school_id === school.id && ["open", "active"].includes(row.status)).length
        : scopedCohortIds.size,
      internalStudents: scopedEnrollments.filter((row) => Boolean(row.user_id)).length,
      externalStudents: scopedEnrollments.filter((row) => Boolean(row.crm_client_id)).length,
    });
  }

  const visibleEnrollmentRows = visibleSchools.flatMap((school) => {
    const hasStaffAccess = global || assignedSchoolIds.has(school.id);
    const rows = enrollments.filter((row) => row.school_id === school.id);
    if (global) return rows;
    if (hasStaffAccess) return rows.filter((row) => enrollmentVisibleTo(auth.user.id, membership.role, assignments, school.id, row));
    return rows.filter((row) => row.user_id === auth.user.id);
  });
  const totalInternal = visibleEnrollmentRows.filter((row) => Boolean(row.user_id)).length;
  const totalExternal = visibleEnrollmentRows.filter((row) => Boolean(row.crm_client_id)).length;

  return (
    <section id="ilead-global-institute" className="mt-6 space-y-6 scroll-mt-24">
      <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-slate-950 to-violet-950 p-6 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-400">iLEAD Global Institute</p>
              <h2 className="mt-1 text-3xl font-black">{fr ? "L’université au cœur de Super Leader" : "The university inside Super Leader"}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                {fr
                  ? "Les Grandes Écoles accueillent à la fois les collaborateurs de l’organisation et les étudiants externes. Les rôles Academy restent indépendants des rôles RH, Finance et Administration."
                  : "The Schools serve both organization staff and external students. Academy roles remain independent from HR, Finance and Administration roles."}
              </p>
            </div>
            <Link href="/dashboard/academy/schools" className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 transition hover:bg-amber-300">
              {fr ? "Voir toutes les Grandes Écoles →" : "View all Schools →"}
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric value={visibleSchools.length} label={fr ? "Écoles visibles" : "Visible schools"} />
            <MiniMetric value={totalInternal} label={fr ? "Étudiants internes" : "Internal students"} />
            <MiniMetric value={totalExternal} label={fr ? "Étudiants externes" : "External students"} />
            <MiniMetric value={global ? staffRows.length : assignments.length} label={fr ? "Affectations Academy" : "Academy assignments"} />
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "Grandes Écoles" : "Schools"}</p>
              <h3 className="mt-1 text-2xl font-black">{fr ? "Entrer directement dans l’école concernée" : "Open the school you work with"}</h3>
            </div>
            <p className="text-xs font-bold text-slate-500">{fr ? "Affichage selon votre périmètre Academy" : "Shown according to your Academy scope"}</p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleSchools.map((school) => {
              const stats = statsBySchool.get(school.id) ?? {programs: 0, cohorts: 0, internalStudents: 0, externalStudents: 0};
              const hasStaffAccess = global || assignedSchoolIds.has(school.id);
              const isStudent = ownStudentSchoolIds.has(school.id);
              const content = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-2xl" aria-hidden>{schoolIcon(school.code)}</p>
                      <h4 className="mt-2 text-xl font-black">{school.name}</h4>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {hasStaffAccess ? <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide">{fr ? "Accès staff" : "Staff access"}</span> : null}
                      {isStudent ? <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide">{fr ? "Mon parcours" : "My studies"}</span> : null}
                    </div>
                  </div>
                  <p className="mt-3 min-h-12 text-sm leading-6 opacity-75">{school.description}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <Stat value={stats.programs} label={fr ? "Programmes" : "Programs"} />
                    <Stat value={stats.cohorts} label={fr ? "Cohortes" : "Cohorts"} />
                    <Stat value={stats.internalStudents} label={fr ? "Internes" : "Internal"} />
                    <Stat value={stats.externalStudents} label={fr ? "Externes" : "External"} />
                  </div>
                  <p className="mt-4 text-xs font-black">{hasStaffAccess ? (fr ? "Ouvrir l’école →" : "Open school →") : (fr ? "Voir mon parcours Academy →" : "Open my Academy path →")}</p>
                </>
              );
              const className = `rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${schoolTone[school.color] ?? schoolTone.violet}`;
              return hasStaffAccess
                ? <Link key={school.id} href={`/dashboard/academy/schools/${school.id}`} className={className}>{content}</Link>
                : <Link key={school.id} href="#academy-course-catalogue" className={className}>{content}</Link>;
            })}
            {!visibleSchools.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 md:col-span-2 xl:col-span-3">
                {fr ? "Aucune Grande École n’est encore visible dans votre périmètre. Une affectation Academy ou une inscription étudiante la fera apparaître ici." : "No School is visible in your scope yet. An Academy assignment or student enrollment will make it appear here."}
              </div>
            ) : null}
          </div>
        </div>
      </article>

      <article className="rounded-3xl border border-violet-200 bg-violet-50/50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "Mon espace Institute" : "My Institute workspace"}</p>
            <h3 className="mt-1 text-2xl font-black text-slate-950">{fr ? "Mon rôle Academy sur mon plancher" : "My Academy role on my workspace"}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              {fr ? "Chaque responsabilité académique apparaît ici sans modifier votre rôle dans l’organisation." : "Every academic responsibility appears here without changing your organization role."}
            </p>
          </div>
          <Link href="/dashboard/academy/trainers" className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-xs font-black text-violet-800">
            {fr ? "Voir les affectations Academy →" : "View Academy assignments →"}
          </Link>
        </div>

        {global ? (
          <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-4">
            <p className="text-sm font-black text-violet-800">{organizationRoleLabel(membership.role, fr)}</p>
            <p className="mt-1 text-sm text-slate-600">{fr ? "Vous pouvez superviser l’ensemble des écoles, cohortes, étudiants et équipes Academy autorisées par votre rôle global." : "You can supervise the schools, cohorts, students and Academy teams permitted by your global role."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <QuickLink href="/dashboard/academy/schools" label={fr ? "Grandes Écoles" : "Schools"} />
              <QuickLink href="/dashboard/academy/students" label={fr ? "Étudiants" : "Students"} />
              <QuickLink href="/dashboard/academy/cohorts" label={fr ? "Cohortes" : "Cohorts"} />
              <QuickLink href="/dashboard/academy/trainers" label={fr ? "Formateurs & responsables" : "Trainers & staff"} />
              <QuickLink href="/dashboard/academy/analytics" label={fr ? "Analyse & décisions" : "Analytics & decisions"} />
            </div>
          </div>
        ) : null}

        {assignments.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {assignments.map((assignment, index) => {
              const school = schoolById.get(assignment.school_id);
              const program = assignment.program_id ? programById.get(assignment.program_id) : null;
              const cohort = assignment.cohort_id ? cohortById.get(assignment.cohort_id) : null;
              const scopeEnrollments = enrollments.filter((row) =>
                row.school_id === assignment.school_id &&
                (!assignment.program_id || row.program_id === assignment.program_id) &&
                (!assignment.cohort_id || row.cohort_id === assignment.cohort_id) &&
                enrollmentVisibleTo(auth.user.id, membership.role, assignments, assignment.school_id, row),
              );
              return (
                <div key={`${assignment.school_id}-${assignment.assignment_role}-${assignment.program_id ?? "all"}-${assignment.cohort_id ?? "all"}-${index}`} className="rounded-2xl border border-violet-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-violet-700">{roleLabel(assignment.assignment_role, fr)}</p>
                      <h4 className="mt-1 text-lg font-black">{school?.name ?? (fr ? "Grande École" : "School")}</h4>
                    </div>
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-black text-violet-800">{scopeEnrollments.length} {fr ? "étudiant(s)" : "student(s)"}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <ScopeLine label={fr ? "Programme" : "Program"} value={program?.name ?? (fr ? "Toute l’école" : "Whole school")} />
                    <ScopeLine label={fr ? "Cohorte" : "Cohort"} value={cohort?.name ?? (fr ? "Toutes les cohortes" : "All cohorts")} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {school ? <QuickLink href={`/dashboard/academy/schools/${school.id}`} label={fr ? "Ouvrir mon école" : "Open my school"} /> : null}
                    <QuickLink href="/dashboard/academy/students" label={fr ? "Mes étudiants" : "My students"} />
                    <QuickLink href="/dashboard/academy/cohorts" label={fr ? "Mes cohortes" : "My cohorts"} />
                    {assignment.assignment_role === "data_analyst" ? <QuickLink href={`/dashboard/academy/analytics?school=${assignment.school_id}`} label={fr ? "Analyse & décisions" : "Analytics & decisions"} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {ownStudentEnrollments.length ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-700">{fr ? "Double identité Academy" : "Dual Academy identity"}</p>
            <h4 className="mt-1 text-lg font-black text-emerald-950">{fr ? "Vous êtes aussi étudiant interne" : "You are also an internal student"}</h4>
            <p className="mt-1 text-sm text-emerald-900">
              {fr
                ? `${new Set(ownStudentEnrollments.map((row) => row.school_id)).size} école(s) liée(s) à votre parcours. Votre rôle étudiant reste séparé de vos responsabilités de staff.`
                : `${new Set(ownStudentEnrollments.map((row) => row.school_id)).size} school(s) are linked to your studies. Your student role remains separate from your staff responsibilities.`}
            </p>
            <Link href="#academy-course-catalogue" className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white">{fr ? "Voir mes formations →" : "View my courses →"}</Link>
          </div>
        ) : null}

        {!global && !assignments.length && !ownStudentEnrollments.length ? (
          <p className="mt-4 rounded-2xl bg-white p-5 text-sm text-slate-600">{fr ? "Aucune responsabilité Academy ni inscription étudiante ne vous est actuellement affectée." : "No Academy responsibility or student enrollment is currently assigned to you."}</p>
        ) : null}
      </article>
    </section>
  );
}

function MiniMetric({value, label}: {value: number; label: string}) {
  return <div className="rounded-2xl bg-white/10 p-3"><p className="text-2xl font-black">{value}</p><p className="mt-0.5 text-xs font-bold text-slate-300">{label}</p></div>;
}

function Stat({value, label}: {value: number; label: string}) {
  return <div className="rounded-xl bg-white/70 p-2.5"><p className="text-lg font-black">{value}</p><p className="text-[10px] font-bold uppercase tracking-wide opacity-60">{label}</p></div>;
}

function QuickLink({href, label}: {href: string; label: string}) {
  return <Link href={href} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-violet-800">{label}</Link>;
}

function ScopeLine({label, value}: {label: string; value: string}) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 font-bold text-slate-800">{value}</p></div>;
}
