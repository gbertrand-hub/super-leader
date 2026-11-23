"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canEditFinance, getAcademyAssignments, type AcademyAssignment } from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const clean = (value: FormDataEntryValue | null, max = 5000) => String(value ?? "").trim().slice(0, max);
const asUuid = (value: FormDataEntryValue | null) => {
  const v = clean(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : "";
};
const asAmount = (value: FormDataEntryValue | null) => Math.max(0, Number(clean(value, 40).replace(",", ".")) || 0);
const asDate = (value: FormDataEntryValue | null) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value, 20)) ? clean(value, 20) : "";
const asCurrency = (value: FormDataEntryValue | null) => (clean(value, 3) || "USD").toUpperCase();
const allowedMethods = new Set(["cash", "bank_transfer", "card", "mobile_money", "check", "other"]);

type Membership = { organization_id: string; role: string };
type Ctx = {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  membership: Membership;
  assignments: AcademyAssignment[];
};
type Enrollment = { id: string; school_id: string; crm_client_id: string | null; user_id: string | null };

async function context(organizationId: string): Promise<Ctx> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("organization_id", organizationId)
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  const assignments = await getAcademyAssignments(admin, organizationId, data.user.id);
  return { admin, userId: data.user.id, membership, assignments };
}

function backPath(organizationId: string, returnQ: string, kind: "success" | "error", message: string) {
  const query = new URLSearchParams({ organization: organizationId, [kind]: message });
  if (returnQ) query.set("q", returnQ);
  return `/dashboard/academy/students/finance-control?${query.toString()}`;
}

function go(organizationId: string, returnQ: string, message: string, kind: "success" | "error" = "success"): never {
  revalidatePath("/dashboard/academy/students/finance-control");
  revalidatePath("/dashboard/academy/students/finance");
  revalidatePath("/dashboard/academy/students");
  redirect(backPath(organizationId, returnQ, kind, message));
}

async function enrollment(ctx: Ctx, organizationId: string, enrollmentId: string) {
  const { data } = await ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id,crm_client_id,user_id")
    .eq("organization_id", organizationId)
    .eq("id", enrollmentId)
    .maybeSingle<Enrollment>();
  return data ?? null;
}

function assertFinanceEdit(ctx: Ctx, row: Enrollment | null, organizationId: string, returnQ: string) {
  if (!row || !canEditFinance(ctx.membership.role, ctx.assignments, String(row.school_id))) {
    go(organizationId, returnQ, "Action financière non autorisée sur cette inscription.", "error");
  }
}

async function subjectEnrollments(ctx: Ctx, organizationId: string, subjectType: string, subjectId: string) {
  let query = ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id,crm_client_id,user_id")
    .eq("organization_id", organizationId);
  query = subjectType === "crm" ? query.eq("crm_client_id", subjectId) : query.eq("user_id", subjectId);
  const { data } = await query;
  return (data ?? []) as Enrollment[];
}

async function ensureAccount(ctx: Ctx, organizationId: string, subjectType: string, subjectId: string) {
  const dbType = subjectType === "crm" ? "crm_client" : "user";
  const { data, error } = await ctx.admin
    .from("academy_student_accounts")
    .upsert(
      { organization_id: organizationId, subject_type: dbType, subject_id: subjectId, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,subject_type,subject_id" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(error?.message ?? "Compte financier étudiant impossible à créer.");
  return data.id;
}

async function audit(ctx: Ctx, organizationId: string, entityType: string, entityId: string | null, action: string, data: Record<string, unknown>) {
  const { error } = await ctx.admin.from("academy_pricing_audit_log").insert({
    organization_id: organizationId,
    actor_id: ctx.userId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    after_data: { version: "4.10.124", source: "student_finance_control_center", ...data },
  });
  if (error) console.error("Student Finance Control Center audit failed", error);
}

export async function repairStudentFinanceRecordAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const enrollmentId = asUuid(formData.get("enrollment_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  if (!organizationId || !enrollmentId) redirect("/dashboard/academy/students");
  const ctx = await context(organizationId);
  const row = await enrollment(ctx, organizationId, enrollmentId);
  assertFinanceEdit(ctx, row, organizationId, returnQ);

  const { data, error } = await ctx.admin.rpc("repair_academy_student_finance_v118", {
    target_organization_id: organizationId,
    target_enrollment_id: enrollmentId,
    target_actor_id: ctx.userId,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  const result = (data ?? {}) as Record<string, unknown>;
  const status = String(result.status ?? "");
  if (status === "no_tariff") {
    go(organizationId, returnQ, "Aucun tarif homologué n’est disponible pour cette inscription. Configurez d’abord le programme/cohorte et son tarif.", "error");
  }
  await audit(ctx, organizationId, "student_finance", enrollmentId, "finance_record_repaired", result);
  go(organizationId, returnQ, status === "already_present" ? "La fiche financière existe déjà." : "Fiche financière créée/réparée et rattachée à l’accord actif.");
}

export async function recordStudentPaymentFromControlAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const subjectType = clean(formData.get("subject_type"), 10);
  const subjectId = asUuid(formData.get("subject_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  const total = asAmount(formData.get("amount"));
  const paymentCurrency = asCurrency(formData.get("currency"));
  const allocationEnrollmentId = asUuid(formData.get("allocation_enrollment_id"));
  const requestedAllocationAmount = asAmount(formData.get("allocation_amount"));
  const paidOn = asDate(formData.get("paid_on")) || new Date().toISOString().slice(0, 10);
  if (!organizationId || !subjectId || !["crm", "user"].includes(subjectType)) redirect("/dashboard/academy/students");
  if (total <= 0) go(organizationId, returnQ, "Le paiement doit être supérieur à zéro.", "error");
  if (!/^[A-Z]{3}$/.test(paymentCurrency)) go(organizationId, returnQ, "Devise invalide.", "error");
  if (paidOn > new Date().toISOString().slice(0, 10)) go(organizationId, returnQ, "Un paiement reçu ne peut pas être daté dans le futur. Pour un montant attendu, créez une échéance.", "error");
  const allocationAmount = allocationEnrollmentId && requestedAllocationAmount <= 0 ? total : requestedAllocationAmount;
  if (allocationAmount > total + 0.0001) go(organizationId, returnQ, "L’allocation ne peut pas dépasser le paiement.", "error");

  const ctx = await context(organizationId);
  const rows = await subjectEnrollments(ctx, organizationId, subjectType, subjectId);
  const editable = rows.filter((r) => canEditFinance(ctx.membership.role, ctx.assignments, String(r.school_id)));
  if (!editable.length) go(organizationId, returnQ, "Aucun périmètre financier modifiable pour cet étudiant.", "error");
  if (allocationEnrollmentId && !editable.some((r) => r.id === allocationEnrollmentId)) {
    go(organizationId, returnQ, "L’inscription sélectionnée n’est pas modifiable par votre rôle.", "error");
  }
  if (allocationAmount > 0 && !allocationEnrollmentId) go(organizationId, returnQ, "Choisissez l’inscription à laquelle affecter le paiement.", "error");

  const method = clean(formData.get("payment_method"), 30) || "other";
  if (!allowedMethods.has(method)) go(organizationId, returnQ, "Méthode de paiement invalide.", "error");
  const accountId = await ensureAccount(ctx, organizationId, subjectType, subjectId);
  const confirmed = clean(formData.get("bank_confirmed"), 10) === "on";
  const allocations = allocationEnrollmentId && allocationAmount > 0
    ? [{ enrollment_id: allocationEnrollmentId, amount: allocationAmount }]
    : [];

  const { data: paymentId, error } = await ctx.admin.rpc("record_academy_consolidated_payment", {
    target_organization_id: organizationId,
    target_account_id: accountId,
    payment_amount: total,
    payment_currency: paymentCurrency,
    payment_paid_on: paidOn,
    payment_method_value: method,
    payment_reference: clean(formData.get("reference"), 160),
    payment_notes: clean(formData.get("notes"), 2000),
    payment_status_value: confirmed ? "confirmed" : "declared",
    payment_allocations: allocations,
    target_actor_id: ctx.userId,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  await audit(ctx, organizationId, "student_global_payment", String(paymentId ?? "") || null, confirmed ? "payment_recorded_confirmed" : "payment_recorded_declared", {
    amount: total,
    currency: paymentCurrency,
    allocated: allocationAmount,
    subject_type: subjectType,
    subject_id: subjectId,
  });
  go(organizationId, returnQ, confirmed ? "Paiement confirmé enregistré. Les soldes ont été recalculés." : "Paiement enregistré en attente de confirmation bancaire.");
}

export async function confirmStudentPaymentFromControlAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const paymentId = asUuid(formData.get("payment_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  if (!organizationId || !paymentId) redirect("/dashboard/academy/students");
  const ctx = await context(organizationId);
  const { data: payment } = await ctx.admin
    .from("academy_student_global_payments")
    .select("id,account_id,status,paid_on,source")
    .eq("organization_id", organizationId)
    .eq("id", paymentId)
    .maybeSingle<{ id: string; account_id: string; status: string; paid_on: string; source: string }>();
  if (!payment) go(organizationId, returnQ, "Paiement introuvable.", "error");
  if (payment.status === "confirmed") go(organizationId, returnQ, "Ce paiement est déjà confirmé.");
  if (String(payment.paid_on || "") > new Date().toISOString().slice(0, 10)) go(organizationId, returnQ, "Impossible de confirmer un paiement daté dans le futur. Corrigez la date ou utilisez un échéancier.", "error");

  const { data: account } = await ctx.admin
    .from("academy_student_accounts")
    .select("subject_type,subject_id")
    .eq("organization_id", organizationId)
    .eq("id", payment.account_id)
    .maybeSingle<{ subject_type: string; subject_id: string }>();
  if (!account) go(organizationId, returnQ, "Compte financier étudiant introuvable.", "error");
  const rows = await subjectEnrollments(ctx, organizationId, account.subject_type === "crm_client" ? "crm" : "user", account.subject_id);
  if (!rows.some((r) => canEditFinance(ctx.membership.role, ctx.assignments, String(r.school_id)))) {
    go(organizationId, returnQ, "Confirmation bancaire non autorisée.", "error");
  }

  const { error } = await ctx.admin
    .from("academy_student_global_payments")
    .update({ status: "confirmed", confirmed_by: ctx.userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", paymentId);
  if (error) go(organizationId, returnQ, error.message, "error");
  await audit(ctx, organizationId, "student_global_payment", paymentId, "payment_bank_confirmed", {});
  go(organizationId, returnQ, "Paiement confirmé. Les allocations alimentent maintenant les soldes Academy.");
}

export async function cancelStudentPaymentFromControlAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const paymentId = asUuid(formData.get("payment_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  const reason = clean(formData.get("reason"), 500);
  if (!organizationId || !paymentId) redirect("/dashboard/academy/students");
  if (reason.length < 10) go(organizationId, returnQ, "Expliquez la raison de l’annulation en au moins 10 caractères.", "error");

  const ctx = await context(organizationId);
  const { data: payment } = await ctx.admin
    .from("academy_student_global_payments")
    .select("id,account_id,status,source")
    .eq("organization_id", organizationId)
    .eq("id", paymentId)
    .maybeSingle<{ id: string; account_id: string; status: string; source: string }>();
  if (!payment) go(organizationId, returnQ, "Paiement introuvable.", "error");
  if (payment.source !== "manual") go(organizationId, returnQ, "Seuls les paiements manuels peuvent être annulés ici. Corrigez les paiements Sales/CRM dans leur module d’origine.", "error");
  if (!["declared", "confirmed"].includes(payment.status)) go(organizationId, returnQ, "Ce paiement n’est plus annulable depuis le Centre.", "error");

  const { data: account } = await ctx.admin
    .from("academy_student_accounts")
    .select("subject_type,subject_id")
    .eq("organization_id", organizationId)
    .eq("id", payment.account_id)
    .maybeSingle<{ subject_type: string; subject_id: string }>();
  if (!account) go(organizationId, returnQ, "Compte financier étudiant introuvable.", "error");

  const { data: allocations } = await ctx.admin
    .from("academy_student_payment_allocations")
    .select("enrollment_id")
    .eq("organization_id", organizationId)
    .eq("payment_id", paymentId);
  const allocatedEnrollmentIds = [...new Set((allocations ?? []).map((x: any) => String(x.enrollment_id)).filter(Boolean))];
  if (allocatedEnrollmentIds.length) {
    for (const enrollmentId of allocatedEnrollmentIds) {
      const row = await enrollment(ctx, organizationId, enrollmentId);
      assertFinanceEdit(ctx, row, organizationId, returnQ);
    }
  } else {
    const rows = await subjectEnrollments(ctx, organizationId, account.subject_type === "crm_client" ? "crm" : "user", account.subject_id);
    if (!rows.some((r) => canEditFinance(ctx.membership.role, ctx.assignments, String(r.school_id)))) {
      go(organizationId, returnQ, "Annulation non autorisée pour ce paiement.", "error");
    }
  }

  const { data, error } = await ctx.admin.rpc("cancel_academy_student_payment_v120", {
    target_organization_id: organizationId,
    target_payment_id: paymentId,
    target_actor_id: ctx.userId,
    target_reason: reason,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  const result = (data ?? {}) as Record<string, unknown>;
  go(organizationId, returnQ, `Paiement annulé avec traçabilité. ${Number(result.allocations_affected ?? 0)} affectation(s) neutralisée(s) et soldes recalculés.`);
}


export async function reconcileStudentAcademySalesPaymentAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const salesPaymentId = asUuid(formData.get("sales_payment_id"));
  const enrollmentId = asUuid(formData.get("enrollment_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  if (!organizationId || !salesPaymentId || !enrollmentId) redirect("/dashboard/academy/students");
  const ctx = await context(organizationId);
  const row = await enrollment(ctx, organizationId, enrollmentId);
  assertFinanceEdit(ctx, row, organizationId, returnQ);

  const { data, error } = await ctx.admin.rpc("reconcile_academy_sales_payment_v124", {
    target_organization_id: organizationId,
    target_sales_payment_id: salesPaymentId,
    target_enrollment_id: enrollmentId,
    target_actor_id: ctx.userId,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  const result = (data ?? {}) as Record<string, unknown>;
  const status = String(result.status ?? "");
  if (status === "already_reconciled") {
    go(organizationId, returnQ, "Ce paiement Sales est déjà rapproché. Aucune duplication n’a été créée.");
  }
  const amount = Number(result.amount ?? 0);
  const currency = String(result.currency ?? "USD");
  const allocated = Number(result.allocated_amount ?? 0);
  const residual = Math.max(0, amount - allocated);
  const suffix = residual > 0.005 ? ` ${residual.toFixed(2)} ${currency} restent en crédit non affecté.` : " Le paiement est entièrement affecté à l’inscription sélectionnée.";
  go(organizationId, returnQ, `Paiement Sales rapproché avec succès.${suffix}`);
}

export async function reconcileStudentAcademySalesAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const subjectId = asUuid(formData.get("subject_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  if (!organizationId || !subjectId) redirect("/dashboard/academy/students");
  const ctx = await context(organizationId);
  const rows = await subjectEnrollments(ctx, organizationId, "crm", subjectId);
  if (!rows.some((r) => canEditFinance(ctx.membership.role, ctx.assignments, String(r.school_id)))) {
    go(organizationId, returnQ, "Rapprochement Sales non autorisé pour cet étudiant.", "error");
  }
  const accountId = await ensureAccount(ctx, organizationId, "crm", subjectId);
  const { data, error } = await ctx.admin.rpc("reconcile_academy_sales_payments_v118", {
    target_organization_id: organizationId,
    target_account_id: accountId,
    target_actor_id: ctx.userId,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  const imported = Number(data ?? 0);
  await audit(ctx, organizationId, "student_account", accountId, "academy_sales_payments_reconciled", { imported_count: imported, crm_client_id: subjectId });
  go(organizationId, returnQ, imported ? `${imported} paiement(s) Sales Academy rapproché(s) comme crédit étudiant non affecté.` : "Aucun nouveau paiement Sales Academy confirmé à rapprocher.");
}

export async function allocateStudentCreditFromControlAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const paymentId = asUuid(formData.get("payment_id"));
  const enrollmentId = asUuid(formData.get("enrollment_id"));
  const allocationAmount = asAmount(formData.get("amount"));
  const returnQ = clean(formData.get("return_q"), 180);
  if (!organizationId || !paymentId || !enrollmentId) redirect("/dashboard/academy/students");
  if (allocationAmount <= 0) go(organizationId, returnQ, "Le montant à affecter doit être supérieur à zéro.", "error");
  const ctx = await context(organizationId);
  const row = await enrollment(ctx, organizationId, enrollmentId);
  assertFinanceEdit(ctx, row, organizationId, returnQ);

  const { error } = await ctx.admin.rpc("add_academy_payment_allocations", {
    target_organization_id: organizationId,
    target_payment_id: paymentId,
    payment_allocations: [{ enrollment_id: enrollmentId, amount: allocationAmount }],
    target_actor_id: ctx.userId,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  await audit(ctx, organizationId, "student_global_payment", paymentId, "credit_allocated_from_control_center", { enrollment_id: enrollmentId, amount: allocationAmount });
  go(organizationId, returnQ, "Crédit affecté à l’inscription sélectionnée. Le solde a été recalculé.");
}

export async function addStudentInstallmentFromControlAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const enrollmentId = asUuid(formData.get("enrollment_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  const dueOn = asDate(formData.get("due_on"));
  const installmentAmount = asAmount(formData.get("amount"));
  if (!organizationId || !enrollmentId) redirect("/dashboard/academy/students");
  if (!dueOn) go(organizationId, returnQ, "La date d’échéance est obligatoire.", "error");
  if (installmentAmount <= 0) go(organizationId, returnQ, "Le montant de l’échéance doit être supérieur à zéro.", "error");
  const ctx = await context(organizationId);
  const row = await enrollment(ctx, organizationId, enrollmentId);
  assertFinanceEdit(ctx, row, organizationId, returnQ);
  const { data, error } = await ctx.admin.rpc("add_academy_student_installment_v118", {
    target_organization_id: organizationId,
    target_enrollment_id: enrollmentId,
    target_due_on: dueOn,
    target_amount: installmentAmount,
    target_actor_id: ctx.userId,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  await audit(ctx, organizationId, "student_installment", enrollmentId, "installment_created_from_control_center", (data ?? {}) as Record<string, unknown>);
  go(organizationId, returnQ, "Échéance ajoutée. Le prochain paiement attendu est maintenant visible dans le Centre.");
}


export async function validateComplimentarySchoolAccessAction(formData: FormData) {
  const organizationId = asUuid(formData.get("organization_id"));
  const targetEnrollmentId = asUuid(formData.get("target_enrollment_id"));
  const sourceEnrollmentId = asUuid(formData.get("source_enrollment_id"));
  const returnQ = clean(formData.get("return_q"), 180);
  if (!organizationId || !targetEnrollmentId || !sourceEnrollmentId) redirect("/dashboard/academy/students");
  if (targetEnrollmentId === sourceEnrollmentId) go(organizationId, returnQ, "L’école offerte et l’école source doivent être différentes.", "error");

  const ctx = await context(organizationId);
  const target = await enrollment(ctx, organizationId, targetEnrollmentId);
  const source = await enrollment(ctx, organizationId, sourceEnrollmentId);
  assertFinanceEdit(ctx, target, organizationId, returnQ);
  assertFinanceEdit(ctx, source, organizationId, returnQ);
  if (!target || !source) go(organizationId, returnQ, "Inscription Academy introuvable.", "error");

  const samePerson = Boolean(
    (target.user_id && source.user_id && target.user_id === source.user_id) ||
    (target.crm_client_id && source.crm_client_id && target.crm_client_id === source.crm_client_id)
  );
  if (!samePerson) go(organizationId, returnQ, "Les deux inscriptions ne correspondent pas à la même personne.", "error");

  const schoolIds = [String(target.school_id), String(source.school_id)];
  const { data: schoolRows } = await ctx.admin
    .from("academy_schools")
    .select("id,name")
    .eq("organization_id", organizationId)
    .in("id", schoolIds);
  const names = new Map((schoolRows ?? []).map((row: any) => [String(row.id), String(row.name || "École")]));
  const targetSchoolName = names.get(String(target.school_id)) ?? "école offerte";
  const sourceSchoolName = names.get(String(source.school_id)) ?? "école source";
  const reason = `Accès offert à ${targetSchoolName} validé dans le cadre de l’offre souscrite via ${sourceSchoolName}.`;

  const { data, error } = await ctx.admin.rpc("validate_complimentary_academy_access_v121", {
    target_organization_id: organizationId,
    target_enrollment_id: targetEnrollmentId,
    source_enrollment_id: sourceEnrollmentId,
    target_actor_id: ctx.userId,
    target_reason: reason,
  });
  if (error) go(organizationId, returnQ, error.message, "error");
  const result = (data ?? {}) as Record<string, unknown>;
  await audit(ctx, organizationId, "academy_enrollment", targetEnrollmentId, "complimentary_access_validated", {
    ...result,
    source_enrollment_id: sourceEnrollmentId,
    target_school: targetSchoolName,
    source_school: sourceSchoolName,
  });
  go(organizationId, returnQ, `${targetSchoolName} validée comme école offerte via ${sourceSchoolName}. Aucun paiement n’est requis et l’accès Academy est confirmé.`);
}
