import Link from "next/link";
import {redirect} from "next/navigation";
import {
  cancelOwnSaleAction,
  createSaleAction,
  createSalesProductAction,
  reviewSaleAction,
  toggleSalesProductAction,
  upsertSalesTargetAction,
} from "@/app/actions/sales";
import {PaymentDetailsFields} from "@/components/sales/payment-details-fields";
import {SaleDraftForm} from "@/components/sales/sale-draft-form";
import {getI18n} from "@/i18n/server";
import {
  COMMERCIAL_MANAGER_ROLES,
  PRODUCT_MANAGER_ROLES,
  canUseCommercialModules,
} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {canManageSensitiveFinanceData, canVerifySalesForFinance} from "@/lib/auth/sensitive-finance-access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = COMMERCIAL_MANAGER_ROLES;
const productManagerRoles = PRODUCT_MANAGER_ROLES;
const currencies = ["USD", "EUR", "GBP", "XAF", "CAD"] as const;

type SearchParams = {
  success?: string | string[];
  error?: string | string[];
  status?: string | string[];
  seller?: string | string[];
  field?: string | string[];
  saleCreated?: string | string[];
  q?: string | string[];
  sale?: string | string[];
  from?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};

type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type AmbassadorRow = {id: string; code: string; full_name: string};
type ProductRow = {
  id: string;
  name: string;
  code: string | null;
  default_price: number | string;
  currency: string;
  commission_type: string;
  commission_value: number | string;
  proof_required: boolean;
  is_active: boolean;
  payment_plan_type: string;
  initial_payment_type: string;
  initial_payment_value: number | string;
  max_installments: number | null;
};
type SaleRow = {
  id: string;
  seller_id: string;
  product_name: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  sale_date: string;
  quantity: number;
  unit_price: number | string;
  total_amount: number | string;
  currency: string;
  payment_method: string;
  payment_status: string;
  workflow_status: string;
  transaction_reference: string | null;
  proof_url: string | null;
  proof_storage_path: string | null;
  proof_file_name: string | null;
  notes: string | null;
  commission_amount: number | string;
  commission_status: string;
  commission_basis_amount: number | string;
  first_payment_amount: number | string;
  paid_amount: number | string;
  balance_amount: number | string;
  payment_plan_type: string;
  collection_owner_id: string | null;
  collection_status: string;
  next_payment_due_date: string | null;
  next_payment_amount: number | string | null;
  created_at: string;
  ambassador_id: string | null;
};
type SaleDocumentRow = {
  id: string;
  sale_id: string;
  document_type: "proforma" | "invoice" | "receipt";
  document_number: string;
  status: string;
  created_at: string;
};
type TargetRow = {
  id: string;
  user_id: string;
  period_month: string;
  target_amount: number | string;
  currency: string;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchValue(value: string | null | undefined) {
  return normalizeSearchValue(value).replace(/[^a-z0-9]/g, "");
}

function moneyFormatter(locale: string, currency: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "XAF" ? 0 : 2,
    });
  } catch {
    return new Intl.NumberFormat(locale, {maximumFractionDigits: 2});
  }
}

function sumByCurrency(rows: Array<{amount: number; currency: string}>, locale: string) {
  const totals = new Map<string, number>();
  rows.forEach((row) => totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount));
  if (!totals.size) return moneyFormatter(locale, "USD").format(0);
  return [...totals.entries()]
    .map(([currency, amount]) => moneyFormatter(locale, currency).format(amount))
    .join(" · ");
}

function Metric({label, value, detail}: {label: string; value: string | number; detail?: string}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      {detail ? <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p> : null}
    </article>
  );
}

const financeDocumentLabels: Record<string, {fr: string; en: string}> = {
  proforma: {fr: "PRO FORMA", en: "PRO FORMA"},
  invoice: {fr: "FACTURE", en: "INVOICE"},
  receipt: {fr: "RECU", en: "RECEIPT"},
};
const financeDocumentStatusLabels: Record<string, {fr: string; en: string}> = {
  draft: {fr: "Brouillon", en: "Draft"}, approved: {fr: "Approuve", en: "Approved"}, sent: {fr: "Envoye", en: "Sent"},
  accepted: {fr: "Accepte", en: "Accepted"}, partial: {fr: "Partiellement paye", en: "Partially paid"}, paid: {fr: "Paye", en: "Paid"},
  overdue: {fr: "En retard", en: "Overdue"}, cancelled: {fr: "Annule", en: "Cancelled"}, converted: {fr: "Converti", en: "Converted"},
};

const statusClasses: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  verified: "bg-blue-100 text-blue-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-700",
  refunded: "bg-violet-100 text-violet-800",
};

export default async function SalesPage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const params = (await searchParams) ?? {};
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const statusFilter = firstValue(params.status);
  const sellerFilter = firstValue(params.seller);
  const customerSearch = firstValue(params.q).trim().slice(0, 120);
  const selectedSaleId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(firstValue(params.sale)) ? firstValue(params.sale) : "";
  const fromFinance = firstValue(params.from) === "finance";
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError) throw new Error(membershipError.message);
  if (!membership) redirect("/dashboard/company");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  const isLeader = leaderRoles.has(membership.role);
  const isEmployee = membership.role === "employee";
  const canViewAllCommissions = await canManageSensitiveFinanceData(
    admin,
    membership.organization_id,
    authData.user.id,
    membership.role,
  );
  const canFinanceVerify = await canVerifySalesForFinance(
    admin,
    membership.organization_id,
    authData.user.id,
    membership.role,
  );
  const isFinanceVerifierOnly = canFinanceVerify && !isLeader && !canViewAllCommissions;
  const canManageProducts = productManagerRoles.has(membership.role) && canViewAllCommissions;

  let membersQuery = admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("created_at");
  if (!canViewAllCommissions && !canFinanceVerify) membersQuery = membersQuery.in("user_id", visibleUserIds);

  const [membersResult, productsResult, ambassadorsResult] = await Promise.all([
    membersQuery,
    admin
      .from("sales_products")
      .select("id, name, code, default_price, currency, commission_type, commission_value, proof_required, is_active, payment_plan_type, initial_payment_type, initial_payment_value, max_installments")
      .eq("organization_id", membership.organization_id)
      .order("is_active", {ascending: false})
      .order("name"),
    admin
      .from("crm_ambassadors")
      .select("id, code, full_name")
      .eq("organization_id", membership.organization_id)
      .eq("status", "active")
      .order("full_name"),
  ]);

  if (productsResult.error) {
    const missingTable = productsResult.error.code === "42P01" || productsResult.error.code === "PGRST205";
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("sales.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black">{t("sales.title")}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">
              {missingTable ? t("sales.databaseSetupTitle") : t("sales.loadFailedTitle")}
            </h2>
            <p className="mt-3 leading-7 text-amber-900">
              {missingTable
                ? t("sales.databaseSetupDescription")
                : t("sales.messages.loadFailed", {message: productsResult.error.message})}
            </p>
            {missingTable ? (
              <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
                supabase/009_sales_payments_collections.sql
              </code>
            ) : null}
          </section>
        </div>
      </main>
    );
  }
  if (membersResult.error) throw new Error(membersResult.error.message);
  if (ambassadorsResult.error) throw new Error(ambassadorsResult.error.message);

  const members = (membersResult.data ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.user_id);
  const {data: profilesData, error: profilesError} = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : {data: [] as ProfileRow[], error: null};
  if (profilesError) throw new Error(profilesError.message);

  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(members.map((member) => [member.user_id, member.role]));
  const memberOptions = memberIds
    .map((id) => ({
      id,
      name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || t("common.member"),
      email: profileById.get(id)?.email ?? "",
      role: roleById.get(id) ?? "employee",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ambassadors = (ambassadorsResult.data ?? []) as AmbassadorRow[];
  const ambassadorById = new Map(ambassadors.map((ambassador) => [ambassador.id, ambassador]));

  let salesQuery = admin
    .from("sales_records")
    .select("id, seller_id, ambassador_id, product_name, customer_name, customer_email, customer_phone, sale_date, quantity, unit_price, total_amount, currency, payment_method, payment_status, workflow_status, transaction_reference, proof_url, proof_storage_path, proof_file_name, notes, commission_amount, commission_status, commission_basis_amount, first_payment_amount, paid_amount, balance_amount, payment_plan_type, collection_owner_id, collection_status, next_payment_due_date, next_payment_amount, created_at")
    .eq("organization_id", membership.organization_id)
    .order("sale_date", {ascending: false})
    .order("created_at", {ascending: false})
    .limit(250);

  if (membership.role === "manager" && !canViewAllCommissions && !canFinanceVerify) {
    salesQuery = salesQuery.in("seller_id", visibleUserIds);
  } else if (!isLeader && !canViewAllCommissions && !canFinanceVerify) {
    salesQuery = salesQuery.eq("seller_id", authData.user.id);
  }
  if (selectedSaleId) salesQuery = salesQuery.eq("id", selectedSaleId);
  if ((isLeader || canViewAllCommissions) && sellerFilter && memberIds.includes(sellerFilter)) {
    salesQuery = salesQuery.eq("seller_id", sellerFilter);
  }
  if (statusFilter && ["submitted", "verified", "approved", "rejected", "cancelled", "refunded"].includes(statusFilter)) {
    salesQuery = salesQuery.eq("workflow_status", statusFilter);
  } else if (isFinanceVerifierOnly) {
    salesQuery = salesQuery.eq("workflow_status", "submitted");
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthStart = `${currentMonth}-01`;
  let targetsQuery = admin
    .from("sales_targets")
    .select("id, user_id, period_month, target_amount, currency")
    .eq("organization_id", membership.organization_id)
    .eq("period_month", monthStart)
    .order("created_at");

  if (membership.role === "manager" && !canViewAllCommissions) {
    targetsQuery = targetsQuery.in("user_id", visibleUserIds);
  } else if (!canViewAllCommissions && membership.role === "employee") {
    targetsQuery = targetsQuery.eq("user_id", authData.user.id);
  }

  const [salesResult, targetsResult] = await Promise.all([
    salesQuery,
    targetsQuery,
  ]);

  if (salesResult.error) throw new Error(t("sales.messages.loadFailed", {message: salesResult.error.message}));
  if (targetsResult.error) throw new Error(t("sales.messages.loadFailed", {message: targetsResult.error.message}));

  const sales = (salesResult.data ?? []) as SaleRow[];
  const targets = (targetsResult.data ?? []) as TargetRow[];
  const saleIds = sales.map((sale) => sale.id);
  const [saleDocumentsResult, confirmedPaymentsResult] = saleIds.length
    ? await Promise.all([
      admin.from("finance_documents")
        .select("id,sale_id,document_type,document_number,status,created_at")
        .eq("organization_id", membership.organization_id)
        .in("sale_id", saleIds)
        .in("document_type", ["proforma", "invoice", "receipt"])
        .order("created_at", {ascending: true}),
      admin.from("sales_payments")
        .select("sale_id")
        .eq("organization_id", membership.organization_id)
        .in("sale_id", saleIds)
        .eq("status", "confirmed"),
    ])
    : [{data: [] as SaleDocumentRow[], error: null}, {data: [] as Array<{sale_id:string}>, error: null}];
  const {data: saleDocumentsData, error: saleDocumentsError} = saleDocumentsResult;
  if (saleDocumentsError) throw new Error(saleDocumentsError.message);
  if (confirmedPaymentsResult.error) throw new Error(confirmedPaymentsResult.error.message);
  const saleIdsWithConfirmedPayment = new Set((confirmedPaymentsResult.data ?? []).map((payment) => String(payment.sale_id)));
  const saleDocumentsBySale = new Map<string, SaleDocumentRow[]>();
  ((saleDocumentsData ?? []) as SaleDocumentRow[]).forEach((document) => {
    const list = saleDocumentsBySale.get(document.sale_id) ?? [];
    list.push(document);
    saleDocumentsBySale.set(document.sale_id, list);
  });

  const missingCollectionOwnerIds = [...new Set(
    sales
      .map((sale) => sale.collection_owner_id)
      .filter((id): id is string => typeof id === "string" && !profileById.has(id)),
  )];
  if (missingCollectionOwnerIds.length) {
    const {data: collectionOwnerMemberships, error: collectionOwnerMembershipsError} = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .in("user_id", missingCollectionOwnerIds);
    if (collectionOwnerMembershipsError) throw new Error(collectionOwnerMembershipsError.message);

    const safeCollectionOwnerIds = (collectionOwnerMemberships ?? []).map((row) => String(row.user_id));
    if (safeCollectionOwnerIds.length) {
      const {data: collectionOwnerProfiles, error: collectionOwnerProfilesError} = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", safeCollectionOwnerIds);
      if (collectionOwnerProfilesError) throw new Error(collectionOwnerProfilesError.message);
      ((collectionOwnerProfiles ?? []) as ProfileRow[]).forEach((profile) => profileById.set(profile.id, profile));
    }
  }

  const normalizedCustomerSearch = normalizeSearchValue(customerSearch);
  const compactCustomerSearch = compactSearchValue(customerSearch);
  const registerSales = normalizedCustomerSearch
    ? sales.filter((sale) => {
        const values = [
          sale.customer_name,
          sale.customer_email,
          sale.customer_phone,
          sale.transaction_reference,
          sale.product_name,
        ];
        return values.some((value) => {
          const normalized = normalizeSearchValue(value);
          const compact = compactSearchValue(value);
          return normalized.includes(normalizedCustomerSearch)
            || Boolean(compactCustomerSearch && compact.includes(compactCustomerSearch));
        });
      })
    : sales;

  const products = (productsResult.data ?? []) as ProductRow[];
  const activeProducts = products.filter((product) => product.is_active);
  const reviewQueue = sales.filter((sale) => isLeader
    ? ["submitted", "verified"].includes(sale.workflow_status)
    : sale.workflow_status === "submitted");
  const monthSales = sales.filter((sale) => sale.sale_date >= monthStart);
  const approvedMonthSales = monthSales.filter((sale) => sale.workflow_status === "approved");
  const ownTarget = targets.find((target) => target.user_id === authData.user.id) ?? null;
  const ownApprovedRevenue = approvedMonthSales
    .filter((sale) => sale.seller_id === authData.user.id && (!ownTarget || sale.currency === ownTarget.currency))
    .reduce((sum, sale) => sum + Number(sale.total_amount), 0);
  const targetProgress = ownTarget && Number(ownTarget.target_amount) > 0
    ? Math.min(100, Math.round((ownApprovedRevenue / Number(ownTarget.target_amount)) * 100))
    : 0;
  const saleCountLabel = membership.role === "manager"
    ? t("sales.scopeTeam")
    : isLeader
      ? t("sales.scopeOrganisation")
      : t("sales.scopePersonal");
  const dateFormatter = new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeZone: "UTC"});

  const csvParams = new URLSearchParams();
  if (statusFilter) csvParams.set("status", statusFilter);
  if ((isLeader || canViewAllCommissions) && sellerFilter) csvParams.set("seller", sellerFilter);
  const csvHref = `/api/sales/export${csvParams.size ? `?${csvParams.toString()}` : ""}`;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("sales.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black">{t("sales.title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{t(isEmployee ? "sales.employeeSubtitle" : "sales.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/dashboard/collections" className="rounded-xl bg-amber-400 px-5 py-3 text-center font-black text-slate-950 hover:bg-amber-300">
                {t(isEmployee ? "sales.employeeOpenCollections" : "sales.openCollections")}
              </Link>
              <Link href={csvHref} className="rounded-xl bg-white px-5 py-3 text-center font-black text-slate-950 hover:bg-slate-100">
                {t(isEmployee ? "sales.employeeExportCsv" : "sales.exportCsv")}
              </Link>
            </div>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Metric label={t("sales.salesThisMonth")} value={monthSales.length} detail={saleCountLabel} />
          <Metric
            label={t("sales.approvedRevenue")}
            value={sumByCurrency(approvedMonthSales.map((sale) => ({amount: Number(sale.total_amount), currency: sale.currency})), dateLocale)}
            detail={t("sales.currentMonth")}
          />
          <Metric label={t("sales.pendingValidation")} value={reviewQueue.length} />
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{t("sales.recordSale")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("sales.recordSaleHelp")}</p>
            <SaleDraftForm
              action={createSaleAction}
              draftKey={`super-leader:sale-draft:${membership.organization_id}:${authData.user.id}`}
              errorField={firstValue(params.field)}
              errorMessage={firstValue(params.field) ? errorMessage : undefined}
              clearDraft={firstValue(params.saleCreated) === "1"}
            >
              {isLeader ? (
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.seller")}</span>
                  <select name="sellerId" defaultValue={authData.user.id} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name} · {t(`roles.${member.role}`)}</option>)}
                  </select>
                </label>
              ) : <input type="hidden" name="sellerId" value={authData.user.id} />}

              <label className="block">
                <span className="text-sm font-bold">{t("sales.referringAmbassador")}</span>
                <select name="ambassadorId" defaultValue="" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                  <option value="">{t("sales.noAmbassador")}</option>
                  {ambassadors.map((ambassador) => <option key={ambassador.id} value={ambassador.id}>{ambassador.full_name} · {ambassador.code}</option>)}
                </select>
                <span className="mt-1 block text-xs text-slate-500">{t("sales.referringAmbassadorHelp")}</span>
              </label>

              <label className="block">
                <span className="text-sm font-bold">{t("sales.catalogueProduct")}</span>
                <select name="productId" defaultValue="" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                  <option value="">{t("sales.customProductOption")}</option>
                  {activeProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.code ? `${product.code} · ` : ""}{product.name} · {moneyFormatter(dateLocale, product.currency).format(Number(product.default_price))}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-bold">{t("sales.customProductName")}</span>
                <input name="customProductName" maxLength={200} placeholder={t("sales.customProductPlaceholder")} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>

              <label className="block">
                <span className="text-sm font-bold">{t("sales.customerName")}</span>
                <input name="customerName" required minLength={2} maxLength={200} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.customerEmail")}</span>
                  <input type="email" name="customerEmail" maxLength={254} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.customerPhone")}</span>
                  <input name="customerPhone" maxLength={80} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.saleDate")}</span>
                  <input type="date" name="saleDate" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.quantity")}</span>
                  <input type="number" name="quantity" required min={1} step={1} defaultValue={1} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.unitPrice")}</span>
                  <input type="number" name="unitPrice" required min={0} step="0.01" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.currency")}</span>
                  <select name="currency" defaultValue="USD" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-bold">{t("sales.contractReference")}</span>
                <input name="contractReference" maxLength={160} placeholder={t("sales.contractReferencePlaceholder")} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>

              <PaymentDetailsFields
                today={new Date().toISOString().slice(0, 10)}
                labels={{section: t("sales.initialPaymentSection"), help: t("sales.initialPaymentHelp"), settlementMode: t("sales.settlementMode"), full: t("sales.settlementModes.full"), installments: t("sales.settlementModes.installments"), amount: t("sales.initialPaymentAmount"), date: t("sales.initialPaymentDate"), method: t("sales.paymentMethod"), reference: t("sales.initialPaymentReference"), nextDate: t("sales.nextPaymentDueDate"), nextAmount: t("sales.nextPaymentAmount"), proof: t("sales.proofUpload"), externalLink: t("attachments.externalLinkOptional"), chooseFile: t("attachments.chooseFile"), uploading: t("attachments.uploading"), uploaded: t("attachments.uploaded"), remove: t("attachments.remove"), invalidFile: t("attachments.invalidFile"), attachmentHelp: t("attachments.help"), noPayment: dateLocale.startsWith("fr") ? "Aucun paiement re\u00e7u a ce jour" : "No payment received yet", noPaymentHelp: dateLocale.startsWith("fr") ? "Cochez cette option si le client n'a encore rien paye. La vente sera creee avec un solde integral a recouvrer." : "Select this option when the customer has not paid yet. The sale will be created with the full balance outstanding."}}
                paymentMethods={(["bank_transfer", "card", "cash", "mobile_money", "cheque", "other"] as const).map((value) => ({value, label: t(`sales.paymentMethods.${value}`)}))}
              />
              {isLeader ? (
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.collectionOwner")}</span>
                  <select name="collectionOwnerId" defaultValue="" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <option value="">{t("sales.assignLater")}</option>
                    {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="text-sm font-bold">{t("sales.notes")}</span>
                <textarea name="notes" rows={3} maxLength={3000} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>
              <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800">{t("sales.submitSale")}</button>
            </SaleDraftForm>
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("sales.myMonthlyTarget")}</h2>
              {ownTarget ? (
                <>
                  <div className="mt-5 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-500">{t("sales.approvedRevenue")}</p>
                      <p className="mt-1 text-2xl font-black">{moneyFormatter(dateLocale, ownTarget.currency).format(ownApprovedRevenue)}</p>
                    </div>
                    <p className="text-right text-sm font-bold text-slate-600">{t("sales.targetOf", {amount: moneyFormatter(dateLocale, ownTarget.currency).format(Number(ownTarget.target_amount))})}</p>
                  </div>
                  <div className="mt-4 h-4 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{width: `${targetProgress}%`}} />
                  </div>
                  <p className="mt-2 text-right text-sm font-black text-emerald-700">{targetProgress}%</p>
                </>
              ) : <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{t("sales.noTarget")}</p>}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{t("sales.salesRegister")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("sales.salesRegisterHelp", {count: registerSales.length})}</p>
                  <p className="mt-1 text-xs font-semibold text-indigo-700">{t(isEmployee ? "sales.clientSearchPersonalScope" : "sales.clientSearchVisibleScope")}</p>
                </div>
                <form method="get" className="flex flex-wrap gap-2">
                  <input
                    type="search"
                    name="q"
                    defaultValue={customerSearch}
                    placeholder={t("sales.clientSearchPlaceholder")}
                    className="min-w-[240px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                  />
                  {isLeader || canViewAllCommissions ? (
                    <select name="seller" defaultValue={sellerFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                      <option value="">{t("sales.allSellers")}</option>
                      {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                    </select>
                  ) : null}
                  <select name="status" defaultValue={statusFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                    <option value="">{t("sales.allStatuses")}</option>
                    {(["submitted", "verified", "approved", "rejected", "cancelled", "refunded"] as const).map((value) => <option key={value} value={value}>{t(`sales.workflowStatuses.${value}`)}</option>)}
                  </select>
                  <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{t("sales.filter")}</button>
                </form>
              </div>

              <div className="mt-5 space-y-4">
                {registerSales.length ? registerSales.map((sale) => {
                  const seller = profileById.get(sale.seller_id);
                  const collectionOwner = sale.collection_owner_id ? profileById.get(sale.collection_owner_id) : null;
                  const collectionOwnerName = collectionOwner?.full_name?.trim() || collectionOwner?.email || t("common.member");
                  const saleDocuments = saleDocumentsBySale.get(sale.id) ?? [];
                  const canOpenCollectionCase = membership.role === "owner"
                    || membership.role === "admin"
                    || (membership.role === "manager" && Boolean(sale.collection_owner_id && visibleUserIds.includes(sale.collection_owner_id)))
                    || sale.collection_owner_id === authData.user.id;
                  return (
                    <article key={sale.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClasses[sale.workflow_status] ?? statusClasses.draft}`}>{t(`sales.workflowStatuses.${sale.workflow_status}`)}</span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{t(`sales.paymentStatuses.${sale.payment_status}`)}</span>
                          </div>
                          <h3 className="mt-3 text-xl font-black">{sale.product_name}</h3>
                          <p className="mt-1 text-sm text-slate-600">{sale.customer_name} · {seller?.full_name || seller?.email || t("common.member")}</p>
                          {sale.customer_email || sale.customer_phone ? (
                            <p className="mt-1 text-xs font-semibold text-slate-500">{[sale.customer_email, sale.customer_phone].filter(Boolean).join(" · ")}</p>
                          ) : null}
                          {sale.ambassador_id && ambassadorById.get(sale.ambassador_id) ? <p className="mt-1 text-sm font-semibold text-violet-700">{t("sales.ambassadorSummary", {name: ambassadorById.get(sale.ambassador_id)!.full_name})}</p> : null}
                          <p className="mt-2 text-xs font-semibold text-slate-500">{dateFormatter.format(new Date(`${sale.sale_date}T00:00:00Z`))} · {t(`sales.paymentMethods.${sale.payment_method}`)}{sale.transaction_reference ? ` · ${sale.transaction_reference}` : ""}</p>
                          {sale.proof_storage_path ? <a href={`/api/attachments/sale/${sale.id}`} className="mt-2 inline-block text-sm font-bold text-indigo-700 underline">{t("sales.openProof")}{sale.proof_file_name ? ` · ${sale.proof_file_name}` : ""}</a> : sale.proof_url ? <a href={sale.proof_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-indigo-700 underline">{t("sales.openProof")}</a> : null}
                          {saleDocuments.length ? (
                            <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-3">
                              <p className="text-[11px] font-black uppercase tracking-wide text-indigo-700">{dateLocale.startsWith("fr") ? "Documents de paiement" : "Payment documents"}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {saleDocuments.map((document) => {
                                  const label = financeDocumentLabels[document.document_type]?.[dateLocale.startsWith("fr") ? "fr" : "en"] ?? document.document_type;
                                  const statusLabel = financeDocumentStatusLabels[document.status]?.[dateLocale.startsWith("fr") ? "fr" : "en"] ?? document.status;
                                  return <Link key={document.id} href={`/dashboard/finance/documents/${document.id}`} target="_blank" className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-800">{label} · {document.document_number} · {statusLabel}</Link>;
                                })}
                              </div>
                              <p className="mt-2 text-[11px] font-semibold text-indigo-700">{dateLocale.startsWith("fr") ? "Ouvrez le document puis utilisez Imprimer / Enregistrer en PDF pour l'envoyer au client." : "Open the document, then use Print / Save as PDF to send it to the customer."}</p>
                            </div>
                          ) : null}

                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{t("sales.validationState")}</p>
                              <p className="mt-1 text-sm font-black text-slate-900">{t(`sales.workflowStatuses.${sale.workflow_status}`)}</p>
                            </div>
                            <div className="rounded-xl bg-indigo-50 p-3">
                              <p className="text-[11px] font-black uppercase tracking-wide text-indigo-600">{t("sales.followUpAssignment")}</p>
                              <p className="mt-1 text-sm font-black text-indigo-950">
                                {sale.collection_owner_id ? t("sales.followUpAssignedTo", {name: collectionOwnerName}) : t("sales.followUpUnassigned")}
                              </p>
                            </div>
                            <div className="rounded-xl bg-emerald-50 p-3">
                              <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">{t("sales.followUpStatus")}</p>
                              <p className="mt-1 text-sm font-black text-emerald-950">{t(`collections.statuses.${sale.collection_status}`)}</p>
                            </div>
                          </div>
                          {sale.seller_id === authData.user.id && sale.collection_owner_id && sale.collection_owner_id !== authData.user.id ? (
                            <p className="mt-2 text-xs font-semibold text-slate-500">{t("sales.readOnlyFollowUp", {name: collectionOwnerName})}</p>
                          ) : null}
                        </div>
                        <div className="text-left lg:text-right">
                          <p className="text-2xl font-black">{moneyFormatter(dateLocale, sale.currency).format(Number(sale.total_amount))}</p>
                          <p className="mt-1 text-sm font-bold text-indigo-700">{t("sales.firstPaymentSummary", {amount: moneyFormatter(dateLocale, sale.currency).format(Number(sale.first_payment_amount))})}</p>
                          <p className="mt-1 text-sm font-bold text-slate-600">{t("sales.paidAndBalance", {paid: moneyFormatter(dateLocale, sale.currency).format(Number(sale.paid_amount)), balance: moneyFormatter(dateLocale, sale.currency).format(Number(sale.balance_amount))})}</p>
                          {canOpenCollectionCase ? (
                            <Link href={`/dashboard/collections?sale=${sale.id}`} className="mt-2 inline-block text-sm font-black text-indigo-700 underline">{t("sales.followCollection")}</Link>
                          ) : (
                            <span className="mt-2 inline-block text-sm font-bold text-slate-500">{t("sales.followCollectionReadOnly")}</span>
                          )}
                          {sale.seller_id === authData.user.id && ["draft", "submitted"].includes(sale.workflow_status) ? (
                            <form action={cancelOwnSaleAction} className="mt-3">
                              <input type="hidden" name="saleId" value={sale.id} />
                              <button className="text-sm font-bold text-red-700 underline">{t("sales.cancelSale")}</button>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                }) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">{customerSearch ? t("sales.noClientSearchResults") : t("sales.noSales")}</p>}
              </div>
            </section>
          </div>
        </div>

        {isLeader || canFinanceVerify ? (
          <section id="validation-queue" className="mt-6 scroll-mt-28 rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-2xl font-black text-amber-950">{t("sales.validationQueue")}</h2>
            <p className="mt-1 text-sm text-amber-800">{t("sales.validationQueueHelp", {count: reviewQueue.length})}</p>
            <div className="mt-5 grid gap-4">
              {reviewQueue.length ? reviewQueue.map((sale) => (
                <form action={reviewSaleAction} key={sale.id} className="rounded-2xl border border-amber-200 bg-white p-5">
                  <input type="hidden" name="saleId" value={sale.id} />
                  {fromFinance ? <input type="hidden" name="returnTo" value="finance" /> : null}
                  <div className="grid gap-4 xl:grid-cols-[1fr_auto_1fr_auto] xl:items-end">
                    <div>
                      <p className="font-black">{sale.product_name} · {sale.customer_name}</p>
                      <p className="mt-1 text-sm text-slate-600">{profileById.get(sale.seller_id)?.full_name || profileById.get(sale.seller_id)?.email} · {moneyFormatter(dateLocale, sale.currency).format(Number(sale.total_amount))}</p>
                    </div>
                    {isLeader && (membership.role !== "manager" || visibleUserIds.includes(sale.seller_id)) && sale.workflow_status === "verified" ? (
                      <div>
                        <span className="text-xs font-black text-slate-500">Décision finale</span>
                        <p className="mt-1 rounded-xl bg-violet-50 px-3 py-2 font-black text-violet-900">Vente vérifiée par Finance</p>
                      </div>
                    ) : isLeader && (membership.role !== "manager" || visibleUserIds.includes(sale.seller_id)) ? (
                      <label>
                        <span className="text-xs font-black text-slate-500">{t("sales.reviewStatus")}</span>
                        <select name="workflowStatus" defaultValue={sale.workflow_status === "verified" ? "approved" : "verified"} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2">
                          {(["verified", "approved", "rejected", "cancelled", "refunded"] as const).map((value) => <option key={value} value={value}>{t(`sales.workflowStatuses.${value}`)}</option>)}
                        </select>
                      </label>
                    ) : (
                      <div>
                        <input type="hidden" name="workflowStatus" value="verified" />
                        <span className="text-xs font-black text-slate-500">Étape autorisée</span>
                        <p className="mt-1 rounded-xl bg-blue-50 px-3 py-2 font-black text-blue-900">Soumise → Vérifiée</p>
                      </div>
                    )}
                    <label>
                      <span className="text-xs font-black text-slate-500">{t("sales.reviewNote")}</span>
                      <input name="reviewNote" maxLength={1500} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2" />
                    </label>
                    {isLeader && (membership.role !== "manager" || visibleUserIds.includes(sale.seller_id)) && sale.workflow_status === "verified" && saleIdsWithConfirmedPayment.has(sale.id) ? (
                      <div className="flex gap-2">
                        <button name="workflowStatus" value="approved" className="rounded-xl bg-emerald-600 px-5 py-2.5 font-black text-white">Approuver</button>
                        <button name="workflowStatus" value="rejected" className="rounded-xl bg-red-600 px-5 py-2.5 font-black text-white">Rejeter</button>
                      </div>
                    ) : isLeader && (membership.role !== "manager" || visibleUserIds.includes(sale.seller_id)) && sale.workflow_status === "verified" ? (
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/dashboard/finance/payments?sale=${sale.id}`} className="rounded-xl bg-amber-500 px-5 py-2.5 font-black text-slate-950">Contrôler l’encaissement</Link>
                        <button name="workflowStatus" value="rejected" className="rounded-xl bg-red-600 px-5 py-2.5 font-black text-white">Rejeter</button>
                      </div>
                    ) : (
                      <button className="rounded-xl bg-amber-500 px-5 py-2.5 font-black text-slate-950">
                        {isLeader && (membership.role !== "manager" || visibleUserIds.includes(sale.seller_id)) ? t("sales.update") : "Vérifier cette vente"}
                      </button>
                    )}
                  </div>
                </form>
              )) : <p className="rounded-2xl bg-white p-5 text-sm text-amber-900">{t("sales.noValidationPending")}</p>}
            </div>
          </section>
        ) : null}

        {canManageProducts ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("sales.productCatalogue")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("sales.productCatalogueHelp")}</p>
              <form action={createSalesProductAction} className="mt-5 space-y-4">
                <label className="block"><span className="text-sm font-bold">{t("sales.productName")}</span><input name="name" required minLength={2} maxLength={160} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
                <label className="block"><span className="text-sm font-bold">{t("sales.productCode")}</span><input name="code" maxLength={60} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label><span className="text-sm font-bold">{t("sales.defaultPrice")}</span><input type="number" name="defaultPrice" min={0} step="0.01" defaultValue={0} required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
                  <label><span className="text-sm font-bold">{t("sales.currency")}</span><select name="currency" defaultValue="USD" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
                </div>
                <div className="rounded-2xl bg-indigo-50 p-4">
                  <p className="font-black text-indigo-950">{t("sales.paymentConfiguration")}</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label><span className="text-sm font-bold">{t("sales.paymentPlanType")}</span><select name="paymentPlanType" defaultValue="full" className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3">{(["full", "deposit_balance", "installments", "custom"] as const).map((value) => <option key={value} value={value}>{t(`sales.paymentPlanTypes.${value}`)}</option>)}</select></label>
                    <label><span className="text-sm font-bold">{t("sales.maxInstallments")}</span><input type="number" name="maxInstallments" min={1} max={120} step={1} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
                    <label><span className="text-sm font-bold">{t("sales.initialPaymentType")}</span><select name="initialPaymentType" defaultValue="percentage" className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3"><option value="percentage">{t("sales.initialPaymentTypes.percentage")}</option><option value="fixed">{t("sales.initialPaymentTypes.fixed")}</option></select></label>
                    <label><span className="text-sm font-bold">{t("sales.initialPaymentValue")}</span><input type="number" name="initialPaymentValue" min={0} step="0.01" defaultValue={100} required className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
                  </div>
                </div>
                <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold"><input type="checkbox" name="proofRequired" />{t("sales.proofRequiredOption")}</label>
                <label className="block"><span className="text-sm font-bold">{t("sales.description")}</span><textarea name="description" maxLength={1500} rows={3} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
                <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("sales.addProduct")}</button>
              </form>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("sales.configuredProducts", {count: products.length})}</h2>
              <div className="mt-5 grid gap-3">
                {products.length ? products.map((product) => (
                  <article key={product.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-black">{product.code ? `${product.code} · ` : ""}{product.name}</p>
                      <p className="mt-1 text-sm text-slate-600">{moneyFormatter(dateLocale, product.currency).format(Number(product.default_price))}</p>
                      <p className="mt-1 text-xs font-bold text-indigo-700">{t(`sales.paymentPlanTypes.${product.payment_plan_type}`)} · {t("sales.initialPaymentConfigured", {value: product.initial_payment_type === "percentage" ? `${product.initial_payment_value}%` : moneyFormatter(dateLocale, product.currency).format(Number(product.initial_payment_value))})}</p>
                    </div>
                    <form action={toggleSalesProductAction}>
                      <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="activate" value={String(!product.is_active)} />
                      <button className={`rounded-xl px-4 py-2 text-sm font-black ${product.is_active ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{product.is_active ? t("sales.disable") : t("sales.activate")}</button>
                    </form>
                  </article>
                )) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">{t("sales.noProducts")}</p>}
              </div>
            </div>
          </section>
        ) : null}

        {isLeader ? (
          <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
            <h2 className="text-2xl font-black text-indigo-950">{t("sales.monthlyTargets")}</h2>
            <p className="mt-1 text-sm text-indigo-800">{t("sales.monthlyTargetsHelp")}</p>
            <form action={upsertSalesTargetAction} className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-end">
              <label><span className="text-sm font-bold">{t("sales.member")}</span><select name="memberId" required className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3">{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
              <label><span className="text-sm font-bold">{t("sales.month")}</span><input type="month" name="period" required defaultValue={currentMonth} className="mt-2 block rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
              <label><span className="text-sm font-bold">{t("sales.targetAmount")}</span><input type="number" name="targetAmount" required min={0} step="0.01" className="mt-2 block rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
              <label><span className="text-sm font-bold">{t("sales.currency")}</span><select name="currency" defaultValue="USD" className="mt-2 block rounded-xl border border-indigo-200 bg-white px-4 py-3">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              <button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("sales.saveTarget")}</button>
            </form>
            {targets.length ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {targets.map((target) => <article key={target.id} className="rounded-2xl bg-white p-4"><p className="font-black">{profileById.get(target.user_id)?.full_name || profileById.get(target.user_id)?.email}</p><p className="mt-1 text-lg font-black text-indigo-700">{moneyFormatter(dateLocale, target.currency).format(Number(target.target_amount))}</p></article>)}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
