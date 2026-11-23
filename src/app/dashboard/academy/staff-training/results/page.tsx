import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {canViewStaffTrainingResults, loadStaffTrainingResults, type StaffTrainingParticipantResult} from "@/lib/academy/staff-training-results";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string; is_active: boolean};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDateTime(value: string | null, fr: boolean) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function statusLabel(status: StaffTrainingParticipantResult["status"], fr: boolean) {
  if (status === "validated") return fr ? "Validé" : "Validated";
  if (status === "in_progress") return fr ? "À compléter" : "In progress";
  return fr ? "Non commencé" : "Not started";
}

function statusTone(status: StaffTrainingParticipantResult["status"]) {
  if (status === "validated") return "bg-emerald-100 text-emerald-800";
  if (status === "in_progress") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

export default async function StaffTrainingResultsPage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const requestedCourseId = first(params.course);
  const search = first(params.q).trim().toLowerCase();
  const requestedStatus = first(params.status);
  const statusFilter = new Set(["validated", "in_progress", "not_started"]).has(requestedStatus) ? requestedStatus : "all";
  const {locale} = await getI18n();
  const fr = locale === "fr";

  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard");
  if (!canViewStaffTrainingResults(membership.role)) redirect("/dashboard/academy/staff-training?error=access-denied");

  const data = await loadStaffTrainingResults({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
    courseId: requestedCourseId || undefined,
  });
  if (!data) redirect("/dashboard/academy/staff-training?error=training-not-found");

  const filtered = data.participants.filter((participant) => {
    if (statusFilter !== "all" && participant.status !== statusFilter) return false;
    if (!search) return true;
    return `${participant.fullName} ${participant.email} ${participant.role}`.toLowerCase().includes(search);
  });
  const validated = data.participants.filter((row) => row.status === "validated").length;
  const inProgress = data.participants.filter((row) => row.status === "in_progress").length;
  const notStarted = data.participants.filter((row) => row.status === "not_started").length;
  const attemptedScores = data.participants.flatMap((row) => row.quizResults.map((result) => result.bestScore).filter((score): score is number => score !== null));
  const averageScore = attemptedScores.length ? Math.round((attemptedScores.reduce((sum, score) => sum + score, 0) / attemptedScores.length) * 10) / 10 : null;
  const completionRate = data.participants.length ? Math.round((validated / data.participants.length) * 100) : 0;

  const exportParams = new URLSearchParams({course: data.course.id});
  if (search) exportParams.set("q", search);
  if (statusFilter !== "all") exportParams.set("status", statusFilter);

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1600px]">
    <header className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-violet-950 to-indigo-950 p-7 text-white shadow-xl lg:p-9">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">Super Leader Academy · Staff Training</p><h1 className="mt-3 text-3xl font-black sm:text-4xl">{fr ? "Résultats consolidés des évaluations" : "Consolidated assessment results"}</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-200">{fr ? "Suivez en une seule vue qui a commencé, qui doit encore compléter les quiz et qui a validé tous les modules obligatoires." : "See who has started, who still needs to complete quizzes, and who has passed every required module."}</p></div><div className="flex flex-wrap gap-2"><Link href={`/dashboard/academy/staff-training?course=${data.course.id}`} className="rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-black hover:bg-white/20">← {fr ? "Retour Staff Training" : "Back to Staff Training"}</Link><a href={`/api/academy/staff-training/results?${exportParams.toString()}`} className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-300">{fr ? "Exporter CSV / Excel" : "Export CSV / Excel"}</a></div></div>
      <div className="mt-6 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-200"><span className="rounded-full bg-white/10 px-3 py-1.5">{data.course.title}</span><span className="rounded-full bg-white/10 px-3 py-1.5">{data.scope === "team" ? (fr ? "Périmètre : mon équipe" : "Scope: my team") : (fr ? "Périmètre : organisation" : "Scope: organization")}</span>{data.course.training_month ? <span className="rounded-full bg-white/10 px-3 py-1.5">{data.course.training_month.slice(0, 7)}</span> : null}</div>
    </header>

    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label={fr ? "Participants" : "Participants"} value={data.participants.length} tone="slate" />
      <Metric label={fr ? "Validés" : "Validated"} value={validated} detail={`${completionRate}%`} tone="emerald" />
      <Metric label={fr ? "À compléter" : "In progress"} value={inProgress} tone="amber" />
      <Metric label={fr ? "Non commencés" : "Not started"} value={notStarted} tone="rose" />
      <Metric label={fr ? "Score moyen" : "Average score"} value={averageScore === null ? "—" : `${averageScore}%`} tone="violet" />
    </section>

    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <form className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_240px_auto]" method="get">
        <input type="hidden" name="course" value={data.course.id} />
        <input name="q" defaultValue={first(params.q)} placeholder={fr ? "Rechercher un collaborateur, email ou rôle..." : "Search employee, email or role..."} className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-500" />
        <select name="status" defaultValue={statusFilter} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold"><option value="all">{fr ? "Tous les statuts" : "All statuses"}</option><option value="validated">{fr ? "Validés" : "Validated"}</option><option value="in_progress">{fr ? "À compléter" : "In progress"}</option><option value="not_started">{fr ? "Non commencés" : "Not started"}</option></select>
        <button className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{fr ? "Filtrer" : "Filter"}</button>
      </form>
    </section>

    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "Évaluations par jour / module" : "Day / module assessments"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Résultats de l'équipe" : "Team results"}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{filtered.length} {fr ? "ligne(s)" : "row(s)"}</span></div>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr><th className="sticky left-0 z-10 min-w-[240px] bg-slate-50 px-4 py-3">{fr ? "Collaborateur" : "Employee"}</th>{data.quizzes.map((quiz) => <th key={quiz.id} className="min-w-[180px] px-4 py-3"><span className="block text-amber-700">{quiz.module_label}</span><span className="mt-1 block normal-case tracking-normal text-slate-500">{Number(quiz.passing_score)}% {fr ? "requis" : "required"}</span></th>)}<th className="min-w-[120px] px-4 py-3">{fr ? "Progression" : "Progress"}</th><th className="min-w-[150px] px-4 py-3">{fr ? "Statut" : "Status"}</th><th className="min-w-[170px] px-4 py-3">{fr ? "Dernière tentative" : "Last attempt"}</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{filtered.map((participant) => <tr key={participant.userId} className="align-top hover:bg-slate-50/60"><td className="sticky left-0 z-10 bg-white px-4 py-4"><p className="font-black text-slate-950">{participant.fullName}</p><p className="mt-1 text-xs text-slate-500">{participant.email || "—"}</p><div className="mt-2 flex flex-wrap gap-1"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">{participant.role || "staff"}</span>{!participant.membershipActive ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase text-rose-700">{fr ? "inactif" : "inactive"}</span> : null}</div></td>{participant.quizResults.map((result) => <td key={result.quizId} className="px-4 py-4">{result.bestScore === null ? <span className="font-bold text-slate-400">—</span> : <><div className="flex items-center gap-2"><span className={`text-lg font-black ${result.passed ? "text-emerald-700" : "text-rose-700"}`}>{result.bestScore}%</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${result.passed ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{result.passed ? (fr ? "Réussi" : "Passed") : (fr ? "Échec" : "Failed")}</span></div><p className="mt-1 text-xs text-slate-500">{result.attempts} {fr ? "tentative(s)" : "attempt(s)"}</p></>}</td>)}<td className="px-4 py-4"><p className="text-lg font-black">{participant.progressPercent}%</p><p className="mt-1 text-xs text-slate-500">{participant.requiredPassed}/{participant.requiredTotal} {fr ? "quiz requis" : "required quizzes"}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${statusTone(participant.status)}`}>{statusLabel(participant.status, fr)}</span><p className="mt-2 text-xs text-slate-500">{participant.totalAttempts} {fr ? "tentative(s) au total" : "total attempt(s)"}</p></td><td className="px-4 py-4 text-xs font-bold text-slate-600">{formatDateTime(participant.lastAttemptAt, fr)}</td></tr>)}{!filtered.length ? <tr><td colSpan={Math.max(4, data.quizzes.length + 4)} className="px-6 py-12 text-center text-sm font-bold text-slate-500">{fr ? "Aucun collaborateur ne correspond à ces filtres." : "No employee matches these filters."}</td></tr> : null}</tbody></table></div>
    </section>

    <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 text-sm leading-6 text-indigo-950"><p className="font-black">{fr ? "Règle de lecture" : "How to read this dashboard"}</p><p className="mt-1">{fr ? "Validé = tous les quiz obligatoires ont au moins une tentative réussie. À compléter = au moins une tentative existe mais tous les quiz obligatoires ne sont pas encore validés. Non commencé = aucune tentative enregistrée." : "Validated = every required quiz has at least one passing attempt. In progress = at least one attempt exists but not every required quiz is passed. Not started = no attempt is recorded."}</p></section>
  </div></main>;
}

function Metric({label, value, detail, tone}: {label: string; value: string | number; detail?: string; tone: "slate" | "emerald" | "amber" | "rose" | "violet"}) {
  const tones = {slate: "bg-white text-slate-950", emerald: "bg-emerald-50 text-emerald-950", amber: "bg-amber-50 text-amber-950", rose: "bg-rose-50 text-rose-950", violet: "bg-violet-50 text-violet-950"};
  return <article className={`rounded-3xl border border-slate-200 p-5 shadow-sm ${tones[tone]}`}><p className="text-xs font-black uppercase tracking-wider opacity-65">{label}</p><div className="mt-2 flex items-end gap-2"><p className="text-3xl font-black">{value}</p>{detail ? <span className="pb-1 text-xs font-black opacity-70">{detail}</span> : null}</div></article>;
}
