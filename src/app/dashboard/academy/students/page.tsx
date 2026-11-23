import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  assignAcademyStudentFollowerAction,
  enrollExistingStudentInSchoolsAction,
} from "@/app/actions/academy-students-directory";
import { StudentPhotoUpload } from "./StudentPhotoUpload";
import { TeachableStudentImporter } from "@/components/academy/teachable-student-importer";
import { CrmStudentSearch } from "@/components/academy/crm-student-search";
import {
  academyGlobalRoles,
  canEnrollStudents,
  canViewFinance,
  enrollmentVisibleTo,
  getAcademyAssignments,
} from "@/lib/academy/access";
import { createProfileAvatarSignedUrl } from "@/lib/profile/avatar";
import { createCanonicalPersonResolver, type PersonIdentityAssociation } from "@/lib/identity/canonical-person";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
type Enrollment = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  user_id: string | null;
  crm_client_id: string | null;
  academic_status: string;
  source: string;
  assigned_follow_up_user_id: string | null;
  enrolled_on: string;
};
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
const input =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
export default async function StudentsDirectoryPage({ searchParams }: Props) {
  const q = (await searchParams) ?? {},
    term = first(q.q).trim().toLowerCase(),
    incompleteOnly = first(q.incomplete) === "1",
    s = await createClient(),
    { data: auth } = await s.auth.getUser();
  if (!auth.user) redirect("/login");
  const a = createAdminClient(),
    { data: m } = await a
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ organization_id: string; role: string }>();
  if (!m) redirect("/dashboard/company");
  const assignments = await getAcademyAssignments(
      a,
      m.organization_id,
      auth.user.id,
    ),
    assignedIds = new Set(assignments.map((x) => x.school_id));
  const [
    { data: allSchools },
    { data: allEnrollments },
    { data: allPrograms },
    { data: allCohorts },
    { data: members },
    { data: financeRows },
    { data: paymentRows },
    { data: identityAssociations },
  ] = await Promise.all([
    a
      .from("academy_schools")
      .select("id,name,color")
      .eq("organization_id", m.organization_id)
      .eq("is_active", true)
      .order("name"),
    a
      .from("academy_school_enrollments")
      .select(
        "id,school_id,program_id,cohort_id,user_id,crm_client_id,academic_status,source,assigned_follow_up_user_id,enrolled_on",
      )
      .eq("organization_id", m.organization_id)
      .order("created_at", { ascending: false }),
    a
      .from("academy_programs")
      .select("id,name,school_id,status")
      .eq("organization_id", m.organization_id),
    a
      .from("academy_cohorts")
      .select("id,name,school_id,program_id,status")
      .eq("organization_id", m.organization_id),
    a
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", m.organization_id)
      .eq("is_active", true),
    a
      .from("academy_student_finance")
      .select("enrollment_id,is_internal_training,agreed_amount,currency,payment_status")
      .eq("organization_id", m.organization_id),
    a
      .from("academy_student_confirmed_allocations")
      .select("enrollment_id,amount,currency")
      .eq("organization_id", m.organization_id),
    a
      .from("person_identity_associations")
      .select("primary_user_id,crm_client_id,related_user_id,status")
      .eq("organization_id", m.organization_id)
      .eq("status", "active"),
  ]);
  const schools = (allSchools ?? []).filter(
      (x) => academyGlobalRoles.has(m.role) || assignedIds.has(String(x.id)),
    ),
    schoolIds = new Set(schools.map((x) => String(x.id))),
    enrollments = ((allEnrollments ?? []) as Enrollment[]).filter(
      (x) =>
        schoolIds.has(x.school_id) &&
        enrollmentVisibleTo(auth.user.id, m.role, assignments, x.school_id, x),
    ),
    crmIds = [
      ...new Set(
        enrollments.map((x) => x.crm_client_id).filter(Boolean) as string[],
      ),
    ],
    enrollmentUserIds = [
      ...new Set(enrollments.map((x) => x.user_id).filter(Boolean) as string[]),
    ],
    userIds = [
      ...new Set([
        ...(enrollments.map((x) => x.user_id).filter(Boolean) as string[]),
        ...(enrollments
          .map((x) => x.assigned_follow_up_user_id)
          .filter(Boolean) as string[]),
        ...(members ?? []).map((x) => String(x.user_id)),
      ]),
    ];
  const [{ data: directCrmPeople }, { data: linkedCrmPeople }, { data: profiles }] = await Promise.all([
    crmIds.length
      ? a
          .from("crm_clients")
          .select("id,full_name,email,phone,student_photo_storage_path,linked_user_id")
          .in("id", crmIds)
      : { data: [] },
    enrollmentUserIds.length
      ? a
          .from("crm_clients")
          .select("id,full_name,email,phone,student_photo_storage_path,linked_user_id")
          .eq("organization_id", m.organization_id)
          .in("linked_user_id", enrollmentUserIds)
      : { data: [] },
    userIds.length
      ? a
          .from("profiles")
          .select("id,full_name,email,avatar_storage_path")
          .in("id", userIds)
      : { data: [] },
  ]);
  const crmPeople = [...new Map([...(directCrmPeople ?? []), ...(linkedCrmPeople ?? [])].map((item) => [String(item.id), item])).values()];
  const identityResolver = createCanonicalPersonResolver((identityAssociations ?? []) as PersonIdentityAssociation[]);
  const crmClientByUserId = new Map(crmPeople.filter((item) => item.linked_user_id).map((item) => [String(item.linked_user_id), String(item.id)]));
  const staffPhotoById = new Map(
    await Promise.all(
      (profiles ?? []).map(async (profile) => [
        String(profile.id),
        await createProfileAvatarSignedUrl(
          a,
          String(profile.avatar_storage_path ?? ""),
          3600,
        ),
      ] as const),
    ),
  );
  const people = new Map<
    string,
    {
      name: string;
      email: string;
      phone: string;
      kind: string;
      clientId?: string;
      photo?: string;
      photoSrc?: string;
    }
  >();
  crmPeople.forEach((x) =>
    people.set(`crm:${x.id}`, {
      name: cleanImportedName(String(x.full_name)),
      email: String(x.email ?? ""),
      phone: String(x.phone ?? ""),
      kind: "Contact CRM",
      clientId: String(x.id),
      photo: String(x.student_photo_storage_path ?? ""),
      photoSrc: x.student_photo_storage_path
        ? `/api/academy/student-photo/${x.id}`
        : "",
    }),
  );
  (profiles ?? []).forEach((x) =>
    people.set(`user:${x.id}`, {
      name: String(x.full_name || x.email || "Membre"),
      email: String(x.email ?? ""),
      phone: "",
      kind: "Staff",
      photo: String(x.avatar_storage_path ?? ""),
      photoSrc: staffPhotoById.get(String(x.id)) ?? "",
    }),
  );
  for (const association of identityResolver.active) {
    const crmPerson = people.get(`crm:${association.crm_client_id}`);
    const staffPerson = people.get(`user:${association.primary_user_id}`);
    if (!crmPerson && !staffPerson) continue;
    people.set(`person:${association.primary_user_id}`, {
      name: crmPerson?.name || staffPerson?.name || "Personne associée",
      email: [...new Set([staffPerson?.email, crmPerson?.email].filter(Boolean))].join(" · "),
      phone: crmPerson?.phone || staffPerson?.phone || "",
      kind: "Employé + Apprenant",
      clientId: crmPerson?.clientId,
      photo: crmPerson?.photo || staffPerson?.photo,
      photoSrc: crmPerson?.photoSrc || staffPerson?.photoSrc,
    });
  }
  const profileBy = new Map(
      (profiles ?? []).map((x) => [
        String(x.id),
        String(x.full_name || x.email || "Membre"),
      ]),
    ),
    schoolBy = new Map(schools.map((x) => [String(x.id), String(x.name)])),
    programBy = new Map(
      (allPrograms ?? []).map((x) => [String(x.id), String(x.name)]),
    ),
    cohortBy = new Map(
      (allCohorts ?? []).map((x) => [String(x.id), String(x.name)]),
    ),
    visibleEnrollmentIds = new Set(enrollments.map((x) => x.id)),
    financeBy = new Map(
      (financeRows ?? [])
        .filter((x) => visibleEnrollmentIds.has(String(x.enrollment_id)))
        .map((x) => [String(x.enrollment_id), x]),
    ),
    paidBy = new Map<string, number>();
  (paymentRows ?? []).forEach((x) => {
    const id = String(x.enrollment_id);
    if (visibleEnrollmentIds.has(id))
      paidBy.set(id, (paidBy.get(id) ?? 0) + Number(x.amount ?? 0));
  });
  const grouped = new Map<string, Enrollment[]>();
  enrollments.forEach((x) => {
    const canonicalClientId = (x.user_id ? crmClientByUserId.get(x.user_id) : undefined) ?? x.crm_client_id;
    const k = identityResolver.key({ userId: x.user_id, crmClientId: canonicalClientId });
    grouped.set(k, [...(grouped.get(k) ?? []), x]);
  });
  const canonicalGrouped = new Map<string, Enrollment[]>();
  for (const [key, personEnrollments] of grouped) {
    const schoolsWithPersonalEnrollment = new Set(personEnrollments.filter((enrollment) => enrollment.source !== "staff_automatic").map((enrollment) => enrollment.school_id));
    canonicalGrouped.set(key, personEnrollments.filter((enrollment) => enrollment.source !== "staff_automatic" || !schoolsWithPersonalEnrollment.has(enrollment.school_id)));
  }
  const effectiveEnrollmentCount = [...canonicalGrouped.values()].reduce((total, personEnrollments) => total + personEnrollments.length, 0);
  const hiddenTechnicalDuplicates = enrollments.length - effectiveEnrollmentCount;
  const incompleteEnrollments = enrollments.filter((e) => { const f = financeBy.get(e.id); return !e.program_id || !e.cohort_id || (!f?.is_internal_training && Number(f?.agreed_amount ?? 0) === 0); });
  const incompleteIds = new Set(incompleteEnrollments.map((e) => e.id));
  const rows = [...canonicalGrouped.entries()].filter(([k]) => {
    const p = people.get(k);
    const studentRows = canonicalGrouped.get(k) ?? [];
    if (incompleteOnly && !studentRows.some((e) => incompleteIds.has(e.id))) return false;
    return (
      !term ||
      [p?.name, p?.email, p?.phone, ...studentRows.map((e) => schoolBy.get(e.school_id))].some((v) =>
        String(v ?? "").toLowerCase().includes(term),
      )
    );
  });
  const manageableSchools = schools.filter((x) =>
    canEnrollStudents(m.role, assignments, String(x.id)),
  );
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/academy" className="font-bold text-violet-700">
            ← Super Leader Academy
          </Link>
          {["owner", "admin"].includes(m.role) ? (
            <Link
              href={`/dashboard/academy/pricing?organization=${m.organization_id}`}
              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-950"
            >
              Tarification & homologation
            </Link>
          ) : null}
        </div>
        <header className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
            Registre académique unifié
          </p>
          <h1 className="mt-2 text-4xl font-black">Étudiants</h1>
          <p className="mt-3 text-slate-300">
            Une identité unique, plusieurs inscriptions par école, avec
            programme, cohorte et responsable de suivi.
          </p>
        </header>
        {first(q.success) ? (
          <p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">
            {first(q.success)}
          </p>
        ) : null}
        {first(q.error) ? (
          <p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">
            {first(q.error)}
          </p>
        ) : null}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card n={rows.length} label="Étudiants uniques" />
          <Card n={effectiveEnrollmentCount} label="Inscriptions distinctes" />
          <Card
            n={enrollments.filter((x) => x.assigned_follow_up_user_id).length}
            label="Suivis affectés"
          />
          <Link href="/dashboard/academy/students?incomplete=1" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 transition hover:shadow-md"><p className="text-3xl font-black text-amber-800">{incompleteEnrollments.length}</p><p className="text-sm font-black text-amber-800">Inscriptions à régulariser</p><p className="mt-1 text-xs text-amber-700">Sans programme, cohorte ou tarif hérité →</p></Link>
        </section>
        {hiddenTechnicalDuplicates > 0 ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{hiddenTechnicalDuplicates} inscription(s) technique(s) du staff regroupée(s) avec un parcours apprenant déjà existant. Aucune donnée n’a été supprimée.</p> : null}
        {incompleteOnly ? <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4"><div><p className="font-black text-amber-900">Vue : inscriptions à régulariser</p><p className="text-sm text-amber-800">Seuls les étudiants avec programme/cohorte/tarif incomplet sont affichés.</p></div><Link href="/dashboard/academy/students" className="rounded-xl bg-white px-4 py-2 text-sm font-black text-amber-900">Voir tous les étudiants</Link></div> : null}
        {manageableSchools.length ? (
          <details className="mt-6 rounded-3xl border border-blue-200 bg-white p-6">
            <summary className="cursor-pointer text-xl font-black text-blue-950">
              Importer une liste d’étudiants Teachable
            </summary>
            <div className="mt-5">
              <TeachableStudentImporter
                schools={manageableSchools.map((school) => ({ id: String(school.id), name: String(school.name) }))}
                programs={(allPrograms ?? []).map((program) => ({ id: String(program.id), school_id: String(program.school_id), name: String(program.name) }))}
                cohorts={(allCohorts ?? []).map((cohort) => ({ id: String(cohort.id), school_id: String(cohort.school_id), program_id: cohort.program_id ? String(cohort.program_id) : null, name: String(cohort.name) }))}
                returnTo="directory"
              />
            </div>
          </details>
        ) : null}
        {manageableSchools.length ? (
          <details className="mt-6 rounded-3xl border bg-white p-6">
            <summary className="cursor-pointer text-xl font-black">
              Ajouter un étudiant existant à une ou plusieurs écoles
            </summary>
            <form
              action={enrollExistingStudentInSchoolsAction}
              className="mt-5 grid gap-5 lg:grid-cols-2"
            >
              <CrmStudentSearch
                schools={manageableSchools.map((school) => ({ id: String(school.id), name: String(school.name) }))}
                programs={(allPrograms ?? []).map((program) => ({ id: String(program.id), schoolId: String(program.school_id), name: String(program.name) }))}
                cohorts={(allCohorts ?? []).map((cohort) => ({ id: String(cohort.id), schoolId: String(cohort.school_id), name: String(cohort.name) }))}
              />
              <Label title="Responsable de suivi initial (facultatif)">
                <select name="follow_up_user_id" className={input}>
                  <option value="">Non affecté</option>
                  {(members ?? []).map((x) => (
                    <option key={x.user_id} value={String(x.user_id)}>
                      {profileBy.get(String(x.user_id)) ?? String(x.user_id)}
                    </option>
                  ))}
                </select>
              </Label>
              <button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white lg:col-span-2">
                Ajouter aux écoles sélectionnées
              </button>
            </form>
          </details>
        ) : null}
        <form className="mt-6 flex gap-3">
          <input
            name="q"
            defaultValue={first(q.q)}
            placeholder="Rechercher nom, email, téléphone ou école…"
            className={`${input} mt-0`}
          />
          <button className="rounded-xl bg-slate-950 px-5 py-2 font-black text-white">
            Rechercher
          </button>
        </form>
        <section className="mt-7 space-y-5">
          {rows.map(([key, studentEnrollments]) => {
            const p = people.get(key);
            const primaryEnrollment = studentEnrollments[0];
            const trackingHref = p?.clientId
              ? `/dashboard/crm/${p.clientId}#academy-enrollment-${primaryEnrollment.id}`
              : `/dashboard/academy/schools/${primaryEnrollment.school_id}/students?student=${primaryEnrollment.id}#student-${primaryEnrollment.id}`;
            return (
              <article
                key={key}
                className="rounded-3xl border bg-white p-6 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white bg-slate-900 text-xl font-black text-white shadow">
                      {p?.photoSrc ? (
                        <Image
                          src={p.photoSrc}
                          alt={`Photo de ${p.name}`}
                          fill
                          sizes="80px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        initials(p?.name ?? "Étudiant")
                      )}
                    </div>
                    <div>
                    <h2 className="text-2xl font-black">
                      <Link
                        href={trackingHref}
                        className="decoration-violet-500 decoration-2 underline-offset-4 hover:text-violet-700 hover:underline"
                        title="Ouvrir le centre de suivi de cet étudiant"
                      >
                        {p?.name ?? "Identité liée"}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {[p?.email, p?.phone, p?.kind]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">
                      {studentEnrollments.length} école(s)
                    </span>
                    {studentEnrollments.some((enrollment) =>
                      canViewFinance(m.role, assignments, enrollment.school_id),
                    ) ? (
                      <Link
                        href={`/dashboard/academy/students/finance?organization=${m.organization_id}&student=${encodeURIComponent(key)}`}
                        className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"
                      >
                        Compte financier consolidé →
                      </Link>
                    ) : null}
                    {p?.clientId &&
                    studentEnrollments.some((e) =>
                      canEnrollStudents(m.role, assignments, e.school_id),
                    ) ? (
                      <StudentPhotoUpload
                        clientId={p.clientId}
                        hasPhoto={Boolean(p.photo)}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {studentEnrollments.map((e) => {
                    const canEdit = canEnrollStudents(
                      m.role,
                      assignments,
                      e.school_id,
                    );
                    const canSeeFinance = canViewFinance(
                      m.role,
                      assignments,
                      e.school_id,
                    );
                    const finance = financeBy.get(e.id);
                    const agreed = Number(finance?.agreed_amount ?? 0);
                    const paid = paidBy.get(e.id) ?? 0;
                    const currency = String(finance?.currency ?? "USD");
                    const payment = paymentState(finance, agreed, paid);
                    return (
                      <div
                        key={e.id}
                        className="rounded-2xl border bg-slate-50 p-4"
                      >
                        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                        <Mini
                          label="École"
                          value={schoolBy.get(e.school_id) ?? "École"}
                        />
                        <Mini
                          label="Programme"
                          value={
                            programBy.get(String(e.program_id)) ?? "Non défini"
                          }
                        />
                        <Mini
                          label="Cohorte"
                          value={
                            cohortBy.get(String(e.cohort_id)) ?? "Non définie"
                          }
                        />
                        <Mini
                          label="Suivi par"
                          value={
                            profileBy.get(
                              String(e.assigned_follow_up_user_id),
                            ) ?? "Non affecté"
                          }
                        />
                        {canEdit ? (
                          <form
                            action={assignAcademyStudentFollowerAction}
                            className="flex min-w-64 gap-2"
                          >
                            <input
                              type="hidden"
                              name="enrollment_id"
                              value={e.id}
                            />
                            <input
                              type="hidden"
                              name="school_id"
                              value={e.school_id}
                            />
                            <select
                              name="follow_up_user_id"
                              defaultValue={e.assigned_follow_up_user_id ?? ""}
                              className={`${input} mt-0`}
                            >
                              <option value="">Non affecté</option>
                              {(members ?? []).map((x) => (
                                <option
                                  key={x.user_id}
                                  value={String(x.user_id)}
                                >
                                  {profileBy.get(String(x.user_id)) ??
                                    String(x.user_id)}
                                </option>
                              ))}
                            </select>
                            <button className="rounded-xl bg-amber-400 px-3 font-black">
                              Affecter
                            </button>
                          </form>
                        ) : null}
                        <Link
                          href={p?.clientId ? `/dashboard/crm/${p.clientId}#academy-enrollment-${e.id}` : `/dashboard/academy/schools/${e.school_id}/students?student=${e.id}#student-${e.id}`}
                          className="self-center text-sm font-black text-violet-700 hover:underline"
                        >
                          Ouvrir le suivi →
                        </Link>
                        </div>
                        {canSeeFinance ? (
                          <div className={`mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-4 ${payment.tone}`}>
                            <Mini label="Paiements" value={payment.label} />
                            <Mini label="Frais convenus" value={money(agreed, currency)} />
                            <Mini label="Déjà payé" value={money(paid, currency)} />
                            <Mini label="Solde" value={money(Math.max(0, agreed - paid), currency)} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
          {!rows.length ? (
            <p className="rounded-3xl border border-dashed bg-white p-10 text-center text-slate-500">
              Aucun étudiant ne correspond à la recherche ou à votre périmètre
              d’accès.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
function Card({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <p className="text-3xl font-black">{n}</p>
      <p className="text-sm font-bold text-slate-500">{label}</p>
    </div>
  );
}
function Label({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-bold text-slate-700">
      {title}
      {children}
    </label>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="font-black">{value}</p>
    </div>
  );
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
}
function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
function paymentState(
  finance:
    | {
        is_internal_training?: boolean | null;
        payment_status?: string | null;
      }
    | undefined,
  agreed: number,
  paid: number,
) {
  if (!finance)
    return { label: "Frais non configurés", tone: "bg-slate-100" };
  if (finance.is_internal_training || finance.payment_status === "not_required")
    return { label: "Aucun frais requis", tone: "bg-sky-100" };
  if (agreed <= 0 && paid <= 0)
    return { label: "Frais non configurés", tone: "bg-slate-100" };
  if (finance.payment_status === "overdue")
    return { label: "En retard", tone: "bg-red-100 text-red-950" };
  if (finance.payment_status === "paid" || (agreed > 0 && paid >= agreed))
    return { label: "À jour", tone: "bg-emerald-100 text-emerald-950" };
  if (paid > 0 || finance.payment_status === "partial")
    return { label: "Paiement partiel", tone: "bg-amber-100 text-amber-950" };
  return { label: "Paiement à commencer", tone: "bg-orange-100 text-orange-950" };
}
function cleanImportedName(name: string) {
  return name.replace(/^\s*\d+\s*[.)-]\s+/, "").trim();
}
