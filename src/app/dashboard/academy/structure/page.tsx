import Link from "next/link";
import { redirect } from "next/navigation";
import {
  canEnrollStudents,
  getAcademyAssignments,
  hasSchoolAccess,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] ?? "" : v ?? "";

export default async function AcademyStructurePage({ searchParams }: Props) {
  const query = (await searchParams) ?? {};
  const requestedOrganizationId = first(query.organization);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();

  let membershipQuery = admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (requestedOrganizationId) {
    membershipQuery = membershipQuery.eq("organization_id", requestedOrganizationId);
  }
  const { data: memberships } = await membershipQuery;
  const membership = memberships?.[0] as
    | { organization_id: string; role: string }
    | undefined;
  if (!membership) redirect("/dashboard/academy");

  const organizationId = membership.organization_id;
  const assignments = await getAcademyAssignments(
    admin,
    organizationId,
    auth.user.id,
  );
  const { data: allSchools } = await admin
    .from("academy_schools")
    .select("id,name,description")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");

  const schools = (allSchools ?? []).filter((school) =>
    hasSchoolAccess(membership.role, assignments, String(school.id)),
  );
  const schoolIds = schools.map((school) => String(school.id));
  const [programsResult, cohortsResult, enrollmentsResult] =
    schoolIds.length
      ? await Promise.all([
          admin
            .from("academy_programs")
            .select("id,school_id,name,status")
            .eq("organization_id", organizationId)
            .in("school_id", schoolIds),
          admin
            .from("academy_cohorts")
            .select("id,school_id,name,status")
            .eq("organization_id", organizationId)
            .in("school_id", schoolIds),
          admin
            .from("academy_school_enrollments")
            .select("id,school_id,program_id,cohort_id,academic_status")
            .eq("organization_id", organizationId)
            .in("school_id", schoolIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
  const programs = programsResult.data ?? [];
  const cohorts = cohortsResult.data ?? [];
  const enrollments = enrollmentsResult.data ?? [];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard/academy" className="font-bold text-violet-700">
          ← Super Leader Academy
        </Link>
        <header className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
            Intégrité académique
          </p>
          <h1 className="mt-2 text-4xl font-black">Structure académique</h1>
          <p className="mt-3 max-w-4xl text-slate-300">
            Une École contient des programmes, un programme contient des cohortes,
            et les Mastermind, coaching calls et pratiques sont des séances — pas
            de nouveaux programmes.
          </p>
        </header>

        <section className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-xl font-black text-amber-950">Règle de référence</h2>
          <p className="mt-2 text-sm text-amber-900">
            École → Programme → Cohorte → Sessions / activités. Une correction de
            structure conserve les identifiants d’inscription, donc les paiements,
            présences, évaluations et certificats restent liés au même étudiant.
          </p>
        </section>

        <section className="mt-7 grid gap-5 lg:grid-cols-2">
          {schools.map((school) => {
            const schoolId = String(school.id);
            const schoolPrograms = (programs ?? []).filter(
              (item) => String(item.school_id) === schoolId,
            );
            const schoolCohorts = (cohorts ?? []).filter(
              (item) => String(item.school_id) === schoolId,
            );
            const schoolEnrollments = (enrollments ?? []).filter(
              (item) => String(item.school_id) === schoolId,
            );
            const suspiciousPrograms = schoolPrograms.filter((item) =>
              /mastermind|prati|practice|coaching\s*call/i.test(String(item.name)),
            ).length;
            const suspiciousCohorts = schoolCohorts.filter((item) =>
              /mastermind|prati|practice|coaching\s*call/i.test(String(item.name)),
            ).length;
            const canCorrect = canEnrollStudents(
              membership.role,
              assignments,
              schoolId,
            );
            return (
              <article key={schoolId} className="rounded-3xl border bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black">{String(school.name)}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {String(school.description ?? "")}
                    </p>
                  </div>
                  {suspiciousPrograms + suspiciousCohorts > 0 ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
                      {suspiciousPrograms + suspiciousCohorts} élément(s) à vérifier
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                      Structure cohérente
                    </span>
                  )}
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Mini label="Programmes" value={schoolPrograms.filter((x) => x.status !== "archived").length} />
                  <Mini label="Cohortes" value={schoolCohorts.filter((x) => x.status !== "archived").length} />
                  <Mini label="Inscriptions" value={schoolEnrollments.length} />
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/dashboard/academy/schools/${schoolId}`}
                    className="rounded-xl border px-4 py-2.5 text-sm font-black"
                  >
                    Ouvrir l’école
                  </Link>
                  {canCorrect ? (
                    <Link
                      href={`/dashboard/academy/structure/${schoolId}?organization=${encodeURIComponent(organizationId)}`}
                      className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white"
                    >
                      Corriger la structure →
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
