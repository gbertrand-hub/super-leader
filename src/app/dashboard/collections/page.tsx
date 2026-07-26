import Link from "next/link";
import {redirect} from "next/navigation";
import {
  addPaymentScheduleItemAction,
  assignCollectionCaseAction,
  createCollectionPaymentAction,
  reviewCollectionPaymentAction,
} from "@/app/actions/collections";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);

type SearchParams = {
  success?: string | string[];
  error?: string | string[];
  status?: string | string[];
  collector?: string | string[];
  sale?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type SaleRow = {
  id: string;
  seller_id: string;
  product_name: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  sale_date: string;
  total_amount: number | string;
  currency: string;
  workflow_status: string;
  payment_status: string;
  first_payment_amount: number | string;
  paid_amount: number | string;
  balance_amount: number | string;
  commission_amount: number | string;
  commission_status: string;
  collection_owner_id: string | null;
  collection_status: string;
  next_payment_due_date: string | null;
  next_payment_amount: number | string | null;
  collection_notes: string | null;
};
type PaymentRow = {
  id: string;
  sale_id: string;
  schedule_item_id: string | null;
  payment_date: string;
  amount: number | string;
  currency: string;
  payment_method: string;
  transaction_reference: string | null;
  proof_url: string | null;
  status: string;
  is_initial_payment: boolean;
  recorded_by: string;
  notes: string | null;
  created_at: string;
};
type ScheduleRow = {
  id: string;
  sale_id: string;
  sequence_number: number;
  due_date: string;
  expected_amount: number | string;
  paid_amount: number | string;
  status: string;
  notes: string | null;
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

const collectionStatusClasses: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-700",
  assigned: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  overdue: "bg-red-100 text-red-800",
  completed: "bg-emerald-100 text-emerald-800",
  suspended: "bg-amber-100 text-amber-800",
};

const paymentStatusClasses: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  refunded: "bg-violet-100 text-violet-800",
};

export default async function CollectionsPage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const params = (await searchParams) ?? {};
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const statusFilter = firstValue(params.status);
  const collectorFilter = firstValue(params.collector);
  const saleFilter = firstValue(params.sale);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

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
  const [membersResult, schemaCheck] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("created_at"),
    admin.from("sales_payments").select("id", {head: true, count: "exact"}).limit(1),
  ]);

  if (schemaCheck.error) {
    const missingTable = schemaCheck.error.code === "42P01" || schemaCheck.error.code === "PGRST205";
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("collections.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black">{t("collections.title")}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">
              {missingTable ? t("collections.databaseSetupTitle") : t("collections.loadFailedTitle")}
            </h2>
            <p className="mt-3 leading-7 text-amber-900">
              {missingTable
                ? t("collections.databaseSetupDescription")
                : t("collections.messages.loadFailed", {message: schemaCheck.error.message})}
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

  const members = (membersResult.data ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.user_id);
  const {data: profilesData, error: profilesError} = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : {data: [] as ProfileRow[], error: null};
  if (profilesError) throw new Error(profilesError.message);

  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const memberOptions = memberIds
    .map((id) => ({
      id,
      name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || t("common.member"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let salesQuery = admin
    .from("sales_records")
    .select("id, seller_id, product_name, customer_name, customer_email, customer_phone, sale_date, total_amount, currency, workflow_status, payment_status, first_payment_amount, paid_amount, balance_amount, commission_amount, commission_status, collection_owner_id, collection_status, next_payment_due_date, next_payment_amount, collection_notes")
    .eq("organization_id", membership.organization_id)
    .not("workflow_status", "in", '(rejected,cancelled,refunded)')
    .order("next_payment_due_date", {ascending: true, nullsFirst: false})
    .order("sale_date", {ascending: false})
    .limit(250);

  if (!isLeader) salesQuery = salesQuery.eq("collection_owner_id", authData.user.id);
  if (isLeader && collectorFilter && memberIds.includes(collectorFilter)) {
    salesQuery = salesQuery.eq("collection_owner_id", collectorFilter);
  }
  if (statusFilter && ["not_started", "assigned", "in_progress", "overdue", "completed", "suspended"].includes(statusFilter)) {
    salesQuery = salesQuery.eq("collection_status", statusFilter);
  }
  if (saleFilter) salesQuery = salesQuery.eq("id", saleFilter);

  const {data: salesData, error: salesError} = await salesQuery;
  if (salesError) throw new Error(t("collections.messages.loadFailed", {message: salesError.message}));
  const sales = (salesData ?? []) as SaleRow[];
  const saleIds = sales.map((sale) => sale.id);

  const [paymentsResult, schedulesResult] = saleIds.length
    ? await Promise.all([
        admin
          .from("sales_payments")
          .select("id, sale_id, schedule_item_id, payment_date, amount, currency, payment_method, transaction_reference, proof_url, status, is_initial_payment, recorded_by, notes, created_at")
          .in("sale_id", saleIds)
          .order("payment_date", {ascending: false})
          .order("created_at", {ascending: false}),
        admin
          .from("sales_payment_schedule")
          .select("id, sale_id, sequence_number, due_date, expected_amount, paid_amount, status, notes")
          .in("sale_id", saleIds)
          .order("due_date", {ascending: true}),
      ])
    : [{data: [] as PaymentRow[], error: null}, {data: [] as ScheduleRow[], error: null}];

  if (paymentsResult.error) throw new Error(t("collections.messages.loadFailed", {message: paymentsResult.error.message}));
  if (schedulesResult.error) throw new Error(t("collections.messages.loadFailed", {message: schedulesResult.error.message}));

  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const schedules = (schedulesResult.data ?? []) as ScheduleRow[];
  const paymentsBySale = new Map<string, PaymentRow[]>();
  const schedulesBySale = new Map<string, ScheduleRow[]>();
  payments.forEach((payment) => paymentsBySale.set(payment.sale_id, [...(paymentsBySale.get(payment.sale_id) ?? []), payment]));
  schedules.forEach((item) => schedulesBySale.set(item.sale_id, [...(schedulesBySale.get(item.sale_id) ?? []), item]));

  const outstandingRows = sales
    .filter((sale) => Number(sale.balance_amount) > 0)
    .map((sale) => ({amount: Number(sale.balance_amount), currency: sale.currency}));
  const confirmedThisMonth = payments
    .filter((payment) => payment.status === "confirmed" && payment.payment_date.startsWith(currentMonth))
    .map((payment) => ({amount: Number(payment.amount), currency: payment.currency}));
  const overdueCount = sales.filter((sale) => Number(sale.balance_amount) > 0 && sale.next_payment_due_date && sale.next_payment_due_date < today).length;
  const completedCount = sales.filter((sale) => Number(sale.balance_amount) <= 0 || sale.collection_status === "completed").length;
  const pendingPayments = payments.filter((payment) => payment.status === "pending");
  const dateFormatter = new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeZone: "UTC"});

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("collections.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black">{t("collections.title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{t("collections.subtitle")}</p>
            </div>
            <Link href="/dashboard/sales" className="rounded-xl bg-white px-5 py-3 text-center font-black text-slate-950 hover:bg-slate-100">
              {t("collections.backToSales")}
            </Link>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label={t("collections.outstandingBalance")} value={sumByCurrency(outstandingRows, dateLocale)} />
          <Metric label={t("collections.collectedThisMonth")} value={sumByCurrency(confirmedThisMonth, dateLocale)} />
          <Metric label={t("collections.overdueCases")} value={overdueCount} />
          <Metric label={t("collections.completedCases")} value={completedCount} />
          <Metric label={t("collections.pendingPayments")} value={pendingPayments.length} detail={t("collections.pendingPaymentsHelp")} />
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form method="get" className="flex flex-wrap items-end gap-3">
            {isLeader ? (
              <label>
                <span className="text-xs font-black text-slate-500">{t("collections.collector")}</span>
                <select name="collector" defaultValue={collectorFilter} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <option value="">{t("collections.allCollectors")}</option>
                  {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              <span className="text-xs font-black text-slate-500">{t("collections.collectionStatus")}</span>
              <select name="status" defaultValue={statusFilter} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2">
                <option value="">{t("collections.allStatuses")}</option>
                {(["not_started", "assigned", "in_progress", "overdue", "completed", "suspended"] as const).map((value) => (
                  <option key={value} value={value}>{t(`collections.statuses.${value}`)}</option>
                ))}
              </select>
            </label>
            <button className="rounded-xl bg-slate-950 px-5 py-2.5 font-black text-white">{t("collections.filter")}</button>
            {(statusFilter || collectorFilter || saleFilter) ? (
              <Link href="/dashboard/collections" className="rounded-xl bg-slate-100 px-5 py-2.5 font-black text-slate-700">{t("collections.reset")}</Link>
            ) : null}
          </form>
        </section>

        <section className="mt-6 space-y-6">
          {sales.length ? sales.map((sale) => {
            const salePayments = paymentsBySale.get(sale.id) ?? [];
            const saleSchedules = schedulesBySale.get(sale.id) ?? [];
            const seller = profileById.get(sale.seller_id);
            const collector = sale.collection_owner_id ? profileById.get(sale.collection_owner_id) : null;
            const canHandle = isLeader || sale.collection_owner_id === authData.user.id;
            const paymentProgress = Number(sale.total_amount) > 0
              ? Math.min(100, Math.round((Number(sale.paid_amount) / Number(sale.total_amount)) * 100))
              : 0;

            return (
              <article key={sale.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-950 p-6 text-white">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${collectionStatusClasses[sale.collection_status] ?? collectionStatusClasses.not_started}`}>
                          {t(`collections.statuses.${sale.collection_status}`)}
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white">
                          {t(`sales.paymentStatuses.${sale.payment_status}`)}
                        </span>
                        <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-950">
                          {t(`sales.workflowStatuses.${sale.workflow_status}`)}
                        </span>
                      </div>
                      <h2 className="mt-3 text-2xl font-black">{sale.product_name}</h2>
                      <p className="mt-1 text-slate-300">{sale.customer_name} · {seller?.full_name || seller?.email || t("common.member")}</p>
                      <p className="mt-1 text-sm text-slate-400">{sale.customer_email || "—"} · {sale.customer_phone || "—"}</p>
                    </div>
                    <div className="text-left lg:text-right">
                      <p className="text-sm font-bold text-slate-400">{t("collections.contractValue")}</p>
                      <p className="text-3xl font-black">{moneyFormatter(dateLocale, sale.currency).format(Number(sale.total_amount))}</p>
                      <p className="mt-1 text-sm font-bold text-amber-300">{t("collections.assignedTo", {name: collector?.full_name || collector?.email || t("collections.unassigned")})}</p>
                    </div>
                  </div>
                </div>

                <div className="p-6">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <Metric label={t("collections.firstPayment")} value={moneyFormatter(dateLocale, sale.currency).format(Number(sale.first_payment_amount))} />
                    <Metric label={t("collections.totalCollected")} value={moneyFormatter(dateLocale, sale.currency).format(Number(sale.paid_amount))} />
                    <Metric label={t("collections.remainingBalance")} value={moneyFormatter(dateLocale, sale.currency).format(Number(sale.balance_amount))} />
                    <Metric label={t("collections.sellerCommission")} value={moneyFormatter(dateLocale, sale.currency).format(Number(sale.commission_amount))} detail={t("collections.firstPaymentOnly")} />
                    <Metric
                      label={t("collections.nextDue")}
                      value={sale.next_payment_due_date ? dateFormatter.format(new Date(`${sale.next_payment_due_date}T00:00:00Z`)) : "—"}
                      detail={sale.next_payment_amount !== null ? moneyFormatter(dateLocale, sale.currency).format(Number(sale.next_payment_amount)) : undefined}
                    />
                  </div>

                  <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{width: `${paymentProgress}%`}} />
                  </div>
                  <p className="mt-2 text-right text-sm font-black text-emerald-700">{t("collections.paymentProgress", {percent: paymentProgress})}</p>

                  <div className="mt-6 grid gap-6 xl:grid-cols-2">
                    {isLeader ? (
                      <form action={assignCollectionCaseAction} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                        <input type="hidden" name="saleId" value={sale.id} />
                        <h3 className="text-lg font-black text-indigo-950">{t("collections.assignCase")}</h3>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label><span className="text-sm font-bold">{t("collections.collector")}</span><select name="collectionOwnerId" defaultValue={sale.collection_owner_id ?? ""} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5"><option value="">{t("collections.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                          <label><span className="text-sm font-bold">{t("collections.collectionStatus")}</span><select name="collectionStatus" defaultValue={sale.collection_status} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5">{(["not_started", "assigned", "in_progress", "overdue", "completed", "suspended"] as const).map((value) => <option key={value} value={value}>{t(`collections.statuses.${value}`)}</option>)}</select></label>
                          <label><span className="text-sm font-bold">{t("collections.nextPaymentDate")}</span><input type="date" name="nextPaymentDueDate" defaultValue={sale.next_payment_due_date ?? ""} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                          <label><span className="text-sm font-bold">{t("collections.nextPaymentAmount")}</span><input type="number" name="nextPaymentAmount" min={0} step="0.01" defaultValue={sale.next_payment_amount === null ? "" : String(sale.next_payment_amount)} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                        </div>
                        <label className="mt-4 block"><span className="text-sm font-bold">{t("collections.followUpNotes")}</span><textarea name="collectionNotes" rows={2} maxLength={3000} defaultValue={sale.collection_notes ?? ""} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5" /></label>
                        <button className="mt-4 w-full rounded-xl bg-indigo-700 px-4 py-3 font-black text-white">{t("collections.saveAssignment")}</button>
                      </form>
                    ) : (
                      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                        <h3 className="text-lg font-black text-indigo-950">{t("collections.followUpInstructions")}</h3>
                        <p className="mt-3 text-sm leading-6 text-indigo-900">{sale.collection_notes || t("collections.noFollowUpNotes")}</p>
                      </div>
                    )}

                    {canHandle && Number(sale.balance_amount) > 0 ? (
                      <form action={createCollectionPaymentAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                        <input type="hidden" name="saleId" value={sale.id} />
                        <input type="hidden" name="currency" value={sale.currency} />
                        <h3 className="text-lg font-black text-emerald-950">{t("collections.recordPayment")}</h3>
                        <p className="mt-1 text-xs font-semibold text-emerald-800">{t("collections.recordPaymentHelp")}</p>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label><span className="text-sm font-bold">{t("collections.amount")}</span><input type="number" name="amount" min="0.01" max={Number(sale.balance_amount)} step="0.01" required className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                          <label><span className="text-sm font-bold">{t("collections.paymentDate")}</span><input type="date" name="paymentDate" defaultValue={today} required className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                          <label><span className="text-sm font-bold">{t("sales.paymentMethod")}</span><select name="paymentMethod" defaultValue="bank_transfer" className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5">{(["bank_transfer", "card", "cash", "mobile_money", "cheque", "other"] as const).map((value) => <option key={value} value={value}>{t(`sales.paymentMethods.${value}`)}</option>)}</select></label>
                          <label><span className="text-sm font-bold">{t("collections.transactionReference")}</span><input name="transactionReference" maxLength={160} className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                          <label className="sm:col-span-2"><span className="text-sm font-bold">{t("collections.scheduleItem")}</span><select name="scheduleItemId" defaultValue="" className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5"><option value="">{t("collections.noScheduleItem")}</option>{saleSchedules.filter((item) => !["paid", "cancelled"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>#{item.sequence_number} · {dateFormatter.format(new Date(`${item.due_date}T00:00:00Z`))} · {moneyFormatter(dateLocale, sale.currency).format(Number(item.expected_amount))}</option>)}</select></label>
                          <label className="sm:col-span-2"><span className="text-sm font-bold">{t("sales.proofUrl")}</span><input type="url" name="proofUrl" maxLength={1000} placeholder="https://..." className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                          <label className="sm:col-span-2"><span className="text-sm font-bold">{t("sales.notes")}</span><textarea name="notes" rows={2} maxLength={1500} className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" /></label>
                        </div>
                        <button className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 font-black text-white">{t("collections.submitPayment")}</button>
                      </form>
                    ) : null}
                  </div>

                  {canHandle && Number(sale.balance_amount) > 0 ? (
                    <form action={addPaymentScheduleItemAction} className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <input type="hidden" name="saleId" value={sale.id} />
                      <h3 className="text-lg font-black">{t("collections.addScheduleItem")}</h3>
                      <div className="mt-4 grid gap-4 md:grid-cols-[auto_auto_1fr_auto] md:items-end">
                        <label><span className="text-sm font-bold">{t("collections.dueDate")}</span><input type="date" name="dueDate" required className="mt-2 block rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
                        <label><span className="text-sm font-bold">{t("collections.expectedAmount")}</span><input type="number" name="expectedAmount" min="0.01" step="0.01" required className="mt-2 block rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
                        <label><span className="text-sm font-bold">{t("sales.notes")}</span><input name="notes" maxLength={1500} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" /></label>
                        <button className="rounded-xl bg-slate-950 px-5 py-2.5 font-black text-white">{t("collections.add")}</button>
                      </div>
                    </form>
                  ) : null}

                  <div className="mt-6 grid gap-6 xl:grid-cols-2">
                    <section>
                      <h3 className="text-lg font-black">{t("collections.paymentHistory", {count: salePayments.length})}</h3>
                      <div className="mt-3 space-y-3">
                        {salePayments.length ? salePayments.map((payment) => (
                          <article key={payment.id} className="rounded-2xl border border-slate-200 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-full px-3 py-1 text-xs font-black ${paymentStatusClasses[payment.status] ?? paymentStatusClasses.pending}`}>{t(`collections.paymentStatuses.${payment.status}`)}</span>
                                  {payment.is_initial_payment ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">{t("collections.commissionTrigger")}</span> : null}
                                </div>
                                <p className="mt-2 font-black">{moneyFormatter(dateLocale, payment.currency).format(Number(payment.amount))}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">{dateFormatter.format(new Date(`${payment.payment_date}T00:00:00Z`))} · {t(`sales.paymentMethods.${payment.payment_method}`)}{payment.transaction_reference ? ` · ${payment.transaction_reference}` : ""}</p>
                                {payment.proof_url ? <a href={payment.proof_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-indigo-700 underline">{t("sales.openProof")}</a> : null}
                              </div>
                              {isLeader && payment.status === "pending" ? (
                                <div className="flex flex-wrap gap-2">
                                  <form action={reviewCollectionPaymentAction}><input type="hidden" name="paymentId" value={payment.id} /><input type="hidden" name="decision" value="confirmed" /><button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white">{t("collections.confirm")}</button></form>
                                  <form action={reviewCollectionPaymentAction}><input type="hidden" name="paymentId" value={payment.id} /><input type="hidden" name="decision" value="rejected" /><button className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">{t("collections.reject")}</button></form>
                                </div>
                              ) : null}
                              {isLeader && payment.status === "confirmed" ? (
                                <form action={reviewCollectionPaymentAction}><input type="hidden" name="paymentId" value={payment.id} /><input type="hidden" name="decision" value="refunded" /><button className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-black text-violet-700">{t("collections.refund")}</button></form>
                              ) : null}
                            </div>
                          </article>
                        )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{t("collections.noPayments")}</p>}
                      </div>
                    </section>

                    <section>
                      <h3 className="text-lg font-black">{t("collections.paymentSchedule", {count: saleSchedules.length})}</h3>
                      <div className="mt-3 space-y-3">
                        {saleSchedules.length ? saleSchedules.map((item) => (
                          <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-black">#{item.sequence_number} · {dateFormatter.format(new Date(`${item.due_date}T00:00:00Z`))}</p>
                                <p className="mt-1 text-sm text-slate-600">{t("collections.scheduleAmounts", {expected: moneyFormatter(dateLocale, sale.currency).format(Number(item.expected_amount)), paid: moneyFormatter(dateLocale, sale.currency).format(Number(item.paid_amount))})}</p>
                              </div>
                              <span className={`rounded-full px-3 py-1 text-xs font-black ${collectionStatusClasses[item.status === "paid" ? "completed" : item.status === "overdue" ? "overdue" : "assigned"]}`}>{t(`collections.scheduleStatuses.${item.status}`)}</span>
                            </div>
                          </article>
                        )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{t("collections.noSchedule")}</p>}
                      </div>
                    </section>
                  </div>
                </div>
              </article>
            );
          }) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <h2 className="text-2xl font-black">{t("collections.noCasesTitle")}</h2>
              <p className="mt-2 text-slate-600">{isLeader ? t("collections.noCasesLeader") : t("collections.noCasesMember")}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
