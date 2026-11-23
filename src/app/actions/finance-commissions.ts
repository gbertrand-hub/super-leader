"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {canManageCommissions} from "@/lib/auth/sensitive-finance-access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

function clean(formData: FormData, key: string, max = 1500) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/commissions?${kind}=${encodeURIComponent(message)}`);
}

async function context() {
  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  if (!(await canManageCommissions(admin, membership.organization_id, authData.user.id, membership.role))) redirect("/dashboard/sales?error=access-denied");
  return {admin, user: authData.user, membership};
}

export async function decideSaleCommissionAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const saleId = clean(formData, "saleId", 50);
  const decision = clean(formData, "decision", 20);
  const justification = clean(formData, "justification");
  if (!saleId || !["eligible", "ineligible"].includes(decision ?? "") || !justification) go("La décision et sa justification sont obligatoires.", "error");

  const {data: sale, error: readError} = await admin.from("sales_records")
    .select("id,workflow_status,commission_review_status")
    .eq("organization_id", membership.organization_id).eq("id", saleId).maybeSingle<{id: string; workflow_status: string; commission_review_status: string}>();
  if (readError || !sale) go("Vente introuvable.", "error");
  if (sale.workflow_status !== "approved") go("Seule une vente approuvée peut être examinée par Finance.", "error");
  if (!["not_reviewed", "ineligible"].includes(sale.commission_review_status)) go("Cette vente a déjà fait l’objet d’une décision financière définitive.", "error");

  const now = new Date().toISOString();
  const values: Record<string, string | number | null> = {
    commission_review_status: decision,
    commission_reviewed_by: user.id,
    commission_reviewed_at: now,
    commission_justification: justification,
  };
  if (decision === "eligible") {
    const beneficiaryId = clean(formData, "beneficiaryId", 50);
    const policyReference = clean(formData, "policyReference", 300);
    const amount = Number(String(formData.get("amount") ?? "").replace(",", "."));
    if (!beneficiaryId || !policyReference || !Number.isFinite(amount) || amount <= 0) go("Bénéficiaire, montant et politique du PDG sont obligatoires.", "error");
    const {data: beneficiary} = await admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("user_id", beneficiaryId).eq("is_active", true).maybeSingle();
    if (!beneficiary) go("Le bénéficiaire n’est pas un membre actif de cette organisation.", "error");
    Object.assign(values, {commission_beneficiary_id: beneficiaryId, commission_amount: Math.round(amount * 100) / 100, commission_policy_reference: policyReference, commission_status: "payable"});
  } else {
    Object.assign(values, {commission_beneficiary_id: null, commission_amount: 0, commission_policy_reference: null, commission_status: "cancelled"});
  }

  const {data: updated, error} = await admin.from("sales_records").update(values).eq("organization_id", membership.organization_id).eq("id", saleId).eq("commission_review_status", sale.commission_review_status).select("id").maybeSingle();
  if (error) go(`Décision impossible : ${error.message}`, "error");
  if (!updated) go("La vente a déjà été traitée. Actualise la page.", "error");
  await admin.from("sales_audit_log").insert({organization_id: membership.organization_id, sale_id: saleId, actor_id: user.id, action: `finance_commission_${decision}`, old_status: sale.commission_review_status, new_status: decision, note: justification});
  revalidatePath("/dashboard/commissions");
  go(decision === "eligible" ? "Commission créée selon la décision de Finance." : "Vente classée non éligible.");
}

export async function paySaleCommissionAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const saleId = clean(formData, "saleId", 50);
  const paymentReference = clean(formData, "paymentReference", 200);
  if (!saleId || !paymentReference) go("La référence de paiement est obligatoire.", "error");
  const {data: updated, error} = await admin.from("sales_records").update({commission_review_status: "paid", commission_status: "paid", commission_paid_by: user.id, commission_paid_at: new Date().toISOString(), commission_payment_reference: paymentReference}).eq("organization_id", membership.organization_id).eq("id", saleId).eq("commission_review_status", "eligible").select("id").maybeSingle();
  if (error) go(`Paiement impossible : ${error.message}`, "error");
  if (!updated) go("Cette commission n’est pas payable ou a déjà été traitée.", "error");
  await admin.from("sales_audit_log").insert({organization_id: membership.organization_id, sale_id: saleId, actor_id: user.id, action: "finance_commission_paid", old_status: "eligible", new_status: "paid", note: paymentReference});
  revalidatePath("/dashboard/commissions");
  go("Paiement de la commission enregistré.");
}
