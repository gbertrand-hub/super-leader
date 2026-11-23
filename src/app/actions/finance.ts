"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createNotification} from "@/lib/notifications/service";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const financeRoles = new Set(["owner", "admin"]);
const documentTypes = new Set(["proforma", "invoice", "receipt", "credit_note", "expense_receipt", "other"]);
const documentStatuses = new Set([
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "partial",
  "paid",
  "overdue",
  "cancelled",
  "converted",
  "archived",
]);
const payrollPeriodStatuses = new Set(["draft", "open", "review", "approved", "paid", "locked", "cancelled"]);
const salaryBases = new Set(["hourly", "weekly", "biweekly", "semimonthly", "monthly", "custom"]);
const paymentMethods = new Set(["bank_transfer", "cash", "cheque", "mobile_money", "other"]);
const passwordModes = new Set(["none", "employee_secret", "unique"]);

function first(value: FormDataEntryValue | null, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function money(value: FormDataEntryValue | null, fallback = 0) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
}

function dateValue(value: FormDataEntryValue | null, required = false) {
  const raw = first(value, 10);
  if (!raw) return required ? "" : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  return Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime()) ? "" : raw;
}

function redirectFinance(message: string, kind: "success" | "error" = "success", view = "overview"): never {
  redirect(`/dashboard/finance?view=${encodeURIComponent(view)}&${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (error || !membership) redirect("/dashboard/company");
  if (!financeRoles.has(membership.role)) redirect("/dashboard/my-payslips");

  const text = (frText: string, enText: string) => fr ? frText : enText;
  return {user: authData.user, membership, admin, fr, text};
}

async function auditFinance(input: {
  organizationId: string;
  documentId: string;
  actorId: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await input.admin.from("finance_document_audit_log").insert({
    organization_id: input.organizationId,
    document_id: input.documentId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("Finance audit failed", error);
}

async function auditPayroll(input: {
  organizationId: string;
  actorId: string;
  action: string;
  periodId?: string | null;
  entryId?: string | null;
  payslipId?: string | null;
  employeeUserId?: string | null;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await input.admin.from("payroll_audit_log").insert({
    organization_id: input.organizationId,
    payroll_period_id: input.periodId ?? null,
    payroll_entry_id: input.entryId ?? null,
    payslip_id: input.payslipId ?? null,
    employee_user_id: input.employeeUserId ?? null,
    actor_id: input.actorId,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Payroll audit failed", error);
}

export async function createFinanceDocumentAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const documentType = first(formData.get("documentType"), 40);
  const title = first(formData.get("title"), 240);
  const counterpartyName = first(formData.get("counterpartyName"), 240) || null;
  const issueDate = dateValue(formData.get("issueDate"), true);
  const requestedDueDate = dateValue(formData.get("dueDate"));
  const currency = first(formData.get("currency"), 3).toUpperCase();
  const subtotal = money(formData.get("subtotal"));
  const taxAmount = money(formData.get("taxAmount"));
  const totalAmountInput = money(formData.get("totalAmount"));
  const paidAmount = money(formData.get("paidAmount"));
  const notes = first(formData.get("notes"), 4000) || null;
  const pending = readPendingAttachment(formData, "financeDocument");

  if (!documentTypes.has(documentType) || !title || !issueDate) {
    redirectFinance(text("Informations du document invalides.", "Invalid document information."), "error", "documents");
  }
  if (requestedDueDate === "" || !/^[A-Z]{3}$/.test(currency)) {
    redirectFinance(text("Date ou devise invalide.", "Invalid date or currency."), "error", "documents");
  }
  if ([subtotal, taxAmount, totalAmountInput, paidAmount].some((value) => !Number.isFinite(value) || value < 0)) {
    redirectFinance(text("Les montants doivent être positifs.", "Amounts must be positive."), "error", "documents");
  }
  const totalAmount = totalAmountInput > 0 ? totalAmountInput : subtotal + taxAmount;
  if (paidAmount > totalAmount && totalAmount > 0) {
    redirectFinance(text("Le montant payé ne peut pas dépasser le total.", "Paid amount cannot exceed the total."), "error", "documents");
  }
  if (!pending) {
    redirectFinance(text("Téléverse le document avant de l’enregistrer.", "Upload the document before saving."), "error", "documents");
  }

  let effectiveDueDate = requestedDueDate;
  if (!effectiveDueDate) {
    const {data: financeSettings, error: settingsError} = await admin
      .from("finance_settings")
      .select("payment_terms_days")
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{payment_terms_days: number | null}>();

    if (settingsError) {
      redirectFinance(
        text("Impossible de lire l’échéance par défaut des Paramètres Finance : ", "Unable to read the default due date from Finance Settings: ") + settingsError.message,
        "error",
        "documents",
      );
    }

    const configuredDays = Number(financeSettings?.payment_terms_days ?? 30);
    const paymentTermsDays = Number.isFinite(configuredDays) ? Math.min(365, Math.max(0, Math.trunc(configuredDays))) : 30;
    const calculatedDueDate = new Date(`${issueDate}T12:00:00Z`);
    calculatedDueDate.setUTCDate(calculatedDueDate.getUTCDate() + paymentTermsDays);
    effectiveDueDate = calculatedDueDate.toISOString().slice(0, 10);
  }

  const {data: generatedNumber, error: numberError} = await admin.rpc("finance_next_document_number", {
    p_organization_id: membership.organization_id,
    p_document_type: documentType,
    p_issue_date: issueDate,
  });
  if (numberError || !generatedNumber) {
    redirectFinance(
      text("Numérotation automatique impossible : ", "Automatic numbering failed: ") + (numberError?.message ?? "unknown error"),
      "error",
      "documents",
    );
  }
  const documentNumber = String(generatedNumber);

  const {data: created, error: createError} = await admin
    .from("finance_documents")
    .insert({
      organization_id: membership.organization_id,
      document_type: documentType,
      document_number: documentNumber,
      title,
      counterparty_name: counterpartyName,
      issue_date: issueDate,
      due_date: effectiveDueDate,
      currency,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      status: "draft",
      notes,
      created_by: user.id,
    })
    .select("id, status")
    .single<{id: string; status: string}>();

  if (createError || !created) {
    redirectFinance(
      text("Création impossible : ", "Unable to create: ") + (createError?.message ?? "unknown error"),
      "error",
      "documents",
    );
  }

  try {
    const attachment = await finalizeTemporaryAttachment({
      admin,
      organizationId: membership.organization_id,
      userId: user.id,
      purpose: "finance",
      recordId: created.id,
      pending,
    });
    const {error: updateError} = await admin
      .from("finance_documents")
      .update({
        storage_path: attachment.storagePath,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
      })
      .eq("id", created.id)
      .eq("organization_id", membership.organization_id);
    if (updateError) throw updateError;
  } catch (error) {
    await admin.from("finance_documents").delete().eq("id", created.id);
    await removePrivateAttachment(admin, pending.storagePath);
    redirectFinance(
      text("Le document n’a pas pu être sécurisé : ", "The document could not be secured: ") +
        (error instanceof Error ? error.message : "unknown error"),
      "error",
      "documents",
    );
  }

  await auditFinance({
    organizationId: membership.organization_id,
    documentId: created.id,
    actorId: user.id,
    action: "created",
    newStatus: created.status,
    details: {documentType, documentNumber, dueDate: effectiveDueDate, dueDateSource: requestedDueDate ? "manual" : "finance_settings"},
    admin,
  });
  revalidatePath("/dashboard/finance");
  redirectFinance(text("Document financier enregistré.", "Financial document saved."), "success", "documents");
}

export async function updateFinanceDocumentStatusAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const documentId = first(formData.get("documentId"), 80);
  const status = first(formData.get("status"), 40);
  if (!documentId || !documentStatuses.has(status)) {
    redirectFinance(text("Statut invalide.", "Invalid status."), "error", "documents");
  }

  const {data: current} = await admin
    .from("finance_documents")
    .select("id, status")
    .eq("id", documentId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string}>();
  if (!current) redirectFinance(text("Document introuvable.", "Document not found."), "error", "documents");

  const patch: Record<string, unknown> = {status};
  if (status === "approved") {
    patch.approved_by = user.id;
    patch.approved_at = new Date().toISOString();
  }
  if (["sent", "accepted", "paid"].includes(status)) patch.published_at = new Date().toISOString();

  const {error} = await admin
    .from("finance_documents")
    .update(patch)
    .eq("id", documentId)
    .eq("organization_id", membership.organization_id);
  if (error) redirectFinance(text("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "documents");

  await auditFinance({
    organizationId: membership.organization_id,
    documentId,
    actorId: user.id,
    action: status === "approved" ? "approved" : "status_changed",
    previousStatus: current.status,
    newStatus: status,
    admin,
  });
  revalidatePath("/dashboard/finance");
  redirectFinance(text("Statut mis à jour.", "Status updated."), "success", "documents");
}

export async function savePayrollProfileAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const employeeUserId = first(formData.get("employeeUserId"), 80);
  const salaryBasis = first(formData.get("salaryBasis"), 40);
  const baseSalary = money(formData.get("baseSalary"));
  const hourlyRate = money(formData.get("hourlyRate"));
  const currency = first(formData.get("currency"), 3).toUpperCase();
  const paymentMethod = first(formData.get("paymentMethod"), 40);
  const bankAccountLast4 = first(formData.get("bankAccountLast4"), 4) || null;
  const standardAllowance = money(formData.get("standardAllowance"));
  const standardDeduction = money(formData.get("standardDeduction"));
  const effectiveFrom = dateValue(formData.get("effectiveFrom"), true);

  if (!employeeUserId || !salaryBases.has(salaryBasis) || !paymentMethods.has(paymentMethod) || !effectiveFrom) {
    redirectFinance(text("Profil de rémunération invalide.", "Invalid compensation profile."), "error", "payroll");
  }
  if (!/^[A-Z]{3}$/.test(currency) || [baseSalary, hourlyRate, standardAllowance, standardDeduction].some((value) => !Number.isFinite(value) || value < 0)) {
    redirectFinance(text("Montants ou devise invalides.", "Invalid amounts or currency."), "error", "payroll");
  }
  if (bankAccountLast4 && !/^\d{4}$/.test(bankAccountLast4)) {
    redirectFinance(text("Les 4 derniers chiffres du compte sont invalides.", "Invalid last four account digits."), "error", "payroll");
  }

  const {data: activeMember} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (!activeMember) redirectFinance(text("Employé introuvable.", "Employee not found."), "error", "payroll");

  const {error} = await admin.from("payroll_profiles").upsert({
    organization_id: membership.organization_id,
    employee_user_id: employeeUserId,
    salary_basis: salaryBasis,
    base_salary: baseSalary,
    hourly_rate: hourlyRate,
    currency,
    payment_method: paymentMethod,
    bank_account_last4: bankAccountLast4,
    standard_allowance: standardAllowance,
    standard_deduction: standardDeduction,
    effective_from: effectiveFrom,
    is_active: true,
    created_by: user.id,
  }, {onConflict: "organization_id,employee_user_id"});
  if (error) redirectFinance(text("Enregistrement impossible : ", "Unable to save: ") + error.message, "error", "payroll");

  await auditPayroll({
    organizationId: membership.organization_id,
    actorId: user.id,
    action: "profile_saved",
    employeeUserId,
    details: {salaryBasis, currency},
    admin,
  });
  revalidatePath("/dashboard/finance");
  redirectFinance(text("Profil de rémunération enregistré.", "Compensation profile saved."), "success", "payroll");
}

export async function createPayrollPeriodAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const name = first(formData.get("name"), 160);
  const periodStart = dateValue(formData.get("periodStart"), true);
  const periodEnd = dateValue(formData.get("periodEnd"), true);
  const payDate = dateValue(formData.get("payDate"));
  const currency = first(formData.get("currency"), 3).toUpperCase();

  if (!name || !periodStart || !periodEnd || payDate === "" || !/^[A-Z]{3}$/.test(currency) || periodEnd < periodStart) {
    redirectFinance(text("Période de paie invalide.", "Invalid payroll period."), "error", "payroll");
  }

  const {data: period, error} = await admin
    .from("payroll_periods")
    .insert({
      organization_id: membership.organization_id,
      name,
      period_start: periodStart,
      period_end: periodEnd,
      pay_date: payDate,
      currency,
      status: "open",
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  if (error || !period) redirectFinance(text("Création impossible : ", "Unable to create: ") + (error?.message ?? "unknown error"), "error", "payroll");

  await auditPayroll({
    organizationId: membership.organization_id,
    actorId: user.id,
    action: "period_created",
    periodId: period.id,
    details: {name, periodStart, periodEnd},
    admin,
  });
  revalidatePath("/dashboard/finance");
  redirectFinance(text("Période de paie ouverte.", "Payroll period opened."), "success", "payroll");
}

export async function updatePayrollPeriodStatusAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const periodId = first(formData.get("periodId"), 80);
  const status = first(formData.get("status"), 40);
  if (!periodId || !payrollPeriodStatuses.has(status)) {
    redirectFinance(text("Statut de période invalide.", "Invalid period status."), "error", "payroll");
  }

  const patch: Record<string, unknown> = {status};
  if (status === "approved") {
    patch.approved_by = user.id;
    patch.approved_at = new Date().toISOString();
  }
  if (status === "locked") patch.locked_at = new Date().toISOString();

  const {error} = await admin
    .from("payroll_periods")
    .update(patch)
    .eq("id", periodId)
    .eq("organization_id", membership.organization_id)
    .not("status", "eq", "locked");
  if (error) redirectFinance(text("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "payroll");

  await auditPayroll({
    organizationId: membership.organization_id,
    actorId: user.id,
    action: status === "locked" ? "period_locked" : "period_status_changed",
    periodId,
    details: {status},
    admin,
  });
  revalidatePath("/dashboard/finance");
  redirectFinance(text("Période mise à jour.", "Payroll period updated."), "success", "payroll");
}

export async function savePayrollEntryAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const periodId = first(formData.get("periodId"), 80);
  const employeeUserId = first(formData.get("employeeUserId"), 80);
  const baseAmount = money(formData.get("baseAmount"));
  const overtimeAmount = money(formData.get("overtimeAmount"));
  const bonusAmount = money(formData.get("bonusAmount"));
  const commissionAmount = money(formData.get("commissionAmount"));
  const allowanceAmount = money(formData.get("allowanceAmount"));
  const deductionAmount = money(formData.get("deductionAmount"));
  const taxAmount = money(formData.get("taxAmount"));
  const notes = first(formData.get("notes"), 3000) || null;

  const amounts = [baseAmount, overtimeAmount, bonusAmount, commissionAmount, allowanceAmount, deductionAmount, taxAmount];
  if (!periodId || !employeeUserId || amounts.some((value) => !Number.isFinite(value) || value < 0)) {
    redirectFinance(text("Données de paie invalides.", "Invalid payroll data."), "error", "payroll");
  }

  const [{data: period}, {data: member}] = await Promise.all([
    admin
      .from("payroll_periods")
      .select("id, status")
      .eq("id", periodId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; status: string}>(),
    admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", employeeUserId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  if (!period || !member || ["locked", "cancelled"].includes(period.status)) {
    redirectFinance(text("Période ou employé indisponible.", "Period or employee unavailable."), "error", "payroll");
  }

  const {data: entry, error} = await admin
    .from("payroll_entries")
    .upsert({
      organization_id: membership.organization_id,
      payroll_period_id: periodId,
      employee_user_id: employeeUserId,
      base_amount: baseAmount,
      overtime_amount: overtimeAmount,
      bonus_amount: bonusAmount,
      commission_amount: commissionAmount,
      allowance_amount: allowanceAmount,
      deduction_amount: deductionAmount,
      tax_amount: taxAmount,
      notes,
      status: "review",
      created_by: user.id,
    }, {onConflict: "payroll_period_id,employee_user_id"})
    .select("id")
    .single<{id: string}>();
  if (error || !entry) redirectFinance(text("Enregistrement impossible : ", "Unable to save: ") + (error?.message ?? "unknown error"), "error", "payroll");

  await auditPayroll({
    organizationId: membership.organization_id,
    actorId: user.id,
    action: "entry_saved",
    periodId,
    entryId: entry.id,
    employeeUserId,
    admin,
  });
  revalidatePath("/dashboard/finance");
  redirectFinance(text("Ligne de paie enregistrée.", "Payroll entry saved."), "success", "payroll");
}

export async function publishPayslipAction(formData: FormData) {
  const {user, membership, admin, text} = await getContext();
  const payrollEntryId = first(formData.get("payrollEntryId"), 80);
  const passwordMode = first(formData.get("passwordMode"), 40);
  const passwordHint = first(formData.get("passwordHint"), 240) || null;
  const passwordProtected = passwordMode !== "none";
  const pending = readPendingAttachment(formData, "payslipDocument");

  if (!payrollEntryId || !passwordModes.has(passwordMode) || !pending) {
    redirectFinance(text("Bulletin ou fichier invalide.", "Invalid payslip or file."), "error", "payroll");
  }
  if (pending.mimeType !== "application/pdf") {
    redirectFinance(text("Le bulletin doit être un fichier PDF.", "The payslip must be a PDF file."), "error", "payroll");
  }

  const {data: entry} = await admin
    .from("payroll_entries")
    .select("id, payroll_period_id, employee_user_id, status")
    .eq("id", payrollEntryId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; payroll_period_id: string; employee_user_id: string; status: string}>();
  if (!entry || entry.status === "cancelled") {
    redirectFinance(text("Ligne de paie introuvable.", "Payroll entry not found."), "error", "payroll");
  }

  const {data: existing} = await admin
    .from("payslips")
    .select("id, storage_path")
    .eq("payroll_entry_id", payrollEntryId)
    .maybeSingle<{id: string; storage_path: string}>();

  let attachment: Awaited<ReturnType<typeof finalizeTemporaryAttachment>>;
  try {
    attachment = await finalizeTemporaryAttachment({
      admin,
      organizationId: membership.organization_id,
      userId: user.id,
      purpose: "payslip",
      recordId: payrollEntryId,
      pending,
    });
  } catch (error) {
    redirectFinance(
      text("Le PDF n’a pas pu être sécurisé : ", "The PDF could not be secured: ") +
        (error instanceof Error ? error.message : "unknown error"),
      "error",
      "payroll",
    );
  }

  const {data: payslip, error} = await admin
    .from("payslips")
    .upsert({
      organization_id: membership.organization_id,
      payroll_entry_id: payrollEntryId,
      employee_user_id: entry.employee_user_id,
      password_protected: passwordProtected,
      password_mode: passwordMode,
      password_hint: passwordHint,
      storage_path: attachment.storagePath,
      file_name: attachment.fileName,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      published_by: user.id,
      published_at: new Date().toISOString(),
    }, {onConflict: "payroll_entry_id"})
    .select("id")
    .single<{id: string}>();

  if (error || !payslip) {
    await removePrivateAttachment(admin, attachment.storagePath);
    redirectFinance(text("Publication impossible : ", "Unable to publish: ") + (error?.message ?? "unknown error"), "error", "payroll");
  }

  if (existing?.storage_path && existing.storage_path !== attachment.storagePath) {
    await removePrivateAttachment(admin, existing.storage_path);
  }
  await admin.from("payroll_entries").update({status: "published"}).eq("id", payrollEntryId);

  await auditPayroll({
    organizationId: membership.organization_id,
    actorId: user.id,
    action: "payslip_published",
    periodId: entry.payroll_period_id,
    entryId: payrollEntryId,
    payslipId: payslip.id,
    employeeUserId: entry.employee_user_id,
    details: {passwordProtected, passwordMode},
    admin,
  });

  await createNotification({
    organizationId: membership.organization_id,
    userId: entry.employee_user_id,
    actorId: user.id,
    category: "finance",
    eventType: "payslip_published",
    titleFr: "Nouveau bulletin de paie disponible",
    titleEn: "New payslip available",
    bodyFr: "Ton bulletin de paie est disponible dans ton espace privé. Le PDF peut demander ton mot de passe.",
    bodyEn: "Your payslip is available in your private space. The PDF may require your password.",
    actionUrl: "/dashboard/my-payslips",
    priority: "success",
    dedupeKey: `payslip:${payslip.id}:published`,
    metadata: {payslipId: payslip.id, payrollEntryId},
  });

  revalidatePath("/dashboard/finance");
  revalidatePath("/dashboard/my-payslips");
  redirectFinance(text("Bulletin publié dans l’espace privé de l’employé.", "Payslip published to the employee’s private space."), "success", "payroll");
}
