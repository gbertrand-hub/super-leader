import {NextResponse} from "next/server";
import {verifyCronRequest} from "@/lib/crm/webhook-security";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContractRow = {id: string; organization_id: string; internal_owner_user_id: string; end_date: string; status: string};
type SignalRow = {contract_id: string; status: string};
type DeliverableRow = SignalRow & {due_date: string};
type IncidentRow = SignalRow & {severity: string};
type FinancialRow = SignalRow & {gate_status: string};

const CLOSED_CONTRACTS = new Set(["completed", "terminated"]);
const CLOSED_DELIVERABLES = new Set(["accepted", "cancelled"]);
const CLOSED_INCIDENTS = new Set(["resolved", "closed"]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(date: string) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - today) / 86400000);
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return NextResponse.json({ok: false, error: "Unauthorized"}, {status: 401});
  const weekday = new Date().getUTCDay();
  if (weekday === 0 || weekday === 6) return NextResponse.json({ok: true, skipped: "weekend"});

  const admin = createAdminClient();
  const contractResult = await admin.from("service_contracts")
    .select("id,organization_id,internal_owner_user_id,end_date,status")
    .not("internal_owner_user_id", "is", null);
  if (contractResult.error) throw contractResult.error;
  const contracts = ((contractResult.data ?? []) as ContractRow[]).filter((row) => !CLOSED_CONTRACTS.has(row.status));
  if (!contracts.length) return NextResponse.json({ok: true, digests: 0});

  const contractIds = contracts.map((row) => row.id);
  const [reportResult, deliverableResult, incidentResult, financialResult] = await Promise.all([
    admin.from("service_contract_reports").select("contract_id,status").in("contract_id", contractIds).eq("status", "submitted"),
    admin.from("service_contract_deliverables").select("contract_id,due_date,status").in("contract_id", contractIds),
    admin.from("service_contract_incidents").select("contract_id,severity,status").in("contract_id", contractIds),
    admin.from("service_contract_financial_items").select("contract_id,gate_status,status").in("contract_id", contractIds),
  ]);
  const firstError = [reportResult, deliverableResult, incidentResult, financialResult].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  const reports = (reportResult.data ?? []) as SignalRow[];
  const deliverables = (deliverableResult.data ?? []) as DeliverableRow[];
  const incidents = (incidentResult.data ?? []) as IncidentRow[];
  const financial = (financialResult.data ?? []) as FinancialRow[];
  const today = todayIso();
  const contractById = new Map(contracts.map((row) => [row.id, row]));
  const ownerSignals = new Map<string, {organizationId: string; reports: number; deliverables: number; incidents: number; payments: number; renewals: number}>();

  const signalFor = (contractId: string) => {
    const contract = contractById.get(contractId);
    if (!contract) return null;
    const key = `${contract.organization_id}:${contract.internal_owner_user_id}`;
    const current = ownerSignals.get(key) ?? {organizationId: contract.organization_id, reports: 0, deliverables: 0, incidents: 0, payments: 0, renewals: 0};
    ownerSignals.set(key, current);
    return current;
  };

  for (const row of reports) {const signal = signalFor(row.contract_id); if (signal) signal.reports += 1;}
  for (const row of deliverables) {if (row.due_date < today && !CLOSED_DELIVERABLES.has(row.status)) {const signal = signalFor(row.contract_id); if (signal) signal.deliverables += 1;}}
  for (const row of incidents) {if (["critical", "high"].includes(row.severity) && !CLOSED_INCIDENTS.has(row.status)) {const signal = signalFor(row.contract_id); if (signal) signal.incidents += 1;}}
  for (const row of financial) {if (row.gate_status === "blocked" || row.status === "held") {const signal = signalFor(row.contract_id); if (signal) signal.payments += 1;}}
  for (const contract of contracts) {if (daysUntil(contract.end_date) <= 90) {const signal = signalFor(contract.id); if (signal) signal.renewals += 1;}}

  let digests = 0;
  for (const [key, signal] of ownerSignals) {
    const total = signal.reports + signal.deliverables + signal.incidents + signal.payments + signal.renewals;
    if (!total) continue;
    const userId = key.split(":")[1];
    const summaryFr = `${signal.reports} rapport(s), ${signal.deliverables} livrable(s) en retard, ${signal.incidents} incident(s) élevé(s), ${signal.payments} paiement(s) bloqué(s), ${signal.renewals} renouvellement(s).`;
    const summaryEn = `${signal.reports} report(s), ${signal.deliverables} overdue deliverable(s), ${signal.incidents} high incident(s), ${signal.payments} blocked payment(s), ${signal.renewals} renewal(s).`;
    const id = await createNotification({
      organizationId: signal.organizationId,
      userId,
      category: "performance",
      eventType: "contract_owner_daily_digest",
      titleFr: "Vos priorités contractuelles du jour",
      titleEn: "Your contract priorities for today",
      bodyFr: summaryFr,
      bodyEn: summaryEn,
      actionUrl: "/dashboard/contracts",
      priority: signal.incidents || signal.payments ? "urgent" : "warning",
      requiresAction: true,
      dedupeKey: `contract-digest:${today}:${signal.organizationId}:${userId}`,
      metadata: signal,
      emailRequested: true,
    });
    if (id) digests += 1;
  }

  return NextResponse.json({ok: true, digests, processedAt: new Date().toISOString()});
}
