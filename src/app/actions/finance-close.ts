"use server";

import {createHash} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {calculateFinanceCloseSnapshot} from "@/lib/finance/period-close";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const clean = (value: FormDataEntryValue | null, max = 1000) => String(value ?? "").trim().slice(0, max);
const validDate = (value: FormDataEntryValue | null) => {const date = clean(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";};
const number = (value: FormDataEntryValue | null) => {const parsed = Number(clean(value).replace(",", ".")); return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;};
const nullableNumber = (value: FormDataEntryValue | null) => clean(value) === "" ? null : number(value);

function go(message: string, kind: "success" | "error" = "success", periodId = ""): never {
  redirect(`/dashboard/finance/close?${periodId ? `period=${encodeURIComponent(periodId)}&` : ""}${kind}=${encodeURIComponent(message)}`);
}

async function context() {
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", auth.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if (!membership || !["owner", "admin"].includes(membership.role)) redirect("/dashboard?error=access-denied");
  return {admin, user: auth.user, membership};
}

type ClosePeriod = {
  id:string; period_start:string; period_end:string; currency:string; status:string;
  opening_bank_balance:number|string; declared_closing_bank_balance:number|string|null;
};

async function period(c: Awaited<ReturnType<typeof context>>, id: string) {
  const {data} = await c.admin.from("finance_close_periods").select("id,period_start,period_end,currency,status,opening_bank_balance,declared_closing_bank_balance").eq("id", id).eq("organization_id", c.membership.organization_id).maybeSingle<ClosePeriod>();
  if (!data) go("Période de clôture introuvable.", "error");
  return data;
}

async function audit(c: Awaited<ReturnType<typeof context>>, periodId: string, action: string, details: Record<string, unknown> = {}) {
  const {error} = await c.admin.from("finance_close_audit_log").insert({organization_id: c.membership.organization_id, period_id: periodId, actor_id: c.user.id, action, details});
  if (error) console.error("Finance close audit failed", error);
}

async function refreshSnapshot(c: Awaited<ReturnType<typeof context>>, current: ClosePeriod) {
  const snapshot = await calculateFinanceCloseSnapshot(c.admin, c.membership.organization_id, {
    from: current.period_start,
    to: current.period_end,
    currency: current.currency,
    openingBankBalance: Number(current.opening_bank_balance) || 0,
    declaredClosingBankBalance: current.declared_closing_bank_balance === null ? null : Number(current.declared_closing_bank_balance),
  });
  const nextStatus = current.status === "closed" ? "closed" : snapshot.ready ? "ready" : current.status === "reopened" ? "reopened" : "in_review";
  const now = new Date().toISOString();
  const {error} = await c.admin.from("finance_close_periods").update({status: nextStatus, incoming_snapshot: snapshot.incoming, outgoing_snapshot: snapshot.outgoing, net_snapshot: snapshot.net, calculated_closing_balance: snapshot.calculatedClosingBalance, variance_snapshot: snapshot.variance, checks_snapshot: snapshot.checks, last_checked_by: c.user.id, last_checked_at: now, updated_at: now}).eq("id", current.id).eq("organization_id", c.membership.organization_id).neq("status", "closed");
  if (error && current.status !== "closed") go(error.message, "error", current.id);
  return snapshot;
}

export async function createFinanceClosePeriodAction(formData: FormData) {
  const c = await context();
  const label = clean(formData.get("label"), 160), from = validDate(formData.get("from")), to = validDate(formData.get("to")), currency = clean(formData.get("currency"), 3).toUpperCase(), requestedOpening = number(formData.get("openingBankBalance")), closing = nullableNumber(formData.get("declaredClosingBankBalance")), notes = clean(formData.get("notes"), 2000) || null;
  const useCarryForward = formData.get("useCarryForward") === "yes";
  let opening = requestedOpening;
  let openingSourcePeriodId: string | null = null;
  if (useCarryForward && from && /^[A-Z]{3}$/.test(currency)) {
    const {data: prior} = await c.admin.from("finance_close_periods")
      .select("id,calculated_closing_balance")
      .eq("organization_id", c.membership.organization_id).eq("currency", currency).eq("status", "closed")
      .lt("period_end", from).order("period_end", {ascending:false}).limit(1)
      .maybeSingle<{id:string;calculated_closing_balance:number|string}>();
    if (prior) {
      opening = Number(prior.calculated_closing_balance) || 0;
      openingSourcePeriodId = prior.id;
    }
  }
  if (label.length < 2 || !from || !to || from > to || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(opening) || (closing !== null && !Number.isFinite(closing))) go("Vérifiez le nom, les dates, la devise et les soldes.", "error");
  const {data: overlap} = await c.admin.from("finance_close_periods").select("id").eq("organization_id", c.membership.organization_id).eq("currency", currency).lte("period_start", to).gte("period_end", from).neq("status", "archived").limit(1);
  if (overlap?.length) go("Cette période chevauche une clôture existante dans la même devise.", "error");
  const {data, error} = await c.admin.from("finance_close_periods").insert({organization_id: c.membership.organization_id, label, period_start: from, period_end: to, currency, opening_bank_balance: opening, opening_source_period_id: openingSourcePeriodId, declared_closing_bank_balance: closing, notes, created_by: c.user.id}).select("id,period_start,period_end,currency,status,opening_bank_balance,declared_closing_bank_balance").single<ClosePeriod>();
  if (error || !data) go(error?.message ?? "Création impossible.", "error");
  await audit(c, data.id, "created", {label, from, to, currency, opening, closing, openingSourcePeriodId});
  await refreshSnapshot(c, data);
  revalidatePath("/dashboard/finance/close");
  go("Période créée et contrôlée.", "success", data.id);
}

export async function updateFinanceCloseBalancesAction(formData: FormData) {
  const c = await context(), id = clean(formData.get("periodId"), 80), opening = number(formData.get("openingBankBalance")), closing = nullableNumber(formData.get("declaredClosingBankBalance")), notes = clean(formData.get("notes"), 2000) || null;
  const current = await period(c, id);
  if (current.status === "closed" || !Number.isFinite(opening) || (closing !== null && !Number.isFinite(closing))) go("Cette clôture ne peut pas être modifiée.", "error", id);
  const {error} = await c.admin.from("finance_close_periods").update({opening_bank_balance: opening, declared_closing_bank_balance: closing, notes, updated_at: new Date().toISOString()}).eq("id", id).eq("organization_id", c.membership.organization_id).neq("status", "closed");
  if (error) go(error.message, "error", id);
  await audit(c, id, "balances_updated", {opening, closing});
  await refreshSnapshot(c, {...current, opening_bank_balance: opening, declared_closing_bank_balance: closing});
  revalidatePath("/dashboard/finance/close");
  go("Soldes enregistrés et contrôles actualisés.", "success", id);
}

export async function refreshFinanceCloseAction(formData: FormData) {
  const c = await context(), id = clean(formData.get("periodId"), 80), current = await period(c, id);
  if (current.status === "closed") go("La période est déjà clôturée.", "error", id);
  const snapshot = await refreshSnapshot(c, current);
  await audit(c, id, "checks_refreshed", {ready: snapshot.ready, variance: snapshot.variance});
  revalidatePath("/dashboard/finance/close");
  go(snapshot.ready ? "Tous les contrôles sont validés." : "Contrôles actualisés : des points restent à traiter.", "success", id);
}

export async function closeFinancePeriodAction(formData: FormData) {
  const c = await context(), id = clean(formData.get("periodId"), 80);
  if (c.membership.role !== "owner") go("Seul le propriétaire peut prononcer la clôture finale.", "error", id);
  if (!["bankStatement", "documentsComplete", "lockAcknowledged"].every(key => formData.get(key) === "yes")) go("Les trois confirmations de clôture sont obligatoires.", "error", id);
  const current = await period(c, id);
  if (current.status === "closed") go("Cette période est déjà clôturée.", "error", id);
  const snapshot = await refreshSnapshot(c, current);
  if (!snapshot.ready) go("La clôture est bloquée tant que tous les contrôles ne sont pas validés.", "error", id);
  const now = new Date().toISOString();
  const certificateNumber = `CLT-${current.period_end.replaceAll("-", "")}-${id.slice(-6).toUpperCase()}`;
  const certificateHash = createHash("sha256").update(JSON.stringify({
    id, organizationId:c.membership.organization_id, from:current.period_start, to:current.period_end,
    currency:current.currency, opening:Number(current.opening_bank_balance)||0, incoming:snapshot.incoming,
    outgoing:snapshot.outgoing, calculatedClosingBalance:snapshot.calculatedClosingBalance,
    declaredClosingBalance:current.declared_closing_bank_balance === null ? null : Number(current.declared_closing_bank_balance),
    variance:snapshot.variance, closedAt:now, closedBy:c.user.id,
  })).digest("hex");
  const {data, error} = await c.admin.from("finance_close_periods").update({status: "closed", closed_by: c.user.id, closed_at: now, certificate_number: certificateNumber, certificate_hash: certificateHash, certificate_issued_at: now, updated_at: now}).eq("id", id).eq("organization_id", c.membership.organization_id).neq("status", "closed").select("id").maybeSingle();
  if (error || !data) go(error?.message ?? "Clôture concurrente détectée.", "error", id);
  await audit(c, id, "closed", {incoming: snapshot.incoming, outgoing: snapshot.outgoing, calculatedClosingBalance: snapshot.calculatedClosingBalance, variance: snapshot.variance, certificateNumber, certificateHash, confirmations: ["bank_statement", "documents_complete", "lock_acknowledged"]});
  revalidatePath("/dashboard/finance/close");
  revalidatePath(`/dashboard/finance/close/${id}/certificate`);
  go("Période clôturée et mouvements verrouillés.", "success", id);
}

export async function reopenFinancePeriodAction(formData: FormData) {
  const c = await context(), id = clean(formData.get("periodId"), 80), reason = clean(formData.get("reason"), 1500);
  if (c.membership.role !== "owner") go("Seul le propriétaire peut rouvrir une période.", "error", id);
  if (reason.length < 10) go("Un motif détaillé de réouverture est obligatoire.", "error", id);
  const current = await period(c, id);
  if (current.status !== "closed") go("Seule une période clôturée peut être rouverte.", "error", id);
  const now = new Date().toISOString();
  const {data, error} = await c.admin.from("finance_close_periods").update({status: "reopened", reopened_by: c.user.id, reopened_at: now, reopen_reason: reason, updated_at: now}).eq("id", id).eq("organization_id", c.membership.organization_id).eq("status", "closed").select("id").maybeSingle();
  if (error || !data) go(error?.message ?? "Réouverture impossible.", "error", id);
  await audit(c, id, "reopened", {reason});
  revalidatePath("/dashboard/finance/close");
  go("Période rouverte exceptionnellement. L’action est journalisée.", "success", id);
}
