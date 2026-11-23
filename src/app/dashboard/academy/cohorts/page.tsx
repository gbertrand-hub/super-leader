import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createAcademyCohortAction,
  updateAcademyCohortAction,
  updateAcademyCohortStatusAction,
} from "@/app/actions/academy-programs-cohorts";
import {
  academyGlobalRoles,
  canEnrollStudents,
  getAcademyAssignments,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
const input =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const labels: Record<string, string> = {
  planned: "Planifiée",
  open: "Ouverte",
  active: "Active",
  completed: "Terminée",
  archived: "Archivée",
};
export default async function CohortsPage({ searchParams }: Props) {
  const q = (await searchParams) ?? {},
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
  const [{ data: allSchools }, { data: allPrograms }, { data: allCohorts }] =
    await Promise.all([
      a
        .from("academy_schools")
        .select("id,name,color")
        .eq("organization_id", m.organization_id)
        .eq("is_active", true)
        .order("name"),
      a
        .from("academy_programs")
        .select("id,school_id,name,status")
        .eq("organization_id", m.organization_id)
        .order("name"),
      a
        .from("academy_cohorts")
        .select(
          "id,school_id,program_id,name,status,starts_on,ends_on,capacity",
        )
        .eq("organization_id", m.organization_id)
        .order("created_at", { ascending: false }),
    ]);
  const schools = (allSchools ?? []).filter(
      (x) => academyGlobalRoles.has(m.role) || assignedIds.has(String(x.id)),
    ),
    schoolIds = new Set(schools.map((x) => String(x.id))),
    programs = (allPrograms ?? []).filter((x) =>
      schoolIds.has(String(x.school_id)),
    ),
    cohorts = (allCohorts ?? []).filter((x) =>
      schoolIds.has(String(x.school_id)),
    ),
    cohortIds = cohorts.map((x) => String(x.id));
  const { data: enrollments } = cohortIds.length
    ? await a
        .from("academy_school_enrollments")
        .select("cohort_id")
        .in("cohort_id", cohortIds)
        .in("academic_status", ["admitted", "enrolled", "active"])
    : { data: [] };
  const countBy = new Map<string, number>();
  (enrollments ?? []).forEach((x) =>
    countBy.set(
      String(x.cohort_id),
      (countBy.get(String(x.cohort_id)) ?? 0) + 1,
    ),
  );
  const schoolBy = new Map(schools.map((x) => [String(x.id), x])),
    programBy = new Map(programs.map((x) => [String(x.id), x]));
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard/academy" className="font-bold text-violet-700">
          ← Super Leader Academy
        </Link>
        <header className="mt-5 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
            Organisation académique
          </p>
          <h1 className="mt-2 text-4xl font-black">Cohortes et promotions</h1>
          <p className="mt-3 text-slate-300">
            Planifie les promotions, contrôle leur capacité et suis leur statut
            dans les écoles auxquelles tu as accès.
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
        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          <Card n={cohorts.length} label="Total" />
          <Card
            n={cohorts.filter((x) => x.status === "open").length}
            label="Ouvertes"
          />
          <Card
            n={cohorts.filter((x) => x.status === "active").length}
            label="Actives"
          />
          <Card
            n={cohorts.reduce(
              (n, x) => n + (countBy.get(String(x.id)) ?? 0),
              0,
            )}
            label="Étudiants inscrits"
          />
        </section>
        {schools.some((x) =>
          canEnrollStudents(m.role, assignments, String(x.id)),
        ) ? (
          <details className="mt-6 rounded-3xl border bg-white p-6">
            <summary className="cursor-pointer text-xl font-black">
              Créer une cohorte
            </summary>
            <form
              action={createAcademyCohortAction}
              className="mt-5 grid gap-4 md:grid-cols-3"
            >
              <input
                type="hidden"
                name="return_to"
                value="/dashboard/academy/cohorts"
              />
              <Label title="École">
                <select name="school_id" required className={input}>
                  <option value="">Sélectionner…</option>
                  {schools
                    .filter((x) =>
                      canEnrollStudents(m.role, assignments, String(x.id)),
                    )
                    .map((x) => (
                      <option key={x.id} value={String(x.id)}>
                        {String(x.name)}
                      </option>
                    ))}
                </select>
              </Label>
              <Label title="Nom de la cohorte">
                <input
                  name="name"
                  required
                  minLength={2}
                  placeholder="Promotion 2026"
                  className={input}
                />
              </Label>
              <Label title="Programme (facultatif)">
                <select name="program_id" className={input}>
                  <option value="">À rattacher plus tard</option>
                  {programs
                    .filter((x) => x.status === "active")
                    .map((x) => (
                      <option key={x.id} value={String(x.id)}>
                        {String(programBy.get(String(x.id))?.name)} —{" "}
                        {String(schoolBy.get(String(x.school_id))?.name)}
                      </option>
                    ))}
                </select>
              </Label>
              <Label title="Date de début">
                <input name="starts_on" type="date" className={input} />
              </Label>
              <Label title="Date de fin">
                <input name="ends_on" type="date" className={input} />
              </Label>
              <Label title="Capacité">
                <input
                  name="capacity"
                  type="number"
                  min="1"
                  className={input}
                />
              </Label>
              <Label title="Statut">
                <select name="status" defaultValue="planned" className={input}>
                  {Object.entries(labels)
                    .filter(([k]) => k !== "archived")
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </Label>
              <div className="flex items-end">
                <button className="w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white">
                  Créer la cohorte
                </button>
              </div>
            </form>
          </details>
        ) : null}
        <section className="mt-7 grid gap-5 lg:grid-cols-2">
          {cohorts.map((x) => {
            const school = schoolBy.get(String(x.school_id)),
              program = programBy.get(String(x.program_id)),
              count = countBy.get(String(x.id)) ?? 0,
              capacity = Number(x.capacity) || null,
              canEdit = canEnrollStudents(
                m.role,
                assignments,
                String(x.school_id),
              );
            return (
              <article
                key={x.id}
                className="rounded-3xl border bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-violet-700">
                      {String(school?.name)}
                    </p>
                    <h2 className="mt-1 text-2xl font-black">
                      {String(x.name)}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {program ? String(program.name) : "Programme non défini"}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">
                    {labels[String(x.status)] ?? String(x.status)}
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Mini
                    label="Étudiants"
                    value={capacity ? `${count}/${capacity}` : String(count)}
                  />
                  <Mini label="Début" value={String(x.starts_on ?? "—")} />
                  <Mini label="Fin" value={String(x.ends_on ?? "—")} />
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-violet-600"
                    style={{
                      width: `${capacity ? Math.min(100, (count / capacity) * 100) : 0}%`,
                    }}
                  />
                </div>
                {canEdit ? (
                  <>
                    <details className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                      <summary className="cursor-pointer font-black text-violet-900">
                        Modifier la cohorte
                      </summary>
                      <form
                        action={updateAcademyCohortAction}
                        className="mt-4 grid gap-3 sm:grid-cols-2"
                      >
                        <input
                          type="hidden"
                          name="school_id"
                          value={String(x.school_id)}
                        />
                        <input
                          type="hidden"
                          name="cohort_id"
                          value={String(x.id)}
                        />
                        <input
                          type="hidden"
                          name="return_to"
                          value="/dashboard/academy/cohorts"
                        />
                        <Label title="Nom">
                          <input
                            name="name"
                            required
                            defaultValue={String(x.name)}
                            className={input}
                          />
                        </Label>
                        <Label title="Programme">
                          <select
                            name="program_id"
                            defaultValue={String(x.program_id ?? "")}
                            className={input}
                          >
                            <option value="">Programme non défini</option>
                            {programs
                              .filter(
                                (p) =>
                                  String(p.school_id) === String(x.school_id) &&
                                  p.status === "active",
                              )
                              .map((p) => (
                                <option key={p.id} value={String(p.id)}>
                                  {String(p.name)}
                                </option>
                              ))}
                          </select>
                        </Label>
                        <Label title="Date de début">
                          <input
                            name="starts_on"
                            type="date"
                            defaultValue={String(x.starts_on ?? "")}
                            className={input}
                          />
                        </Label>
                        <Label title="Date de fin">
                          <input
                            name="ends_on"
                            type="date"
                            defaultValue={String(x.ends_on ?? "")}
                            className={input}
                          />
                        </Label>
                        <Label title="Capacité maximale">
                          <input
                            name="capacity"
                            type="number"
                            min="1"
                            defaultValue={x.capacity ? String(x.capacity) : ""}
                            className={input}
                          />
                        </Label>
                        <Label title="Statut">
                          <select
                            name="status"
                            defaultValue={String(x.status)}
                            className={input}
                          >
                            {Object.entries(labels).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </Label>
                        <button className="rounded-xl bg-violet-700 px-4 py-3 font-black text-white sm:col-span-2">
                          Enregistrer toutes les modifications
                        </button>
                      </form>
                    </details>
                    <form
                      action={updateAcademyCohortStatusAction}
                      className="mt-5 flex gap-3"
                    >
                      <input
                        type="hidden"
                        name="school_id"
                        value={String(x.school_id)}
                      />
                      <input
                        type="hidden"
                        name="cohort_id"
                        value={String(x.id)}
                      />
                      <input
                        type="hidden"
                        name="return_to"
                        value="/dashboard/academy/cohorts"
                      />
                      <select
                        name="status"
                        defaultValue={String(x.status)}
                        className={`${input} mt-0`}
                      >
                        {Object.entries(labels).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">
                        Actualiser
                      </button>
                    </form>
                  </>
                ) : null}
              </article>
            );
          })}
          {!cohorts.length ? (
            <p className="rounded-3xl border border-dashed bg-white p-10 text-center text-slate-500">
              Aucune cohorte dans les écoles autorisées.
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
