"use server";

import {createHash} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {
  COMMERCIAL_MANAGER_ROLES,
  PRODUCT_MANAGER_ROLES,
  canUseCommercialModules,
} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {canManageSensitiveFinanceData, canVerifySalesForFinance} from "@/lib/auth/sensitive-finance-access";
import {createNotification} from "@/lib/notifications/service";
import {cancelOpenSaleFinanceDocuments, ensureSaleInvoice, ensureSaleProforma} from "@/lib/finance/sale-documents";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = COMMERCIAL_MANAGER_ROLES;
const productManagerRoles = PRODUCT_MANAGER_ROLES;
const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);
const paymentMethods = new Set([
  "bank_transfer",
  "card",
  "cash",
  "mobile_money",
  "cheque",
  "other",
]);
const reviewStatuses = new Set([
  "verified",
  "approved",
  "rejected",
  "cancelled",
  "refunded",
]);
const paymentPlanTypes = new Set(["full", "deposit_balance", "installments", "custom"]);
const initialPaymentTypes = new Set(["percentage", "fixed"]);
const settlementModes = new Set(["full", "installments"]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type ProductRow = {
  id: string;
  organization_id: string;
  name: string;
  commission_type: string;
  commission_value: number | string;
  currency: string;
  proof_required: boolean;
  is_active: boolean;
  payment_plan_type: string;
  initial_payment_type: string;
  initial_payment_value: number | string;
  max_installments: number | null;
};

type SaleRow = {
  id: string;
  organization_id: string;
  seller_id: string;
  workflow_status: string;
  commission_amount: number | string;
};

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/sales?${kind}=${encodeURIComponent(message)}`);
}

function saleFormError(message: string, field: string): never {
  redirect(`/dashboard/sales?error=${encodeURIComponent(message)}&field=${encodeURIComponent(field)}`);
}

function commissionGo(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/commissions?${kind}=${encodeURIComponent(message)}`);
}

function parseMoney(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
}

function parseInteger(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function normalizeCurrency(value: FormDataEntryValue | null) {
  const currency = String(value ?? "USD").trim().toUpperCase();
  return currencies.has(currency) ? currency : "";
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : raw;
}

function cleanOptional(value: FormDataEntryValue | null, maxLength: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizedFingerprintPart(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}

function buildSaleDeduplicationKey(input: {
  customerEmail: string | null;
  customerPhone: string | null;
  productId: string | null;
  productName: string;
  saleDate: string;
  totalAmount: number;
  currency: string;
}) {
  const customerIdentity = normalizedFingerprintPart(input.customerPhone)
    || normalizedFingerprintPart(input.customerEmail);
  const productIdentity = input.productId || normalizedFingerprintPart(input.productName);
  return createHash("sha256").update([
    customerIdentity,
    productIdentity,
    input.saleDate,
    input.totalAmount.toFixed(2),
    input.currency,
  ].join("|")).digest("hex");
}

function buildContactSaleKey(contact: string | null, productIdentity: string, saleDate: string, totalAmount: number, currency: string) {
  const normalizedContact = normalizedFingerprintPart(contact);
  if (!normalizedContact) return null;
  return createHash("sha256").update([
    normalizedContact,
    productIdentity,
    saleDate,
    totalAmount.toFixed(2),
    currency,
  ].join("|")).digest("hex");
}

async function getContext() {
  const {t} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError) {
    go(t("sales.messages.organisationLoadFailed", {message: membershipError.message}), "error");
  }
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "crm_sales");
  if (!canUseCommercialModules(membership.role)) {
    redirect("/dashboard/performance");
  }

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  return {user: authData.user, membership, admin, t, visibleUserIds};
}

async function ensureActiveMember(
  organizationId: string,
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function auditSale({
  organizationId,
  saleId,
  actorId,
  action,
  oldStatus,
  newStatus,
  note,
  admin,
}: {
  organizationId: string;
  saleId: string;
  actorId: string;
  action: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  note?: string | null;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await admin.from("sales_audit_log").insert({
    organization_id: organizationId,
    sale_id: saleId,
    actor_id: actorId,
    action,
    old_status: oldStatus ?? null,
    new_status: newStatus ?? null,
    note: note ?? null,
  });
  if (error) console.error("Sales audit log insert failed", error);
}

export async function createSalesProductAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!productManagerRoles.has(membership.role)) {
    go(t("sales.messages.productPermissionDenied"), "error");
  }

  const name = String(formData.get("name") ?? "").trim();
  const code = cleanOptional(formData.get("code"), 60);
  const description = cleanOptional(formData.get("description"), 1500);
  const defaultPrice = parseMoney(formData.get("defaultPrice"));
  const currency = normalizeCurrency(formData.get("currency"));
  const commissionType = "fixed";
  const commissionValue = 0;
  const proofRequired = formData.get("proofRequired") === "on";
  const paymentPlanType = String(formData.get("paymentPlanType") ?? "full");
  const initialPaymentType = String(formData.get("initialPaymentType") ?? "percentage");
  const initialPaymentValue = parseMoney(formData.get("initialPaymentValue"));
  const rawMaxInstallments = String(formData.get("maxInstallments") ?? "").trim();
  const maxInstallments = rawMaxInstallments ? parseInteger(formData.get("maxInstallments")) : null;

  if (name.length < 2 || name.length > 160) {
    go(t("sales.messages.invalidProductName"), "error");
  }
  if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
    go(t("sales.messages.invalidPrice"), "error");
  }
  if (!currency) go(t("sales.messages.invalidCurrency"), "error");
  if (!paymentPlanTypes.has(paymentPlanType)) {
    go(t("sales.messages.invalidPaymentPlan"), "error");
  }
  if (!initialPaymentTypes.has(initialPaymentType)) {
    go(t("sales.messages.invalidInitialPaymentType"), "error");
  }
  if (!Number.isFinite(initialPaymentValue) || initialPaymentValue < 0) {
    go(t("sales.messages.invalidInitialPayment"), "error");
  }
  if (initialPaymentType === "percentage" && initialPaymentValue > 100) {
    go(t("sales.messages.invalidInitialPaymentPercentage"), "error");
  }
  if (maxInstallments !== null && (!Number.isInteger(maxInstallments) || maxInstallments < 1 || maxInstallments > 120)) {
    go(t("sales.messages.invalidMaxInstallments"), "error");
  }

  const {error} = await admin.from("sales_products").insert({
    organization_id: membership.organization_id,
    name,
    code,
    description,
    default_price: defaultPrice,
    currency,
    commission_type: commissionType,
    commission_value: commissionValue,
    proof_required: proofRequired,
    payment_plan_type: paymentPlanType,
    initial_payment_type: initialPaymentType,
    initial_payment_value: initialPaymentValue,
    max_installments: maxInstallments,
    created_by: user.id,
  });

  if (error) {
    const message = error.code === "23505"
      ? t("sales.messages.duplicateProductCode")
      : t("sales.messages.productCreateFailed", {message: error.message});
    go(message, "error");
  }

  revalidatePath("/dashboard/sales");
  go(t("sales.messages.productCreated"));
}

export async function toggleSalesProductAction(formData: FormData) {
  const {membership, admin, t} = await getContext();
  if (!productManagerRoles.has(membership.role)) {
    go(t("sales.messages.productPermissionDenied"), "error");
  }

  const productId = String(formData.get("productId") ?? "").trim();
  const activate = String(formData.get("activate") ?? "") === "true";
  if (!productId) go(t("sales.messages.productNotFound"), "error");

  const {error} = await admin
    .from("sales_products")
    .update({is_active: activate})
    .eq("id", productId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    go(t("sales.messages.productUpdateFailed", {message: error.message}), "error");
  }

  revalidatePath("/dashboard/sales");
  go(activate ? t("sales.messages.productActivated") : t("sales.messages.productDisabled"));
}

export async function createSaleAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();

  const requestedSellerId = String(formData.get("sellerId") ?? user.id).trim() || user.id;
  if (leaderRoles.has(membership.role) && !visibleUserIds.includes(requestedSellerId)) {
    go(t("sales.messages.sellerNotActive"), "error");
  }
  const sellerId = leaderRoles.has(membership.role) ? requestedSellerId : user.id;
  const productId = String(formData.get("productId") ?? "").trim() || null;
  const customProductName = String(formData.get("customProductName") ?? "").trim();
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerEmail = cleanOptional(formData.get("customerEmail"), 254);
  const customerPhone = cleanOptional(formData.get("customerPhone"), 80);
  const ambassadorId = String(formData.get("ambassadorId") ?? "").trim() || null;
  const saleDate = normalizeDate(formData.get("saleDate"));
  const quantity = parseInteger(formData.get("quantity"));
  const unitPrice = parseMoney(formData.get("unitPrice"));
  const currency = normalizeCurrency(formData.get("currency"));
  const contractReference = cleanOptional(formData.get("contractReference"), 160);
  const noInitialPayment = formData.get("noInitialPayment") === "on";
  const initialPaymentAmountRaw = noInitialPayment ? "0" : String(formData.get("initialPaymentAmount") ?? "").trim();
  const initialPaymentAmount = noInitialPayment ? 0 : (initialPaymentAmountRaw ? parseMoney(formData.get("initialPaymentAmount")) : 0);
  const settlementMode = String(formData.get("settlementMode") ?? "").trim();
  const initialPaymentDate = initialPaymentAmount > 0 ? normalizeDate(formData.get("initialPaymentDate")) : null;
  const paymentMethod = String(formData.get("paymentMethod") ?? "bank_transfer");
  const initialPaymentReference = cleanOptional(formData.get("initialPaymentReference"), 160);
  const proofUrl = cleanOptional(formData.get("proofUrl"), 1000);
  const pendingProof = readPendingAttachment(formData, "proof");
  const nextPaymentDueDate = settlementMode === "installments"
    ? normalizeDate(formData.get("nextPaymentDueDate"))
    : null;
  const nextPaymentAmountRaw = settlementMode === "installments"
    ? String(formData.get("nextPaymentAmount") ?? "").trim()
    : "";
  const nextPaymentAmount = nextPaymentAmountRaw
    ? parseMoney(formData.get("nextPaymentAmount"))
    : null;
  const requestedCollectionOwnerId = String(formData.get("collectionOwnerId") ?? "").trim() || null;
  if (
    requestedCollectionOwnerId &&
    leaderRoles.has(membership.role) &&
    !visibleUserIds.includes(requestedCollectionOwnerId)
  ) {
    go(t("sales.messages.collectorNotActive"), "error");
  }
  const collectionOwnerId = leaderRoles.has(membership.role) ? requestedCollectionOwnerId : null;
  const notes = cleanOptional(formData.get("notes"), 3000);

  if (!(await ensureActiveMember(membership.organization_id, sellerId, admin))) {
    go(t("sales.messages.sellerNotActive"), "error");
  }
  if (collectionOwnerId && !(await ensureActiveMember(membership.organization_id, collectionOwnerId, admin))) {
    go(t("sales.messages.collectorNotActive"), "error");
  }
  if (customerName.length < 2 || customerName.length > 200) {
    saleFormError(t("sales.messages.invalidCustomerName"), "customerName");
  }
  if (!normalizedFingerprintPart(customerPhone) && !normalizedFingerprintPart(customerEmail)) {
    saleFormError("Le téléphone ou l’adresse e-mail du client est obligatoire pour empêcher les doubles ventes.", "customerPhone");
  }
  if (ambassadorId) {
    const {data: ambassador, error: ambassadorError} = await admin
      .from("crm_ambassadors")
      .select("id")
      .eq("id", ambassadorId)
      .eq("organization_id", membership.organization_id)
      .eq("status", "active")
      .maybeSingle();
    if (ambassadorError || !ambassador) {
      go(t("sales.messages.ambassadorNotActive"), "error");
    }
  }
  if (!saleDate) saleFormError(t("sales.messages.invalidSaleDate"), "saleDate");
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000) {
    saleFormError(t("sales.messages.invalidQuantity"), "quantity");
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    saleFormError(t("sales.messages.invalidPrice"), "unitPrice");
  }
  if (!currency) saleFormError(t("sales.messages.invalidCurrency"), "currency");
  if (!settlementModes.has(settlementMode)) {
    saleFormError(t("sales.messages.invalidSettlementMode"), "settlementMode");
  }
  if (!noInitialPayment && (initialPaymentAmount <= 0 || !Number.isFinite(initialPaymentAmount))) {
    saleFormError(t("sales.messages.invalidInitialPayment"), "initialPaymentAmount");
  }
  if (noInitialPayment && settlementMode !== "installments") {
    saleFormError("Une vente sans paiement initial doit utiliser le mode de reglement echelonne.", "settlementMode");
  }
  if (initialPaymentAmount > 0 && !initialPaymentDate) {
    saleFormError(t("sales.messages.invalidInitialPaymentDate"), "initialPaymentDate");
  }
  if (initialPaymentAmount > 0 && !paymentMethods.has(paymentMethod)) {
    saleFormError(t("sales.messages.invalidPaymentMethod"), "paymentMethod");
  }
  if (settlementMode === "installments" && nextPaymentDueDate === "") {
    saleFormError(t("sales.messages.invalidNextPaymentDate"), "nextPaymentDueDate");
  }
  if (settlementMode === "installments" && nextPaymentAmount !== null && (!Number.isFinite(nextPaymentAmount) || nextPaymentAmount < 0)) {
    saleFormError(t("sales.messages.invalidNextPaymentAmount"), "nextPaymentAmount");
  }

  let product: ProductRow | null = null;
  if (productId) {
    const {data, error} = await admin
      .from("sales_products")
      .select("id, organization_id, name, commission_type, commission_value, currency, proof_required, is_active, payment_plan_type, initial_payment_type, initial_payment_value, max_installments")
      .eq("id", productId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<ProductRow>();
    if (error || !data || !data.is_active) {
      go(t("sales.messages.productNotFound"), "error");
    }
    product = data;
  }

  const productName = product?.name ?? customProductName;
  if (productName.length < 2 || productName.length > 200) {
    saleFormError(t("sales.messages.productRequired"), "customProductName");
  }
  if (product?.proof_required && !pendingProof && !noInitialPayment) {
    saleFormError(t("sales.messages.proofRequired"), "proof");
  }

  const saleCurrency = product?.currency ?? currency;
  const totalAmount = Math.round(quantity * unitPrice * 100) / 100;
  if (totalAmount <= 0) saleFormError(t("sales.messages.invalidPrice"), "unitPrice");
  if (initialPaymentAmount > totalAmount) {
    saleFormError(t("sales.messages.initialPaymentExceedsTotal"), "initialPaymentAmount");
  }

  const commissionType = "fixed";
  const commissionValue = 0;
  if (settlementMode === "full" && initialPaymentAmount !== totalAmount) saleFormError(t("sales.messages.fullPaymentMustMatchTotal"), "initialPaymentAmount");
  if (settlementMode === "installments" && initialPaymentAmount >= totalAmount) saleFormError(t("sales.messages.installmentPaymentMustLeaveBalance"), "initialPaymentAmount");
  if (settlementMode === "installments" && (!nextPaymentDueDate || nextPaymentAmount === null || nextPaymentAmount <= 0)) saleFormError(t("sales.messages.nextPaymentRequired"), !nextPaymentDueDate ? "nextPaymentDueDate" : "nextPaymentAmount");
  if (settlementMode === "installments" && nextPaymentAmount !== null && nextPaymentAmount > totalAmount - initialPaymentAmount) saleFormError(t("sales.messages.nextPaymentExceedsBalance"), "nextPaymentAmount");
  if (!pendingProof && !noInitialPayment) saleFormError(t("sales.messages.proofRequired"), "proof");

  const paymentPlanType = settlementMode;
  const initialPaymentType = "fixed";
  const initialPaymentValue = initialPaymentAmount;

  const deduplicationKey = buildSaleDeduplicationKey({
    customerEmail,
    customerPhone,
    productId: product?.id ?? null,
    productName,
    saleDate,
    totalAmount,
    currency: saleCurrency,
  });
  const productIdentity = product?.id ?? normalizedFingerprintPart(productName);
  const phoneDeduplicationKey = buildContactSaleKey(customerPhone, productIdentity, saleDate, totalAmount, saleCurrency);
  const emailDeduplicationKey = buildContactSaleKey(customerEmail, productIdentity, saleDate, totalAmount, saleCurrency);

  const {data: possibleDuplicates, error: duplicateLookupError} = await admin
    .from("sales_records")
    .select("id,customer_phone,customer_email,product_id,product_name")
    .eq("organization_id", membership.organization_id)
    .eq("sale_date", saleDate)
    .eq("total_amount", totalAmount)
    .eq("currency", saleCurrency)
    .not("workflow_status", "in", "(rejected,cancelled,refunded)")
    .limit(100);
  if (duplicateLookupError) go(t("sales.messages.saleCreateFailed", {message: duplicateLookupError.message}), "error");
  const duplicateExists = (possibleDuplicates ?? []).some((candidate) => {
    const candidateProductIdentity = candidate.product_id ?? normalizedFingerprintPart(candidate.product_name);
    if (candidateProductIdentity !== productIdentity) return false;
    return Boolean(
      (phoneDeduplicationKey && normalizedFingerprintPart(candidate.customer_phone) === normalizedFingerprintPart(customerPhone))
      || (emailDeduplicationKey && normalizedFingerprintPart(candidate.customer_email) === normalizedFingerprintPart(customerEmail)),
    );
  });
  if (duplicateExists) go(t("sales.messages.duplicateSale"), "error");

  const {data: sale, error} = await admin
    .from("sales_records")
    .insert({
      organization_id: membership.organization_id,
      seller_id: sellerId,
      product_id: product?.id ?? null,
      product_name: productName,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      ambassador_id: ambassadorId,
      sale_date: saleDate,
      quantity,
      unit_price: unitPrice,
      total_amount: totalAmount,
      currency: saleCurrency,
      payment_method: paymentMethod,
      payment_status: "unpaid",
      workflow_status: "submitted",
      transaction_reference: contractReference,
      proof_url: proofUrl,
      notes,
      commission_type: commissionType,
      commission_value: commissionValue,
      commission_amount: 0,
      commission_status: "pending",
      commission_rule: "first_payment_only",
      payment_plan_type: paymentPlanType,
      initial_payment_type: initialPaymentType,
      initial_payment_value: initialPaymentValue,
      paid_amount: 0,
      balance_amount: totalAmount,
      collection_owner_id: collectionOwnerId,
      collection_status: collectionOwnerId ? "assigned" : "not_started",
      transferred_to_collection_at: collectionOwnerId ? new Date().toISOString() : null,
      next_payment_due_date: nextPaymentDueDate,
      next_payment_amount: nextPaymentAmount,
      created_by: user.id,
      deduplication_key: deduplicationKey,
      phone_deduplication_key: phoneDeduplicationKey,
      email_deduplication_key: emailDeduplicationKey,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !sale) {
    const message = error?.code === "23505"
      ? t(error?.message?.includes("sales_records_active_deduplication_unique")
          ? "sales.messages.duplicateSale"
          : "sales.messages.duplicateTransaction")
      : t("sales.messages.saleCreateFailed", {message: error?.message ?? t("common.unknownError")});
    go(message, "error");
  }

  let finalizedProof = null;
  if (pendingProof) {
    try {
      finalizedProof = await finalizeTemporaryAttachment({
        admin,
        organizationId: membership.organization_id,
        userId: user.id,
        purpose: "sale",
        recordId: sale.id,
        pending: pendingProof,
      });
      const {error: proofUpdateError} = await admin.from("sales_records").update({
        proof_storage_path: finalizedProof.storagePath,
        proof_file_name: finalizedProof.fileName,
        proof_mime_type: finalizedProof.mimeType,
        proof_size_bytes: finalizedProof.sizeBytes,
        proof_uploaded_at: new Date().toISOString(),
      }).eq("id", sale.id).eq("organization_id", membership.organization_id);
      if (proofUpdateError) throw proofUpdateError;
    } catch (proofError) {
      await removePrivateAttachment(admin, finalizedProof?.storagePath ?? pendingProof.storagePath);
      await admin.from("sales_records").delete().eq("id", sale.id).eq("organization_id", membership.organization_id);
      go(t("attachments.messages.finalizeFailed", {
        message: proofError instanceof Error ? proofError.message : t("common.unknownError"),
      }), "error");
    }
  }

  if (initialPaymentAmount > 0) {
    const {error: paymentError} = await admin.from("sales_payments").insert({
      organization_id: membership.organization_id,
      sale_id: sale.id,
      payment_date: initialPaymentDate,
      amount: initialPaymentAmount,
      currency: saleCurrency,
      payment_method: paymentMethod,
      transaction_reference: initialPaymentReference,
      proof_url: proofUrl,
      proof_storage_path: finalizedProof?.storagePath ?? null,
      proof_file_name: finalizedProof?.fileName ?? null,
      proof_mime_type: finalizedProof?.mimeType ?? null,
      proof_size_bytes: finalizedProof?.sizeBytes ?? null,
      proof_uploaded_at: finalizedProof ? new Date().toISOString() : null,
      status: "pending",
      recorded_by: user.id,
      notes: t("sales.initialPaymentPendingNote"),
    });
    if (paymentError) {
      await removePrivateAttachment(admin, finalizedProof?.storagePath);
      await admin.from("sales_records").delete().eq("id", sale.id);
      const message = paymentError.code === "23505"
        ? t("sales.messages.duplicateTransaction")
        : t("sales.messages.initialPaymentCreateFailed", {message: paymentError.message});
      go(message, "error");
    }
  }

  if (noInitialPayment) {
    try {
      await ensureSaleProforma({admin, organizationId: membership.organization_id, saleId: sale.id, actorId: user.id});
    } catch (documentError) {
      await removePrivateAttachment(admin, finalizedProof?.storagePath);
      await admin.from("sales_records").delete().eq("id", sale.id).eq("organization_id", membership.organization_id);
      go(`La vente n'a pas pu etre finalisee car la pro forma automatique n'a pas pu etre generee : ${documentError instanceof Error ? documentError.message : "erreur inconnue"}`, "error");
    }
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId: sale.id,
    actorId: user.id,
    action: "created",
    newStatus: "submitted",
    note: notes,
    admin,
  });
  if (finalizedProof) {
    await auditSale({
      organizationId: membership.organization_id,
      saleId: sale.id,
      actorId: user.id,
      action: "proof_uploaded",
      note: finalizedProof.fileName,
      admin,
    });
  }

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/collections");
  revalidatePath("/dashboard");
  redirect(`/dashboard/sales?success=${encodeURIComponent(initialPaymentAmount > 0 ? t("sales.messages.saleAndPaymentSubmitted") : t("sales.messages.saleSubmitted"))}&saleCreated=1`);
}

export async function reviewSaleAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const isLeader = leaderRoles.has(membership.role);
  const canFinanceVerify = await canVerifySalesForFinance(admin, membership.organization_id, user.id, membership.role);
  if (!isLeader && !canFinanceVerify) {
    go(t("sales.messages.reviewPermissionDenied"), "error");
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const workflowStatus = String(formData.get("workflowStatus") ?? "").trim();
  const note = cleanOptional(formData.get("reviewNote"), 1500);
  const returnTo = String(formData.get("returnTo") ?? "");

  if (!saleId || !reviewStatuses.has(workflowStatus)) {
    go(t("sales.messages.invalidReviewStatus"), "error");
  }
  if (workflowStatus === "rejected" && !note) {
    if (returnTo === "finance" && saleId) {
      redirect(`/dashboard/sales?status=verified&sale=${encodeURIComponent(saleId)}&from=finance&error=${encodeURIComponent("Le motif du rejet est obligatoire.")}#validation-queue`);
    }
    go("Le motif du rejet est obligatoire.", "error");
  }
  const {data: sale, error: saleError} = await admin
    .from("sales_records")
    .select("id, organization_id, seller_id, workflow_status, commission_amount")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<SaleRow>();

  if (saleError || !sale) go(t("sales.messages.saleNotFound"), "error");
  const isFinanceVerification = canFinanceVerify && sale.workflow_status === "submitted" && workflowStatus === "verified";
  if (isLeader && membership.role === "manager" && !visibleUserIds.includes(sale.seller_id) && !isFinanceVerification) {
    go(t("sales.messages.reviewPermissionDenied"), "error");
  }
  if (!isLeader && !isFinanceVerification) {
    go(t("sales.messages.reviewPermissionDenied"), "error");
  }

  const updates: Record<string, string | null> = {
    workflow_status: workflowStatus,
  };

  if (workflowStatus === "approved") {
    updates.approved_by = user.id;
    updates.approved_at = new Date().toISOString();
    updates.commission_status = Number(sale.commission_amount) > 0 ? "payable" : "pending";
  } else if (["rejected", "cancelled", "refunded"].includes(workflowStatus)) {
    updates.commission_status = "cancelled";
  } else if (workflowStatus === "verified") {
    updates.commission_status = "validated";
  }

  const {error} = await admin
    .from("sales_records")
    .update(updates)
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    go(t("sales.messages.reviewFailed", {message: error.message}), "error");
  }

  const {error: refreshError} = await admin.rpc("refresh_sales_payment_summary", {p_sale_id: saleId});
  if (refreshError) {
    go(t("sales.messages.paymentSummaryFailed", {message: refreshError.message}), "error");
  }

  let financeDocumentWarning: string | null = null;
  try {
    if (workflowStatus === "approved") {
      await ensureSaleInvoice({admin, organizationId: membership.organization_id, saleId, actorId: user.id});
    } else if (["rejected", "cancelled", "refunded"].includes(workflowStatus)) {
      await cancelOpenSaleFinanceDocuments({admin, organizationId: membership.organization_id, saleId, actorId: user.id, reason: `sale_${workflowStatus}`});
    }
  } catch (documentError) {
    financeDocumentWarning = documentError instanceof Error ? documentError.message : "Synchronisation des documents Finance impossible.";
    console.error("Automatic sale finance document sync failed", documentError);
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId,
    actorId: user.id,
    action: "reviewed",
    oldStatus: sale.workflow_status,
    newStatus: workflowStatus,
    note,
    admin,
  });

  if (["approved", "rejected"].includes(workflowStatus)) {
    await createNotification({
      organizationId: membership.organization_id,
      userId: sale.seller_id,
      actorId: user.id,
      category: "sales",
      eventType: `sale_${workflowStatus}`,
      titleFr: workflowStatus === "approved" ? "Vente approuvée" : "Vente rejetée",
      titleEn: workflowStatus === "approved" ? "Sale approved" : "Sale rejected",
      bodyFr: workflowStatus === "approved"
        ? "Votre vente a été approuvée et la facture a été générée."
        : `Votre vente a été rejetée. Motif : ${note}`,
      bodyEn: workflowStatus === "approved"
        ? "Your sale was approved and the invoice was generated."
        : `Your sale was rejected. Reason: ${note}`,
      actionUrl: `/dashboard/sales?sale=${saleId}`,
      priority: workflowStatus === "approved" ? "success" : "warning",
      dedupeKey: `sale-decision:${saleId}:${workflowStatus}`,
      metadata: {saleId, workflowStatus},
    });
  }

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/collections");
  revalidatePath("/dashboard/finance");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard");
  const resultMessage = financeDocumentWarning ? `${t("sales.messages.saleUpdated")} Document Finance a verifier : ${financeDocumentWarning}` : t("sales.messages.saleUpdated");
  if (returnTo === "finance") {
    redirect(`/dashboard/finance?view=overview&${financeDocumentWarning ? "error" : "success"}=${encodeURIComponent(resultMessage)}`);
  }
  go(resultMessage, financeDocumentWarning ? "error" : "success");
}

export async function requestSaleProofAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const saleId = String(formData.get("saleId") ?? "").trim();
  const canFinanceVerify = await canVerifySalesForFinance(admin, membership.organization_id, user.id, membership.role);
  if (!saleId || (!leaderRoles.has(membership.role) && !canFinanceVerify)) {
    go("Vous n’êtes pas autorisé à demander ce justificatif.", "error");
  }

  const {data: sale, error} = await admin
    .from("sales_records")
    .select("id,seller_id,customer_name,workflow_status,proof_storage_path")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; seller_id: string; customer_name: string; workflow_status: string; proof_storage_path: string | null}>();
  if (error || !sale) go("Vente introuvable.", "error");
  if (sale.proof_storage_path) go("Le justificatif est déjà disponible.");

  await createNotification({
    organizationId: membership.organization_id,
    userId: sale.seller_id,
    actorId: user.id,
    category: "sales",
    eventType: "sale_proof_requested",
    titleFr: "Justificatif de paiement demandé",
    titleEn: "Payment receipt requested",
    bodyFr: `Finance demande le justificatif de paiement de la vente ${sale.customer_name}.`,
    bodyEn: `Finance requested the payment receipt for the ${sale.customer_name} sale.`,
    actionUrl: `/dashboard/sales?sale=${sale.id}`,
    priority: "urgent",
    requiresAction: true,
    dedupeKey: `sale-proof-request:${sale.id}`,
    metadata: {saleId: sale.id},
  });
  await auditSale({organizationId: membership.organization_id, saleId: sale.id, actorId: user.id, action: "proof_requested", oldStatus: sale.workflow_status, newStatus: sale.workflow_status, note: "Justificatif demandé au vendeur", admin});
  revalidatePath("/dashboard/notifications");
  redirect(`/dashboard/finance?view=overview&success=${encodeURIComponent("La demande de justificatif a été envoyée au vendeur.")}`);
}

export async function uploadExistingSaleProofAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const saleId = String(formData.get("saleId") ?? "").trim();
  const pendingProof = readPendingAttachment(formData, "proof");
  if (!saleId || !pendingProof) go("Sélectionnez un justificatif de paiement.", "error");

  const {data: sale, error} = await admin
    .from("sales_records")
    .select("id,seller_id,workflow_status,proof_storage_path")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; seller_id: string; workflow_status: string; proof_storage_path: string | null}>();
  if (error || !sale || sale.seller_id !== user.id || !["submitted", "verified"].includes(sale.workflow_status)) {
    go("Vous ne pouvez pas modifier le justificatif de cette vente.", "error");
  }

  let finalizedProof = null;
  try {
    finalizedProof = await finalizeTemporaryAttachment({admin, organizationId: membership.organization_id, userId: user.id, purpose: "sale", recordId: sale.id, pending: pendingProof});
    const proofValues = {proof_storage_path: finalizedProof.storagePath, proof_file_name: finalizedProof.fileName, proof_mime_type: finalizedProof.mimeType, proof_size_bytes: finalizedProof.sizeBytes, proof_uploaded_at: new Date().toISOString()};
    const {error: saleUpdateError} = await admin.from("sales_records").update(proofValues).eq("id", sale.id).eq("organization_id", membership.organization_id);
    if (saleUpdateError) throw saleUpdateError;
    const {error: paymentUpdateError} = await admin.from("sales_payments").update(proofValues).eq("sale_id", sale.id).eq("organization_id", membership.organization_id).eq("status", "pending");
    if (paymentUpdateError) throw paymentUpdateError;
  } catch (proofError) {
    if (finalizedProof) await removePrivateAttachment(admin, finalizedProof.storagePath);
    go(`Enregistrement du justificatif impossible : ${proofError instanceof Error ? proofError.message : "erreur inconnue"}`, "error");
  }

  await auditSale({organizationId: membership.organization_id, saleId: sale.id, actorId: user.id, action: "proof_uploaded", oldStatus: sale.workflow_status, newStatus: sale.workflow_status, note: finalizedProof.fileName, admin});
  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/finance");
  redirect(`/dashboard/sales?sale=${sale.id}&success=${encodeURIComponent("Justificatif enregistré. Finance peut maintenant vérifier la vente.")}`);
}

export async function cancelOwnSaleAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const saleId = String(formData.get("saleId") ?? "").trim();
  if (!saleId) go(t("sales.messages.saleNotFound"), "error");

  const {data: sale, error: saleError} = await admin
    .from("sales_records")
    .select("id, organization_id, seller_id, workflow_status, commission_amount")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .eq("seller_id", user.id)
    .maybeSingle<SaleRow>();

  if (saleError || !sale) go(t("sales.messages.saleNotFound"), "error");
  if (!["draft", "submitted"].includes(sale.workflow_status)) {
    go(t("sales.messages.saleCannotBeCancelled"), "error");
  }

  const {error} = await admin
    .from("sales_records")
    .update({workflow_status: "cancelled", commission_status: "cancelled"})
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .eq("seller_id", user.id);

  if (error) go(t("sales.messages.cancelFailed", {message: error.message}), "error");

  try {
    await cancelOpenSaleFinanceDocuments({admin, organizationId: membership.organization_id, saleId, actorId: user.id, reason: "cancelled_by_seller"});
  } catch (documentError) {
    console.error("Automatic sale finance document cancellation failed", documentError);
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId,
    actorId: user.id,
    action: "cancelled_by_seller",
    oldStatus: sale.workflow_status,
    newStatus: "cancelled",
    admin,
  });

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/collections");
  revalidatePath("/dashboard");
  go(t("sales.messages.saleCancelled"));
}

export async function markCommissionPaidAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!(await canManageSensitiveFinanceData(admin, membership.organization_id, user.id, membership.role))) {
    commissionGo(t("sales.messages.commissionPaymentPermissionDenied"), "error");
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const {data: sale, error: saleError} = await admin
    .from("sales_records")
    .select("id, organization_id, seller_id, workflow_status, commission_amount")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<SaleRow>();

  if (saleError || !sale) commissionGo(t("sales.messages.saleNotFound"), "error");
  if (sale.workflow_status !== "approved" || Number(sale.commission_amount) <= 0) {
    commissionGo(t("sales.messages.commissionNotPayable"), "error");
  }

  const {error} = await admin
    .from("sales_records")
    .update({
      commission_status: "paid",
      commission_paid_by: user.id,
      commission_paid_at: new Date().toISOString(),
    })
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    commissionGo(t("sales.messages.commissionPaymentFailed", {message: error.message}), "error");
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId,
    actorId: user.id,
    action: "commission_paid",
    oldStatus: "payable",
    newStatus: "paid",
    admin,
  });

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/commissions");
  commissionGo(t("sales.messages.commissionPaid"));
}

export async function upsertSalesTargetAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  if (!leaderRoles.has(membership.role)) {
    go(t("sales.messages.targetPermissionDenied"), "error");
  }

  const memberId = String(formData.get("memberId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  const amount = parseMoney(formData.get("targetAmount"));
  const currency = normalizeCurrency(formData.get("currency"));

  if (
    !visibleUserIds.includes(memberId) ||
    !(await ensureActiveMember(membership.organization_id, memberId, admin))
  ) {
    go(t("sales.messages.sellerNotActive"), "error");
  }
  if (!/^\d{4}-\d{2}$/.test(period)) {
    go(t("sales.messages.invalidTargetMonth"), "error");
  }
  if (!Number.isFinite(amount) || amount < 0) {
    go(t("sales.messages.invalidTarget"), "error");
  }
  if (!currency) go(t("sales.messages.invalidCurrency"), "error");

  const {error} = await admin.from("sales_targets").upsert(
    {
      organization_id: membership.organization_id,
      user_id: memberId,
      period_month: `${period}-01`,
      target_amount: amount,
      currency,
      created_by: user.id,
    },
    {onConflict: "organization_id,user_id,period_month,currency"},
  );

  if (error) {
    go(t("sales.messages.targetSaveFailed", {message: error.message}), "error");
  }

  revalidatePath("/dashboard/sales");
  go(t("sales.messages.targetSaved"));
}
