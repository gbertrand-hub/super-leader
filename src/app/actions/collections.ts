"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {COMMERCIAL_MANAGER_ROLES, canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = COMMERCIAL_MANAGER_ROLES;
const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);
const paymentMethods = new Set([
  "bank_transfer",
  "card",
  "cash",
  "mobile_money",
  "cheque",
  "other",
]);
const collectionStatuses = new Set([
  "not_started",
  "assigned",
  "in_progress",
  "overdue",
  "completed",
  "suspended",
]);
const paymentDecisions = new Set(["confirmed", "rejected", "refunded"]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type CollectionSale = {
  id: string;
  organization_id: string;
  collection_owner_id: string | null;
  collection_status: string;
  currency: string;
  total_amount: number | string;
  paid_amount: number | string;
  balance_amount: number | string;
  initial_payment_type: string;
  initial_payment_value: number | string;
  commission_trigger_payment_id: string | null;
  next_payment_due_date: string | null;
};

type PaymentRow = {
  id: string;
  organization_id: string;
  sale_id: string;
  schedule_item_id: string | null;
  amount: number | string;
  status: string;
};

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/collections?${kind}=${encodeURIComponent(message)}`);
}

function parseMoney(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
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
    go(t("collections.messages.organisationLoadFailed", {message: membershipError.message}), "error");
  }
  if (!membership) redirect("/dashboard/company");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  return {user: authData.user, membership, admin, t, visibleUserIds};
}

async function getSale(
  saleId: string,
  organizationId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const {data, error} = await admin
    .from("sales_records")
    .select("id, organization_id, collection_owner_id, collection_status, currency, total_amount, paid_amount, balance_amount, initial_payment_type, initial_payment_value, commission_trigger_payment_id, next_payment_due_date")
    .eq("id", saleId)
    .eq("organization_id", organizationId)
    .maybeSingle<CollectionSale>();
  return {sale: data, error};
}

function canHandleCase(
  role: string,
  userId: string,
  sale: CollectionSale,
  visibleUserIds: string[],
) {
  if (["owner", "admin"].includes(role)) return true;
  if (role === "manager") {
    return Boolean(
      sale.collection_owner_id && visibleUserIds.includes(sale.collection_owner_id),
    );
  }
  return sale.collection_owner_id === userId;
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

async function refreshSummary(saleId: string, admin: ReturnType<typeof createAdminClient>) {
  const {error} = await admin.rpc("refresh_sales_payment_summary", {p_sale_id: saleId});
  return error;
}

async function syncScheduleItem(
  scheduleItemId: string | null,
  admin: ReturnType<typeof createAdminClient>,
) {
  if (!scheduleItemId) return null;

  const [{data: item, error: itemError}, {data: payments, error: paymentsError}] = await Promise.all([
    admin
      .from("sales_payment_schedule")
      .select("id, expected_amount, due_date")
      .eq("id", scheduleItemId)
      .maybeSingle<{id: string; expected_amount: number | string; due_date: string}>(),
    admin
      .from("sales_payments")
      .select("amount")
      .eq("schedule_item_id", scheduleItemId)
      .eq("status", "confirmed"),
  ]);

  if (itemError) return itemError;
  if (paymentsError) return paymentsError;
  if (!item) return null;

  const paidAmount = (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const expectedAmount = Number(item.expected_amount);
  const status = paidAmount >= expectedAmount
    ? "paid"
    : paidAmount > 0
      ? "partial"
      : item.due_date < new Date().toISOString().slice(0, 10)
        ? "overdue"
        : "upcoming";

  const {error} = await admin
    .from("sales_payment_schedule")
    .update({paid_amount: paidAmount, status})
    .eq("id", scheduleItemId);
  return error;
}

export async function assignCollectionCaseAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  if (!leaderRoles.has(membership.role)) {
    go(t("collections.messages.assignmentPermissionDenied"), "error");
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const collectionOwnerId = String(formData.get("collectionOwnerId") ?? "").trim() || null;
  const requestedStatus = String(formData.get("collectionStatus") ?? "assigned").trim();
  const nextPaymentDueDate = normalizeDate(formData.get("nextPaymentDueDate"));
  const rawNextAmount = String(formData.get("nextPaymentAmount") ?? "").trim();
  const nextPaymentAmount = rawNextAmount ? parseMoney(formData.get("nextPaymentAmount")) : null;
  const notes = cleanOptional(formData.get("collectionNotes"), 3000);

  if (!saleId || !collectionStatuses.has(requestedStatus)) {
    go(t("collections.messages.invalidAssignment"), "error");
  }
  if (nextPaymentDueDate === "") go(t("collections.messages.invalidDueDate"), "error");
  if (nextPaymentAmount !== null && (!Number.isFinite(nextPaymentAmount) || nextPaymentAmount < 0)) {
    go(t("collections.messages.invalidAmount"), "error");
  }
  if (
    collectionOwnerId &&
    (!visibleUserIds.includes(collectionOwnerId) ||
      !(await ensureActiveMember(membership.organization_id, collectionOwnerId, admin)))
  ) {
    go(t("collections.messages.collectorNotActive"), "error");
  }

  const {sale, error: saleError} = await getSale(saleId, membership.organization_id, admin);
  if (saleError || !sale) go(t("collections.messages.saleNotFound"), "error");
  if (
    membership.role === "manager" &&
    sale.collection_owner_id &&
    !visibleUserIds.includes(sale.collection_owner_id)
  ) {
    go(t("collections.messages.assignmentPermissionDenied"), "error");
  }
  if (membership.role === "manager" && !sale.collection_owner_id && !collectionOwnerId) {
    go(t("collections.messages.assignmentPermissionDenied"), "error");
  }

  const status = collectionOwnerId && requestedStatus === "not_started" ? "assigned" : requestedStatus;
  const {error} = await admin
    .from("sales_records")
    .update({
      collection_owner_id: collectionOwnerId,
      collection_status: status,
      transferred_to_collection_at: collectionOwnerId ? new Date().toISOString() : null,
      next_payment_due_date: nextPaymentDueDate,
      next_payment_amount: nextPaymentAmount,
      collection_notes: notes,
    })
    .eq("id", saleId)
    .eq("organization_id", membership.organization_id);

  if (error) go(t("collections.messages.assignmentFailed", {message: error.message}), "error");

  await refreshSummary(saleId, admin);
  await auditSale({
    organizationId: membership.organization_id,
    saleId,
    actorId: user.id,
    action: "collection_assigned",
    oldStatus: sale.collection_status,
    newStatus: status,
    note: notes,
    admin,
  });

  revalidatePath("/dashboard/collections");
  revalidatePath("/dashboard/sales");
  go(t("collections.messages.assignmentSaved"));
}

export async function createCollectionPaymentAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const saleId = String(formData.get("saleId") ?? "").trim();
  const amount = parseMoney(formData.get("amount"));
  const paymentDate = normalizeDate(formData.get("paymentDate"));
  const paymentMethod = String(formData.get("paymentMethod") ?? "bank_transfer").trim();
  const currency = String(formData.get("currency") ?? "USD").trim().toUpperCase();
  const transactionReference = cleanOptional(formData.get("transactionReference"), 160);
  const proofUrl = cleanOptional(formData.get("proofUrl"), 1000);
  const pendingProof = readPendingAttachment(formData, "proof");
  const notes = cleanOptional(formData.get("notes"), 1500);
  const scheduleItemId = String(formData.get("scheduleItemId") ?? "").trim() || null;

  if (!saleId) go(t("collections.messages.saleNotFound"), "error");
  if (!Number.isFinite(amount) || amount <= 0) go(t("collections.messages.invalidAmount"), "error");
  if (!paymentDate) go(t("collections.messages.invalidPaymentDate"), "error");
  if (!paymentMethods.has(paymentMethod)) go(t("collections.messages.invalidPaymentMethod"), "error");
  if (!currencies.has(currency)) go(t("collections.messages.invalidCurrency"), "error");

  const {sale, error: saleError} = await getSale(saleId, membership.organization_id, admin);
  if (saleError || !sale) go(t("collections.messages.saleNotFound"), "error");
  if (!canHandleCase(membership.role, user.id, sale, visibleUserIds)) {
    go(t("collections.messages.casePermissionDenied"), "error");
  }
  if (currency !== sale.currency) go(t("collections.messages.currencyMismatch"), "error");
  if (Number(sale.balance_amount) <= 0 || amount > Number(sale.balance_amount)) {
    go(t("collections.messages.paymentExceedsBalance"), "error");
  }

  if (scheduleItemId) {
    const {data: scheduleItem} = await admin
      .from("sales_payment_schedule")
      .select("id")
      .eq("id", scheduleItemId)
      .eq("sale_id", saleId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    if (!scheduleItem) go(t("collections.messages.scheduleNotFound"), "error");
  }

  const {data: payment, error} = await admin
    .from("sales_payments")
    .insert({
      organization_id: membership.organization_id,
      sale_id: saleId,
      schedule_item_id: scheduleItemId,
      payment_date: paymentDate,
      amount,
      currency,
      payment_method: paymentMethod,
      transaction_reference: transactionReference,
      proof_url: proofUrl,
      status: "pending",
      recorded_by: user.id,
      notes,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !payment) {
    const message = error?.code === "23505"
      ? t("collections.messages.duplicateTransaction")
      : t("collections.messages.paymentCreateFailed", {message: error?.message ?? t("common.unknownError")});
    go(message, "error");
  }

  let finalizedProof = null;
  if (pendingProof) {
    try {
      finalizedProof = await finalizeTemporaryAttachment({
        admin,
        organizationId: membership.organization_id,
        userId: user.id,
        purpose: "payment",
        recordId: payment.id,
        pending: pendingProof,
      });
      const {error: proofUpdateError} = await admin.from("sales_payments").update({
        proof_storage_path: finalizedProof.storagePath,
        proof_file_name: finalizedProof.fileName,
        proof_mime_type: finalizedProof.mimeType,
        proof_size_bytes: finalizedProof.sizeBytes,
        proof_uploaded_at: new Date().toISOString(),
      }).eq("id", payment.id).eq("organization_id", membership.organization_id);
      if (proofUpdateError) throw proofUpdateError;
    } catch (proofError) {
      await removePrivateAttachment(admin, finalizedProof?.storagePath ?? pendingProof.storagePath);
      await admin.from("sales_payments").delete().eq("id", payment.id).eq("organization_id", membership.organization_id);
      go(t("attachments.messages.finalizeFailed", {
        message: proofError instanceof Error ? proofError.message : t("common.unknownError"),
      }), "error");
    }
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId,
    actorId: user.id,
    action: "payment_recorded",
    note: `${amount} ${currency}${transactionReference ? ` · ${transactionReference}` : ""}`,
    admin,
  });
  if (finalizedProof) {
    await auditSale({
      organizationId: membership.organization_id,
      saleId,
      actorId: user.id,
      action: "payment_proof_uploaded",
      note: finalizedProof.fileName,
      admin,
    });
  }

  revalidatePath("/dashboard/collections");
  go(t("collections.messages.paymentRecorded"));
}

export async function reviewCollectionPaymentAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  if (!leaderRoles.has(membership.role)) {
    go(t("collections.messages.paymentReviewPermissionDenied"), "error");
  }

  const paymentId = String(formData.get("paymentId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  if (!paymentId || !paymentDecisions.has(decision)) {
    go(t("collections.messages.invalidPaymentDecision"), "error");
  }

  const {data: payment, error: paymentError} = await admin
    .from("sales_payments")
    .select("id, organization_id, sale_id, schedule_item_id, amount, status")
    .eq("id", paymentId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<PaymentRow>();
  if (paymentError || !payment) go(t("collections.messages.paymentNotFound"), "error");

  if (decision === "refunded" && payment.status !== "confirmed") {
    go(t("collections.messages.onlyConfirmedCanBeRefunded"), "error");
  }
  if (["confirmed", "rejected"].includes(decision) && payment.status !== "pending") {
    go(t("collections.messages.paymentAlreadyReviewed"), "error");
  }

  const {sale, error: saleError} = await getSale(payment.sale_id, membership.organization_id, admin);
  if (saleError || !sale) go(t("collections.messages.saleNotFound"), "error");
  if (!canHandleCase(membership.role, user.id, sale, visibleUserIds)) {
    go(t("collections.messages.paymentReviewPermissionDenied"), "error");
  }
  if (decision === "confirmed" && !sale.commission_trigger_payment_id) {
    const minimumInitialPayment = sale.initial_payment_type === "percentage"
      ? Math.round(Number(sale.total_amount) * (Number(sale.initial_payment_value) / 100) * 100) / 100
      : Number(sale.initial_payment_value);
    if (Number(payment.amount) < minimumInitialPayment) {
      go(t("collections.messages.firstPaymentBelowMinimum", {
        amount: `${minimumInitialPayment.toFixed(2)} ${sale.currency}`,
      }), "error");
    }
  }

  const {error} = await admin
    .from("sales_payments")
    .update({
      status: decision,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .eq("organization_id", membership.organization_id);
  if (error) go(t("collections.messages.paymentReviewFailed", {message: error.message}), "error");

  const scheduleError = await syncScheduleItem(payment.schedule_item_id, admin);
  if (scheduleError) {
    go(t("collections.messages.scheduleUpdateFailed", {message: scheduleError.message}), "error");
  }
  const refreshError = await refreshSummary(payment.sale_id, admin);
  if (refreshError) {
    go(t("collections.messages.summaryUpdateFailed", {message: refreshError.message}), "error");
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId: payment.sale_id,
    actorId: user.id,
    action: decision === "confirmed" ? "payment_confirmed" : decision === "refunded" ? "payment_refunded" : "payment_rejected",
    oldStatus: payment.status,
    newStatus: decision,
    note: `${payment.amount}`,
    admin,
  });

  revalidatePath("/dashboard/collections");
  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard");
  go(decision === "confirmed"
    ? t("collections.messages.paymentConfirmed")
    : decision === "refunded"
      ? t("collections.messages.paymentRefunded")
      : t("collections.messages.paymentRejected"));
}

export async function addPaymentScheduleItemAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const saleId = String(formData.get("saleId") ?? "").trim();
  const dueDate = normalizeDate(formData.get("dueDate"));
  const expectedAmount = parseMoney(formData.get("expectedAmount"));
  const notes = cleanOptional(formData.get("notes"), 1500);

  if (!saleId) go(t("collections.messages.saleNotFound"), "error");
  if (!dueDate) go(t("collections.messages.invalidDueDate"), "error");
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    go(t("collections.messages.invalidAmount"), "error");
  }

  const {sale, error: saleError} = await getSale(saleId, membership.organization_id, admin);
  if (saleError || !sale) go(t("collections.messages.saleNotFound"), "error");
  if (!canHandleCase(membership.role, user.id, sale, visibleUserIds)) {
    go(t("collections.messages.casePermissionDenied"), "error");
  }

  const {data: lastItem, error: lastItemError} = await admin
    .from("sales_payment_schedule")
    .select("sequence_number")
    .eq("sale_id", saleId)
    .order("sequence_number", {ascending: false})
    .limit(1)
    .maybeSingle<{sequence_number: number}>();
  if (lastItemError) go(t("collections.messages.scheduleCreateFailed", {message: lastItemError.message}), "error");

  const sequenceNumber = (lastItem?.sequence_number ?? 0) + 1;
  const {error} = await admin.from("sales_payment_schedule").insert({
    organization_id: membership.organization_id,
    sale_id: saleId,
    sequence_number: sequenceNumber,
    due_date: dueDate,
    expected_amount: expectedAmount,
    status: dueDate < new Date().toISOString().slice(0, 10) ? "overdue" : "upcoming",
    notes,
    created_by: user.id,
  });
  if (error) go(t("collections.messages.scheduleCreateFailed", {message: error.message}), "error");

  const shouldUpdateNextDue = !sale.next_payment_due_date || dueDate < sale.next_payment_due_date;
  if (shouldUpdateNextDue) {
    await admin
      .from("sales_records")
      .update({next_payment_due_date: dueDate, next_payment_amount: expectedAmount})
      .eq("id", saleId)
      .eq("organization_id", membership.organization_id);
  }

  await auditSale({
    organizationId: membership.organization_id,
    saleId,
    actorId: user.id,
    action: "payment_schedule_added",
    note: `${dueDate} · ${expectedAmount} ${sale.currency}`,
    admin,
  });

  revalidatePath("/dashboard/collections");
  go(t("collections.messages.scheduleAdded"));
}
