"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);
const financeRoles = new Set(["owner", "admin", "hr"]);
const productManagerRoles = new Set(["owner", "admin", "hr"]);
const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);
const paymentMethods = new Set([
  "bank_transfer",
  "card",
  "cash",
  "mobile_money",
  "cheque",
  "other",
]);
const paymentStatuses = new Set(["unpaid", "partial", "paid", "refunded"]);
const reviewStatuses = new Set([
  "verified",
  "approved",
  "rejected",
  "cancelled",
  "refunded",
]);
const commissionTypes = new Set(["percentage", "fixed"]);

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

  return {user: authData.user, membership, admin, t};
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
  const commissionType = String(formData.get("commissionType") ?? "percentage");
  const commissionValue = parseMoney(formData.get("commissionValue"));
  const proofRequired = formData.get("proofRequired") === "on";

  if (name.length < 2 || name.length > 160) {
    go(t("sales.messages.invalidProductName"), "error");
  }
  if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
    go(t("sales.messages.invalidPrice"), "error");
  }
  if (!currency) go(t("sales.messages.invalidCurrency"), "error");
  if (!commissionTypes.has(commissionType)) {
    go(t("sales.messages.invalidCommissionType"), "error");
  }
  if (!Number.isFinite(commissionValue) || commissionValue < 0) {
    go(t("sales.messages.invalidCommission"), "error");
  }
  if (commissionType === "percentage" && commissionValue > 100) {
    go(t("sales.messages.invalidCommissionPercentage"), "error");
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
  const {user, membership, admin, t} = await getContext();

  const requestedSellerId = String(formData.get("sellerId") ?? user.id).trim();
  const sellerId = leaderRoles.has(membership.role) ? requestedSellerId || user.id : user.id;
  const productId = String(formData.get("productId") ?? "").trim() || null;
  const customProductName = String(formData.get("customProductName") ?? "").trim();
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerEmail = cleanOptional(formData.get("customerEmail"), 254);
  const customerPhone = cleanOptional(formData.get("customerPhone"), 80);
  const saleDate = normalizeDate(formData.get("saleDate"));
  const quantity = parseInteger(formData.get("quantity"));
  const unitPrice = parseMoney(formData.get("unitPrice"));
  const currency = normalizeCurrency(formData.get("currency"));
  const paymentMethod = String(formData.get("paymentMethod") ?? "bank_transfer");
  const paymentStatus = String(formData.get("paymentStatus") ?? "unpaid");
  const transactionReference = cleanOptional(formData.get("transactionReference"), 160);
  const proofUrl = cleanOptional(formData.get("proofUrl"), 1000);
  const notes = cleanOptional(formData.get("notes"), 3000);

  if (!(await ensureActiveMember(membership.organization_id, sellerId, admin))) {
    go(t("sales.messages.sellerNotActive"), "error");
  }
  if (customerName.length < 2 || customerName.length > 200) {
    go(t("sales.messages.invalidCustomerName"), "error");
  }
  if (!saleDate) go(t("sales.messages.invalidSaleDate"), "error");
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000) {
    go(t("sales.messages.invalidQuantity"), "error");
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    go(t("sales.messages.invalidPrice"), "error");
  }
  if (!currency) go(t("sales.messages.invalidCurrency"), "error");
  if (!paymentMethods.has(paymentMethod)) {
    go(t("sales.messages.invalidPaymentMethod"), "error");
  }
  if (!paymentStatuses.has(paymentStatus)) {
    go(t("sales.messages.invalidPaymentStatus"), "error");
  }

  let product: ProductRow | null = null;
  if (productId) {
    const {data, error} = await admin
      .from("sales_products")
      .select("id, organization_id, name, commission_type, commission_value, currency, proof_required, is_active")
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
    go(t("sales.messages.productRequired"), "error");
  }
  if (product?.proof_required && !proofUrl) {
    go(t("sales.messages.proofRequired"), "error");
  }

  const saleCurrency = product?.currency ?? currency;
  const totalAmount = Math.round(quantity * unitPrice * 100) / 100;
  const commissionType = product?.commission_type ?? "percentage";
  const commissionValue = Number(product?.commission_value ?? 0);
  const commissionAmount = commissionType === "percentage"
    ? Math.round(totalAmount * (commissionValue / 100) * 100) / 100
    : Math.round(commissionValue * quantity * 100) / 100;

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
      sale_date: saleDate,
      quantity,
      unit_price: unitPrice,
      total_amount: totalAmount,
      currency: saleCurrency,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      workflow_status: "submitted",
      transaction_reference: transactionReference,
      proof_url: proofUrl,
      notes,
      commission_type: commissionType,
      commission_value: commissionValue,
      commission_amount: commissionAmount,
      commission_status: "pending",
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !sale) {
    const message = error?.code === "23505"
      ? t("sales.messages.duplicateTransaction")
      : t("sales.messages.saleCreateFailed", {message: error?.message ?? t("common.unknownError")});
    go(message, "error");
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

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard");
  go(t("sales.messages.saleSubmitted"));
}

export async function reviewSaleAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) {
    go(t("sales.messages.reviewPermissionDenied"), "error");
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const workflowStatus = String(formData.get("workflowStatus") ?? "").trim();
  const paymentStatus = String(formData.get("paymentStatus") ?? "").trim();
  const note = cleanOptional(formData.get("reviewNote"), 1500);

  if (!saleId || !reviewStatuses.has(workflowStatus)) {
    go(t("sales.messages.invalidReviewStatus"), "error");
  }
  if (!paymentStatuses.has(paymentStatus)) {
    go(t("sales.messages.invalidPaymentStatus"), "error");
  }

  const {data: sale, error: saleError} = await admin
    .from("sales_records")
    .select("id, organization_id, seller_id, workflow_status, commission_amount")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<SaleRow>();

  if (saleError || !sale) go(t("sales.messages.saleNotFound"), "error");

  const updates: Record<string, string | null> = {
    workflow_status: workflowStatus,
    payment_status: workflowStatus === "refunded" ? "refunded" : paymentStatus,
  };

  if (workflowStatus === "approved") {
    updates.approved_by = user.id;
    updates.approved_at = new Date().toISOString();
    updates.commission_status = Number(sale.commission_amount) > 0 ? "payable" : "cancelled";
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

  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard");
  go(t("sales.messages.saleUpdated"));
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
  revalidatePath("/dashboard");
  go(t("sales.messages.saleCancelled"));
}

export async function markCommissionPaidAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!financeRoles.has(membership.role)) {
    go(t("sales.messages.commissionPaymentPermissionDenied"), "error");
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const {data: sale, error: saleError} = await admin
    .from("sales_records")
    .select("id, organization_id, seller_id, workflow_status, commission_amount")
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<SaleRow>();

  if (saleError || !sale) go(t("sales.messages.saleNotFound"), "error");
  if (sale.workflow_status !== "approved" || Number(sale.commission_amount) <= 0) {
    go(t("sales.messages.commissionNotPayable"), "error");
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
    go(t("sales.messages.commissionPaymentFailed", {message: error.message}), "error");
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
  go(t("sales.messages.commissionPaid"));
}

export async function upsertSalesTargetAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) {
    go(t("sales.messages.targetPermissionDenied"), "error");
  }

  const memberId = String(formData.get("memberId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  const amount = parseMoney(formData.get("targetAmount"));
  const currency = normalizeCurrency(formData.get("currency"));

  if (!(await ensureActiveMember(membership.organization_id, memberId, admin))) {
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
