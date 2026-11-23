import Link from "next/link";
import { redirect } from "next/navigation";
import {
  addStudentInstallmentFromControlAction,
  allocateStudentCreditFromControlAction,
  cancelStudentPaymentFromControlAction,
  confirmStudentPaymentFromControlAction,
  reconcileStudentAcademySalesPaymentAction,
  recordStudentPaymentFromControlAction,
  repairStudentFinanceRecordAction,
  validateComplimentarySchoolAccessAction,
} from "@/app/actions/student-finance-control";
import {
  canEditFinance,
  canViewFinance,
  enrollmentVisibleTo,
  getAcademyAssignments,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
type Enrollment = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  crm_client_id: string | null;
  user_id: string | null;
  academic_status: string;
  assigned_follow_up_user_id: string | null;
  enrolled_on: string;
};
type MoneyBucket = { agreed: number; paid: number; balance: number; credit: number; salesUnmapped: number };
type PersonRow = {
  key: string;
  subjectType: "crm" | "user";
  subjectId: string;
  crmId: string | null;
  userId: string | null;
  name: string;
  email: string;
  enrollments: Enrollment[];
  schools: string[];
  totals: Map<string, MoneyBucket>;
  missingFinance: number;
  financeEditable: boolean;
  financeViewable: boolean;
  installmentCount: number;
  nextDueOn: string | null;
  hasBalance: boolean;
  hasCredit: boolean;
  salesToReconcileCount: number;
  salesToReconcileAmount: Map<string, number>;
  flags: string[];
  pendingPayments: any[];
  manualPayments: any[];
  unallocatedPayments: Array<any & { remaining: number }>;
  complimentaryPending: string[];
  complimentaryValidated: string[];
  salesReconcileItems: Array<{ salesPaymentId: string; saleId: string; amount: number; currency: string; paymentDate: string; reference: string; productName: string; schoolName: string; schoolId: string; candidates: Enrollment[]; suggestedEnrollmentId: string | null; blockedReason: string | null }>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const num = (value: unknown) => Number(value ?? 0);
const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("fr-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
};
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`)) : "Non définie";
const today = () => new Date().toISOString().slice(0, 10);
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs";
const badge = (tone: "green" | "amber" | "red" | "blue" | "slate") => ({
  green: "bg-emerald-100 text-emerald-900",
  amber: "bg-amber-100 text-amber-950",
  red: "bg-rose-100 text-rose-900",
  blue: "bg-sky-100 text-sky-900",
  slate: "bg-slate-100 text-slate-800",
}[tone]);

export default async function StudentFinanceControlCenter({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const requestedOrganizationId = first(params.organization).trim();
  const q = norm(first(params.q));
  const statusFilter = first(params.status).trim();
  const schoolFilter = first(params.school).trim();
  const page = Math.max(1, Number(first(params.page)) || 1);
  const pageSize = 40;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();

  let membershipQuery = admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (requestedOrganizationId) membershipQuery = membershipQuery.eq("organization_id", requestedOrganizationId);
  const {data: membershipRows} = await membershipQuery.limit(20);
  const memberships = (membershipRows ?? []) as Array<{organization_id: string; role: string}>;
  const membership = requestedOrganizationId
    ? memberships[0] ?? null
    : memberships.length === 1
      ? memberships[0]
      : null;
  if (!membership) {
    const reason = requestedOrganizationId ? "finance-access" : "select-organization";
    redirect(`/dashboard/company?from=academy-finance&reason=${reason}`);
  }
  const organizationId = membership.organization_id;
  const assignments = await getAcademyAssignments(admin, organizationId, auth.user.id);
  const followUpSchoolIds = new Set(
    assignments
      .filter((assignment) => assignment.assignment_role === "follow_up")
      .map((assignment) => assignment.school_id),
  );

  const { data: enrollmentData } = await admin
    .from("academy_school_enrollments")
    .select("id,school_id,program_id,cohort_id,crm_client_id,user_id,academic_status,assigned_follow_up_user_id,enrolled_on")
    .eq("organization_id", organizationId)
    .order("enrolled_on", { ascending: true });
  const enrollments = ((enrollmentData ?? []) as Enrollment[]).filter((e) =>
    followUpSchoolIds.has(String(e.school_id)) ||
    enrollmentVisibleTo(auth.user.id, membership.role, assignments, String(e.school_id), e)
  );
  if (!enrollments.length) redirect("/dashboard/academy/students");

  const enrollmentIds = enrollments.map((e) => e.id);
  const schoolIds = [...new Set(enrollments.map((e) => e.school_id))];
  const directCrmIds = [...new Set(enrollments.map((e) => e.crm_client_id).filter(Boolean).map(String))];
  const directUserIds = [...new Set(enrollments.map((e) => e.user_id).filter(Boolean).map(String))];

  const [schoolsResult, financeResult, allocationsResult, installmentsResult, crmDirectResult, profilesResult, accountsResult, activeAgreementsResult, accessOverridesResult] = await Promise.all([
    admin.from("academy_schools").select("id,name").in("id", schoolIds),
    admin.from("academy_student_finance").select("enrollment_id,is_internal_training,agreed_amount,currency,payment_status,first_payment_due_on,current_agreement_id").in("enrollment_id", enrollmentIds),
    admin.from("academy_student_confirmed_allocations").select("payment_id,enrollment_id,amount,currency,paid_on,status").in("enrollment_id", enrollmentIds),
    admin.from("academy_student_installments").select("id,enrollment_id,due_on,amount_due,status").in("enrollment_id", enrollmentIds),
    directCrmIds.length ? admin.from("crm_clients").select("id,full_name,email,phone,linked_user_id").eq("organization_id", organizationId).in("id", directCrmIds) : Promise.resolve({ data: [] as any[] }),
    directUserIds.length ? admin.from("profiles").select("id,full_name,email").in("id", directUserIds) : Promise.resolve({ data: [] as any[] }),
    admin.from("academy_student_accounts").select("id,subject_type,subject_id").eq("organization_id", organizationId),
    admin.from("academy_student_financial_agreements").select("id,enrollment_id,status,list_price,promotion_discount_amount,individual_adjustment_amount,agreed_amount,source,adjustment_reason,approval_note").eq("organization_id", organizationId).eq("status", "active").in("enrollment_id", enrollmentIds),
    admin.from("academy_class_access_overrides").select("id,enrollment_id,is_active,reason,approved_at").eq("organization_id", organizationId).in("enrollment_id", enrollmentIds),
  ]);

  const crmDirect = (crmDirectResult.data ?? []) as any[];
  const linkedUserIds = [...new Set(crmDirect.map((c) => c.linked_user_id).filter(Boolean).map(String))];
  const missingLinkedProfiles = linkedUserIds.filter((id) => !directUserIds.includes(id));
  const { data: linkedProfilesData } = missingLinkedProfiles.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", missingLinkedProfiles)
    : { data: [] as any[] };

  const userIdsForCrmLookup = [...new Set([...directUserIds, ...linkedUserIds])];
  const { data: crmByUserData } = userIdsForCrmLookup.length
    ? await admin.from("crm_clients").select("id,full_name,email,phone,linked_user_id").eq("organization_id", organizationId).in("linked_user_id", userIdsForCrmLookup)
    : { data: [] as any[] };

  const crmRows = [...crmDirect, ...((crmByUserData ?? []) as any[])].filter((row, index, arr) => arr.findIndex((x) => String(x.id) === String(row.id)) === index);
  const profileRows = [...((profilesResult.data ?? []) as any[]), ...((linkedProfilesData ?? []) as any[])].filter((row, index, arr) => arr.findIndex((x) => String(x.id) === String(row.id)) === index);
  const crmById = new Map(crmRows.map((c) => [String(c.id), c]));
  const crmByLinkedUser = new Map(crmRows.filter((c) => c.linked_user_id).map((c) => [String(c.linked_user_id), c]));
  const profileById = new Map(profileRows.map((p) => [String(p.id), p]));
  const schoolById = new Map(((schoolsResult.data ?? []) as any[]).map((s) => [String(s.id), String(s.name)]));
  const financeByEnrollment = new Map(((financeResult.data ?? []) as any[]).map((f) => [String(f.enrollment_id), f]));
  const activeAgreementByEnrollment = new Map(((activeAgreementsResult.data ?? []) as any[]).map((a) => [String(a.enrollment_id), a]));
  const accessOverrideByEnrollment = new Map(((accessOverridesResult.data ?? []) as any[]).map((o) => [String(o.enrollment_id), o]));
  const paidByEnrollment = new Map<string, number>();
  const paidCurrencyByEnrollment = new Map<string, string>();
  for (const a of (allocationsResult.data ?? []) as any[]) {
    const id = String(a.enrollment_id);
    paidByEnrollment.set(id, (paidByEnrollment.get(id) ?? 0) + num(a.amount));
    if (!paidCurrencyByEnrollment.has(id) && a.currency) paidCurrencyByEnrollment.set(id, String(a.currency));
  }

  const installmentsByEnrollment = new Map<string, any[]>();
  for (const item of (installmentsResult.data ?? []) as any[]) {
    const id = String(item.enrollment_id);
    installmentsByEnrollment.set(id, [...(installmentsByEnrollment.get(id) ?? []), item]);
  }

  const accountRows = (accountsResult.data ?? []) as any[];
  const accountIds = accountRows.map((a) => String(a.id));
  const [globalPaymentsResult, allPaymentAllocationsResult] = accountIds.length ? await Promise.all([
    admin.from("academy_student_global_payments").select("id,account_id,amount,currency,status,paid_on,source,reference,created_at").eq("organization_id", organizationId).in("account_id", accountIds),
    admin.from("academy_student_payment_allocations").select("payment_id,enrollment_id,amount").eq("organization_id", organizationId),
  ]) : [{ data: [] as any[] }, { data: [] as any[] }];
  const globalPayments = (globalPaymentsResult.data ?? []) as any[];
  const allPaymentAllocations = (allPaymentAllocationsResult.data ?? []) as any[];
  const allocationsByPayment = new Map<string, number>();
  for (const a of allPaymentAllocations) allocationsByPayment.set(String(a.payment_id), (allocationsByPayment.get(String(a.payment_id)) ?? 0) + num(a.amount));
  const accountsBySubject = new Map<string, string[]>();
  for (const a of accountRows) {
    const key = `${String(a.subject_type)}:${String(a.subject_id)}`;
    accountsBySubject.set(key, [...(accountsBySubject.get(key) ?? []), String(a.id)]);
  }
  const paymentsByAccount = new Map<string, any[]>();
  for (const payment of globalPayments) paymentsByAccount.set(String(payment.account_id), [...(paymentsByAccount.get(String(payment.account_id)) ?? []), payment]);

  const crmIds = [...new Set(crmRows.map((c) => String(c.id)))];
  const { data: academyMappingsData } = schoolIds.length
    ? await admin.from("academy_sales_product_mappings").select("product_id,school_id,program_id,cohort_id").eq("organization_id", organizationId).eq("is_active", true).in("school_id", schoolIds)
    : { data: [] as any[] };
  const academyMappings = (academyMappingsData ?? []) as any[];
  const academyProductIds = [...new Set(academyMappings.map((m) => String(m.product_id)))];
  const academyMappingByProduct = new Map(academyMappings.map((m) => [String(m.product_id), m]));
  const { data: salesData } = crmIds.length && academyProductIds.length
    ? await admin.from("sales_records").select("id,crm_client_id,product_id,product_name,total_amount,currency,payment_status").eq("organization_id", organizationId).in("crm_client_id", crmIds).in("product_id", academyProductIds)
    : { data: [] as any[] };
  const salesRows = (salesData ?? []) as any[];
  const saleIds = salesRows.map((s) => String(s.id));
  const { data: salesPaymentsData } = saleIds.length
    ? await admin.from("sales_payments").select("id,sale_id,amount,currency,status,payment_date,transaction_reference").eq("organization_id", organizationId).in("sale_id", saleIds)
    : { data: [] as any[] };
  const salesPayments = (salesPaymentsData ?? []) as any[];
  const salesPaymentIds = salesPayments.map((p) => String(p.id));
  const { data: crmPaymentLinksData } = salesPaymentIds.length
    ? await admin.from("academy_crm_payment_links").select("sales_payment_id,global_payment_id,matched_by").eq("organization_id", organizationId).in("sales_payment_id", salesPaymentIds)
    : { data: [] as any[] };
  const mappedSalesPaymentIds = new Set(((crmPaymentLinksData ?? []) as any[]).map((x) => String(x.sales_payment_id)));
  const salesByCrm = new Map<string, any[]>();
  for (const sale of salesRows) if (sale.crm_client_id) salesByCrm.set(String(sale.crm_client_id), [...(salesByCrm.get(String(sale.crm_client_id)) ?? []), sale]);
  const paymentsBySale = new Map<string, any[]>();
  for (const payment of salesPayments) paymentsBySale.set(String(payment.sale_id), [...(paymentsBySale.get(String(payment.sale_id)) ?? []), payment]);

  const people = new Map<string, PersonRow>();
  for (const enrollment of enrollments) {
    const linkedCrm = enrollment.crm_client_id ? crmById.get(String(enrollment.crm_client_id)) : enrollment.user_id ? crmByLinkedUser.get(String(enrollment.user_id)) : null;
    const crmId = linkedCrm ? String(linkedCrm.id) : enrollment.crm_client_id ? String(enrollment.crm_client_id) : null;
    const userId = enrollment.user_id ? String(enrollment.user_id) : linkedCrm?.linked_user_id ? String(linkedCrm.linked_user_id) : null;
    const subjectType: "crm" | "user" = crmId ? "crm" : "user";
    const subjectId = crmId ?? userId ?? enrollment.id;
    const key = `${subjectType}:${subjectId}`;
    const profile = userId ? profileById.get(userId) : null;
    const name = String(linkedCrm?.full_name || profile?.full_name || linkedCrm?.email || profile?.email || "Étudiant");
    const email = String(linkedCrm?.email || profile?.email || "");
    const existing = people.get(key) ?? {
      key, subjectType, subjectId, crmId, userId, name, email, enrollments: [], schools: [], totals: new Map<string, MoneyBucket>(),
      missingFinance: 0, financeEditable: false, financeViewable: false, installmentCount: 0, nextDueOn: null,
      hasBalance: false, hasCredit: false, salesToReconcileCount: 0, salesToReconcileAmount: new Map<string, number>(), flags: [], pendingPayments: [], manualPayments: [], unallocatedPayments: [], complimentaryPending: [], complimentaryValidated: [], salesReconcileItems: [],
    };
    existing.enrollments.push(enrollment);
    const schoolName = schoolById.get(String(enrollment.school_id)) ?? "École inconnue";
    if (!existing.schools.includes(schoolName)) existing.schools.push(schoolName);
    existing.financeEditable = existing.financeEditable || canEditFinance(membership.role, assignments, String(enrollment.school_id));
    existing.financeViewable = existing.financeViewable || canViewFinance(membership.role, assignments, String(enrollment.school_id));
    const finance = financeByEnrollment.get(enrollment.id);
    if (!finance) {
      existing.missingFinance += 1;
      const paid = paidByEnrollment.get(enrollment.id) ?? 0;
      if (paid > 0.005) {
        const currency = paidCurrencyByEnrollment.get(enrollment.id) ?? "USD";
        const bucket = existing.totals.get(currency) ?? { agreed: 0, paid: 0, balance: 0, credit: 0, salesUnmapped: 0 };
        bucket.paid += paid;
        existing.totals.set(currency, bucket);
      }
    } else {
      const currency = String(finance.currency || "USD");
      const agreed = num(finance.agreed_amount);
      const paid = paidByEnrollment.get(enrollment.id) ?? 0;
      const balance = finance.is_internal_training || String(finance.payment_status) === "not_required" ? 0 : Math.max(0, agreed - paid);
      const bucket = existing.totals.get(currency) ?? { agreed: 0, paid: 0, balance: 0, credit: 0, salesUnmapped: 0 };
      bucket.agreed += agreed;
      bucket.paid += paid;
      bucket.balance += balance;
      existing.totals.set(currency, bucket);
      if (balance > 0.005) existing.hasBalance = true;
      const firstDue = finance.first_payment_due_on ? String(finance.first_payment_due_on) : null;
      if (firstDue && (!existing.nextDueOn || firstDue < existing.nextDueOn)) existing.nextDueOn = firstDue;

      const agreement = activeAgreementByEnrollment.get(enrollment.id);
      const listPrice = num(agreement?.list_price);
      const agreementAgreed = num(agreement?.agreed_amount);
      const fullDiscount = num(agreement?.promotion_discount_amount) + num(agreement?.individual_adjustment_amount);
      const complimentary = Boolean(
        agreement &&
        !finance.is_internal_training &&
        listPrice > 0.005 &&
        agreementAgreed <= 0.005 &&
        agreed <= 0.005 &&
        fullDiscount + 0.005 >= listPrice
      );
      if (complimentary) {
        const accessOverride = accessOverrideByEnrollment.get(enrollment.id);
        if (accessOverride?.is_active) existing.complimentaryValidated.push(enrollment.id);
        else existing.complimentaryPending.push(enrollment.id);
      }
    }
    const installmentRows = installmentsByEnrollment.get(enrollment.id) ?? [];
    existing.installmentCount += installmentRows.length;
    for (const installment of installmentRows) {
      if (String(installment.status) === "paid") continue;
      const due = String(installment.due_on ?? "");
      if (due && (!existing.nextDueOn || due < existing.nextDueOn)) existing.nextDueOn = due;
    }
    people.set(key, existing);
  }

  for (const person of people.values()) {
    const accountIdsForPerson = [
      ...(person.crmId ? accountsBySubject.get(`crm_client:${person.crmId}`) ?? [] : []),
      ...(person.userId ? accountsBySubject.get(`user:${person.userId}`) ?? [] : []),
    ];
    const seenPaymentIds = new Set<string>();
    for (const accountId of accountIdsForPerson) {
      for (const payment of paymentsByAccount.get(accountId) ?? []) {
        if (seenPaymentIds.has(String(payment.id))) continue;
        seenPaymentIds.add(String(payment.id));
        if (String(payment.source) === "manual" && ["declared", "confirmed"].includes(String(payment.status))) person.manualPayments.push(payment);
        if (String(payment.status) === "declared") { person.pendingPayments.push(payment); continue; }
        if (String(payment.status) !== "confirmed") continue;
        const currency = String(payment.currency || "USD");
        const remaining = Math.max(0, num(payment.amount) - (allocationsByPayment.get(String(payment.id)) ?? 0));
        if (remaining > 0.005) {
          person.unallocatedPayments.push({ ...payment, remaining });
          const bucket = person.totals.get(currency) ?? { agreed: 0, paid: 0, balance: 0, credit: 0, salesUnmapped: 0 };
          bucket.credit += remaining;
          person.totals.set(currency, bucket);
          person.hasCredit = true;
        }
      }
    }
    if (person.crmId) {
      const sales = salesByCrm.get(person.crmId) ?? [];
      for (const sale of sales) {
        const mapping = academyMappingByProduct.get(String(sale.product_id));
        if (!mapping) continue;
        const schoolCandidates = person.enrollments.filter((e) => String(e.school_id) === String(mapping.school_id));
        const exactCandidates = schoolCandidates.filter((e) =>
          (!mapping.program_id || String(e.program_id || "") === String(mapping.program_id)) &&
          (!mapping.cohort_id || String(e.cohort_id || "") === String(mapping.cohort_id))
        );
        const suggestedEnrollmentId = exactCandidates.length === 1
          ? exactCandidates[0].id
          : exactCandidates.length === 0 && schoolCandidates.length === 1
            ? schoolCandidates[0].id
            : null;
        const blockedReason = schoolCandidates.length === 0
          ? `Aucune inscription ${schoolById.get(String(mapping.school_id)) ?? "Academy"} correspondante.`
          : exactCandidates.length > 1
            ? "Plusieurs inscriptions correspondent exactement au produit Sales."
            : exactCandidates.length === 0 && schoolCandidates.length > 1
              ? "Plusieurs inscriptions existent dans cette école : sélection requise."
              : null;
        for (const payment of paymentsBySale.get(String(sale.id)) ?? []) {
          if (String(payment.status) !== "confirmed" || mappedSalesPaymentIds.has(String(payment.id))) continue;
          person.salesToReconcileCount += 1;
          const currency = String(payment.currency || "USD");
          const amount = num(payment.amount);
          person.salesToReconcileAmount.set(currency, (person.salesToReconcileAmount.get(currency) ?? 0) + amount);
          const bucket = person.totals.get(currency) ?? { agreed: 0, paid: 0, balance: 0, credit: 0, salesUnmapped: 0 };
          bucket.salesUnmapped += amount;
          person.totals.set(currency, bucket);
          person.salesReconcileItems.push({
            salesPaymentId: String(payment.id),
            saleId: String(sale.id),
            amount,
            currency,
            paymentDate: String(payment.payment_date || ""),
            reference: String(payment.transaction_reference || ""),
            productName: String(sale.product_name || "Produit Academy"),
            schoolName: schoolById.get(String(mapping.school_id)) ?? "École Academy",
            schoolId: String(mapping.school_id),
            candidates: schoolCandidates,
            suggestedEnrollmentId,
            blockedReason,
          });
        }
      }
    }
    if (person.missingFinance) person.flags.push("Fiche financière manquante");
    if (person.pendingPayments.length) person.flags.push("Paiement à confirmer");
    if (person.salesToReconcileCount) person.flags.push("Paiement Sales à rapprocher");
    if (person.hasCredit) person.flags.push("Crédit non affecté");
    if (person.complimentaryPending.length) person.flags.push("Accès offert à valider");
    if (person.hasBalance && person.installmentCount === 0) person.flags.push("Échéancier absent");
    if (person.hasBalance) person.flags.push("Solde restant");
    if (!person.flags.length) person.flags.push("À jour");
  }

  for (const person of people.values()) person.manualPayments.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const allPeople = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const allSchools = [...new Set(allPeople.flatMap((p) => p.schools))].sort((a, b) => a.localeCompare(b, "fr"));
  const filtered = allPeople.filter((person) => {
    if (q) {
      const haystack = norm([person.name, person.email, ...person.schools, ...person.flags].join(" "));
      if (!haystack.includes(q)) return false;
    }
    if (schoolFilter && !person.schools.includes(schoolFilter)) return false;
    if (statusFilter === "missing_finance" && !person.missingFinance) return false;
    if (statusFilter === "reconcile" && !person.salesToReconcileCount) return false;
    if (statusFilter === "credit" && !person.hasCredit) return false;
    if (statusFilter === "balance" && !person.hasBalance) return false;
    if (statusFilter === "schedule" && !(person.hasBalance && person.installmentCount === 0)) return false;
    if (statusFilter === "complimentary" && !person.complimentaryPending.length) return false;
    if (statusFilter === "ok" && !(person.flags.length === 1 && person.flags[0] === "À jour")) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const missingFinanceEnrollments = allPeople.reduce((sum, p) => sum + p.missingFinance, 0);
  const peopleWithBalance = allPeople.filter((p) => p.hasBalance).length;
  const peopleWithCredit = allPeople.filter((p) => p.hasCredit).length;
  const peopleWithSalesReconcile = allPeople.filter((p) => p.salesToReconcileCount > 0).length;
  const peopleWithoutSchedule = allPeople.filter((p) => p.hasBalance && p.installmentCount === 0).length;
  const peopleWithPendingPayments = allPeople.filter((p) => p.pendingPayments.length > 0).length;
  const peopleWithComplimentaryPending = allPeople.filter((p) => p.complimentaryPending.length > 0).length;
  const href = (nextPage: number, nextStatus = statusFilter, nextSchool = schoolFilter) => `/dashboard/academy/students/finance-control?organization=${encodeURIComponent(organizationId)}&q=${encodeURIComponent(first(params.q))}&status=${encodeURIComponent(nextStatus)}&school=${encodeURIComponent(nextSchool)}&page=${nextPage}`;

  return <main className="min-h-screen bg-slate-50 p-6 md:p-8"><div className="mx-auto max-w-[1500px]">
    <header className="rounded-[2rem] bg-gradient-to-r from-slate-950 via-indigo-950 to-emerald-950 p-7 text-white shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[.22em] text-emerald-300">V4.10.127 · Finance / Suivi / Academy</p><h1 className="mt-2 text-4xl font-black">Student Finance Operations Center</h1><p className="mt-3 max-w-4xl text-slate-200">Voir → comprendre → corriger → vérifier depuis le même écran. Les actions écrivent dans les registres Academy existants avec contrôle des droits et audit.</p></div><Link href={`/dashboard/admin/identity-audit?organization=${encodeURIComponent(organizationId)}`} className="rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-black text-white">← Identités 360°</Link></div>
      <div className="mt-5 rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm font-bold text-amber-100">Invitations étudiants suspendues : valider d’abord les données financières internes, puis publier les soldes dans le portail.</div>
    </header>
    {first(params.success) ? <Banner tone="success">{first(params.success)}</Banner> : null}
    {first(params.error) ? <Banner tone="error">{first(params.error)}</Banner> : null}

    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
      <Metric label="Personnes Academy" value={allPeople.length} href={href(1, "")} active={!statusFilter}/>
      <Metric label="Inscriptions visibles" value={enrollments.length}/>
      <Metric label="Fiches finance manquantes" value={missingFinanceEnrollments} href={href(1, "missing_finance")} active={statusFilter === "missing_finance"} tone="red"/>
      <Metric label="Avec solde restant" value={peopleWithBalance} href={href(1, "balance")} active={statusFilter === "balance"} tone="amber"/>
      <Metric label="Crédit non affecté" value={peopleWithCredit} href={href(1, "credit")} active={statusFilter === "credit"} tone="blue"/>
      <Metric label="Sales à rapprocher" value={peopleWithSalesReconcile} href={href(1, "reconcile")} active={statusFilter === "reconcile"} tone="red"/>
      <Metric label="Accès offert à valider" value={peopleWithComplimentaryPending} href={href(1, "complimentary")} active={statusFilter === "complimentary"} tone="amber"/>
      <Metric label="Paiements à confirmer" value={peopleWithPendingPayments} tone="blue"/>
    </section>

    <section className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black text-violet-950">Échéanciers</p><p className="text-xs text-violet-800">{peopleWithoutSchedule} personne(s) avec solde n’ont encore aucun échéancier généré. V4.10.118 permet maintenant d’ajouter explicitement les dates et montants sans les inventer.</p></div><Link href={href(1, "schedule")} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-black text-white">Voir les échéanciers absents</Link></div></section>

    <section className="mt-6 rounded-3xl border bg-white p-5 shadow-sm">
      <form method="get" className="grid gap-3 lg:grid-cols-[1fr_240px_auto_auto]"><input type="hidden" name="organization" value={organizationId}/><input name="q" defaultValue={first(params.q)} placeholder="Nom, e-mail, école, anomalie…" className="rounded-xl border border-slate-300 px-4 py-3"/><select name="school" defaultValue={schoolFilter} className="rounded-xl border border-slate-300 px-3 py-3"><option value="">Toutes les écoles</option>{allSchools.map((school) => <option key={school} value={school}>{school}</option>)}</select><input type="hidden" name="status" value={statusFilter}/><button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Rechercher</button><Link href={`/dashboard/academy/students/finance-control?organization=${encodeURIComponent(organizationId)}`} className="rounded-xl bg-slate-100 px-5 py-3 text-center font-black">Tout afficher</Link></form>
      <div className="mt-4 flex flex-wrap gap-2">{[["balance","Solde restant"],["credit","Crédit non affecté"],["reconcile","Sales à rapprocher"],["complimentary","Accès offert à valider"],["missing_finance","Finance manquante"],["schedule","Échéancier absent"],["ok","À jour"]].map(([value,label]) => <Link key={value} href={href(1,value)} className={`rounded-full px-3 py-2 text-xs font-black ${statusFilter===value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>{label}</Link>)}</div>
    </section>

    <section className="mt-6 overflow-hidden rounded-3xl border bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-slate-950 text-white"><tr><th className="p-4">Étudiant</th><th className="p-4">Academy</th><th className="p-4">Situation financière</th><th className="p-4">Prochaine échéance</th><th className="p-4">Anomalies / actions</th><th className="p-4">Dossier</th></tr></thead><tbody>{visible.map((person) => {
        const editableEnrollments = person.enrollments.filter((e) => canEditFinance(membership.role, assignments, String(e.school_id)));
        const missingFinanceRows = editableEnrollments.filter((e) => !financeByEnrollment.has(e.id));
        const balanceEnrollments = editableEnrollments.filter((e) => {
          const finance = financeByEnrollment.get(e.id);
          if (!finance || finance.is_internal_training || String(finance.payment_status) === "not_required") return false;
          return Math.max(0, num(finance.agreed_amount) - (paidByEnrollment.get(e.id) ?? 0)) > 0.005;
        });
        const complimentaryPendingRows = editableEnrollments.filter((e) => person.complimentaryPending.includes(e.id));
        const paidSourceEnrollments = editableEnrollments.filter((e) => {
          const finance = financeByEnrollment.get(e.id);
          const agreement = activeAgreementByEnrollment.get(e.id);
          return Boolean(finance && agreement && num(finance.agreed_amount) > 0.005 && String(agreement.status) === "active");
        });
        const complimentaryValidatedRows = person.enrollments.filter((e) => person.complimentaryValidated.includes(e.id));
        return <tr key={person.key} className="border-b align-top last:border-0">
        <td className="p-4"><p className="font-black text-slate-950">{person.name}</p><p className="mt-1 text-xs text-slate-500">{person.email || "E-mail non renseigné"}</p><p className="mt-2 text-xs font-bold text-slate-400">{person.crmId ? "CRM pivot" : "Compte utilisateur"}</p></td>
        <td className="p-4"><p className="font-black">{person.enrollments.length} inscription(s)</p><p className="mt-1 max-w-[260px] text-xs text-slate-500">{person.schools.join(" · ")}</p>{person.missingFinance ? <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-black ${badge("red")}`}>{person.missingFinance} fiche(s) finance manquante(s)</span> : null}{complimentaryValidatedRows.map((e) => <span key={`complimentary-ok-${e.id}`} className={`mt-2 mr-1 inline-flex rounded-full px-2 py-1 text-xs font-black ${badge("green")}`}>Offert · {schoolById.get(String(e.school_id))}</span>)}</td>
        <td className="p-4"><div className="space-y-2">{[...person.totals.entries()].map(([currency,total]) => <div key={currency} className="rounded-xl bg-slate-50 p-3"><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"><span className="text-slate-500">Convenu</span><b>{money(total.agreed,currency)}</b><span className="text-slate-500">Payé</span><b className="text-emerald-700">{money(total.paid,currency)}</b><span className="text-slate-500">Solde</span><b className={total.balance>0?"text-amber-800":"text-emerald-700"}>{money(total.balance,currency)}</b>{total.credit>0?<><span className="text-slate-500">Crédit non affecté</span><b className="text-sky-700">{money(total.credit,currency)}</b></>:null}{total.salesUnmapped>0?<><span className="text-slate-500">Sales non rapproché</span><b className="text-rose-700">{money(total.salesUnmapped,currency)}</b></>:null}</div></div>)}</div></td>
        <td className="p-4"><p className="font-black">{dateLabel(person.nextDueOn)}</p><p className="mt-1 text-xs text-slate-500">{person.installmentCount ? `${person.installmentCount} échéance(s) enregistrée(s)` : person.hasBalance ? "Aucun échéancier généré" : "Aucune échéance requise"}</p></td>
        <td className="p-4"><div className="flex max-w-[300px] flex-wrap gap-2">{person.flags.map((flag) => <span key={flag} className={`rounded-full px-2 py-1 text-xs font-black ${flag==="À jour"?badge("green"):flag.includes("Sales")||flag.includes("manquante")?badge("red"):flag.includes("Crédit")?badge("blue"):badge("amber")}`}>{flag}</span>)}</div>{person.salesToReconcileCount ? <p className="mt-2 text-xs font-bold text-rose-700">{person.salesToReconcileCount} paiement(s) Sales confirmé(s) non rapproché(s)</p> : null}</td>
        <td className="p-4"><div className="flex min-w-[230px] flex-col gap-2">{person.financeViewable ? <Link href={`/dashboard/academy/students/finance?organization=${encodeURIComponent(organizationId)}&student=${encodeURIComponent(`${person.subjectType}:${person.subjectId}`)}`} className="rounded-xl bg-emerald-700 px-3 py-2 text-center text-xs font-black text-white">Dossier financier complet</Link> : <span className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-600">Lecture de suivi uniquement</span>}{person.crmId && ["owner","admin"].includes(membership.role) ? <Link href={`/dashboard/admin/identity-audit/${person.crmId}?organization=${encodeURIComponent(organizationId)}`} className="rounded-xl border px-3 py-2 text-center text-xs font-black text-indigo-700">Dossier 360°</Link> : null}
          {person.financeEditable ? <details className="rounded-xl border border-emerald-200 bg-emerald-50 p-2"><summary className="cursor-pointer text-center text-xs font-black text-emerald-900">Actions correctives</summary><div className="mt-3 space-y-4">
            {missingFinanceRows.map((e) => <form key={`repair-${e.id}`} action={repairStudentFinanceRecordAction} className="rounded-lg border border-rose-200 bg-white p-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="enrollment_id" value={e.id}/><input type="hidden" name="return_q" value={person.name}/><p className="text-xs font-black text-rose-800">Fiche finance manquante · {schoolById.get(String(e.school_id))}</p><button className="mt-2 w-full rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white">Créer / réparer la fiche</button></form>)}
            {complimentaryPendingRows.map((e) => <form key={`complimentary-${e.id}`} action={validateComplimentarySchoolAccessAction} className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="target_enrollment_id" value={e.id}/><input type="hidden" name="return_q" value={person.name}/><p className="text-xs font-black text-emerald-950">École offerte · {schoolById.get(String(e.school_id))}</p><p className="text-[11px] text-emerald-800">Accord financier actif à 0 USD avec remise couvrant 100 % du prix catalogue. Choisissez l’inscription payante qui porte l’offre.</p><select className={inputClass} name="source_enrollment_id" required defaultValue=""><option value="" disabled>Offre liée à…</option>{paidSourceEnrollments.filter((source) => source.id !== e.id).map((source) => <option key={source.id} value={source.id}>{schoolById.get(String(source.school_id))} · {money(num(financeByEnrollment.get(source.id)?.agreed_amount), String(financeByEnrollment.get(source.id)?.currency || "USD"))}</option>)}</select><button className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white" disabled={!paidSourceEnrollments.some((source) => source.id !== e.id)}>Valider l’accès offert</button></form>)}
            {person.salesReconcileItems.map((item) => {
              const editableCandidates = item.candidates.filter((candidate) => canEditFinance(membership.role, assignments, String(candidate.school_id)));
              const suggestedEditable = item.suggestedEnrollmentId && editableCandidates.some((candidate) => candidate.id === item.suggestedEnrollmentId) ? item.suggestedEnrollmentId : "";
              const blocked = Boolean(item.blockedReason) || editableCandidates.length === 0;
              return <form key={`sales-${item.salesPaymentId}`} action={reconcileStudentAcademySalesPaymentAction} className="space-y-2 rounded-lg border border-sky-200 bg-white p-3">
                <input type="hidden" name="organization_id" value={organizationId}/>
                <input type="hidden" name="sales_payment_id" value={item.salesPaymentId}/>
                <input type="hidden" name="return_q" value={person.name}/>
                <p className="text-xs font-black text-sky-900">Sales confirmé · {money(item.amount,item.currency)}</p>
                <p className="text-[11px] leading-relaxed text-slate-600">{item.productName} → <b>{item.schoolName}</b> · {item.paymentDate}{item.reference ? ` · réf. ${item.reference}` : ""}</p>
                {blocked ? <p className="rounded-lg bg-amber-50 p-2 text-[11px] font-bold text-amber-900">{item.blockedReason || "Vous n’avez pas le droit Finance sur l’inscription correspondante."}</p> : <>
                  <select className={inputClass} name="enrollment_id" required defaultValue={suggestedEditable}>
                    <option value="" disabled>Sélectionner l’inscription cible…</option>
                    {editableCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{item.schoolName} · {candidate.academic_status}{candidate.program_id ? " · programme lié" : " · inscription historique"}</option>)}
                  </select>
                  <button className="w-full rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white">Rapprocher et affecter à cette inscription</button>
                </>}
              </form>;
            })}
            <form action={recordStudentPaymentFromControlAction} className="space-y-2 rounded-lg border bg-white p-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="subject_type" value={person.subjectType}/><input type="hidden" name="subject_id" value={person.subjectId}/><input type="hidden" name="return_q" value={person.name}/><p className="text-xs font-black">Enregistrer un paiement reçu</p><p className="text-[11px] text-slate-500">Pour un paiement attendu dans le futur, utilisez « Ajouter une échéance ».</p><div className="grid grid-cols-2 gap-2"><input className={inputClass} name="amount" inputMode="decimal" placeholder="Montant" required/><input className={inputClass} name="currency" defaultValue={[...person.totals.keys()][0] ?? "USD"} maxLength={3}/></div><div className="grid grid-cols-2 gap-2"><input className={inputClass} type="date" name="paid_on" defaultValue={today()} max={today()}/><select className={inputClass} name="payment_method" defaultValue="bank_transfer"><option value="bank_transfer">Virement</option><option value="card">Carte</option><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="check">Chèque</option><option value="other">Autre</option></select></div><input className={inputClass} name="reference" placeholder="Référence / transaction"/><select className={inputClass} name="allocation_enrollment_id" defaultValue=""><option value="">Laisser en crédit non affecté</option>{editableEnrollments.filter((e) => financeByEnrollment.has(e.id)).map((e) => <option key={e.id} value={e.id}>{schoolById.get(String(e.school_id))}</option>)}</select><input className={inputClass} name="allocation_amount" inputMode="decimal" placeholder="Montant partiel à affecter (laisser vide = totalité)"/><textarea className={inputClass} name="notes" rows={2} placeholder="Note interne"/><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" name="bank_confirmed"/> Paiement déjà confirmé par Finance / banque</label><button className="w-full rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">Enregistrer le paiement</button></form>
            {person.pendingPayments.map((payment) => <form key={`confirm-${String(payment.id)}`} action={confirmStudentPaymentFromControlAction} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="payment_id" value={String(payment.id)}/><input type="hidden" name="return_q" value={person.name}/><p className="text-xs font-black text-amber-950">À confirmer · {money(num(payment.amount), String(payment.currency || "USD"))} · {String(payment.paid_on)}</p><button className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white">Confirmer le paiement</button></form>)}
            {person.manualPayments.slice(0, 5).map((payment) => <details key={`cancel-${String(payment.id)}`} className="rounded-lg border border-slate-300 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-black text-slate-800">Paiement manuel · {money(num(payment.amount), String(payment.currency || "USD"))} · {String(payment.paid_on)}{payment.reference ? ` · ${String(payment.reference)}` : ""}</summary><form action={cancelStudentPaymentFromControlAction} className="mt-2 space-y-2"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="payment_id" value={String(payment.id)}/><input type="hidden" name="return_q" value={person.name}/><textarea className={inputClass} name="reason" rows={2} minLength={10} required placeholder="Motif obligatoire de l’annulation (minimum 10 caractères)"/><p className="text-[11px] text-slate-500">L’opération conserve le paiement dans l’historique, le marque annulé et recalcule les soldes. Elle ne supprime aucune trace.</p><button className="w-full rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white">Annuler ce paiement</button></form></details>)}
            {person.unallocatedPayments.map((payment) => <form key={`credit-${String(payment.id)}`} action={allocateStudentCreditFromControlAction} className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="payment_id" value={String(payment.id)}/><input type="hidden" name="return_q" value={person.name}/><p className="text-xs font-black text-sky-950">Crédit disponible {money(num(payment.remaining), String(payment.currency || "USD"))}</p><select className={inputClass} name="enrollment_id" required defaultValue=""><option value="" disabled>Affecter à…</option>{editableEnrollments.filter((e) => String(financeByEnrollment.get(e.id)?.currency || "USD") === String(payment.currency || "USD")).map((e) => <option key={e.id} value={e.id}>{schoolById.get(String(e.school_id))}</option>)}</select><input className={inputClass} name="amount" inputMode="decimal" defaultValue={num(payment.remaining).toFixed(2)} required/><button className="w-full rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white">Affecter le crédit</button></form>)}
            {balanceEnrollments.length ? <form action={addStudentInstallmentFromControlAction} className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3"><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="return_q" value={person.name}/><p className="text-xs font-black text-violet-950">Ajouter une échéance</p><select className={inputClass} name="enrollment_id" required defaultValue=""><option value="" disabled>Inscription…</option>{balanceEnrollments.map((e) => <option key={e.id} value={e.id}>{schoolById.get(String(e.school_id))}</option>)}</select><div className="grid grid-cols-2 gap-2"><input className={inputClass} type="date" name="due_on" min={today()} required/><input className={inputClass} name="amount" inputMode="decimal" placeholder="Montant" required/></div><button className="w-full rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white">Ajouter l’échéance</button></form> : null}
            <p className="rounded-lg bg-slate-100 p-2 text-[11px] leading-relaxed text-slate-600">Les changements de tarif, promotion ou remise restent soumis au circuit d’homologation du dossier financier complet.</p>
          </div></details> : null}</div></td>
      </tr>;})}{!visible.length ? <tr><td colSpan={6} className="p-8 text-center font-bold text-slate-500">Aucun étudiant ne correspond à ce filtre.</td></tr> : null}</tbody></table></div>
      {totalPages > 1 ? <nav className="flex items-center justify-between gap-3 border-t p-4">{safePage > 1 ? <Link href={href(safePage-1)} className="rounded-xl border px-4 py-2 font-black">← Précédente</Link> : <span/>}<span className="text-sm font-bold text-slate-600">Page {safePage} / {totalPages} · {filtered.length} personne(s)</span>{safePage < totalPages ? <Link href={href(safePage+1)} className="rounded-xl border px-4 py-2 font-black">Suivante →</Link> : <span/>}</nav> : null}
    </section>

    <section className="mt-6 rounded-2xl bg-slate-900 p-5 text-sm text-white"><p className="font-black">Règle de gouvernance V4.10.124</p><p className="mt-1 text-slate-300">Le Centre agit directement sur les registres financiers Academy existants. Finance/Admin peuvent réparer une fiche, enregistrer ou confirmer un paiement, annuler avec motif un paiement manuel erroné, rapprocher un paiement Sales confirmé vers une inscription Academy précise, affecter un crédit, créer une échéance et valider un accès offert lorsqu’un accord actif couvre 100 % du prix catalogue. Une école offerte reste à 0 dû : aucun faux paiement n’est créé. Suivi conserve une lecture opérationnelle sans modifier les montants.</p></section>
  </div></main>;
}

function Metric({ label, value, href, active, tone = "slate" }: { label: string; value: number; href?: string; active?: boolean; tone?: "slate"|"red"|"amber"|"blue" }) {
  const toneClass = tone === "red" ? "border-rose-200" : tone === "amber" ? "border-amber-200" : tone === "blue" ? "border-sky-200" : "border-slate-200";
  const content = <div className={`rounded-2xl border ${toneClass} ${active ? "ring-2 ring-indigo-500" : ""} bg-white p-4 shadow-sm`}><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-1 text-3xl font-black">{value}</p></div>;
  return href ? <Link href={href}>{content}</Link> : content;
}


function Banner({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return <div className={`mt-4 rounded-2xl border p-4 text-sm font-black ${tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>{children}</div>;
}

