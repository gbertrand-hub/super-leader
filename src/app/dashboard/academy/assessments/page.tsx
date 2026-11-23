import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createAssessmentAction,
  gradeAssessmentAction,
  updateAssessmentAction,
  updateAssessmentStatusAction,
} from "@/app/actions/academy-assessments";
import { syncAssessmentStudentsAction } from "@/app/actions/academy-quiz";
import {
  academyGlobalRoles,
  getAcademyAssignments,
} from "@/lib/academy/access";
import {
  assessmentAvailability,
  formatAssessmentDateTime,
  isoToZonedLocalInput,
} from "@/lib/academy/assessment-availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { commonTimeZones, normalizeTimeZone } from "@/lib/timezone";
type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? ""),
  input =
    "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const typeLabel = (s: string) =>
    ({
      quiz: "Quiz",
      exam: "Examen",
      project: "Projet",
      practical: "Pratique",
      oral: "Oral",
      other: "Autre",
    })[s] ?? s,
  statusLabel = (s: string) =>
    ({
      draft: "Brouillon",
      scheduled: "Programmée",
      open: "Ouverte",
      closed: "Terminée",
      archived: "Archivée",
    })[s] ?? s,
  resultLabel = (s: string) =>
    ({
      ungraded: "Non noté",
      passed: "Réussi",
      failed: "Échoué",
      absent: "Absent",
      exempt: "Exempté",
    })[s] ?? s;
export default async function AssessmentsPage({ searchParams }: Props) {
  const query = (await searchParams) ?? {},
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
    global = academyGlobalRoles.has(m.role);
  if (
    !global &&
    !assignments.some((x) =>
      ["director", "academic_coordinator", "instructor"].includes(
        x.assignment_role,
      ),
    )
  )
    redirect("/dashboard/academy");
  const ids = new Set(assignments.map((x) => x.school_id));
  const [
    { data: allSchools },
    { data: programs },
    { data: cohorts },
    { data: items },
    { data: members },
  ] = await Promise.all([
    a
      .from("academy_schools")
      .select("id,name")
      .eq("organization_id", m.organization_id)
      .eq("is_active", true)
      .order("name"),
    a
      .from("academy_programs")
      .select("id,school_id,name")
      .eq("organization_id", m.organization_id)
      .neq("status", "archived"),
    a
      .from("academy_cohorts")
      .select("id,school_id,name")
      .eq("organization_id", m.organization_id)
      .neq("status", "archived"),
    a
      .from("academy_assessments")
      .select(
        "id,school_id,program_id,cohort_id,evaluator_user_id,title,description,assessment_type,due_date,max_score,passing_score,status,opens_at,closes_at,schedule_time_zone",
      )
      .eq("organization_id", m.organization_id)
      .order("created_at", { ascending: false })
      .limit(100),
    a
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", m.organization_id)
      .eq("is_active", true),
  ]);
  const schools = (allSchools ?? []).filter(
      (x) => global || ids.has(String(x.id)),
    ),
    schoolIds = new Set(schools.map((x) => String(x.id))),
    assessments = (items ?? []).filter((x) =>
      schoolIds.has(String(x.school_id)),
    ),
    assessmentIds = assessments.map((x) => String(x.id));
  const { data: results } = assessmentIds.length
    ? await a
        .from("academy_assessment_results")
        .select("id,assessment_id,enrollment_id,score,result_status,feedback")
        .in("assessment_id", assessmentIds)
    : { data: [] };
  const enrollmentIds = [
      ...new Set((results ?? []).map((x) => String(x.enrollment_id))),
    ],
    { data: enrollments } = enrollmentIds.length
      ? await a
          .from("academy_school_enrollments")
          .select("id,user_id,crm_client_id")
          .in("id", enrollmentIds)
      : { data: [] };
  const userIds = [
      ...new Set([
        ...(enrollments ?? [])
          .map((x) => x.user_id)
          .filter(Boolean)
          .map(String),
        ...(members ?? []).map((x) => String(x.user_id)),
      ]),
    ],
    crmIds = [
      ...new Set(
        (enrollments ?? [])
          .map((x) => x.crm_client_id)
          .filter(Boolean)
          .map(String),
      ),
    ];
  const [{ data: profiles }, { data: clients }] = await Promise.all([
    userIds.length
      ? a.from("profiles").select("id,full_name,email,time_zone").in("id", userIds)
      : Promise.resolve({ data: [] }),
    crmIds.length
      ? a.from("crm_clients").select("id,full_name,email").in("id", crmIds)
      : Promise.resolve({ data: [] }),
  ]);
  const person = new Map<string, string>();
  (profiles ?? []).forEach((x) =>
    person.set(`u:${x.id}`, String(x.full_name || x.email || "Membre")),
  );
  (clients ?? []).forEach((x) =>
    person.set(`c:${x.id}`, String(x.full_name || x.email || "Étudiant")),
  );
  const enrollmentBy = new Map(
      (enrollments ?? []).map((x) => [String(x.id), x]),
    ),
    profileBy = new Map(
      (profiles ?? []).map((x) => [
        String(x.id),
        String(x.full_name || x.email || "Membre"),
      ]),
    ),
    schoolBy = new Map(schools.map((x) => [String(x.id), String(x.name)])),
    defaultTimeZone = normalizeTimeZone(
      (profiles ?? []).find((profile) => String(profile.id) === auth.user.id)
        ?.time_zone,
    );
  const graded = (results ?? []).filter((x) => x.result_status !== "ungraded"),
    passed = graded.filter((x) => x.result_status === "passed").length;
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard/academy" className="font-bold text-violet-700">
          ← Super Leader Academy
        </Link>
        <nav className="mt-5 flex gap-2">
          <Link
            href="/dashboard/academy/attendance"
            className="rounded-xl border bg-white px-5 py-3 font-black text-violet-700"
          >
            Présences
          </Link>
          <span className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">
            Évaluations
          </span>
        </nav>
        <header className="mt-4 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
            Performance académique
          </p>
          <h1 className="mt-2 text-4xl font-black">Évaluations</h1>
          <p className="mt-3 text-slate-300">
            Créez les examens, attribuez les notes et mesurez la réussite par
            école.
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
        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          <Stat n={assessments.length} label="Évaluations" />
          <Stat n={(results ?? []).length} label="Résultats attendus" />
          <Stat n={graded.length} label="Résultats saisis" />
          <Stat
            n={graded.length ? Math.round((passed / graded.length) * 100) : 0}
            label="% de réussite"
          />
        </section>
        <details className="mt-6 rounded-3xl border bg-white p-6">
          <summary className="cursor-pointer text-xl font-black">
            Créer une évaluation
          </summary>
          <form
            action={createAssessmentAction}
            className="mt-5 grid gap-4 md:grid-cols-3"
          >
            <Label t="Titre">
              <input name="title" required className={input} />
            </Label>
            <Label t="École">
              <select name="school_id" required className={input}>
                <option value="">Sélectionner…</option>
                {schools.map((x) => (
                  <option key={String(x.id)} value={String(x.id)}>
                    {String(x.name)}
                  </option>
                ))}
              </select>
            </Label>
            <Trainer
              members={members ?? []}
              profiles={profileBy}
              value={auth.user.id}
            />
            <Program
              data={(programs ?? []).filter((x) =>
                schoolIds.has(String(x.school_id)),
              )}
              schools={schoolBy}
            />
            <Cohort
              data={(cohorts ?? []).filter((x) =>
                schoolIds.has(String(x.school_id)),
              )}
              schools={schoolBy}
            />
            <Type />
            <Label t="Date limite">
              <input type="date" name="due_date" className={input} />
            </Label>
            <ScheduleFields timeZone={defaultTimeZone} />
            <Label t="Note maximale">
              <input
                type="number"
                name="max_score"
                min="1"
                step="0.01"
                defaultValue="100"
                required
                className={input}
              />
            </Label>
            <Label t="Note de réussite">
              <input
                type="number"
                name="passing_score"
                min="0"
                step="0.01"
                defaultValue="60"
                required
                className={input}
              />
            </Label>
            <Label t="Description">
              <textarea name="description" rows={3} className={input} />
            </Label>
            <button className="self-end rounded-xl bg-violet-700 px-5 py-3 font-black text-white md:col-span-2">
              Créer et attribuer aux étudiants
            </button>
          </form>
        </details>
        <section className="mt-7 space-y-5">
          {assessments.map((item) => {
            const rows = (results ?? []).filter(
                (x) => String(x.assessment_id) === String(item.id),
              ),
              done = rows.filter((x) => x.result_status !== "ungraded").length,
              availability = assessmentAvailability({
                status: String(item.status),
                opens_at: item.opens_at ? String(item.opens_at) : null,
                closes_at: item.closes_at ? String(item.closes_at) : null,
              }),
              timeZone = normalizeTimeZone(
                String(item.schedule_time_zone ?? defaultTimeZone),
              ),
              opensLabel = formatAssessmentDateTime(
                item.opens_at ? String(item.opens_at) : null,
                timeZone,
              ),
              closesLabel = formatAssessmentDateTime(
                item.closes_at ? String(item.closes_at) : null,
                timeZone,
              );
            return (
              <details
                key={String(item.id)}
                className="rounded-3xl border bg-white shadow-sm"
              >
                <summary className="cursor-pointer list-none p-6">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase text-violet-700">
                        {schoolBy.get(String(item.school_id))} ·{" "}
                        {typeLabel(String(item.assessment_type))}
                      </p>
                      <h2 className="text-xl font-black">
                        {String(item.title)}
                      </h2>
                      <p className="text-sm text-slate-500">
                        Échéance : {String(item.due_date ?? "Non définie")} ·
                        Réussite : {String(item.passing_score)}/
                        {String(item.max_score)}
                      </p>
                      {opensLabel || closesLabel ? (
                        <p className="mt-1 text-sm font-bold text-violet-700">
                          {opensLabel ? `Ouverture : ${opensLabel}` : "Ouverte maintenant"}
                          {closesLabel ? ` · Fermeture : ${closesLabel}` : ""}
                          {` · ${timeZone}`}
                        </p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">
                      {done}/{rows.length} notés ·{" "}
                      {statusLabel(availability)}
                    </span>
                  </div>
                </summary>
                <div className="border-t bg-slate-50 p-5">
                  <details className="mb-5 rounded-2xl border bg-white p-4">
                    <summary className="cursor-pointer font-black text-violet-700">
                      Modifier l’évaluation
                    </summary>
                    <form
                      action={updateAssessmentAction}
                      className="mt-4 grid gap-4 md:grid-cols-3"
                    >
                      <input
                        type="hidden"
                        name="assessment_id"
                        value={String(item.id)}
                      />
                      <Label t="Titre">
                        <input
                          name="title"
                          required
                          defaultValue={String(item.title)}
                          className={input}
                        />
                      </Label>
                      <Trainer
                        members={members ?? []}
                        profiles={profileBy}
                        value={String(item.evaluator_user_id ?? auth.user.id)}
                      />
                      <Type value={String(item.assessment_type)} />
                      <Label t="Date limite">
                        <input
                          type="date"
                          name="due_date"
                          defaultValue={String(item.due_date ?? "")}
                          className={input}
                        />
                      </Label>
                      <ScheduleFields
                        timeZone={timeZone}
                        opensAt={item.opens_at ? String(item.opens_at) : null}
                        closesAt={item.closes_at ? String(item.closes_at) : null}
                      />
                      <Label t="Note maximale">
                        <input
                          type="number"
                          name="max_score"
                          min="1"
                          step="0.01"
                          defaultValue={String(item.max_score)}
                          required
                          className={input}
                        />
                      </Label>
                      <Label t="Note de réussite">
                        <input
                          type="number"
                          name="passing_score"
                          min="0"
                          step="0.01"
                          defaultValue={String(item.passing_score)}
                          required
                          className={input}
                        />
                      </Label>
                      <Label t="Description">
                        <textarea
                          name="description"
                          rows={3}
                          defaultValue={String(item.description ?? "")}
                          className={input}
                        />
                      </Label>
                      <button className="self-end rounded-xl bg-violet-700 px-5 py-3 font-black text-white md:col-span-2">
                        Enregistrer les modifications
                      </button>
                    </form>
                  </details>
                  <div className="mb-5 flex flex-wrap gap-3">
                    <form action={syncAssessmentStudentsAction}>
                      <input
                        type="hidden"
                        name="assessment_id"
                        value={String(item.id)}
                      />
                      <input
                        type="hidden"
                        name="return_to"
                        value="/dashboard/academy/assessments"
                      />
                      <button className="rounded-xl bg-amber-400 px-4 py-2.5 font-black text-slate-950">
                        Synchroniser les étudiants inscrits
                      </button>
                    </form>
                    {String(item.assessment_type) === "quiz" ? (
                      <Link
                        href={`/dashboard/academy/assessments/${item.id}/quiz-builder`}
                        className="rounded-xl bg-violet-700 px-4 py-2.5 font-black text-white"
                      >
                        Préparer le questionnaire
                      </Link>
                    ) : null}
                    <State
                      id={String(item.id)}
                      state="open"
                      label="Ouvrir maintenant"
                      color="bg-emerald-600 text-white"
                    />
                    <State
                      id={String(item.id)}
                      state="closed"
                      label="Terminer maintenant"
                      color="bg-slate-950 text-white"
                    />
                    <State
                      id={String(item.id)}
                      state="archived"
                      label="Archiver"
                      color="border bg-white text-slate-700"
                    />
                  </div>
                  <p className="mb-4 text-xs font-semibold text-slate-500">
                    La synchronisation ajoute les étudiants actifs de l’école,
                    du programme et de la cohorte choisis, sans créer de
                    doublon.
                  </p>
                  <h3 className="mb-3 text-lg font-black">
                    Notes des étudiants
                  </h3>
                  <div className="space-y-3">
                    {rows.map((r) => {
                      const e = enrollmentBy.get(String(r.enrollment_id)),
                        name = e
                          ? person.get(
                              e.crm_client_id
                                ? `c:${e.crm_client_id}`
                                : `u:${e.user_id}`,
                            )
                          : "Étudiant";
                      return (
                        <form
                          key={String(r.id)}
                          action={gradeAssessmentAction}
                          className="grid items-end gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[1.3fr_.7fr_.8fr_1.5fr_auto]"
                        >
                          <input
                            type="hidden"
                            name="result_id"
                            value={String(r.id)}
                          />
                          <div>
                            <p className="font-black">{name}</p>
                            <p className="text-xs text-slate-500">
                              {resultLabel(String(r.result_status))}
                            </p>
                          </div>
                          <Label t={`Note / ${item.max_score}`}>
                            <input
                              type="number"
                              name="score"
                              min="0"
                              max={Number(item.max_score)}
                              step="0.01"
                              defaultValue={
                                r.score === null ? "" : String(r.score)
                              }
                              className={input}
                            />
                          </Label>
                          <Label t="Cas spécial">
                            <select
                              name="special_status"
                              defaultValue={
                                ["absent", "exempt", "ungraded"].includes(
                                  String(r.result_status),
                                )
                                  ? String(r.result_status)
                                  : "graded"
                              }
                              className={input}
                            >
                              <option value="graded">Noter</option>
                              <option value="absent">Absent</option>
                              <option value="exempt">Exempté</option>
                              <option value="ungraded">Non noté</option>
                            </select>
                          </Label>
                          <Label t="Commentaire">
                            <input
                              name="feedback"
                              defaultValue={String(r.feedback ?? "")}
                              className={input}
                            />
                          </Label>
                          <button className="rounded-xl bg-amber-400 px-4 py-2.5 font-black">
                            Enregistrer
                          </button>
                        </form>
                      );
                    })}
                    {!rows.length ? (
                      <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-slate-500">
                        Aucun étudiant attribué à cette évaluation.
                      </p>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}
        </section>
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
function Label({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <label className="text-sm font-bold text-slate-700">
      {t}
      {children}
    </label>
  );
}
function Trainer({
  members,
  profiles,
  value,
}: {
  members: { user_id: unknown }[];
  profiles: Map<string, string>;
  value: string;
}) {
  return (
    <Label t="Évaluateur">
      <select name="evaluator_user_id" defaultValue={value} className={input}>
        {members.map((x) => (
          <option key={String(x.user_id)} value={String(x.user_id)}>
            {profiles.get(String(x.user_id)) ?? String(x.user_id)}
          </option>
        ))}
      </select>
    </Label>
  );
}
function Program({
  data,
  schools,
}: {
  data: { id: unknown; school_id: unknown; name: unknown }[];
  schools: Map<string, string>;
}) {
  return (
    <Label t="Programme">
      <select name="program_id" className={input}>
        <option value="">Toute l’école</option>
        {data.map((x) => (
          <option key={String(x.id)} value={String(x.id)}>
            {schools.get(String(x.school_id))} · {String(x.name)}
          </option>
        ))}
      </select>
    </Label>
  );
}
function Cohort({
  data,
  schools,
}: {
  data: { id: unknown; school_id: unknown; name: unknown }[];
  schools: Map<string, string>;
}) {
  return (
    <Label t="Cohorte">
      <select name="cohort_id" className={input}>
        <option value="">Toutes</option>
        {data.map((x) => (
          <option key={String(x.id)} value={String(x.id)}>
            {schools.get(String(x.school_id))} · {String(x.name)}
          </option>
        ))}
      </select>
    </Label>
  );
}
function Type({ value = "quiz" }: { value?: string }) {
  return (
    <Label t="Type">
      <select name="assessment_type" defaultValue={value} className={input}>
        <option value="quiz">Quiz</option>
        <option value="exam">Examen</option>
        <option value="project">Projet</option>
        <option value="practical">Pratique</option>
        <option value="oral">Oral</option>
        <option value="other">Autre</option>
      </select>
    </Label>
  );
}
function ScheduleFields({
  timeZone,
  opensAt = null,
  closesAt = null,
}: {
  timeZone: string;
  opensAt?: string | null;
  closesAt?: string | null;
}) {
  return (
    <>
      <Label t="Ouverture automatique (facultatif)">
        <input
          type="datetime-local"
          name="opens_at"
          defaultValue={isoToZonedLocalInput(opensAt, timeZone)}
          className={input}
        />
      </Label>
      <Label t="Fermeture automatique (facultatif)">
        <input
          type="datetime-local"
          name="closes_at"
          defaultValue={isoToZonedLocalInput(closesAt, timeZone)}
          className={input}
        />
      </Label>
      <Label t="Fuseau horaire de la programmation">
        <select
          name="schedule_time_zone"
          defaultValue={timeZone}
          className={input}
        >
          {commonTimeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Label>
    </>
  );
}
function State({
  id,
  state,
  label,
  color,
}: {
  id: string;
  state: string;
  label: string;
  color: string;
}) {
  return (
    <form action={updateAssessmentStatusAction}>
      <input type="hidden" name="assessment_id" value={id} />
      <input type="hidden" name="status" value={state} />
      <button className={`rounded-xl px-4 py-2.5 font-black ${color}`}>
        {label}
      </button>
    </form>
  );
}
