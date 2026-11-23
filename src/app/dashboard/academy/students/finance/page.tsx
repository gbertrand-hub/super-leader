import Link from "next/link";
import { redirect } from "next/navigation";
import {
  allocateAcademyStudentCreditAction,
  confirmConsolidatedAcademyPaymentAction,
  recordConsolidatedAcademyPaymentAction,
  reconcileAcademyCrmPaymentsAction,
  repairAcademyCrmPaymentDoubleCountingAction,
  harmonizeAcademyStudentAgreementAction,
  saveAcademyStudentAgreementAction,
  updateAcademyEnrollmentSourceAction,
  updateAcademyEnrollmentAcademicScopeAction,
} from "@/app/actions/academy-financial-governance";
import {
  canEditFinance,
  canEnrollStudents,
  canViewFinance,
  getAcademyAssignments,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const n = (v: unknown) => Number(v ?? 0);
const money = (v: number, c: string) => {
  try { return new Intl.NumberFormat("fr-CA", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(v); }
  catch { return `${v.toFixed(2)} ${c}`; }
};
const today = () => new Date().toISOString().slice(0, 10);

export default async function AcademyStudentFinancialAccountPage({ searchParams }: Props) {
  const q = (await searchParams) ?? {};
  const organizationId = first(q.organization);
  const studentKey = first(q.student);
  const [subjectType, subjectId] = studentKey.split(":", 2);
  if (!organizationId || !subjectId || !["crm", "user"].includes(subjectType)) redirect("/dashboard/academy/students");

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
  if (!membership) redirect("/dashboard/company");
  const assignments = await getAcademyAssignments(admin, organizationId, auth.user.id);

  let enrollmentQuery = admin
    .from("academy_school_enrollments")
    .select("id,school_id,program_id,cohort_id,crm_client_id,user_id,enrolled_on,academic_status,source_type,source_reference")
    .eq("organization_id", organizationId);
  enrollmentQuery = subjectType === "crm" ? enrollmentQuery.eq("crm_client_id", subjectId) : enrollmentQuery.eq("user_id", subjectId);
  const { data: allEnrollments } = await enrollmentQuery.order("enrolled_on", { ascending: true });
  const visibleEnrollments = (allEnrollments ?? []).filter((e) => canViewFinance(membership.role, assignments, String(e.school_id)));
  if (!visibleEnrollments.length) redirect(`/dashboard/academy/students?organization=${organizationId}`);
  const enrollmentIds = visibleEnrollments.map((e) => String(e.id));
  const schoolIds = [...new Set(visibleEnrollments.map((e) => String(e.school_id)))];
  const programIds = [...new Set(visibleEnrollments.map((e) => e.program_id).filter(Boolean).map(String))];
  const cohortIds = [...new Set(visibleEnrollments.map((e) => e.cohort_id).filter(Boolean).map(String))];

  const subjectDbType = subjectType === "crm" ? "crm_client" : "user";
  const { data: existingAccount } = await admin
    .from("academy_student_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("subject_type", subjectDbType)
    .eq("subject_id", subjectId)
    .maybeSingle<{ id: string }>();
  let accountId = existingAccount?.id ?? "";
  if (!accountId) {
    const created = await admin
      .from("academy_student_accounts")
      .insert({ organization_id: organizationId, subject_type: subjectDbType, subject_id: subjectId })
      .select("id")
      .single<{ id: string }>();
    if (created.data) accountId = created.data.id;
  }
  if (!accountId) throw new Error("Compte financier étudiant impossible à créer.");

  const [
    { data: schools },
    { data: programs },
    { data: cohorts },
    { data: financeRows },
    { data: confirmedAllocations },
    { data: agreements },
    { data: tariffs },
    { data: cohortTariffs },
    { data: promotions },
    { data: globalPayments },
    { data: allocations },
  ] = await Promise.all([
    admin.from("academy_schools").select("id,name").in("id", schoolIds),
    schoolIds.length ? admin.from("academy_programs").select("id,name,school_id,status").in("school_id", schoolIds).neq("status", "archived").order("name") : Promise.resolve({ data: [] as any[] }),
    schoolIds.length ? admin.from("academy_cohorts").select("id,name,school_id,program_id,status").in("school_id", schoolIds).neq("status", "archived").order("name") : Promise.resolve({ data: [] as any[] }),
    admin.from("academy_student_finance").select("enrollment_id,is_internal_training,list_price,discount_amount,agreed_amount,currency,payment_status,first_payment_due_on,current_agreement_id").in("enrollment_id", enrollmentIds),
    admin.from("academy_student_confirmed_allocations").select("payment_id,enrollment_id,amount,currency,paid_on,reference,source").in("enrollment_id", enrollmentIds),
    admin.from("academy_student_financial_agreements").select("id,enrollment_id,tariff_id,cohort_tariff_id,promotion_id,list_price,promotion_discount_amount,individual_adjustment_amount,agreed_amount,currency,status,source,adjustment_reason,approved_at").in("enrollment_id", enrollmentIds).order("created_at", { ascending: false }),
    programIds.length ? admin.from("academy_program_tariffs").select("id,program_id,amount,currency,status,effective_from").eq("organization_id", organizationId).eq("status", "active").in("program_id", programIds) : Promise.resolve({ data: [] as any[] }),
    cohortIds.length ? admin.from("academy_cohort_tariffs").select("id,program_id,cohort_id,amount,currency,status,effective_from").eq("organization_id", organizationId).eq("status", "active").in("cohort_id", cohortIds) : Promise.resolve({ data: [] as any[] }),
    admin.from("academy_pricing_promotions").select("id,name,scope_type,school_id,program_id,cohort_id,discount_type,discount_value,currency,valid_from,valid_until,status").eq("organization_id", organizationId).eq("status", "active").lte("valid_from", today()),
    admin.from("academy_student_global_payments").select("id,amount,currency,paid_on,payment_method,reference,notes,status,source,created_at,confirmed_at").eq("account_id", accountId).order("paid_on", { ascending: false }).order("created_at", { ascending: false }),
    admin.from("academy_student_payment_allocations").select("id,payment_id,enrollment_id,amount").eq("organization_id", organizationId).in("enrollment_id", enrollmentIds),
  ]);

  let studentName = "Étudiant";
  let studentDetail = "";
  if (subjectType === "crm") {
    const { data: p } = await admin.from("crm_clients").select("full_name,email,phone").eq("id", subjectId).eq("organization_id", organizationId).maybeSingle<any>();
    studentName = String(p?.full_name || p?.email || "Étudiant");
    studentDetail = [p?.email, p?.phone, "Étudiant externe / CRM"].filter(Boolean).join(" · ");
  } else {
    const { data: p } = await admin.from("profiles").select("full_name,email").eq("id", subjectId).maybeSingle<any>();
    studentName = String(p?.full_name || p?.email || "Membre");
    studentDetail = [p?.email, "Étudiant interne / Staff"].filter(Boolean).join(" · ");
  }

  const schoolBy = new Map((schools ?? []).map((x) => [String(x.id), String(x.name)]));
  const programBy = new Map((programs ?? []).map((x) => [String(x.id), String(x.name)]));
  const cohortBy = new Map((cohorts ?? []).map((x) => [String(x.id), String(x.name)]));
  const financeBy = new Map((financeRows ?? []).map((x) => [String(x.enrollment_id), x]));
  const activeAgreementBy = new Map<string, any>();
  for (const row of agreements ?? []) if (row.status === "active" && !activeAgreementBy.has(String(row.enrollment_id))) activeAgreementBy.set(String(row.enrollment_id), row);
  const pendingAgreementBy = new Map<string, any>();
  for (const row of agreements ?? []) if (row.status === "pending_approval" && !pendingAgreementBy.has(String(row.enrollment_id))) pendingAgreementBy.set(String(row.enrollment_id), row);
  const tariffsByProgram = new Map<string, any[]>();
  for (const t of tariffs ?? []) tariffsByProgram.set(String(t.program_id), [...(tariffsByProgram.get(String(t.program_id)) ?? []), t]);
  const tariffsByCohort = new Map<string, any[]>();
  for (const t of cohortTariffs ?? []) tariffsByCohort.set(String(t.cohort_id), [...(tariffsByCohort.get(String(t.cohort_id)) ?? []), t]);
  const paidBy = new Map<string, number>();
  for (const p of confirmedAllocations ?? []) {
    const id = String(p.enrollment_id);
    paidBy.set(id, (paidBy.get(id) ?? 0) + n(p.amount));
  }
  const allocationByPayment = new Map<string, any[]>();
  for (const a of allocations ?? []) allocationByPayment.set(String(a.payment_id), [...(allocationByPayment.get(String(a.payment_id)) ?? []), a]);

  const totalsByCurrency = new Map<string, { agreed: number; paid: number; balance: number }>();
  for (const e of visibleEnrollments) {
    const f = financeBy.get(String(e.id));
    const c = String(f?.currency ?? "USD");
    const agreed = n(f?.agreed_amount);
    const paid = paidBy.get(String(e.id)) ?? 0;
    const row = totalsByCurrency.get(c) ?? { agreed: 0, paid: 0, balance: 0 };
    row.agreed += agreed;
    row.paid += paid;
    row.balance += Math.max(0, agreed - paid);
    totalsByCurrency.set(c, row);
  }
  const creditByCurrency = new Map<string, number>();
  for (const p of globalPayments ?? []) {
    if (p.status !== "confirmed") continue;
    const allocated = (allocationByPayment.get(String(p.id)) ?? []).reduce((s, a) => s + n(a.amount), 0);
    creditByCurrency.set(String(p.currency), (creditByCurrency.get(String(p.currency)) ?? 0) + Math.max(0, n(p.amount) - allocated));
  }

  const normalizeReference = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const suspectedDuplicatePayments = (globalPayments ?? [])
    .filter((p) => p.status === "confirmed" && p.source === "crm")
    .map((crmPayment) => {
      const crmRef = normalizeReference(crmPayment.reference);
      const candidates = (globalPayments ?? []).filter((other) => {
        if (String(other.id) === String(crmPayment.id) || other.status !== "confirmed" || other.source !== "legacy") return false;
        if (String(other.currency) !== String(crmPayment.currency) || String(other.paid_on) !== String(crmPayment.paid_on)) return false;
        if (Math.abs(n(other.amount) - n(crmPayment.amount)) > 0.0001) return false;
        const legacyRef = normalizeReference(other.reference);
        return !crmRef || !legacyRef || crmRef === legacyRef;
      });
      return { crmPayment, candidates };
    })
    .filter((row) => row.candidates.length > 0);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/dashboard/academy/students?organization=${organizationId}`} className="font-black text-violet-700">← Étudiants</Link>
          <Link href={`/dashboard/academy/pricing?organization=${organizationId}`} className="rounded-xl bg-amber-400 px-4 py-2 font-black text-slate-950">Tarification & homologation</Link>
        </div>
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-amber-400">Compte financier étudiant consolidé</p>
          <h1 className="mt-2 text-4xl font-black">{studentName}</h1>
          <p className="mt-2 text-slate-300">{studentDetail}</p>
          <p className="mt-4 max-w-4xl text-sm text-slate-300">Une identité financière unique pour toutes les Grandes Écoles. Chaque inscription garde son contrat, mais un paiement peut être réparti sur plusieurs écoles.</p>
        </header>
        {subjectType === "crm" ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-black text-sky-950">Client CRM existant</p><p className="text-sm text-sky-800">Les paiements commerciaux déjà confirmés peuvent être rapprochés ici. Ils arrivent d'abord comme crédit non affecté afin de ne jamais choisir une école à votre place.</p></div>
              <form action={reconcileAcademyCrmPaymentsAction}>
                <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="account_id" value={accountId}/>
                <button className="rounded-xl bg-sky-700 px-4 py-2 font-black text-white">Rapprocher les paiements CRM</button>
              </form>
            </div>
          </section>
        ) : null}
        {first(q.success) ? <Banner tone="success">{first(q.success)}</Banner> : null}
        {first(q.error) ? <Banner tone="error">{first(q.error)}</Banner> : null}

        {suspectedDuplicatePayments.length ? (
          <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-red-950">
            <p className="text-xs font-black uppercase tracking-[.18em] text-red-700">Intégrité des paiements</p>
            <h2 className="mt-1 text-xl font-black">Double comptage potentiel détecté</h2>
            <p className="mt-1 text-sm">Un paiement CRM confirmé semble aussi exister dans les anciens paiements Academy. Consolidez d'abord le paiement, puis répartissez son crédit entre les écoles de façon explicite.</p>
            <div className="mt-4 space-y-3">
              {suspectedDuplicatePayments.map(({ crmPayment, candidates }) => (
                <div key={String(crmPayment.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-white p-3">
                  <div>
                    <p className="font-black">{money(n(crmPayment.amount), String(crmPayment.currency))} · {String(crmPayment.paid_on)}</p>
                    <p className="text-xs text-red-700">{candidates.length} ancienne(s) représentation(s) correspondante(s){crmPayment.reference ? ` · Réf. ${String(crmPayment.reference)}` : ""}</p>
                  </div>
                  <form action={repairAcademyCrmPaymentDoubleCountingAction}>
                    <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="payment_id" value={String(crmPayment.id)}/>
                    <button className="rounded-xl bg-red-700 px-4 py-2 font-black text-white">Consolider en un seul paiement</button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[...totalsByCurrency.entries()].map(([c, t]) => (
            <div key={c} className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">Compte global · {c}</p>
              <p className="mt-2 text-2xl font-black">Solde {money(t.balance, c)}</p>
              <p className="mt-2 text-sm text-slate-500">Convenu {money(t.agreed, c)} · Payé {money(t.paid, c)}</p>
              {(creditByCurrency.get(c) ?? 0) > 0 ? <p className="mt-2 font-black text-emerald-700">Crédit non affecté {money(creditByCurrency.get(c) ?? 0, c)}</p> : null}
            </div>
          ))}
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Inscriptions</p><p className="mt-2 text-3xl font-black">{visibleEnrollments.length}</p><p className="text-sm text-slate-500">Grande(s) École(s) visible(s)</p></div>
        </section>

        <section className="space-y-4">
          <div><h2 className="text-3xl font-black">Conditions financières par inscription</h2><p className="text-slate-500">Prix homologué → promotion → ajustement individuel → frais convenus.</p></div>
          {visibleEnrollments.map((e) => {
            const f = financeBy.get(String(e.id));
            const active = activeAgreementBy.get(String(e.id));
            const pending = pendingAgreementBy.get(String(e.id));
            const c = String(f?.currency ?? active?.currency ?? "USD");
            const paid = paidBy.get(String(e.id)) ?? 0;
            const agreed = n(f?.agreed_amount);
            const editable = canEditFinance(membership.role, assignments, String(e.school_id));
            const scopeEditable = canEnrollStudents(membership.role, assignments, String(e.school_id)) || editable;
            const cohortOptions = tariffsByCohort.get(String(e.cohort_id)) ?? [];
            const programOptions = tariffsByProgram.get(String(e.program_id)) ?? [];
            const inheritedTariff = cohortOptions[0] ?? programOptions[0] ?? null;
            const inheritedSource = cohortOptions.length ? "Cohorte" : programOptions.length ? "Programme" : "Non défini";
            const inheritedAmount = n(inheritedTariff?.amount);
            const activeIsInheritedLike = active && ["legacy", "inherited"].includes(String(active.source ?? ""));
            const activeHasNoSpecificConditions = active && !active.promotion_id && n(active.promotion_discount_amount) === 0 && n(active.individual_adjustment_amount) === 0;
            const harmonizationRequired = Boolean(
              inheritedTariff && inheritedAmount > 0 && activeIsInheritedLike && activeHasNoSpecificConditions &&
              (n(active.list_price) !== inheritedAmount || n(active.agreed_amount) !== inheritedAmount || String(active.currency ?? "USD") !== String(inheritedTariff.currency ?? "USD"))
            );
            const applicablePromos = (promotions ?? []).filter((p) => {
              if (p.valid_until && String(p.valid_until) < today()) return false;
              if (p.school_id && String(p.school_id) !== String(e.school_id)) return false;
              if (p.program_id && String(p.program_id) !== String(e.program_id)) return false;
              if (p.cohort_id && String(p.cohort_id) !== String(e.cohort_id)) return false;
              return true;
            });
            return (
              <article key={e.id} className="rounded-3xl border bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><p className="text-xs font-black uppercase tracking-wider text-violet-600">{schoolBy.get(String(e.school_id))}</p><h3 className="mt-1 text-2xl font-black">{programBy.get(String(e.program_id)) ?? "Programme non défini"}</h3><p className="text-sm text-slate-500">Cohorte : {cohortBy.get(String(e.cohort_id)) ?? "Non définie"}</p><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">Source inscription : {String(e.source_type ?? (e.crm_client_id ? "crm" : e.user_id ? "internal" : "manual"))}</p></div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase">{String(f?.payment_status ?? "non configuré")}</span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Mini label={`Tarif officiel · ${active ? "Accord actif" : inheritedSource}`} value={money(n(active?.list_price ?? inheritedTariff?.amount ?? f?.list_price), String(active?.currency ?? inheritedTariff?.currency ?? c))} />
                  <Mini label="Promotion" value={`-${money(n(active?.promotion_discount_amount), c)}`} />
                  <Mini label="Ajustement individuel" value={`-${money(n(active?.individual_adjustment_amount), c)}`} />
                  <Mini label="Frais convenus" value={money(agreed, c)} />
                  <Mini label="Déjà payé" value={money(paid, c)} />
                  <Mini label="Solde" value={money(Math.max(0, agreed - paid), c)} />
                </div>
                {pending ? <p className="mt-4 rounded-xl bg-amber-100 p-3 font-bold text-amber-950">Ajustement en attente d'homologation : {money(n(pending.agreed_amount), String(pending.currency))}. Le contrat actif n'est pas modifié tant que la Commission n'a pas approuvé.</p> : null}
                {harmonizationRequired && editable ? (
                  <div className="mt-4 rounded-2xl border border-rose-300 bg-rose-50 p-4">
                    <p className="font-black text-rose-950">Harmonisation financière requise</p>
                    <p className="mt-1 text-sm text-rose-800">Le tarif homologué détecté est {money(inheritedAmount, String(inheritedTariff?.currency ?? c))}, mais l'accord actif contient encore {money(n(active?.agreed_amount), String(active?.currency ?? c))}. Super Leader peut remplacer uniquement cet ancien accord hérité sans promotion ni exception individuelle.</p>
                    <form action={harmonizeAcademyStudentAgreementAction} className="mt-3">
                      <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="enrollment_id" value={String(e.id)}/>
                      <button className="rounded-xl bg-rose-700 px-4 py-2 font-black text-white">Harmoniser maintenant</button>
                    </form>
                  </div>
                ) : null}
                {scopeEditable ? (
                  <details className={`mt-4 rounded-xl border p-3 ${!e.program_id || !e.cohort_id ? "border-amber-300 bg-amber-50" : "border-violet-200 bg-violet-50"}`} open={!e.program_id || !e.cohort_id}>
                    <summary className="cursor-pointer text-sm font-black text-violet-900">Affecter / corriger programme & cohorte</summary>
                    <p className="mt-2 text-xs text-slate-600">Le tarif n'est jamais saisi ici. Une fois le programme et la cohorte choisis, Super Leader herite automatiquement du tarif homologue de cohorte, sinon de programme.</p>
                    <form action={updateAcademyEnrollmentAcademicScopeAction} className="mt-3 grid gap-3 sm:grid-cols-3">
                      <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="enrollment_id" value={String(e.id)}/>
                      <select name="program_id" defaultValue={String(e.program_id ?? "")} required className={input}><option value="">Choisir le programme...</option>{(programs ?? []).filter((x:any) => String(x.school_id) === String(e.school_id)).map((x:any) => <option key={String(x.id)} value={String(x.id)}>{String(x.name)}</option>)}</select>
                      <select name="cohort_id" defaultValue={String(e.cohort_id ?? "")} required className={input}><option value="">Choisir la cohorte...</option>{(cohorts ?? []).filter((x:any) => String(x.school_id) === String(e.school_id)).map((x:any) => <option key={String(x.id)} value={String(x.id)}>{String(x.name)}</option>)}</select>
                      <button className="rounded-xl bg-violet-700 px-4 py-2 font-black text-white">Enregistrer et heriter le tarif</button>
                    </form>
                  </details>
                ) : null}
                {editable ? (
                  <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <summary className="cursor-pointer text-sm font-black text-slate-700">Origine de l'inscription</summary>
                    <form action={updateAcademyEnrollmentSourceAction} className="mt-3 grid gap-3 sm:grid-cols-3">
                      <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="enrollment_id" value={String(e.id)}/>
                      <select name="source_type" defaultValue={String(e.source_type ?? (e.crm_client_id ? "crm" : e.user_id ? "internal" : "manual"))} className={input}><option value="crm">Client CRM existant</option><option value="import">Import fichier</option><option value="internal">Staff / interne</option><option value="web">Inscription web</option><option value="manual">Saisie manuelle</option></select>
                      <input name="source_reference" defaultValue={String(e.source_reference ?? "")} placeholder="Référence import / campagne (facultatif)" className={input}/>
                      <button className="rounded-xl bg-slate-900 px-4 py-2 font-black text-white">Enregistrer la source</button>
                    </form>
                  </details>
                ) : null}
                {editable ? (
                  <details className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                    <summary className="cursor-pointer font-black text-violet-900">Modifier les conditions financières</summary>
                    <form action={saveAcademyStudentAgreementAction} className="mt-4 grid gap-4 lg:grid-cols-2">
                      <input type="hidden" name="organization_id" value={organizationId} />
                      <input type="hidden" name="student_key" value={studentKey} />
                      <input type="hidden" name="enrollment_id" value={String(e.id)} />
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 lg:col-span-2">
                        <p className="text-xs font-black uppercase tracking-wide text-amber-700">Prix hérité automatiquement</p>
                        {inheritedTariff ? <p className="mt-1 font-black text-slate-950">{inheritedSource} · {money(n(inheritedTariff.amount), String(inheritedTariff.currency))}</p> : <p className="mt-1 font-black text-rose-700">Aucun tarif officiel. Définissez d'abord le tarif du programme ou de la cohorte dans Tarification & homologation.</p>}
                        <p className="mt-1 text-xs text-slate-600">Le prix de base n'est plus saisi étudiant par étudiant. Ici vous gérez seulement la promotion et l'exception individuelle.</p>
                      </div>
                      <Field title="Promotion applicable">
                        <select name="promotion_id" defaultValue={String(active?.promotion_id ?? "")} className={input}>
                          <option value="">Aucune promotion</option>
                          {applicablePromos.map((p) => <option key={p.id} value={String(p.id)}>{p.name} · {p.discount_type === "percent" ? `${n(p.discount_value)}%` : money(n(p.discount_value), String(p.currency ?? c))}</option>)}
                        </select>
                      </Field>
                      <Field title="Ajustement individuel (remise supplémentaire)"><input name="individual_adjustment_amount" type="number" min="0" step="0.01" defaultValue={n(active?.individual_adjustment_amount)} className={input}/></Field>
                      <Field title="Motif de l'ajustement"><textarea name="adjustment_reason" rows={3} defaultValue={String(active?.adjustment_reason ?? "")} className={input}/></Field>
                      <div className="lg:col-span-2"><button disabled={!inheritedTariff} className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Enregistrer / soumettre à homologation</button></div>
                    </form>
                  </details>
                ) : null}
              </article>
            );
          })}
        </section>

        {[...totalsByCurrency.keys()].map((c) => {
          const group = visibleEnrollments.filter((e) => String(financeBy.get(String(e.id))?.currency ?? "USD") === c);
          const editable = group.filter((e) => canEditFinance(membership.role, assignments, String(e.school_id)));
          if (!editable.length) return null;
          return (
            <section key={c} className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
              <h2 className="text-2xl font-black text-emerald-950">Enregistrer un paiement consolidé · {c}</h2>
              <p className="mt-1 text-sm text-emerald-800">Un seul paiement peut couvrir plusieurs écoles. Le reliquat devient un crédit étudiant non affecté.</p>
              <form action={recordConsolidatedAcademyPaymentAction} className="mt-5 grid gap-4 lg:grid-cols-3">
                <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="account_id" value={accountId}/><input type="hidden" name="currency" value={c}/>
                <Field title={`Montant reçu (${c})`}><input name="amount" type="number" min="0.01" step="0.01" required className={input}/></Field>
                <Field title="Date"><input name="paid_on" type="date" defaultValue={today()} className={input}/></Field>
                <Field title="Mode"><select name="payment_method" defaultValue="bank_transfer" className={input}><option value="bank_transfer">Virement</option><option value="cash">Espèces</option><option value="card">Carte</option><option value="mobile_money">Mobile Money</option><option value="check">Chèque</option><option value="other">Autre</option></select></Field>
                <Field title="Référence"><input name="reference" className={input}/></Field>
                <Field title="Notes"><input name="notes" className={input}/></Field>
                <div className="rounded-xl border bg-white p-3"><label className="flex items-center gap-2 font-bold"><input name="bank_confirmed" type="checkbox"/> Confirmé par la banque</label><p className="mt-1 text-xs text-slate-500">Sinon, le paiement reste déclaré et ne réduit pas encore les soldes.</p></div>
                <fieldset className="rounded-2xl border border-emerald-200 bg-white p-4 lg:col-span-3">
                  <legend className="px-2 font-black">Répartition manuelle (facultative)</legend>
                  <label className="mb-4 flex items-center gap-2 font-bold"><input name="auto_allocate" type="checkbox" defaultChecked/> Répartir automatiquement sur les échéances les plus anciennes si je ne saisis rien</label>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {editable.map((e) => { const f = financeBy.get(String(e.id)); const bal = Math.max(0, n(f?.agreed_amount) - (paidBy.get(String(e.id)) ?? 0)); return <label key={e.id} className="rounded-xl bg-slate-50 p-3 text-sm font-bold">{schoolBy.get(String(e.school_id))} · {programBy.get(String(e.program_id)) ?? "Programme"}<span className="block text-xs font-normal text-slate-500">Solde {money(bal,c)}</span><input name={`allocation_${e.id}`} type="number" min="0" step="0.01" placeholder="Montant à affecter" className={input}/></label>; })}
                  </div>
                </fieldset>
                <div className="lg:col-span-3"><button className="rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">Enregistrer le paiement global</button></div>
              </form>
            </section>
          );
        })}

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Historique des paiements globaux</h2>
          <div className="mt-4 space-y-4">
            {(globalPayments ?? []).map((p) => {
              const al = allocationByPayment.get(String(p.id)) ?? [];
              const allocated = al.reduce((s, a) => s + n(a.amount), 0);
              const unallocated = Math.max(0, n(p.amount) - allocated);
              const canAct = visibleEnrollments.some((e) => canEditFinance(membership.role, assignments, String(e.school_id)));
              return (
                <article key={p.id} className="rounded-2xl border bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xl font-black">{money(n(p.amount), String(p.currency))}</p><p className="text-sm text-slate-500">{String(p.paid_on)} · {String(p.payment_method)}{p.reference ? ` · ${p.reference}` : ""}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${p.status === "confirmed" ? "bg-emerald-100 text-emerald-800" : p.status === "declared" ? "bg-amber-100 text-amber-800" : "bg-slate-200"}`}>{String(p.status)}</span></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3"><Mini label="Affecté" value={money(allocated, String(p.currency))}/><Mini label="Crédit non affecté" value={money(unallocated, String(p.currency))}/><Mini label="Source" value={String(p.source)}/></div>
                  {p.status === "declared" && canAct ? <form action={confirmConsolidatedAcademyPaymentAction} className="mt-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="payment_id" value={String(p.id)}/><button className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white">Confirmer banque</button></form> : null}
                  {unallocated > 0 && canAct ? (
                    <details className="mt-3 rounded-xl border bg-white p-3"><summary className="cursor-pointer font-black">Affecter le crédit restant</summary><form action={allocateAcademyStudentCreditAction} className="mt-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="student_key" value={studentKey}/><input type="hidden" name="payment_id" value={String(p.id)}/><div className="grid gap-3 lg:grid-cols-2">{visibleEnrollments.filter((e) => String(financeBy.get(String(e.id))?.currency ?? "USD") === String(p.currency) && canEditFinance(membership.role, assignments, String(e.school_id))).map((e) => <label key={e.id} className="rounded-xl bg-slate-50 p-3 text-sm font-bold">{schoolBy.get(String(e.school_id))} · {programBy.get(String(e.program_id)) ?? "Programme"}<input name={`credit_allocation_${e.id}`} type="number" min="0" step="0.01" placeholder="Montant" className={input}/></label>)}</div><button className="mt-3 rounded-xl bg-slate-950 px-4 py-2 font-black text-white">Affecter le crédit</button></form></details>
                  ) : null}
                </article>
              );
            })}
            {!globalPayments?.length ? <p className="rounded-xl border border-dashed p-5 text-slate-500">Aucun paiement global enregistré.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) { return <label className="block text-sm font-bold text-slate-700">{title}{children}</label>; }
function Mini({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-black uppercase text-slate-400">{label}</p><p className="font-black">{value}</p></div>; }
function Banner({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) { return <p className={`rounded-2xl p-4 font-black ${tone === "success" ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{children}</p>; }
