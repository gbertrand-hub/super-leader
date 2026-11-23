import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAttendanceSessionAction } from "@/app/actions/academy-attendance";
import { restructureAcademySchoolAction } from "@/app/actions/academy-structure";
import {
  canEnrollStudents,
  getAcademyAssignments,
  hasSchoolAccess,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ schoolId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] ?? "" : v ?? "";
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const activeEnrollmentStatuses = new Set(["admitted", "enrolled", "active"]);

export default async function SchoolStructurePage({ params, searchParams }: Props) {
  const { schoolId } = await params;
  const query = (await searchParams) ?? {};
  const organizationId = first(query.organization);
  if (!organizationId) redirect("/dashboard/academy/structure");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!membership) redirect("/dashboard/academy");

  const assignments = await getAcademyAssignments(admin, organizationId, auth.user.id);
  if (!hasSchoolAccess(membership.role, assignments, schoolId)) notFound();
  if (!canEnrollStudents(membership.role, assignments, schoolId)) {
    redirect(`/dashboard/academy/schools/${schoolId}`);
  }

  const [schoolResult, programsResult, cohortsResult, enrollmentsResult, tariffsResult, logsResult] =
    await Promise.all([
      admin
        .from("academy_schools")
        .select("id,name,description")
        .eq("id", schoolId)
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("academy_programs")
        .select("id,name,status,description")
        .eq("organization_id", organizationId)
        .eq("school_id", schoolId)
        .order("name"),
      admin
        .from("academy_cohorts")
        .select("id,program_id,name,status,starts_on,ends_on,capacity")
        .eq("organization_id", organizationId)
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false }),
      admin
        .from("academy_school_enrollments")
        .select("id,program_id,cohort_id,academic_status")
        .eq("organization_id", organizationId)
        .eq("school_id", schoolId),
      admin
        .from("academy_cohort_tariffs")
        .select("id,cohort_id,amount,currency,status,effective_from")
        .eq("organization_id", organizationId)
        .eq("school_id", schoolId)
        .eq("status", "active"),
      admin
        .from("academy_structure_change_log")
        .select("id,moved_enrollments,copied_cohort_tariff,created_at,canonical_program_id,target_cohort_id,source_cohort_id")
        .eq("organization_id", organizationId)
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const school = schoolResult.data;
  if (!school) notFound();
  const programs = programsResult.data ?? [];
  const cohorts = cohortsResult.data ?? [];
  const enrollments = enrollmentsResult.data ?? [];
  const tariffs = tariffsResult.data ?? [];
  const logs = logsResult.data ?? [];
  const programBy = new Map(programs.map((item) => [String(item.id), item]));
  const cohortBy = new Map(cohorts.map((item) => [String(item.id), item]));
  const tariffByCohort = new Map(tariffs.map((item) => [String(item.cohort_id), item]));
  const activePrograms = programs.filter((item) => item.status !== "archived");
  const activeCohorts = cohorts.filter((item) => item.status !== "archived");
  const activeEnrollments = enrollments.filter((item) =>
    activeEnrollmentStatuses.has(String(item.academic_status)),
  );
  const countProgram = (id: string) =>
    activeEnrollments.filter((item) => String(item.program_id ?? "") === id).length;
  const countCohort = (id: string) =>
    activeEnrollments.filter((item) => String(item.cohort_id ?? "") === id).length;
  const suspicious = (name: unknown) =>
    /mastermind|prati|practice|coaching\s*call/i.test(String(name ?? ""));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/dashboard/academy/schools/${schoolId}`}
            className="font-bold text-violet-700"
          >
            ← {String(school.name)}
          </Link>
          <Link
            href={`/dashboard/academy/structure?organization=${encodeURIComponent(organizationId)}`}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-black"
          >
            Toutes les écoles
          </Link>
        </div>

        <header className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
            Correction contrôlée
          </p>
          <h1 className="mt-2 text-4xl font-black">Structure · {String(school.name)}</h1>
          <p className="mt-3 max-w-4xl text-slate-300">
            Choisis le programme officiel et la cohorte officielle. Une cohorte
            créée par erreur comme « Mastermind » peut être fusionnée sans
            recréer les étudiants : les mêmes inscriptions conservent paiements,
            présence, évaluations et certificats.
          </p>
        </header>

        {first(query.success) ? (
          <p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">
            {first(query.success)}
          </p>
        ) : null}
        {first(query.error) ? (
          <p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">
            {first(query.error)}
          </p>
        ) : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat n={activePrograms.length} label="Programmes actifs" />
          <Stat n={activeCohorts.length} label="Cohortes actives" />
          <Stat n={activeEnrollments.length} label="Étudiants actifs" />
        </section>

        <section className="mt-7 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border bg-white p-6">
            <h2 className="text-2xl font-black">Programmes actuels</h2>
            <p className="mt-1 text-sm text-slate-500">
              Mastermind / pratique / coaching call doivent normalement être des séances.
            </p>
            <div className="mt-4 divide-y">
              {programs.map((item) => (
                <div key={String(item.id)} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-black">{String(item.name)}</p>
                    <p className="text-xs text-slate-500">
                      {countProgram(String(item.id))} étudiant(s) actifs · {String(item.status)}
                    </p>
                  </div>
                  {suspicious(item.name) ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
                      À vérifier
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-6">
            <h2 className="text-2xl font-black">Cohortes actuelles</h2>
            <p className="mt-1 text-sm text-slate-500">
              La cohorte représente la promotion d’étudiants, pas une séance pratique.
            </p>
            <div className="mt-4 divide-y">
              {cohorts.map((item) => {
                const tariff = tariffByCohort.get(String(item.id));
                return (
                  <div key={String(item.id)} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-black">{String(item.name)}</p>
                      <p className="text-xs text-slate-500">
                        {countCohort(String(item.id))} étudiant(s) actifs · {String(item.status)}
                        {tariff
                          ? ` · Tarif ${Number(tariff.amount).toLocaleString("fr-FR")} ${String(tariff.currency)}`
                          : ""}
                      </p>
                    </div>
                    {suspicious(item.name) ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
                        Probable séance
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mt-7 rounded-3xl border-2 border-violet-300 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[.18em] text-violet-700">
                Assistant de restructuration
              </p>
              <h2 className="mt-1 text-2xl font-black">Fusionner sans perdre l’historique</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Le déplacement modifie uniquement le programme / la cohorte de
                l’inscription existante. Aucun nouvel étudiant n’est créé.
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
              Paiements & historique protégés
            </span>
          </div>

          <form action={restructureAcademySchoolAction} className="mt-6 grid gap-5">
            <input type="hidden" name="organization_id" value={organizationId} />
            <input type="hidden" name="school_id" value={schoolId} />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Label title="1. Programme officiel">
                <select name="canonical_program_id" required className={input}>
                  <option value="">Sélectionner…</option>
                  {activePrograms.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name)} · {countProgram(String(item.id))} étudiant(s)
                    </option>
                  ))}
                </select>
              </Label>

              <Label title="2. Cohorte officielle">
                <select name="target_cohort_id" required className={input}>
                  <option value="">Sélectionner…</option>
                  {activeCohorts.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name)} · {countCohort(String(item.id))} étudiant(s)
                    </option>
                  ))}
                </select>
              </Label>

              <Label title="3. Nom officiel de la cohorte (facultatif)">
                <input name="target_cohort_name" placeholder="École des Coachs Promotion 2026-2027" className={input} />
              </Label>

              <Label title="4. Cohorte à fusionner (facultatif)">
                <select name="source_cohort_id" className={input}>
                  <option value="">Aucune fusion</option>
                  {activeCohorts.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name)} · {countCohort(String(item.id))} étudiant(s)
                    </option>
                  ))}
                </select>
              </Label>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">
              <input type="checkbox" name="copy_source_tariff" defaultChecked className="mt-1" />
              <span>
                Si la cohorte à fusionner possède le tarif homologué actif et la
                cohorte officielle n’en possède pas encore, transférer ce tarif
                automatiquement vers la cohorte officielle.
              </span>
            </label>

            <div className="grid gap-5 lg:grid-cols-2">
              <fieldset className="rounded-2xl border p-4">
                <legend className="px-2 font-black">Programmes à archiver après correction</legend>
                <p className="mb-3 text-xs text-slate-500">
                  Super Leader refusera l’archivage s’il reste des étudiants actifs dans le programme.
                </p>
                <div className="space-y-2">
                  {activePrograms.map((item) => (
                    <label key={String(item.id)} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold">
                      <input type="checkbox" name="archive_program_ids" value={String(item.id)} />
                      <span>{String(item.name)}</span>
                      <span className="ml-auto text-xs text-slate-500">{countProgram(String(item.id))} actifs</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="rounded-2xl border p-4">
                <legend className="px-2 font-black">Autres cohortes à archiver</legend>
                <p className="mb-3 text-xs text-slate-500">
                  La cohorte sélectionnée comme « à fusionner » est archivée automatiquement après le déplacement.
                </p>
                <div className="space-y-2">
                  {activeCohorts.map((item) => (
                    <label key={String(item.id)} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold">
                      <input type="checkbox" name="archive_cohort_ids" value={String(item.id)} />
                      <span>{String(item.name)}</span>
                      <span className="ml-auto text-xs text-slate-500">{countCohort(String(item.id))} actifs</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="rounded-2xl bg-slate-950 p-5 text-white">
              <p className="font-black">Avant de confirmer</p>
              <p className="mt-1 text-sm text-slate-300">
                Pour l’École des Coachs, si la cohorte « Mastermind … 2026–2027 » contient déjà les 82 étudiants, la solution la plus sûre est de la choisir elle-même comme cohorte officielle, de laisser « cohorte à fusionner » vide, et de la renommer « École des Coachs Promotion 2026–2027 ». Choisis « Enseignement des 12 Modules… » comme programme officiel. Archive ensuite uniquement le faux programme Mastermind s’il contient 0 étudiant. Ne touche pas encore à « Parcours Coach du Staff » : son classement comme formation interne sera traité séparément.
              </p>
            </div>

            <button className="rounded-xl bg-violet-700 px-6 py-4 font-black text-white">
              Corriger la structure et conserver l’historique
            </button>
          </form>
        </section>

        <section className="mt-7 rounded-3xl border border-emerald-300 bg-emerald-50 p-6">
          <h2 className="text-2xl font-black text-emerald-950">Mastermind = séance pratique</h2>
          <p className="mt-2 text-sm text-emerald-900">
            Après la fusion, crée les Mastermind ici comme séances datées. Elles
            produisent leur propre feuille de présence mais ne créent ni nouveau
            programme ni nouvelle cohorte.
          </p>
          <form action={createAttendanceSessionAction} className="mt-5 grid gap-4 md:grid-cols-3">
            <input type="hidden" name="school_id" value={schoolId} />
            <input type="hidden" name="session_type" value="mastermind" />
            <input type="hidden" name="trainer_user_id" value={auth.user.id} />
            <Label title="Titre">
              <input name="title" defaultValue="Mastermind" required className={input} />
            </Label>
            <Label title="Programme">
              <select name="program_id" required className={input}>
                <option value="">Sélectionner…</option>
                {activePrograms.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>
                ))}
              </select>
            </Label>
            <Label title="Cohorte">
              <select name="cohort_id" required className={input}>
                <option value="">Sélectionner…</option>
                {activeCohorts.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>
                ))}
              </select>
            </Label>
            <Label title="Date">
              <input type="date" name="session_date" required className={input} />
            </Label>
            <Label title="Heure">
              <input type="time" name="starts_at" className={input} />
            </Label>
            <Label title="Durée (minutes)">
              <input type="number" name="duration_minutes" min="1" max="1440" defaultValue="120" className={input} />
            </Label>
            <Label title="Mode">
              <select name="delivery_mode" defaultValue="online" className={input}>
                <option value="online">En ligne</option>
                <option value="in_person">Présentiel</option>
                <option value="hybrid">Hybride</option>
              </select>
            </Label>
            <Label title="Lieu / Zoom / lien">
              <input name="location_or_link" className={input} />
            </Label>
            <button className="self-end rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">
              Créer le Mastermind comme séance
            </button>
          </form>
        </section>

        {logs.length ? (
          <section className="mt-7 rounded-3xl border bg-white p-6">
            <h2 className="text-2xl font-black">Historique des corrections</h2>
            <div className="mt-4 divide-y">
              {logs.map((log) => (
                <div key={String(log.id)} className="py-3 text-sm">
                  <p className="font-black">
                    {Number(log.moved_enrollments ?? 0)} inscription(s) déplacée(s)
                    {log.copied_cohort_tariff ? " · tarif transféré" : ""}
                  </p>
                  <p className="text-slate-500">
                    {new Date(String(log.created_at)).toLocaleString("fr-FR")} · Programme : {String(programBy.get(String(log.canonical_program_id))?.name ?? "—")} · Cohorte cible : {String(cohortBy.get(String(log.target_cohort_id))?.name ?? "—")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <p className="text-3xl font-black">{n}</p>
      <p className="text-sm font-bold text-slate-500">{label}</p>
    </div>
  );
}

function Label({ title, children }: { title: string; children: React.ReactNode }) {
  return <label className="text-sm font-bold text-slate-700">{title}{children}</label>;
}
