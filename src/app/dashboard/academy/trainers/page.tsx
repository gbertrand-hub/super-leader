import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  assignAcademyTrainerAction,
  removeAcademyTrainerAssignmentAction,
} from "@/app/actions/academy-trainers";
import {
  academyGlobalRoles,
  getAcademyAssignments,
  hasAssignmentRole,
} from "@/lib/academy/access";
import { createProfileAvatarSignedUrl } from "@/lib/profile/avatar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
type Assignment = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  user_id: string;
  assignment_role: string;
};
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const roleLabel = (role: string) =>
  ({
    director: "Direction d’école",
    academic_coordinator: "Coordination académique",
    instructor: "Formateur",
    follow_up: "Responsable du suivi",
    finance: "Responsable financier",
    communication: "Responsable communication",
    marketing: "Responsable marketing",
    data_analyst: "Analyste de données",
    observer: "Observateur",
  })[role] ?? role;

export default async function AcademyTrainersPage({ searchParams }: Props) {
  const query = (await searchParams) ?? {};
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!membership) redirect("/dashboard/company");
  const ownAssignments = await getAcademyAssignments(
    admin,
    membership.organization_id,
    auth.user.id,
  );
  const global = academyGlobalRoles.has(membership.role);
  if (!global && ownAssignments.length === 0) redirect("/dashboard/academy");
  const visibleSchoolIds = new Set(ownAssignments.map((x) => x.school_id));
  const [schoolsResult, programsResult, cohortsResult, assignmentsResult, membersResult, enrollmentsResult] =
    await Promise.all([
      admin.from("academy_schools").select("id,name,color").eq("organization_id", membership.organization_id).eq("is_active", true).order("name"),
      admin.from("academy_programs").select("id,school_id,name").eq("organization_id", membership.organization_id).neq("status", "archived").order("name"),
      admin.from("academy_cohorts").select("id,school_id,program_id,name").eq("organization_id", membership.organization_id).neq("status", "archived").order("name"),
      admin.from("academy_staff_assignments").select("id,school_id,program_id,cohort_id,user_id,assignment_role").eq("organization_id", membership.organization_id).eq("is_active", true),
      admin.from("organization_members").select("user_id,role").eq("organization_id", membership.organization_id).eq("is_active", true),
      admin.from("academy_school_enrollments").select("id,school_id,program_id,cohort_id").eq("organization_id", membership.organization_id).in("academic_status", ["admitted", "enrolled", "active"]),
    ]);
  const schools = (schoolsResult.data ?? []).filter((school) => global || visibleSchoolIds.has(String(school.id)));
  const schoolIds = new Set(schools.map((x) => String(x.id)));
  const assignments = ((assignmentsResult.data ?? []) as Assignment[]).filter((x) => schoolIds.has(x.school_id));
  const memberIds = [...new Set((membersResult.data ?? []).map((x) => String(x.user_id)))];
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("id,full_name,email,avatar_storage_path").in("id", memberIds)
    : { data: [] };
  const people = new Map(
    await Promise.all(
      (profiles ?? []).map(async (profile) => [
        String(profile.id),
        {
          name: String(profile.full_name || profile.email || "Membre"),
          email: String(profile.email ?? ""),
          photo: await createProfileAvatarSignedUrl(admin, String(profile.avatar_storage_path ?? ""), 3600),
        },
      ] as const),
    ),
  );
  const schoolBy = new Map(schools.map((x) => [String(x.id), String(x.name)]));
  const programBy = new Map((programsResult.data ?? []).map((x) => [String(x.id), String(x.name)]));
  const cohortBy = new Map((cohortsResult.data ?? []).map((x) => [String(x.id), String(x.name)]));
  const grouped = new Map<string, Assignment[]>();
  assignments.forEach((assignment) => grouped.set(assignment.user_id, [...(grouped.get(assignment.user_id) ?? []), assignment]));
  const canManageSchool = (schoolId: string) => global || hasAssignmentRole(ownAssignments, schoolId, ["director"]);
  const manageableSchools = schools.filter((x) => canManageSchool(String(x.id)));
  const studentsFor = (assignment: Assignment) =>
    (enrollmentsResult.data ?? []).filter((student) =>
      String(student.school_id) === assignment.school_id &&
      (!assignment.program_id || String(student.program_id) === assignment.program_id) &&
      (!assignment.cohort_id || String(student.cohort_id) === assignment.cohort_id),
    ).length;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard/academy" className="font-bold text-violet-700">← Super Leader Academy</Link>
        <header className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">Équipes des écoles</p>
          <h1 className="mt-2 text-4xl font-black">Formateurs et responsables</h1>
          <p className="mt-3 text-slate-300">Affectations pédagogiques, administratives, financières, marketing et communication par école.</p>
        </header>
        {first(query.success) ? <p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">{first(query.success)}</p> : null}
        {first(query.error) ? <p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">{first(query.error)}</p> : null}
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat value={grouped.size} label="Membres affectés" />
          <Stat value={assignments.filter((x) => x.assignment_role === "instructor").length} label="Affectations formateur" />
          <Stat value={new Set(assignments.map((x) => x.school_id)).size} label="Écoles couvertes" />
        </section>
        {manageableSchools.length ? (
          <details className="mt-6 rounded-3xl border bg-white p-6">
            <summary className="cursor-pointer text-xl font-black">Affecter un formateur ou responsable d’école</summary>
            <form action={assignAcademyTrainerAction} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Label title="Membre du staff"><select name="user_id" required className={input}><option value="">Sélectionner…</option>{(membersResult.data ?? []).map((m) => <option key={String(m.user_id)} value={String(m.user_id)}>{people.get(String(m.user_id))?.name ?? String(m.user_id)}</option>)}</select></Label>
              <Label title="École"><select name="school_id" required className={input}><option value="">Sélectionner…</option>{manageableSchools.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></Label>
              <Label title="Fonction"><select name="assignment_role" required className={input}><option value="instructor">Formateur</option><option value="academic_coordinator">Coordination académique</option><option value="director">Direction d’école</option><option value="follow_up">Responsable du suivi</option><option value="communication">Responsable communication</option><option value="marketing">Responsable marketing</option><option value="finance">Responsable financier</option><option value="data_analyst">Analyste de données</option><option value="observer">Observateur</option></select></Label>
              <Label title="Programme (facultatif)"><select name="program_id" className={input}><option value="">Toute l’école</option>{(programsResult.data ?? []).filter((p) => schoolIds.has(String(p.school_id))).map((p) => <option key={String(p.id)} value={String(p.id)}>{schoolBy.get(String(p.school_id))} · {String(p.name)}</option>)}</select></Label>
              <Label title="Cohorte (facultatif)"><select name="cohort_id" className={input}><option value="">Toutes les cohortes</option>{(cohortsResult.data ?? []).filter((c) => schoolIds.has(String(c.school_id))).map((c) => <option key={String(c.id)} value={String(c.id)}>{schoolBy.get(String(c.school_id))} · {String(c.name)}</option>)}</select></Label>
              <button className="self-end rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Enregistrer l’affectation</button>
            </form>
          </details>
        ) : null}
        <section className="mt-7 grid gap-5 lg:grid-cols-2">
          {[...grouped.entries()].map(([userId, rows]) => {
            const person = people.get(userId);
            return <article key={userId} className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 font-black text-white">{person?.photo ? <Image src={person.photo} alt={person.name} fill sizes="64px" className="object-cover" unoptimized /> : initials(person?.name ?? "Staff")}</div>
                <div><h2 className="text-xl font-black">{person?.name ?? "Membre"}</h2><p className="text-sm text-slate-500">{person?.email}</p></div>
              </div>
              <div className="mt-5 space-y-3">{rows.map((row) => <div key={row.id} className="rounded-2xl bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2"><Mini label="École" value={schoolBy.get(row.school_id) ?? "École"} /><Mini label="Fonction" value={roleLabel(row.assignment_role)} /><Mini label="Programme" value={programBy.get(String(row.program_id)) ?? "Toute l’école"} /><Mini label="Cohorte" value={cohortBy.get(String(row.cohort_id)) ?? "Toutes"} /></div>
                <div className="mt-4 flex items-center justify-between"><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">{studentsFor(row)} étudiant(s)</span>{canManageSchool(row.school_id) ? <form action={removeAcademyTrainerAssignmentAction}><input type="hidden" name="assignment_id" value={row.id} /><button className="text-sm font-black text-red-700 hover:underline">Retirer</button></form> : null}</div>
              </div>)}</div>
            </article>;
          })}
          {!grouped.size ? <p className="rounded-3xl border border-dashed bg-white p-10 text-center text-slate-500 lg:col-span-2">Aucune affectation pédagogique dans votre périmètre.</p> : null}
        </section>
      </div>
    </main>
  );
}
function Stat({ value, label }: { value: number; label: string }) { return <div className="rounded-2xl border bg-white p-5"><p className="text-3xl font-black">{value}</p><p className="text-sm font-bold text-slate-500">{label}</p></div>; }
function Label({ title, children }: { title: string; children: React.ReactNode }) { return <label className="text-sm font-bold text-slate-700">{title}{children}</label>; }
function Mini({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-bold uppercase text-slate-400">{label}</p><p className="font-black">{value}</p></div>; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join(""); }
