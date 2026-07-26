import Link from "next/link";
import {redirect} from "next/navigation";
import {
  cancelOwnSaleAction,
  createSaleAction,
  createSalesProductAction,
  markCommissionPaidAction,
  reviewSaleAction,
  toggleSalesProductAction,
  upsertSalesTargetAction,
} from "@/app/actions/sales";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);
const financeRoles = new Set(["owner", "admin", "hr"]);
const productManagerRoles = new Set(["owner", "admin", "hr"]);
const currencies = ["USD", "EUR", "GBP", "XAF", "CAD"] as const;

type SearchParams = {
  success?: string | string[];
  error?: string | string[];
  status?: string | string[];
  seller?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};

type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
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
};
type SaleRow = {
  id: string;
  seller_id: string;
  product_name: string;
  customer_name: string;
  customer_email: string | null;
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
  notes: string | null;
  commission_amount: number | string;
  commission_status: string;
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

  const isLeader = leaderRoles.has(membership.role);
  const canManageProducts = productManagerRoles.has(membership.role);
  const canPayCommission = financeRoles.has(membership.role);

  const [membersResult, productsResult] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("created_at"),
    admin
      .from("sales_products")
      .select("id, name, code, default_price, currency, commission_type, commission_value, proof_required, is_active")
      .eq("organization_id", membership.organization_id)
      .order("is_active", {ascending: false})
      .order("name"),
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
                supabase/008_sales_commissions.sql
              </code>
            ) : null}
          </section>
        </div>
      </main>
    );
  }
  if (membersResult.error) throw new Error(membersResult.error.message);

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

  let salesQuery = admin
    .from("sales_records")
    .select("id, seller_id, product_name, customer_name, customer_email, sale_date, quantity, unit_price, total_amount, currency, payment_method, payment_status, workflow_status, transaction_reference, proof_url, notes, commission_amount, commission_status, created_at")
    .eq("organization_id", membership.organization_id)
    .order("sale_date", {ascending: false})
    .order("created_at", {ascending: false})
    .limit(250);

  if (!isLeader) salesQuery = salesQuery.eq("seller_id", authData.user.id);
  if (isLeader && sellerFilter && memberIds.includes(sellerFilter)) salesQuery = salesQuery.eq("seller_id", sellerFilter);
  if (statusFilter && ["submitted", "verified", "approved", "rejected", "cancelled", "refunded"].includes(statusFilter)) {
    salesQuery = salesQuery.eq("workflow_status", statusFilter);
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthStart = `${currentMonth}-01`;
  const [salesResult, targetsResult] = await Promise.all([
    salesQuery,
    admin
      .from("sales_targets")
      .select("id, user_id, period_month, target_amount, currency")
      .eq("organization_id", membership.organization_id)
      .eq("period_month", monthStart)
      .order("created_at"),
  ]);

  if (salesResult.error) throw new Error(t("sales.messages.loadFailed", {message: salesResult.error.message}));
  if (targetsResult.error) throw new Error(t("sales.messages.loadFailed", {message: targetsResult.error.message}));

  const sales = (salesResult.data ?? []) as SaleRow[];
  const targets = (targetsResult.data ?? []) as TargetRow[];
  const products = (productsResult.data ?? []) as ProductRow[];
  const activeProducts = products.filter((product) => product.is_active);
  const reviewQueue = sales.filter((sale) => ["submitted", "verified"].includes(sale.workflow_status));
  const monthSales = sales.filter((sale) => sale.sale_date >= monthStart);
  const approvedMonthSales = monthSales.filter((sale) => sale.workflow_status === "approved");
  const payableSales = sales.filter((sale) => sale.commission_status === "payable");
  const paidCommissionSales = sales.filter((sale) => sale.commission_status === "paid");
  const ownTarget = targets.find((target) => target.user_id === authData.user.id) ?? null;
  const ownApprovedRevenue = approvedMonthSales
    .filter((sale) => sale.seller_id === authData.user.id && (!ownTarget || sale.currency === ownTarget.currency))
    .reduce((sum, sale) => sum + Number(sale.total_amount), 0);
  const targetProgress = ownTarget && Number(ownTarget.target_amount) > 0
    ? Math.min(100, Math.round((ownApprovedRevenue / Number(ownTarget.target_amount)) * 100))
    : 0;
  const saleCountLabel = isLeader ? t("sales.scopeOrganisation") : t("sales.scopePersonal");
  const dateFormatter = new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeZone: "UTC"});

  const csvParams = new URLSearchParams();
  if (statusFilter) csvParams.set("status", statusFilter);
  if (isLeader && sellerFilter) csvParams.set("seller", sellerFilter);
  const csvHref = `/api/sales/export${csvParams.size ? `?${csvParams.toString()}` : ""}`;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("sales.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black">{t("sales.title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{t("sales.subtitle")}</p>
            </div>
            <Link href={csvHref} className="rounded-xl bg-white px-5 py-3 text-center font-black text-slate-950 hover:bg-slate-100">
              {t("sales.exportCsv")}
            </Link>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label={t("sales.salesThisMonth")} value={monthSales.length} detail={saleCountLabel} />
          <Metric
            label={t("sales.approvedRevenue")}
            value={sumByCurrency(approvedMonthSales.map((sale) => ({amount: Number(sale.total_amount), currency: sale.currency})), dateLocale)}
            detail={t("sales.currentMonth")}
          />
          <Metric label={t("sales.pendingValidation")} value={reviewQueue.length} />
          <Metric
            label={t("sales.commissionsPayable")}
            value={sumByCurrency(payableSales.map((sale) => ({amount: Number(sale.commission_amount), currency: sale.currency})), dateLocale)}
          />
          <Metric
            label={t("sales.commissionsPaid")}
            value={sumByCurrency(paidCommissionSales.map((sale) => ({amount: Number(sale.commission_amount), currency: sale.currency})), dateLocale)}
          />
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{t("sales.recordSale")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("sales.recordSaleHelp")}</p>
            <form action={createSaleAction} className="mt-5 space-y-4">
              {isLeader ? (
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.seller")}</span>
                  <select name="sellerId" defaultValue={authData.user.id} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name} · {t(`roles.${member.role}`)}</option>)}
                  </select>
                </label>
              ) : <input type="hidden" name="sellerId" value={authData.user.id} />}

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

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.paymentMethod")}</span>
                  <select name="paymentMethod" defaultValue="bank_transfer" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    {(["bank_transfer", "card", "cash", "mobile_money", "cheque", "other"] as const).map((value) => <option key={value} value={value}>{t(`sales.paymentMethods.${value}`)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold">{t("sales.paymentStatus")}</span>
                  <select name="paymentStatus" defaultValue="unpaid" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    {(["unpaid", "partial", "paid"] as const).map((value) => <option key={value} value={value}>{t(`sales.paymentStatuses.${value}`)}</option>)}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-bold">{t("sales.transactionReference")}</span>
                <input name="transactionReference" maxLength={160} placeholder={t("sales.transactionReferencePlaceholder")} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">{t("sales.proofUrl")}</span>
                <input type="url" name="proofUrl" maxLength={1000} placeholder="https://..." className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">{t("sales.notes")}</span>
                <textarea name="notes" rows={3} maxLength={3000} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
              </label>
              <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800">{t("sales.submitSale")}</button>
            </form>
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
                  <p className="mt-1 text-sm text-slate-500">{t("sales.salesRegisterHelp", {count: sales.length})}</p>
                </div>
                <form method="get" className="flex flex-wrap gap-2">
                  {isLeader ? (
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
                {sales.length ? sales.map((sale) => {
                  const seller = profileById.get(sale.seller_id);
                  return (
                    <article key={sale.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClasses[sale.workflow_status] ?? statusClasses.draft}`}>{t(`sales.workflowStatuses.${sale.workflow_status}`)}</span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{t(`sales.paymentStatuses.${sale.payment_status}`)}</span>
                            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{t(`sales.commissionStatuses.${sale.commission_status}`)}</span>
                          </div>
                          <h3 className="mt-3 text-xl font-black">{sale.product_name}</h3>
                          <p className="mt-1 text-sm text-slate-600">{sale.customer_name} · {seller?.full_name || seller?.email || t("common.member")}</p>
                          <p className="mt-2 text-xs font-semibold text-slate-500">{dateFormatter.format(new Date(`${sale.sale_date}T00:00:00Z`))} · {t(`sales.paymentMethods.${sale.payment_method}`)}{sale.transaction_reference ? ` · ${sale.transaction_reference}` : ""}</p>
                          {sale.proof_url ? <a href={sale.proof_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-indigo-700 underline">{t("sales.openProof")}</a> : null}
                        </div>
                        <div className="text-left lg:text-right">
                          <p className="text-2xl font-black">{moneyFormatter(dateLocale, sale.currency).format(Number(sale.total_amount))}</p>
                          <p className="mt-1 text-sm font-bold text-emerald-700">{t("sales.commissionAmount", {amount: moneyFormatter(dateLocale, sale.currency).format(Number(sale.commission_amount))})}</p>
                          {sale.seller_id === authData.user.id && ["draft", "submitted"].includes(sale.workflow_status) ? (
                            <form action={cancelOwnSaleAction} className="mt-3">
                              <input type="hidden" name="saleId" value={sale.id} />
                              <button className="text-sm font-bold text-red-700 underline">{t("sales.cancelSale")}</button>
                            </form>
                          ) : null}
                          {canPayCommission && sale.workflow_status === "approved" && sale.commission_status === "payable" ? (
                            <form action={markCommissionPaidAction} className="mt-3">
                              <input type="hidden" name="saleId" value={sale.id} />
                              <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">{t("sales.markCommissionPaid")}</button>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                }) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">{t("sales.noSales")}</p>}
              </div>
            </section>
          </div>
        </div>

        {isLeader ? (
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-2xl font-black text-amber-950">{t("sales.validationQueue")}</h2>
            <p className="mt-1 text-sm text-amber-800">{t("sales.validationQueueHelp", {count: reviewQueue.length})}</p>
            <div className="mt-5 grid gap-4">
              {reviewQueue.length ? reviewQueue.map((sale) => (
                <form action={reviewSaleAction} key={sale.id} className="rounded-2xl border border-amber-200 bg-white p-5">
                  <input type="hidden" name="saleId" value={sale.id} />
                  <div className="grid gap-4 xl:grid-cols-[1fr_auto_auto_1fr_auto] xl:items-end">
                    <div>
                      <p className="font-black">{sale.product_name} · {sale.customer_name}</p>
                      <p className="mt-1 text-sm text-slate-600">{profileById.get(sale.seller_id)?.full_name || profileById.get(sale.seller_id)?.email} · {moneyFormatter(dateLocale, sale.currency).format(Number(sale.total_amount))}</p>
                    </div>
                    <label>
                      <span className="text-xs font-black text-slate-500">{t("sales.reviewStatus")}</span>
                      <select name="workflowStatus" defaultValue={sale.workflow_status === "verified" ? "approved" : "verified"} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2">
                        {(["verified", "approved", "rejected", "cancelled", "refunded"] as const).map((value) => <option key={value} value={value}>{t(`sales.workflowStatuses.${value}`)}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="text-xs font-black text-slate-500">{t("sales.paymentStatus")}</span>
                      <select name="paymentStatus" defaultValue={sale.payment_status} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2">
                        {(["unpaid", "partial", "paid", "refunded"] as const).map((value) => <option key={value} value={value}>{t(`sales.paymentStatuses.${value}`)}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="text-xs font-black text-slate-500">{t("sales.reviewNote")}</span>
                      <input name="reviewNote" maxLength={1500} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2" />
                    </label>
                    <button className="rounded-xl bg-amber-500 px-5 py-2.5 font-black text-slate-950">{t("sales.update")}</button>
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <label><span className="text-sm font-bold">{t("sales.commissionType")}</span><select name="commissionType" defaultValue="percentage" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"><option value="percentage">{t("sales.commissionTypes.percentage")}</option><option value="fixed">{t("sales.commissionTypes.fixed")}</option></select></label>
                  <label><span className="text-sm font-bold">{t("sales.commissionValue")}</span><input type="number" name="commissionValue" min={0} step="0.01" defaultValue={0} required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
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
                      <p className="mt-1 text-sm text-slate-600">{moneyFormatter(dateLocale, product.currency).format(Number(product.default_price))} · {product.commission_type === "percentage" ? `${product.commission_value}%` : moneyFormatter(dateLocale, product.currency).format(Number(product.commission_value))} {t("sales.commission")}</p>
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
