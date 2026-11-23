import type {SupabaseClient} from "@supabase/supabase-js";

export type ReceivableSource = "sale" | "customer_service";
export type ReceivableCase = {
  key: string;
  source: ReceivableSource;
  sourceId: string;
  customer: string;
  product: string;
  currency: string;
  outstanding: number;
  dueDate: string | null;
  daysLate: number;
  ownerId: string | null;
  ownerName: string;
  promiseDate: string | null;
  nextActionAt: string | null;
  lastContactAt: string | null;
  status: string;
  riskScore: number;
  brokenPromise: boolean;
  operationalUrl: string;
};

const n = (value: unknown) => Number(value) || 0;
const rows = <T>(result: {data: T[] | null; error: unknown}) => result.error ? [] : result.data ?? [];
const dayDiff = (today: string, date: string | null) => date
  ? Math.max(0, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000))
  : 0;

function score(item: Pick<ReceivableCase, "daysLate" | "outstanding" | "ownerId" | "nextActionAt" | "brokenPromise">) {
  return Math.min(100,
    (item.daysLate >= 90 ? 50 : item.daysLate >= 60 ? 40 : item.daysLate >= 30 ? 30 : item.daysLate > 0 ? 15 : 0) +
    (item.brokenPromise ? 25 : 0) +
    (!item.ownerId ? 15 : 0) +
    (!item.nextActionAt ? 10 : 0),
  );
}

export async function loadFinanceReceivables(admin: SupabaseClient, organizationId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [salesResult, installmentsResult, contractsResult, clientsResult, servicePaymentsResult, serviceFollowUpsResult] = await Promise.all([
    admin.from("sales_records").select("id,customer_name,product_name,currency,balance_amount,next_payment_due_date,collection_owner_id,collection_status,collection_promise_date,collection_next_action_at,collection_last_contact_at").eq("organization_id", organizationId).gt("balance_amount", 0).not("workflow_status", "in", "(rejected,cancelled,refunded)").limit(500),
    admin.from("customer_service_installments").select("id,client_id,contract_id,due_date,expected_amount,currency,status,assigned_to,promise_date").eq("organization_id", organizationId).not("status", "in", "(paid,deferred,waived)").limit(500),
    admin.from("crm_contracts").select("id,sale_id,title,product_name").eq("organization_id", organizationId).limit(1000),
    admin.from("crm_clients").select("id,full_name").eq("organization_id", organizationId).limit(1500),
    admin.from("customer_service_installment_payments").select("installment_id,amount_received,finance_status").eq("organization_id", organizationId).eq("finance_status", "validated").limit(2000),
    admin.from("customer_service_follow_ups").select("installment_id,next_action_at,created_at").eq("organization_id", organizationId).order("created_at", {ascending: false}).limit(2000),
  ]);

  if (salesResult.error) throw new Error(salesResult.error.message);
  const sales = rows(salesResult) as Array<Record<string, unknown>>;
  const installments = rows(installmentsResult) as Array<Record<string, unknown>>;
  const contracts = rows(contractsResult) as Array<Record<string, unknown>>;
  const clients = rows(clientsResult) as Array<Record<string, unknown>>;
  const servicePayments = rows(servicePaymentsResult) as Array<Record<string, unknown>>;
  const serviceFollowUps = rows(serviceFollowUpsResult) as Array<Record<string, unknown>>;
  const saleIds = new Set(sales.map(item => String(item.id)));
  const contractById = new Map(contracts.map(item => [String(item.id), item]));
  const clientById = new Map(clients.map(item => [String(item.id), String(item.full_name ?? "Client") ]));
  const paidByInstallment = new Map<string, number>();
  servicePayments.forEach(item => paidByInstallment.set(String(item.installment_id), (paidByInstallment.get(String(item.installment_id)) ?? 0) + n(item.amount_received)));
  const latestFollowUp = new Map<string, Record<string, unknown>>();
  serviceFollowUps.forEach(item => { if (!latestFollowUp.has(String(item.installment_id))) latestFollowUp.set(String(item.installment_id), item); });

  const ownerIds = [...new Set([
    ...sales.map(item => item.collection_owner_id),
    ...installments.map(item => item.assigned_to),
  ].filter(Boolean).map(String))];
  const {data: profiles} = ownerIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", ownerIds)
    : {data: []};
  const ownerNames = new Map((profiles ?? []).map(item => [String(item.id), String(item.full_name || item.email || "Membre") ]));

  const cases: ReceivableCase[] = sales.map(item => {
    const dueDate = item.next_payment_due_date ? String(item.next_payment_due_date) : null;
    const promiseDate = item.collection_promise_date ? String(item.collection_promise_date) : null;
    const ownerId = item.collection_owner_id ? String(item.collection_owner_id) : null;
    const nextActionAt = item.collection_next_action_at ? String(item.collection_next_action_at) : null;
    const base = {
      key: `sale:${item.id}`,
      source: "sale" as const,
      sourceId: String(item.id),
      customer: String(item.customer_name || "Client"),
      product: String(item.product_name || "Vente"),
      currency: String(item.currency || "USD"),
      outstanding: n(item.balance_amount),
      dueDate,
      daysLate: dayDiff(today, dueDate && dueDate < today ? dueDate : null),
      ownerId,
      ownerName: ownerId ? ownerNames.get(ownerId) ?? "Membre" : "Non affecté",
      promiseDate,
      nextActionAt,
      lastContactAt: item.collection_last_contact_at ? String(item.collection_last_contact_at) : null,
      status: String(item.collection_status || "not_started"),
      brokenPromise: Boolean(promiseDate && promiseDate < today && n(item.balance_amount) > 0),
      operationalUrl: `/dashboard/collections?sale=${item.id}`,
    };
    return {...base, riskScore: score(base)};
  });

  installments.forEach(item => {
    const contract = item.contract_id ? contractById.get(String(item.contract_id)) : null;
    if (contract?.sale_id && saleIds.has(String(contract.sale_id))) return;
    const outstanding = Math.max(0, n(item.expected_amount) - (paidByInstallment.get(String(item.id)) ?? 0));
    if (outstanding <= 0) return;
    const dueDate = item.due_date ? String(item.due_date) : null;
    const promiseDate = item.promise_date ? String(item.promise_date) : null;
    const ownerId = item.assigned_to ? String(item.assigned_to) : null;
    const followUp = latestFollowUp.get(String(item.id));
    const nextActionAt = followUp?.next_action_at ? String(followUp.next_action_at) : null;
    const base = {
      key: `customer-service:${item.id}`,
      source: "customer_service" as const,
      sourceId: String(item.id),
      customer: clientById.get(String(item.client_id)) ?? "Client",
      product: String(contract?.product_name || contract?.title || "Mensualité client"),
      currency: String(item.currency || "USD"),
      outstanding,
      dueDate,
      daysLate: dayDiff(today, dueDate && dueDate < today ? dueDate : null),
      ownerId,
      ownerName: ownerId ? ownerNames.get(ownerId) ?? "Membre" : "Non affecté",
      promiseDate,
      nextActionAt,
      lastContactAt: followUp?.created_at ? String(followUp.created_at) : null,
      status: String(item.status || "upcoming"),
      brokenPromise: Boolean(promiseDate && promiseDate < today),
      operationalUrl: `/dashboard/customer-service/follow-up?item=${item.id}`,
    };
    cases.push({...base, riskScore: score(base)});
  });

  return cases.sort((a, b) => b.riskScore - a.riskScore || b.daysLate - a.daysLate || b.outstanding - a.outstanding);
}
