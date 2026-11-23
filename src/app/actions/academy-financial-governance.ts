"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  canEditFinance,
  canEnrollStudents,
  getAcademyAssignments,
  type AcademyAssignment,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const text = (v: FormDataEntryValue | null, n = 5000) =>
  String(v ?? "").trim().slice(0, n);
const amount = (v: FormDataEntryValue | null) =>
  Math.max(0, Number(String(v ?? "0").replace(",", ".")) || 0);
const pct = (v: FormDataEntryValue | null) => Math.min(100, amount(v));
const date = (v: FormDataEntryValue | null) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;
const uuid = (v: FormDataEntryValue | null) => {
  const s = text(v, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : "";
};
const currency = (v: FormDataEntryValue | null) =>
  (text(v, 3) || "USD").toUpperCase();

function go(path: string, message: string, kind: "success" | "error" = "success"): never {
  const join = path.includes("?") ? "&" : "?";
  redirect(`${path}${join}${kind}=${encodeURIComponent(message)}`);
}

type Membership = { organization_id: string; role: string };
type Ctx = {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  membership: Membership;
  assignments: AcademyAssignment[];
};

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
  if (!membership) throw new Error("Organisation non autorisée.");
  const assignments = await getAcademyAssignments(admin, organizationId, data.user.id);
  return { admin, userId: data.user.id, membership, assignments };
}

async function commissionRole(ctx: Ctx) {
  const { data: commission } = await ctx.admin
    .from("academy_pricing_commissions")
    .select("id")
    .eq("organization_id", ctx.membership.organization_id)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();
  if (!commission) return "";
  const { data: member } = await ctx.admin
    .from("academy_pricing_commission_members")
    .select("member_role")
    .eq("commission_id", commission.id)
    .eq("user_id", ctx.userId)
    .eq("is_active", true)
    .maybeSingle<{ member_role: string }>();
  return member?.member_role ?? "";
}

async function canApprovePricing(ctx: Ctx) {
  if (["owner", "admin"].includes(ctx.membership.role)) return true;
  return (await commissionRole(ctx)) === "chair";
}

async function canManagePricing(ctx: Ctx) {
  if (["owner", "admin"].includes(ctx.membership.role)) return true;
  return ["chair", "secretary"].includes(await commissionRole(ctx));
}

async function audit(
  ctx: Ctx,
  entityType: string,
  entityId: string | null,
  action: string,
  afterData?: Record<string, unknown> | null,
) {
  await ctx.admin.from("academy_pricing_audit_log").insert({
    organization_id: ctx.membership.organization_id,
    actor_id: ctx.userId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    after_data: afterData ?? null,
  });
}

export async function saveAcademyPricingSettingsAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!["owner", "admin"].includes(ctx.membership.role))
    go(back, "Seuls Owner/Admin peuvent modifier les seuils de délégation.", "error");
  const delegated = pct(formData.get("delegated_discount_percent"));
  const commission = pct(formData.get("commission_required_percent"));
  if (delegated > commission)
    go(back, "Le plafond délégué ne peut pas dépasser le seuil de la Commission.", "error");
  const { error } = await ctx.admin.from("academy_pricing_settings").upsert({
    organization_id: organizationId,
    delegated_discount_percent: delegated,
    commission_required_percent: commission,
    default_currency: currency(formData.get("default_currency")),
    updated_at: new Date().toISOString(),
  });
  if (error) go(back, error.message, "error");
  await audit(ctx, "pricing_settings", organizationId, "updated", { delegated, commission });
  revalidatePath("/dashboard/academy/pricing");
  go(back, "Règles de délégation tarifaire enregistrées.");
}

export async function saveAcademyPricingCommissionAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!["owner", "admin"].includes(ctx.membership.role))
    go(back, "Seuls Owner/Admin peuvent constituer la Commission tarifaire.", "error");

  const chair = uuid(formData.get("chair_user_id"));
  const secretary = uuid(formData.get("secretary_user_id"));
  const extras = formData
    .getAll("member_user_ids")
    .map((v) => uuid(v))
    .filter(Boolean);
  if (!chair) go(back, "Choisissez le Président de la Commission.", "error");
  if (secretary && secretary === chair)
    go(back, "Le Président et le Secrétaire doivent être deux personnes différentes.", "error");

  const requested = [...new Set([chair, secretary, ...extras].filter(Boolean))];
  if (requested.length) {
    const { data: activeMembers } = await ctx.admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("user_id", requested);
    const valid = new Set(((activeMembers ?? []) as Array<{ user_id: string }>).map((x) => String(x.user_id)));
    if (requested.some((id) => !valid.has(id)))
      go(back, "Un membre sélectionné n'appartient pas à l'organisation active.", "error");
  }

  let { data: commission } = await ctx.admin
    .from("academy_pricing_commissions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();
  if (!commission) {
    const created = await ctx.admin
      .from("academy_pricing_commissions")
      .insert({ organization_id: organizationId, created_by: ctx.userId })
      .select("id")
      .single<{ id: string }>();
    if (created.error || !created.data) go(back, created.error?.message ?? "Commission impossible.", "error");
    commission = created.data;
  }

  const commissionId = commission!.id;
  await ctx.admin
    .from("academy_pricing_commission_members")
    .delete()
    .eq("commission_id", commissionId);
  const rows = [
    { user_id: chair, member_role: "chair" },
    ...(secretary ? [{ user_id: secretary, member_role: "secretary" }] : []),
    ...extras
      .filter((id) => id !== chair && id !== secretary)
      .map((id) => ({ user_id: id, member_role: "member" })),
  ].map((row) => ({
    organization_id: organizationId,
    commission_id: commissionId,
    ...row,
    is_active: true,
  }));
  const { error } = rows.length
    ? await ctx.admin.from("academy_pricing_commission_members").insert(rows)
    : { error: null };
  if (error) go(back, error.message, "error");
  await audit(ctx, "pricing_commission", commissionId, "members_updated", { member_count: rows.length });
  revalidatePath("/dashboard/academy/pricing");
  go(back, "Commission de fixation et d'homologation mise à jour.");
}

export async function saveAcademyOfficialTariffAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!(await canManagePricing(ctx))) go(back, "Accès à l'homologation non autorisé.", "error");
  const schoolId = uuid(formData.get("school_id"));
  const programId = uuid(formData.get("program_id"));
  const tariffAmount = amount(formData.get("amount"));
  const effectiveFrom = date(formData.get("effective_from")) ?? new Date().toISOString().slice(0, 10);
  const { data: program } = await ctx.admin
    .from("academy_programs")
    .select("id,school_id")
    .eq("id", programId)
    .eq("organization_id", organizationId)
    .eq("school_id", schoolId)
    .maybeSingle<{ id: string; school_id: string }>();
  if (!program) go(back, "Programme ou Grande École invalide.", "error");

  const { data: versions } = await ctx.admin
    .from("academy_program_tariffs")
    .select("version")
    .eq("program_id", programId)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = Number(versions?.[0]?.version ?? 0) + 1;
  const approve = await canApprovePricing(ctx);
  const status = approve ? "active" : "submitted";
  if (approve) {
    await ctx.admin
      .from("academy_program_tariffs")
      .update({ status: "replaced", effective_until: effectiveFrom, updated_at: new Date().toISOString() })
      .eq("program_id", programId)
      .eq("status", "active");
  }
  const { data: tariff, error } = await ctx.admin
    .from("academy_program_tariffs")
    .insert({
      organization_id: organizationId,
      school_id: schoolId,
      program_id: programId,
      version: nextVersion,
      amount: tariffAmount,
      currency: currency(formData.get("currency")),
      status,
      effective_from: effectiveFrom,
      notes: text(formData.get("notes"), 5000) || null,
      submitted_by: ctx.userId,
      submitted_at: new Date().toISOString(),
      approved_by: approve ? ctx.userId : null,
      approved_at: approve ? new Date().toISOString() : null,
      created_by: ctx.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !tariff) go(back, error?.message ?? "Tarif impossible.", "error");
  await audit(ctx, "program_tariff", tariff.id, status === "active" ? "homologated" : "submitted", {
    program_id: programId,
    amount: tariffAmount,
    status,
  });
  if (status === "active") {
    await ctx.admin.rpc("sync_academy_inherited_finance_scope", {
      target_organization_id: organizationId,
      target_program_id: programId,
      target_cohort_id: null,
    });
  }
  revalidatePath("/dashboard/academy/pricing");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, status === "active" ? "Tarif programme homologué et propagé aux inscriptions sans exception individuelle." : "Tarif soumis à homologation.");
}

export async function saveAcademyCohortTariffAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!(await canManagePricing(ctx))) go(back, "Accès à l'homologation non autorisé.", "error");
  const schoolId = uuid(formData.get("school_id"));
  const programId = uuid(formData.get("program_id"));
  const cohortId = uuid(formData.get("cohort_id"));
  const tariffAmount = amount(formData.get("amount"));
  const effectiveFrom = date(formData.get("effective_from")) ?? new Date().toISOString().slice(0, 10);
  const { data: cohort } = await ctx.admin
    .from("academy_cohorts")
    .select("id,school_id")
    .eq("id", cohortId)
    .eq("organization_id", organizationId)
    .eq("school_id", schoolId)
    .maybeSingle<{ id: string; school_id: string }>();
  if (!cohort) go(back, "Cohorte ou Grande École invalide.", "error");
  if (programId) {
    const { data: program } = await ctx.admin
      .from("academy_programs")
      .select("id,school_id")
      .eq("id", programId)
      .eq("organization_id", organizationId)
      .eq("school_id", schoolId)
      .maybeSingle<{ id: string; school_id: string }>();
    if (!program) go(back, "Programme invalide pour cette école.", "error");
  }
  const { data: versions } = await ctx.admin
    .from("academy_cohort_tariffs")
    .select("version")
    .eq("cohort_id", cohortId)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = Number(versions?.[0]?.version ?? 0) + 1;
  const approve = await canApprovePricing(ctx);
  const status = approve ? "active" : "submitted";
  if (approve) {
    await ctx.admin
      .from("academy_cohort_tariffs")
      .update({ status: "replaced", effective_until: effectiveFrom, updated_at: new Date().toISOString() })
      .eq("cohort_id", cohortId)
      .eq("status", "active");
  }
  const { data: tariff, error } = await ctx.admin
    .from("academy_cohort_tariffs")
    .insert({
      organization_id: organizationId,
      school_id: schoolId,
      program_id: programId || null,
      cohort_id: cohortId,
      version: nextVersion,
      amount: tariffAmount,
      currency: currency(formData.get("currency")),
      status,
      effective_from: effectiveFrom,
      notes: text(formData.get("notes"), 5000) || null,
      submitted_by: ctx.userId,
      submitted_at: new Date().toISOString(),
      approved_by: approve ? ctx.userId : null,
      approved_at: approve ? new Date().toISOString() : null,
      created_by: ctx.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !tariff) go(back, error?.message ?? "Tarif de cohorte impossible.", "error");
  await audit(ctx, "cohort_tariff", tariff.id, status === "active" ? "homologated" : "submitted", {
    cohort_id: cohortId,
    program_id: programId || null,
    amount: tariffAmount,
    status,
  });
  if (status === "active") {
    await ctx.admin.rpc("sync_academy_inherited_finance_scope", {
      target_organization_id: organizationId,
      target_program_id: null,
      target_cohort_id: cohortId,
    });
  }
  revalidatePath("/dashboard/academy/pricing");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, status === "active" ? "Tarif de cohorte homologué. Il surcharge désormais le tarif programme." : "Tarif de cohorte soumis à homologation.");
}

export async function reconcileAcademyCrmPaymentsAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const accountId = uuid(formData.get("account_id"));
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  if (!accountId) go(back, "Compte financier étudiant introuvable.", "error");
  const accountRows = await accountEnrollments(ctx, accountId);
  if (!accountRows.some((e) => canEditFinance(ctx.membership.role, ctx.assignments, String(e.school_id))))
    go(back, "Rapprochement CRM non autorisé.", "error");
  const { data, error } = await ctx.admin.rpc("reconcile_academy_crm_payments", {
    target_organization_id: organizationId,
    target_account_id: accountId,
    target_actor_id: ctx.userId,
  });
  if (error) go(back, error.message, "error");
  const count = Number(data ?? 0);
  await audit(ctx, "student_account", accountId, "crm_payments_reconciled", { imported_count: count });
  revalidatePath("/dashboard/academy/students/finance");
  go(back, count > 0 ? `${count} paiement(s) CRM confirmé(s) importé(s) comme crédit non affecté.` : "Aucun nouveau paiement CRM confirmé à rapprocher.");
}

export async function repairAcademyCrmPaymentDoubleCountingAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const paymentId = uuid(formData.get("payment_id"));
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const { data: payment } = await ctx.admin
    .from("academy_student_global_payments")
    .select("id,account_id,source,status")
    .eq("id", paymentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; account_id: string; source: string; status: string }>();
  if (!payment || payment.source !== "crm" || payment.status !== "confirmed")
    go(back, "Le paiement CRM confirme a consolider est introuvable.", "error");
  const enrollments = await accountEnrollments(ctx, payment.account_id);
  if (!enrollments.some((e: any) => canEditFinance(ctx.membership.role, ctx.assignments, String(e.school_id))))
    go(back, "Correction du double comptage non autorisee.", "error");
  const { data, error } = await ctx.admin.rpc("repair_academy_crm_payment_duplicate", {
    target_organization_id: organizationId,
    target_payment_id: paymentId,
    target_actor_id: ctx.userId,
  });
  if (error) go(back, error.message, "error");
  const result = (data ?? {}) as { removed_global_payments?: number; removed_allocated_amount?: number };
  const removed = Number(result.removed_global_payments ?? 0);
  await audit(ctx, "student_global_payment", paymentId, "duplicate_representations_consolidated", result);
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, removed > 0
    ? `${removed} ancienne(s) representation(s) du meme paiement ont ete supprimees. Le paiement CRM reste unique et son credit peut maintenant etre reparti explicitement.`
    : "Aucun doublon ancien correspondant n a ete trouve. Aucune donnee n a ete supprimee.");
}

export async function updateAcademyEnrollmentSourceAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const enrollmentId = uuid(formData.get("enrollment_id"));
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const { data: enrollment } = await ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id")
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; school_id: string }>();
  if (!enrollment || !canEditFinance(ctx.membership.role, ctx.assignments, enrollment.school_id))
    go(back, "Modification de la provenance non autorisée.", "error");
  const sourceType = text(formData.get("source_type"), 20);
  if (!["crm", "import", "internal", "manual", "web"].includes(sourceType))
    go(back, "Source d'inscription invalide.", "error");
  const { error } = await ctx.admin
    .from("academy_school_enrollments")
    .update({
      source_type: sourceType,
      source_reference: text(formData.get("source_reference"), 250) || null,
      source_detected_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId);
  if (error) go(back, error.message, "error");
  await audit(ctx, "academy_enrollment", enrollmentId, "source_updated", { source_type: sourceType });
  revalidatePath("/dashboard/academy/students/finance");
  go(back, "Source de l'inscription mise à jour.");
}

export async function updateAcademyEnrollmentAcademicScopeAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const enrollmentId = uuid(formData.get("enrollment_id"));
  const programIdInput = uuid(formData.get("program_id"));
  const cohortId = uuid(formData.get("cohort_id"));
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const { data: enrollment } = await ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id")
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; school_id: string }>();
  if (!enrollment || !(canEnrollStudents(ctx.membership.role, ctx.assignments, enrollment.school_id) || canEditFinance(ctx.membership.role, ctx.assignments, enrollment.school_id)))
    go(back, "Affectation programme/cohorte non autorisee.", "error");

  let programId = programIdInput;
  if (cohortId) {
    const { data: cohort } = await ctx.admin
      .from("academy_cohorts")
      .select("id,school_id,program_id")
      .eq("id", cohortId)
      .eq("organization_id", organizationId)
      .eq("school_id", enrollment.school_id)
      .maybeSingle<{ id: string; school_id: string; program_id: string | null }>();
    if (!cohort) go(back, "La cohorte ne depend pas de cette Grande Ecole.", "error");
    if (cohort.program_id && programId && cohort.program_id !== programId)
      go(back, "La cohorte selectionnee appartient a un autre programme.", "error");
    if (cohort.program_id && !programId) programId = cohort.program_id;
  }
  if (programId) {
    const { data: program } = await ctx.admin
      .from("academy_programs")
      .select("id")
      .eq("id", programId)
      .eq("organization_id", organizationId)
      .eq("school_id", enrollment.school_id)
      .maybeSingle<{ id: string }>();
    if (!program) go(back, "Le programme ne depend pas de cette Grande Ecole.", "error");
  }
  if (!programId || !cohortId)
    go(back, "Selectionnez un programme et une cohorte pour finaliser l inscription.", "error");

  const { error } = await ctx.admin
    .from("academy_school_enrollments")
    .update({ program_id: programId, cohort_id: cohortId })
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId);
  if (error) go(back, error.message, "error");
  const { data: harmonizeResult, error: syncError } = await ctx.admin.rpc("harmonize_academy_inherited_agreement", {
    target_enrollment_id: enrollmentId,
    target_actor_id: ctx.userId,
  });
  if (syncError) go(back, syncError.message, "error");
  const harmonizeStatus = String(harmonizeResult ?? "");
  await audit(ctx, "academy_enrollment", enrollmentId, "academic_scope_updated", {
    program_id: programId,
    cohort_id: cohortId,
    finance_harmonization: harmonizeStatus,
  });
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  if (harmonizeStatus === "review_required")
    go(back, "Programme et cohorte affectes. L accord financier existant a ete conserve car il contient deja des conditions specifiques. Verifiez les conditions financieres.");
  if (harmonizeStatus === "no_tariff")
    go(back, "Programme et cohorte affectes, mais aucun tarif homologue actif n a ete trouve.", "error");
  go(back, harmonizeStatus === "already_harmonized"
    ? "Programme et cohorte affectes. L accord financier etait deja harmonise avec le tarif homologue."
    : "Programme et cohorte affectes. L accord financier a ete harmonise automatiquement avec le tarif homologue.");
}

export async function harmonizeAcademyStudentAgreementAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const enrollmentId = uuid(formData.get("enrollment_id"));
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const { data: enrollment } = await ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id")
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; school_id: string }>();
  if (!enrollment || !canEditFinance(ctx.membership.role, ctx.assignments, enrollment.school_id))
    go(back, "Harmonisation financiere non autorisee pour cette inscription.", "error");

  const { data: result, error } = await ctx.admin.rpc("harmonize_academy_inherited_agreement", {
    target_enrollment_id: enrollmentId,
    target_actor_id: ctx.userId,
  });
  if (error) go(back, error.message, "error");
  const status = String(result ?? "");
  await audit(ctx, "student_financial_agreement", null, "inherited_tariff_harmonization", {
    enrollment_id: enrollmentId,
    result: status,
  });
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  if (status === "review_required")
    go(back, "Harmonisation automatique refusee : l accord actif contient deja une promotion, un ajustement ou un prix specifique. Utilisez Modifier les conditions financieres.", "error");
  if (status === "no_tariff")
    go(back, "Aucun tarif homologue actif n est disponible pour cette inscription.", "error");
  go(back, status === "already_harmonized"
    ? "L accord financier est deja harmonise avec le tarif homologue."
    : "Accord financier harmonise avec le tarif homologue. Les frais convenus et le solde ont ete recalcules.");
}

export async function saveAcademyPromotionAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!(await canManagePricing(ctx))) go(back, "Accès aux promotions non autorisé.", "error");
  const approve = await canApprovePricing(ctx);
  const discountType = text(formData.get("discount_type"), 30);
  if (!["percent", "fixed", "final_price"].includes(discountType))
    go(back, "Type de promotion invalide.", "error");
  const discountValue = amount(formData.get("discount_value"));
  if (discountType === "percent" && discountValue > 100)
    go(back, "Une promotion en pourcentage doit etre comprise entre 0 et 100 %.", "error");
  const promotionName = text(formData.get("name"), 180);
  if (!promotionName) go(back, "Le nom de la promotion est obligatoire.", "error");
  const scopeType = text(formData.get("scope_type"), 30) || "program";
  const { data: promotion, error } = await ctx.admin
    .from("academy_pricing_promotions")
    .insert({
      organization_id: organizationId,
      name: promotionName,
      scope_type: scopeType,
      school_id: uuid(formData.get("school_id")) || null,
      program_id: uuid(formData.get("program_id")) || null,
      cohort_id: uuid(formData.get("cohort_id")) || null,
      discount_type: discountType,
      discount_value: discountValue,
      currency: discountType === "percent" ? null : currency(formData.get("currency")),
      valid_from: date(formData.get("valid_from")) ?? new Date().toISOString().slice(0, 10),
      valid_until: date(formData.get("valid_until")),
      status: approve ? "active" : "draft",
      notes: text(formData.get("notes"), 5000) || null,
      created_by: ctx.userId,
      approved_by: approve ? ctx.userId : null,
      approved_at: approve ? new Date().toISOString() : null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !promotion) go(back, error?.message ?? "Promotion impossible.", "error");
  await audit(ctx, "promotion", promotion.id, approve ? "activated" : "created_draft");
  revalidatePath("/dashboard/academy/pricing");
  go(back, approve ? "Promotion activée." : "Promotion enregistrée en brouillon.");
}

export async function updateAcademyPromotionAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const promotionId = uuid(formData.get("promotion_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!(await canManagePricing(ctx))) go(back, "Modification des promotions non autorisee.", "error");
  const discountType = text(formData.get("discount_type"), 30);
  if (!["percent", "fixed", "final_price"].includes(discountType)) go(back, "Type de promotion invalide.", "error");
  const discountValue = amount(formData.get("discount_value"));
  if (discountType === "percent" && discountValue > 100) go(back, "Une promotion en pourcentage doit etre comprise entre 0 et 100 %.", "error");
  const name = text(formData.get("name"), 180);
  if (!name) go(back, "Le nom de la promotion est obligatoire.", "error");
  const { data: before } = await ctx.admin.from("academy_pricing_promotions").select("*").eq("id", promotionId).eq("organization_id", organizationId).maybeSingle<any>();
  if (!before) go(back, "Promotion introuvable.", "error");
  const payload = {
    name,
    scope_type: text(formData.get("scope_type"), 30) || "program",
    school_id: uuid(formData.get("school_id")) || null,
    program_id: uuid(formData.get("program_id")) || null,
    cohort_id: uuid(formData.get("cohort_id")) || null,
    discount_type: discountType,
    discount_value: discountValue,
    currency: discountType === "percent" ? null : currency(formData.get("currency")),
    valid_from: date(formData.get("valid_from")) ?? new Date().toISOString().slice(0, 10),
    valid_until: date(formData.get("valid_until")),
    notes: text(formData.get("notes"), 5000) || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await ctx.admin.from("academy_pricing_promotions").update(payload).eq("id", promotionId).eq("organization_id", organizationId);
  if (error) go(back, error.message, "error");
  await audit(ctx, "promotion", promotionId, "updated", { before, after: payload });
  revalidatePath("/dashboard/academy/pricing");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, "Promotion modifiee et historisee.");
}

export async function setAcademyPromotionStatusAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const promotionId = uuid(formData.get("promotion_id"));
  const ctx = await context(organizationId);
  const back = `/dashboard/academy/pricing?organization=${organizationId}`;
  if (!(await canManagePricing(ctx))) go(back, "Action sur la promotion non autorisee.", "error");
  const nextStatus = text(formData.get("status"), 20);
  if (!["active", "draft", "suspended", "archived"].includes(nextStatus)) go(back, "Statut de promotion invalide.", "error");
  const { data: promo } = await ctx.admin.from("academy_pricing_promotions").select("discount_type,discount_value,status").eq("id", promotionId).eq("organization_id", organizationId).maybeSingle<any>();
  if (!promo) go(back, "Promotion introuvable.", "error");
  if (nextStatus === "active" && promo.discount_type === "percent" && Number(promo.discount_value ?? 0) > 100)
    go(back, "Corrigez le pourcentage avant d activer cette promotion.", "error");
  const { error } = await ctx.admin.from("academy_pricing_promotions").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", promotionId).eq("organization_id", organizationId);
  if (error) go(back, error.message, "error");
  await audit(ctx, "promotion", promotionId, `status_${nextStatus}`, { previous_status: promo.status, status: nextStatus });
  revalidatePath("/dashboard/academy/pricing");
  go(back, `Promotion ${nextStatus}.`);
}

function promotionDiscount(listPrice: number, row: { discount_type: string; discount_value: number | string; currency: string | null }, targetCurrency: string) {
  const value = Number(row.discount_value ?? 0);
  if (row.discount_type === "percent") return Math.min(listPrice, (listPrice * value) / 100);
  if (row.currency && row.currency !== targetCurrency) return 0;
  if (row.discount_type === "fixed") return Math.min(listPrice, value);
  if (row.discount_type === "final_price") return Math.min(listPrice, Math.max(0, listPrice - value));
  return 0;
}

export async function saveAcademyStudentAgreementAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const enrollmentId = uuid(formData.get("enrollment_id"));
  const { data: enrollment } = await ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id,program_id,cohort_id")
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; school_id: string; program_id: string | null; cohort_id: string | null }>();
  if (!enrollment || !canEditFinance(ctx.membership.role, ctx.assignments, enrollment.school_id))
    go(back, "Vous n'êtes pas autorisé à modifier les conditions financières de cette inscription.", "error");

  const promotionId = uuid(formData.get("promotion_id"));
  const { data: resolved, error: resolveError } = await ctx.admin
    .rpc("resolve_academy_enrollment_tariff", { target_enrollment_id: enrollmentId });
  if (resolveError) go(back, resolveError.message, "error");
  const inherited = Array.isArray(resolved) ? resolved[0] : resolved;
  const pricingSource = String(inherited?.pricing_source ?? "none");
  if (!inherited || pricingSource === "none" || Number(inherited.amount ?? 0) <= 0)
    go(back, "Aucun tarif officiel n'est défini. Homologuez d'abord un tarif pour le programme ou la cohorte.", "error");

  const listPrice = Number(inherited.amount ?? 0);
  const targetCurrency = String(inherited.currency ?? "USD");
  const tariffId = String(inherited.program_tariff_id ?? "");
  const cohortTariffId = String(inherited.cohort_tariff_id ?? "");

  let promoDiscount = 0;
  if (promotionId) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: promo } = await ctx.admin
      .from("academy_pricing_promotions")
      .select("id,scope_type,school_id,program_id,cohort_id,discount_type,discount_value,currency,status,valid_from,valid_until")
      .eq("id", promotionId)
      .eq("organization_id", organizationId)
      .maybeSingle<any>();
    if (!promo || promo.status !== "active" || promo.valid_from > today || (promo.valid_until && promo.valid_until < today))
      go(back, "Promotion non applicable ou expirée.", "error");
    if (promo.school_id && promo.school_id !== enrollment.school_id) go(back, "Promotion d'une autre école.", "error");
    if (promo.program_id && promo.program_id !== enrollment.program_id) go(back, "Promotion d'un autre programme.", "error");
    if (promo.cohort_id && promo.cohort_id !== enrollment.cohort_id) go(back, "Promotion d'une autre cohorte.", "error");
    promoDiscount = promotionDiscount(listPrice, promo, targetCurrency);
  }

  const individual = Math.min(Math.max(0, listPrice - promoDiscount), amount(formData.get("individual_adjustment_amount")));
  const agreed = Math.max(0, listPrice - promoDiscount - individual);
  const discountPercent = listPrice > 0 ? ((listPrice - agreed) / listPrice) * 100 : 0;
  const { data: settings } = await ctx.admin
    .from("academy_pricing_settings")
    .select("delegated_discount_percent,commission_required_percent")
    .eq("organization_id", organizationId)
    .maybeSingle<{ delegated_discount_percent: number | string; commission_required_percent: number | string }>();
  const delegated = Number(settings?.delegated_discount_percent ?? 15);
  const approve = (await canApprovePricing(ctx)) || discountPercent <= delegated;
  const status = approve ? "draft" : "pending_approval";
  const { data: current } = await ctx.admin
    .from("academy_student_financial_agreements")
    .select("id")
    .eq("enrollment_id", enrollmentId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();

  const { data: agreement, error } = await ctx.admin
    .from("academy_student_financial_agreements")
    .insert({
      organization_id: organizationId,
      enrollment_id: enrollmentId,
      tariff_id: tariffId || null,
      cohort_tariff_id: cohortTariffId || null,
      promotion_id: promotionId || null,
      list_price: listPrice,
      promotion_discount_amount: promoDiscount,
      individual_adjustment_amount: individual,
      agreed_amount: agreed,
      currency: targetCurrency,
      status,
      adjustment_reason: text(formData.get("adjustment_reason"), 2000) || null,
      source: promotionId ? "promotion" : "manual",
      supersedes_agreement_id: current?.id ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !agreement) go(back, error?.message ?? "Accord financier impossible.", "error");

  if (approve) {
    const { error: activationError } = await ctx.admin.rpc("activate_academy_financial_agreement", {
      target_agreement_id: agreement.id,
      target_actor_id: ctx.userId,
      target_note: discountPercent <= delegated ? "Approuvé dans la délégation autorisée." : "Approuvé par autorité habilitée.",
    });
    if (activationError) go(back, activationError.message, "error");
    const financeValues = {
      list_price: listPrice,
      discount_amount: promoDiscount + individual,
      agreed_amount: agreed,
      currency: targetCurrency,
      current_agreement_id: agreement.id,
      updated_at: new Date().toISOString(),
    };
    const { data: synchronizedFinance, error: financeSyncError } = await ctx.admin
      .from("academy_student_finance")
      .update(financeValues)
      .eq("organization_id", organizationId)
      .eq("enrollment_id", enrollmentId)
      .select("enrollment_id")
      .maybeSingle<{ enrollment_id: string }>();
    if (financeSyncError) go(back, financeSyncError.message, "error");
    if (!synchronizedFinance) {
      const { error: financeInsertError } = await ctx.admin
        .from("academy_student_finance")
        .insert({
          organization_id: organizationId,
          enrollment_id: enrollmentId,
          is_internal_training: false,
          payment_status: "not_started",
          created_by: ctx.userId,
          ...financeValues,
        });
      if (financeInsertError) go(back, financeInsertError.message, "error");
    }
    const { error: refreshError } = await ctx.admin.rpc("refresh_academy_student_finance", {
      target_enrollment_id: enrollmentId,
    });
    if (refreshError) go(back, refreshError.message, "error");
  }
  await audit(ctx, "student_financial_agreement", agreement.id, approve ? "activated" : "submitted_for_approval", {
    enrollment_id: enrollmentId,
    pricing_source: pricingSource,
    agreed_amount: agreed,
    discount_percent: discountPercent,
  });
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, approve ? "Conditions financières enregistrées. Le prix de base reste hérité du programme/de la cohorte." : "Ajustement soumis à la Commission pour approbation.");
}

export async function approveAcademyStudentAgreementAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const agreementId = uuid(formData.get("agreement_id"));
  const returnTo = text(formData.get("return_to"), 1000) || `/dashboard/academy/pricing?organization=${organizationId}`;
  const ctx = await context(organizationId);
  if (!(await canApprovePricing(ctx))) go(returnTo, "Approbation réservée à Owner/Admin ou au Président de la Commission.", "error");
  const { error } = await ctx.admin.rpc("activate_academy_financial_agreement", {
    target_agreement_id: agreementId,
    target_actor_id: ctx.userId,
    target_note: text(formData.get("approval_note"), 2000) || "Approuvé par la Commission tarifaire.",
  });
  if (error) go(returnTo, error.message, "error");
  const { data: approvedAgreement, error: agreementError } = await ctx.admin
    .from("academy_student_financial_agreements")
    .select("enrollment_id,list_price,promotion_discount_amount,individual_adjustment_amount,agreed_amount,currency")
    .eq("id", agreementId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ enrollment_id: string; list_price: number; promotion_discount_amount: number; individual_adjustment_amount: number; agreed_amount: number; currency: string }>();
  if (agreementError || !approvedAgreement) go(returnTo, agreementError?.message ?? "Accord homologué introuvable.", "error");
  const { error: financeSyncError } = await ctx.admin
    .from("academy_student_finance")
    .update({
      list_price: approvedAgreement.list_price,
      discount_amount: Number(approvedAgreement.promotion_discount_amount ?? 0) + Number(approvedAgreement.individual_adjustment_amount ?? 0),
      agreed_amount: approvedAgreement.agreed_amount,
      currency: approvedAgreement.currency,
      current_agreement_id: agreementId,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("enrollment_id", approvedAgreement.enrollment_id);
  if (financeSyncError) go(returnTo, financeSyncError.message, "error");
  const { error: refreshError } = await ctx.admin.rpc("refresh_academy_student_finance", {
    target_enrollment_id: approvedAgreement.enrollment_id,
  });
  if (refreshError) go(returnTo, refreshError.message, "error");
  await audit(ctx, "student_financial_agreement", agreementId, "approved");
  revalidatePath("/dashboard/academy/pricing");
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  go(returnTo, "Accord individuel homologué et activé.");
}

async function accountEnrollments(ctx: Ctx, accountId: string) {
  const { data: account } = await ctx.admin
    .from("academy_student_accounts")
    .select("id,subject_type,subject_id")
    .eq("id", accountId)
    .eq("organization_id", ctx.membership.organization_id)
    .maybeSingle<{ id: string; subject_type: string; subject_id: string }>();
  if (!account) return [];
  let query = ctx.admin
    .from("academy_school_enrollments")
    .select("id,school_id,program_id,enrolled_on")
    .eq("organization_id", ctx.membership.organization_id);
  query = account.subject_type === "crm_client" ? query.eq("crm_client_id", account.subject_id) : query.eq("user_id", account.subject_id);
  const { data } = await query;
  return data ?? [];
}

export async function recordConsolidatedAcademyPaymentAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const accountId = uuid(formData.get("account_id"));
  const total = amount(formData.get("amount"));
  const paymentCurrency = currency(formData.get("currency"));
  if (total <= 0) go(back, "Le paiement doit être supérieur à zéro.", "error");

  const enrollments = await accountEnrollments(ctx, accountId);
  const allowed = enrollments.filter((e: any) => canEditFinance(ctx.membership.role, ctx.assignments, String(e.school_id)));
  if (!allowed.length) go(back, "Aucun périmètre financier autorisé pour ce compte étudiant.", "error");
  const allowedIds = new Set(allowed.map((e: any) => String(e.id)));

  const allocations: Array<{ enrollment_id: string; amount: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("allocation_")) continue;
    const enrollmentId = key.slice("allocation_".length);
    const v = amount(value);
    if (v > 0) {
      if (!allowedIds.has(enrollmentId)) go(back, "Allocation non autorisée pour une inscription.", "error");
      allocations.push({ enrollment_id: enrollmentId, amount: v });
    }
  }

  if (text(formData.get("auto_allocate"), 10) === "on" && !allocations.length) {
    const ids = allowed.map((e: any) => String(e.id));
    const [{ data: financeRows }, { data: confirmedAllocations }] = await Promise.all([
      ctx.admin
        .from("academy_student_finance")
        .select("enrollment_id,agreed_amount,currency,first_payment_due_on")
        .in("enrollment_id", ids),
      ctx.admin
        .from("academy_student_confirmed_allocations")
        .select("enrollment_id,amount,currency")
        .in("enrollment_id", ids),
    ]);
    const paid = new Map<string, number>();
    for (const p of confirmedAllocations ?? []) {
      if (String(p.currency) !== paymentCurrency) continue;
      const id = String(p.enrollment_id);
      paid.set(id, (paid.get(id) ?? 0) + Number(p.amount ?? 0));
    }
    let remaining = total;
    const candidates = ((financeRows ?? []) as Array<{ enrollment_id: string; agreed_amount: number | string; currency: string; first_payment_due_on: string | null }>)
      .filter((f) => String(f.currency) === paymentCurrency)
      .map((f) => ({
        id: String(f.enrollment_id),
        balance: Math.max(0, Number(f.agreed_amount ?? 0) - (paid.get(String(f.enrollment_id)) ?? 0)),
        due: String(f.first_payment_due_on ?? "9999-12-31"),
      }))
      .filter((x) => x.balance > 0)
      .sort((a, b) => a.due.localeCompare(b.due));
    for (const c of candidates) {
      if (remaining <= 0) break;
      const allocationAmount = Math.min(c.balance, remaining);
      allocations.push({ enrollment_id: c.id, amount: allocationAmount });
      remaining -= allocationAmount;
    }
  }

  const allocated = allocations.reduce((sum, x) => sum + x.amount, 0);
  if (allocated > total + 0.0001) go(back, "La répartition dépasse le paiement reçu.", "error");
  const confirmed = text(formData.get("bank_confirmed"), 10) === "on";
  const { data: paymentId, error } = await ctx.admin.rpc("record_academy_consolidated_payment", {
    target_organization_id: organizationId,
    target_account_id: accountId,
    payment_amount: total,
    payment_currency: paymentCurrency,
    payment_paid_on: date(formData.get("paid_on")) ?? new Date().toISOString().slice(0, 10),
    payment_method_value: text(formData.get("payment_method"), 30) || "other",
    payment_reference: text(formData.get("reference"), 160),
    payment_notes: text(formData.get("notes"), 2000),
    payment_status_value: confirmed ? "confirmed" : "declared",
    payment_allocations: allocations,
    target_actor_id: ctx.userId,
  });
  if (error) go(back, error.message, "error");
  await audit(ctx, "student_global_payment", String(paymentId ?? "") || null, confirmed ? "recorded_confirmed" : "recorded_declared", {
    total,
    allocated,
    unallocated: Math.max(0, total - allocated),
    currency: paymentCurrency,
  });
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, confirmed ? "Paiement consolidé confirmé et réparti." : "Paiement enregistré. Il reste en attente de confirmation bancaire.");
}

export async function confirmConsolidatedAcademyPaymentAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const paymentId = uuid(formData.get("payment_id"));
  const { data: payment } = await ctx.admin
    .from("academy_student_global_payments")
    .select("id,account_id,status")
    .eq("id", paymentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; account_id: string; status: string }>();
  if (!payment) go(back, "Paiement introuvable.", "error");
  const enrollments = await accountEnrollments(ctx, payment.account_id);
  if (!enrollments.some((e: any) => canEditFinance(ctx.membership.role, ctx.assignments, String(e.school_id))))
    go(back, "Confirmation bancaire non autorisée.", "error");
  const { error } = await ctx.admin
    .from("academy_student_global_payments")
    .update({ status: "confirmed", confirmed_by: ctx.userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", paymentId)
    .eq("organization_id", organizationId);
  if (error) go(back, error.message, "error");
  await audit(ctx, "student_global_payment", paymentId, "bank_confirmed");
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, "Paiement confirmé. Les allocations alimentent désormais les soldes par école.");
}

export async function allocateAcademyStudentCreditAction(formData: FormData) {
  const organizationId = uuid(formData.get("organization_id"));
  const studentKey = text(formData.get("student_key"), 100);
  const back = `/dashboard/academy/students/finance?organization=${organizationId}&student=${encodeURIComponent(studentKey)}`;
  const ctx = await context(organizationId);
  const paymentId = uuid(formData.get("payment_id"));
  const { data: payment } = await ctx.admin
    .from("academy_student_global_payments")
    .select("id,account_id,currency")
    .eq("id", paymentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; account_id: string; currency: string }>();
  if (!payment) go(back, "Paiement introuvable.", "error");
  const enrollments = await accountEnrollments(ctx, payment.account_id);
  const allowed = new Set(
    enrollments
      .filter((e: any) => canEditFinance(ctx.membership.role, ctx.assignments, String(e.school_id)))
      .map((e: any) => String(e.id)),
  );
  const allocations: Array<{ enrollment_id: string; amount: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("credit_allocation_")) continue;
    const enrollmentId = key.slice("credit_allocation_".length);
    const v = amount(value);
    if (v > 0) {
      if (!allowed.has(enrollmentId)) go(back, "Allocation de crédit non autorisée.", "error");
      allocations.push({ enrollment_id: enrollmentId, amount: v });
    }
  }
  if (!allocations.length) go(back, "Indiquez au moins une allocation.", "error");
  const { error } = await ctx.admin.rpc("add_academy_payment_allocations", {
    target_organization_id: organizationId,
    target_payment_id: paymentId,
    payment_allocations: allocations,
    target_actor_id: ctx.userId,
  });
  if (error) go(back, error.message, "error");
  await audit(ctx, "student_global_payment", paymentId, "credit_allocated", { allocations });
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/students/finance");
  go(back, "Crédit étudiant réparti sur les inscriptions sélectionnées.");
}
