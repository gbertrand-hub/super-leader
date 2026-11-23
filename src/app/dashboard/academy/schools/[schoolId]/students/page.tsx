import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  addAcademyStudentFollowupAction,
  enrollAcademyStudentAction,
  recordAcademyStudentPaymentAction,
  updateAcademyStudentProgressAction,
} from "@/app/actions/academy-student-tracking";
import { issueStudentCardAction } from "@/app/actions/academy-student-cards";
import { TeachableStudentImporter } from "@/components/academy/teachable-student-importer";
import { AcademyCrmStudentSearch } from "@/components/academy/academy-crm-student-search";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  canAddFollowup,
  canEditFinance,
  canEditTraining,
  canEnrollStudents,
  canManageCards,
  canViewFinance,
  enrollmentVisibleTo,
  getAcademyAssignments,
  hasSchoolAccess,
} from "@/lib/academy/access";

type Props = {
  params: Promise<{ schoolId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
type Enrollment = {
  id: string;
  crm_client_id: string | null;
  user_id: string | null;
  program_id: string | null;
  cohort_id: string | null;
  academic_status: string;
  source: string;
  assigned_follow_up_user_id: string | null;
};
type Finance = {
  enrollment_id: string;
  is_internal_training: boolean;
  list_price: number | string;
  discount_amount: number | string;
  agreed_amount: number | string;
  currency: string;
  payment_status: string;
  first_payment_due_on: string | null;
};
type Progress = {
  enrollment_id: string;
  progress_percent: number | string;
  current_module: string | null;
  last_activity_on: string | null;
  training_status: string;
  risk_level: string;
  next_action: string | null;
  next_action_on: string | null;
};
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const input =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);

export default async function StudentTrackingPage({
  params,
  searchParams,
}: Props) {
  const { schoolId } = await params;
  const query = (await searchParams) ?? {};
  const selectedEnrollmentId = first(query.student);
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
  const accessAssignments = await getAcademyAssignments(
    admin,
    membership.organization_id,
    auth.user.id,
  );
  if (!hasSchoolAccess(membership.role, accessAssignments, schoolId))
    notFound();
  const allowEnroll = canEnrollStudents(
      membership.role,
      accessAssignments,
      schoolId,
    ),
    allowFinanceView = canViewFinance(
      membership.role,
      accessAssignments,
      schoolId,
    ),
    allowFinanceEdit = canEditFinance(
      membership.role,
      accessAssignments,
      schoolId,
    ),
    allowTrainingEdit = canEditTraining(
      membership.role,
      accessAssignments,
      schoolId,
    ),
    allowFollowup = canAddFollowup(
      membership.role,
      accessAssignments,
      schoolId,
    ),
    allowCards = canManageCards(membership.role);
  const { data: school } = await admin
    .from("academy_schools")
    .select("id,name")
    .eq("id", schoolId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{ id: string; name: string }>();
  if (!school) notFound();
  const [
    enrollmentsResult,
    financeResult,
    progressResult,
    paymentsResult,
    programsResult,
    cohortsResult,
    clientsResult,
    staffResult,
  ] = await Promise.all([
    admin
      .from("academy_school_enrollments")
      .select(
        "id,crm_client_id,user_id,program_id,cohort_id,academic_status,source,assigned_follow_up_user_id",
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false }),
    admin
      .from("academy_student_finance")
      .select(
        "enrollment_id,is_internal_training,list_price,discount_amount,agreed_amount,currency,payment_status,first_payment_due_on",
      )
      .eq("organization_id", membership.organization_id),
    admin
      .from("academy_student_progress")
      .select(
        "enrollment_id,progress_percent,current_module,last_activity_on,training_status,risk_level,next_action,next_action_on",
      )
      .eq("organization_id", membership.organization_id),
    admin
      .from("academy_student_payments")
      .select("enrollment_id,amount,currency,paid_on")
      .eq("organization_id", membership.organization_id),
    admin
      .from("academy_programs")
      .select("id,name")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .order("name"),
    admin
      .from("academy_cohorts")
      .select("id,name,program_id")
      .eq("school_id", schoolId)
      .neq("status", "archived")
      .order("name"),
    admin
      .from("crm_clients")
      .select("id,full_name,email,status")
      .eq("organization_id", membership.organization_id)
      .order("full_name")
      .limit(500),
    admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true),
  ]);
  if (financeResult.error)
    return (
      <main className="p-8">
        <Link href={`/dashboard/academy/schools/${schoolId}`}>← Retour</Link>
        <h1 className="mt-5 text-3xl font-black">
          Centre de suivi des étudiants
        </h1>
        <p className="mt-5 rounded-2xl bg-amber-50 p-5 text-amber-900">
          Exécute la migration{" "}
          <b>077_student_finance_training_tracking_v4_8_15.sql</b>.
        </p>
      </main>
    );
  const enrollments = ((enrollmentsResult.data ?? []) as Enrollment[]).filter(
    (x) =>
      enrollmentVisibleTo(
        auth.user.id,
        membership.role,
        accessAssignments,
        schoolId,
        x,
      ),
  );
  const enrollmentIds = enrollments.map((x) => x.id),
    visibleIds = new Set(enrollmentIds);
  const finances = ((financeResult.data ?? []) as Finance[]).filter((x) =>
      visibleIds.has(x.enrollment_id),
    ),
    progresses = ((progressResult.data ?? []) as Progress[]).filter((x) =>
      visibleIds.has(x.enrollment_id),
    );
  const clientRows = clientsResult.data ?? [];
  const { data: cardRows } = enrollmentIds.length
    ? await admin
        .from("academy_student_cards")
        .select("id,enrollment_id,card_number,status,valid_until")
        .in("enrollment_id", enrollmentIds)
        .order("issue_number", { ascending: false })
    : { data: [] };
  const currentCardBy = new Map<
    string,
    {
      id: string;
      enrollment_id: string;
      card_number: string;
      status: string;
      valid_until: string;
    }
  >();
  (cardRows ?? []).forEach((card) => {
    if (!currentCardBy.has(String(card.enrollment_id)))
      currentCardBy.set(
        String(card.enrollment_id),
        card as {
          id: string;
          enrollment_id: string;
          card_number: string;
          status: string;
          valid_until: string;
        },
      );
  });
  const userIds = [
    ...new Set([
      ...(enrollments.map((x) => x.user_id).filter(Boolean) as string[]),
      ...(staffResult.data ?? []).map((x) => String(x.user_id)),
    ]),
  ];
  const { data: profiles } = userIds.length
    ? await admin
        .from("profiles")
        .select("id,full_name,email")
        .in("id", userIds)
    : { data: [] };
  const people = new Map<string, { name: string; detail: string }>();
  clientRows.forEach((x) =>
    people.set(String(x.id), {
      name: String(x.full_name),
      detail: String(x.status) === "prospect" ? "Prospect CRM" : "Client CRM",
    }),
  );
  (profiles ?? []).forEach((x) =>
    people.set(String(x.id), {
      name: String(x.full_name || x.email || "Membre du staff"),
      detail: "Staff",
    }),
  );
  const financeBy = new Map(finances.map((x) => [x.enrollment_id, x])),
    progressBy = new Map(progresses.map((x) => [x.enrollment_id, x]));
  const paidBy = new Map<string, number>();
  (paymentsResult.data ?? [])
    .filter((x) => visibleIds.has(String(x.enrollment_id)))
    .forEach((x) =>
      paidBy.set(
        String(x.enrollment_id),
        (paidBy.get(String(x.enrollment_id)) ?? 0) + n(x.amount),
      ),
    );
  const totals = finances.reduce(
    (a, x) => {
      a.sold += n(x.agreed_amount);
      a.paid += paidBy.get(x.enrollment_id) ?? 0;
      if (x.payment_status === "overdue") a.overdue++;
      return a;
    },
    { sold: 0, paid: 0, overdue: 0 },
  );
  const currency =
    finances.find((x) => !x.is_internal_training)?.currency ?? "USD";
  const risks = progresses.filter((x) =>
    ["high", "critical"].includes(x.risk_level),
  ).length;
  const success = first(query.success),
    error = first(query.error);
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link
          href={`/dashboard/academy/schools/${schoolId}`}
          className="font-bold text-violet-700"
        >
          ← Dashboard de l’école
        </Link>
        <header className="mt-5 rounded-3xl bg-slate-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">
            CRM académique et financier
          </p>
          <h1 className="mt-2 text-4xl font-black">{school.name}</h1>
          <p className="mt-3 text-slate-300">
            Paiements, progression Teachable déclarée et suivi humain des
            étudiants.
          </p>
        </header>
        {success ? (
          <p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">
            {success}
          </p>
        ) : null}
        {error ? (
          <p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">
            {error}
          </p>
        ) : null}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card n={String(enrollments.length)} label="Étudiants visibles" />
          {allowFinanceView ? (
            <>
              <Card n={money(totals.sold, currency)} label="Montant vendu" />
              <Card n={money(totals.paid, currency)} label="Encaissé" />
              <Card
                n={money(Math.max(0, totals.sold - totals.paid), currency)}
                label="Solde restant"
              />
            </>
          ) : null}
          <Card
            n={String((allowFinanceView ? totals.overdue : 0) + risks)}
            label="Alertes"
            danger={(allowFinanceView ? totals.overdue : 0) + risks > 0}
          />
        </section>
        {allowEnroll ? (
          <div className="mt-6">
            <TeachableStudentImporter schoolId={schoolId} programs={(programsResult.data ?? []).map((p) => ({ id: String(p.id), school_id: schoolId, name: String(p.name) }))} cohorts={(cohortsResult.data ?? []).map((c) => ({ id: String(c.id), school_id: schoolId, program_id: c.program_id ? String(c.program_id) : null, name: String(c.name) }))} />
          </div>
        ) : null}
        {allowEnroll ? (
          <details className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
            <summary className="cursor-pointer text-xl font-black">
              Inscrire un contact CRM dans cette école
            </summary>
            <form
              action={enrollAcademyStudentAction}
              className="mt-5 grid gap-4 md:grid-cols-3"
            >
              <input type="hidden" name="school_id" value={schoolId} />
              <AcademyCrmStudentSearch />
              <Label title="Programme">
                <select name="program_id" required className={input}>
                  <option value="">Sélectionner le programme…</option>
                  {programsResult.data?.map((x) => (
                    <option key={x.id} value={String(x.id)}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </Label>
              <Label title="Cohorte">
                <select name="cohort_id" required className={input}>
                  <option value="">Sélectionner la cohorte…</option>
                  {cohortsResult.data?.map((x) => (
                    <option key={x.id} value={String(x.id)}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </Label>
              <Label title="Responsable du suivi">
                <select name="follow_up_user_id" className={input}>
                  <option value="">Non affecté</option>
                  {(profiles ?? []).map((x) => (
                    <option key={x.id} value={String(x.id)}>
                      {String(x.full_name || x.email)}
                    </option>
                  ))}
                </select>
              </Label>
              {allowFinanceEdit ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 md:col-span-2">Le prix n&apos;est plus saisi ici. Il est hérité du tarif homologué de cohorte, sinon du programme. Les promotions et exceptions se gèrent dans le compte financier consolidé.</div> : null}
              {allowFinanceEdit ? <Label title="Première échéance"><input name="first_payment_due_on" type="date" className={input}/></Label> : null}
              <div className="flex items-end">
                <button className="w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white">
                  Créer le dossier étudiant
                </button>
              </div>
            </form>
          </details>
        ) : null}
        <section className="mt-7 space-y-5">
          {enrollments.map((enrollment) => {
            const key = String(enrollment.crm_client_id || enrollment.user_id),
              person = people.get(key),
              finance = financeBy.get(enrollment.id),
              progress = progressBy.get(enrollment.id),
              paid = paidBy.get(enrollment.id) ?? 0,
              balance = Math.max(0, n(finance?.agreed_amount) - paid),
              card = currentCardBy.get(enrollment.id),
              today = new Date().toISOString().slice(0, 10),
              nextYear = new Date();
            nextYear.setFullYear(nextYear.getFullYear() + 1);
            return (
              <details
                key={enrollment.id}
                id={`student-${enrollment.id}`}
                open={selectedEnrollmentId === enrollment.id}
                className="rounded-3xl border border-slate-200 bg-white shadow-sm"
              >
                <summary className="cursor-pointer list-none p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black">
                        {person?.name ?? "Identité liée"}
                      </h2>
                      <p className="text-sm text-slate-500">
                        {person?.detail}{allowFinanceView ? ` · ${finance?.is_internal_training ? "Formation interne" : "Formation payante"}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {allowFinanceView ? <Badge value={finance?.payment_status ?? "non configuré"}/> : null}
                      <Badge
                        value={`${n(progress?.progress_percent)}% progression`}
                      />
                      <Badge
                        value={`Risque ${progress?.risk_level ?? "low"}`}
                      />
                      {card ? <Badge value={`Carte ${card.status}`} /> : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                    {allowFinanceView ? <>
                      <Mini label="Montant" value={money(n(finance?.agreed_amount),finance?.currency ?? currency)}/>
                      <Mini label="Payé" value={money(paid, finance?.currency ?? currency)}/>
                      <Mini label="Solde" value={money(balance, finance?.currency ?? currency)}/>
                    </> : null}
                    <Mini
                      label="Module actuel"
                      value={progress?.current_module ?? "Non renseigné"}
                    />
                  </div>
                </summary>
                <div className="border-t border-slate-100 bg-slate-50 p-5">
                  {card ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black">
                          Carte d’étudiant {card.card_number}
                        </p>
                        <p className="text-sm text-slate-500">
                          {card.status} · valide jusqu’au {card.valid_until}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/academy/student-card/${card.id}`}
                        className="rounded-xl bg-slate-950 px-4 py-3 font-black text-white"
                      >
                        Ouvrir la carte
                      </Link>
                    </div>
                  ) : allowCards ? (
                    <form
                      action={issueStudentCardAction}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input
                        type="hidden"
                        name="enrollment_id"
                        value={enrollment.id}
                      />
                      <input type="hidden" name="school_id" value={schoolId} />
                      <label className="text-sm font-bold">
                        Valide du
                        <input
                          name="valid_from"
                          type="date"
                          defaultValue={today}
                          className={input}
                        />
                      </label>
                      <label className="text-sm font-bold">
                        Expire le
                        <input
                          name="valid_until"
                          type="date"
                          required
                          defaultValue={nextYear.toISOString().slice(0, 10)}
                          className={input}
                        />
                      </label>
                      <button className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">
                        Émettre la carte d’étudiant
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Carte non encore émise.
                    </p>
                  )}
                </div>
                {allowFinanceEdit || allowTrainingEdit || allowFollowup ? (
                  <div className="grid gap-5 border-t border-slate-100 p-6 lg:grid-cols-3">
                    {allowFinanceEdit ? (
                    <form
                      action={recordAcademyStudentPaymentAction}
                      className="rounded-2xl bg-emerald-50 p-5"
                    >
                      <h3 className="font-black text-emerald-950">
                        Enregistrer un paiement
                      </h3>
                      <Hidden
                        schoolId={schoolId}
                        enrollmentId={enrollment.id}
                      />
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        placeholder="Montant"
                        className={input}
                      />
                      <input
                        name="currency"
                        defaultValue={finance?.currency ?? currency}
                        maxLength={3}
                        className={input}
                      />
                      <input
                        name="paid_on"
                        type="date"
                        defaultValue={new Date().toISOString().slice(0, 10)}
                        className={input}
                      />
                      <select name="payment_method" className={input}>
                        <option value="bank_transfer">Virement</option>
                        <option value="cash">Espèces</option>
                        <option value="card">Carte</option>
                        <option value="mobile_money">Mobile Money</option>
                        <option value="other">Autre</option>
                      </select>
                      <input
                        name="reference"
                        placeholder="Référence"
                        className={input}
                      />
                      <button className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2 font-black text-white">
                        Enregistrer
                      </button>
                    </form>
                    ) : null}
                    {allowTrainingEdit ? (
                    <form
                      action={updateAcademyStudentProgressAction}
                      className="rounded-2xl bg-violet-50 p-5"
                    >
                      <h3 className="font-black text-violet-950">
                        Progression de formation
                      </h3>
                      <Hidden
                        schoolId={schoolId}
                        enrollmentId={enrollment.id}
                      />
                      <input
                        name="progress_percent"
                        type="number"
                        min="0"
                        max="100"
                        defaultValue={n(progress?.progress_percent)}
                        placeholder="Progression %"
                        className={input}
                      />
                      <input
                        name="current_module"
                        defaultValue={progress?.current_module ?? ""}
                        placeholder="Module actuel"
                        className={input}
                      />
                      <input
                        name="last_activity_on"
                        type="date"
                        defaultValue={progress?.last_activity_on ?? ""}
                        className={input}
                      />
                      <select
                        name="training_status"
                        defaultValue={progress?.training_status ?? "active"}
                        className={input}
                      >
                        <option value="not_started">Non commencé</option>
                        <option value="active">Actif</option>
                        <option value="paused">En pause</option>
                        <option value="at_risk">À risque</option>
                        <option value="completed">Terminé</option>
                        <option value="withdrawn">Abandon</option>
                      </select>
                      <select
                        name="risk_level"
                        defaultValue={progress?.risk_level ?? "low"}
                        className={input}
                      >
                        <option value="low">Risque faible</option>
                        <option value="medium">Risque moyen</option>
                        <option value="high">Risque élevé</option>
                        <option value="critical">Risque critique</option>
                      </select>
                      <input
                        name="next_action"
                        defaultValue={progress?.next_action ?? ""}
                        placeholder="Prochaine action"
                        className={input}
                      />
                      <input
                        name="next_action_on"
                        type="date"
                        defaultValue={progress?.next_action_on ?? ""}
                        className={input}
                      />
                      <button className="mt-3 w-full rounded-xl bg-violet-700 px-4 py-2 font-black text-white">
                        Mettre à jour
                      </button>
                    </form>
                    ) : null}
                    {allowFollowup ? (
                    <form
                      action={addAcademyStudentFollowupAction}
                      className="rounded-2xl bg-amber-50 p-5"
                    >
                      <h3 className="font-black text-amber-950">
                        Ajouter un suivi
                      </h3>
                      <Hidden
                        schoolId={schoolId}
                        enrollmentId={enrollment.id}
                      />
                      <select name="channel" className={input}>
                        <option value="phone">Téléphone</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="email">Email</option>
                        <option value="meeting">Rendez-vous</option>
                        <option value="video">Visio</option>
                      </select>
                      <select name="outcome" className={input}>
                        <option value="follow_up">À suivre</option>
                        <option value="resolved">Résolu</option>
                        <option value="payment_promise">
                          Promesse de paiement
                        </option>
                        <option value="no_answer">Sans réponse</option>
                        <option value="escalated">Escaladé</option>
                      </select>
                      <textarea
                        name="summary"
                        required
                        placeholder="Résumé du suivi"
                        className={input}
                      />
                      <input
                        name="next_action"
                        placeholder="Prochaine action"
                        className={input}
                      />
                      <input
                        name="next_action_on"
                        type="date"
                        className={input}
                      />
                      <button className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2 font-black text-slate-950">
                        Enregistrer le suivi
                      </button>
                    </form>
                    ) : null}
                  </div>
                ) : null}
              </details>
            );
          })}
          {!enrollments.length ? (
            <p className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              Aucun étudiant n’est encore inscrit dans cette école.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
function Card({
  n,
  label,
  danger = false,
}: {
  n: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${danger ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}
    >
      <p className="text-2xl font-black">{n}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
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
function Badge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
      {value}
    </span>
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
function Hidden({
  schoolId,
  enrollmentId,
}: {
  schoolId: string;
  enrollmentId: string;
}) {
  return (
    <>
      <input type="hidden" name="school_id" value={schoolId} />
      <input type="hidden" name="enrollment_id" value={enrollmentId} />
    </>
  );
}
