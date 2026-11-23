import type {createAdminClient} from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type SaleRow = {
  id: string;
  organization_id: string;
  seller_id: string;
  product_name: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  sale_date: string;
  quantity: number;
  unit_price: number | string;
  total_amount: number | string;
  currency: string;
  next_payment_due_date: string | null;
  workflow_status: string;
};

type FinanceSettingsRow = {
  payment_terms_days: number | null;
  default_payment_terms: string | null;
  default_payment_instructions: string | null;
};

type FinanceDocumentRow = {
  id: string;
  document_type: string;
  document_number: string;
  status: string;
  total_amount: number | string;
  paid_amount: number | string;
  related_document_id: string | null;
};

type EnsureResult = {
  id: string;
  documentNumber: string;
  created: boolean;
};

const n = (value: unknown) => Number(value) || 0;

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function sale(admin: AdminClient, organizationId: string, saleId: string) {
  const {data, error} = await admin
    .from("sales_records")
    .select("id,organization_id,seller_id,product_name,customer_name,customer_email,customer_phone,sale_date,quantity,unit_price,total_amount,currency,next_payment_due_date,workflow_status")
    .eq("organization_id", organizationId)
    .eq("id", saleId)
    .maybeSingle<SaleRow>();
  if (error || !data) throw new Error(error?.message ?? "Vente introuvable pour la génération du document financier.");
  return data;
}

async function financeSettings(admin: AdminClient, organizationId: string) {
  const {data} = await admin
    .from("finance_settings")
    .select("payment_terms_days,default_payment_terms,default_payment_instructions")
    .eq("organization_id", organizationId)
    .maybeSingle<FinanceSettingsRow>();
  return data ?? null;
}

async function nextNumber(admin: AdminClient, organizationId: string, documentType: string, issueDate: string) {
  const {data, error} = await admin.rpc("finance_next_document_number", {
    p_organization_id: organizationId,
    p_document_type: documentType,
    p_issue_date: issueDate,
  });
  if (error || !data) throw new Error(error?.message ?? "Numérotation Finance impossible.");
  return String(data);
}

async function existingDocument(admin: AdminClient, organizationId: string, saleId: string, documentType: string) {
  const {data, error} = await admin
    .from("finance_documents")
    .select("id,document_type,document_number,status,total_amount,paid_amount,related_document_id")
    .eq("organization_id", organizationId)
    .eq("sale_id", saleId)
    .eq("document_type", documentType)
    .not("status", "in", '("cancelled","archived")')
    .order("created_at", {ascending: false})
    .limit(1)
    .maybeSingle<FinanceDocumentRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function audit(admin: AdminClient, input: {
  organizationId: string;
  documentId: string;
  actorId: string;
  action: "created" | "updated" | "status_changed" | "approved" | "cancelled";
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("finance_document_audit_log").insert({
    organization_id: input.organizationId,
    document_id: input.documentId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("Finance document audit failed", error);
}

async function confirmedPaid(admin: AdminClient, organizationId: string, saleId: string) {
  const {data, error} = await admin
    .from("sales_payments")
    .select("amount")
    .eq("organization_id", organizationId)
    .eq("sale_id", saleId)
    .eq("status", "confirmed");
  if (error) throw new Error(error.message);
  return Math.round((data ?? []).reduce((sum, row) => sum + n(row.amount), 0) * 100) / 100;
}

function lineItems(row: SaleRow) {
  const quantity = Math.max(1, Number(row.quantity) || 1);
  const unitPrice = n(row.unit_price);
  return [{
    description: row.product_name,
    quantity,
    unitPrice,
    total: Math.round(quantity * unitPrice * 100) / 100,
  }];
}

async function insertSaleDocument(admin: AdminClient, input: {
  organizationId: string;
  actorId: string;
  row: SaleRow;
  documentType: "proforma" | "invoice" | "receipt";
  issueDate: string;
  dueDate: string | null;
  paidAmount: number;
  status: string;
  relatedDocumentId?: string | null;
  notes: string;
}) {
  const settings = await financeSettings(admin, input.organizationId);
  const documentNumber = await nextNumber(admin, input.organizationId, input.documentType, input.issueDate);
  const total = Math.round(n(input.row.total_amount) * 100) / 100;
  const {data: created, error} = await admin.from("finance_documents").insert({
    organization_id: input.organizationId,
    sale_id: input.row.id,
    document_type: input.documentType,
    document_number: documentNumber,
    title: input.row.product_name,
    counterparty_name: input.row.customer_name,
    counterparty_email: input.row.customer_email,
    counterparty_phone: input.row.customer_phone,
    issue_date: input.issueDate,
    due_date: input.dueDate,
    currency: input.row.currency,
    subtotal: total,
    tax_amount: 0,
    total_amount: total,
    paid_amount: Math.min(total, Math.max(0, input.paidAmount)),
    status: input.status,
    related_document_id: input.relatedDocumentId ?? null,
    line_items: lineItems(input.row),
    payment_terms: settings?.default_payment_terms ?? null,
    payment_instructions: settings?.default_payment_instructions ?? null,
    notes: input.notes,
    generated_document: true,
    created_by: input.actorId,
    approved_by: input.status === "approved" ? input.actorId : null,
    approved_at: input.status === "approved" ? new Date().toISOString() : null,
    published_at: ["approved", "sent", "accepted", "partial", "paid"].includes(input.status) ? new Date().toISOString() : null,
  }).select("id,status").single<{id: string; status: string}>();
  if (error || !created) throw new Error(error?.message ?? `Création ${input.documentType} impossible.`);
  await audit(admin, {
    organizationId: input.organizationId,
    documentId: created.id,
    actorId: input.actorId,
    action: "created",
    newStatus: created.status,
    details: {saleId: input.row.id, automatic: true, documentType: input.documentType, documentNumber},
  });
  return {id: created.id, documentNumber, created: true} satisfies EnsureResult;
}

export async function ensureSaleProforma(input: {
  admin: AdminClient;
  organizationId: string;
  saleId: string;
  actorId: string;
}) {
  const existing = await existingDocument(input.admin, input.organizationId, input.saleId, "proforma");
  if (existing) return {id: existing.id, documentNumber: existing.document_number, created: false} satisfies EnsureResult;
  const row = await sale(input.admin, input.organizationId, input.saleId);
  const settings = await financeSettings(input.admin, input.organizationId);
  const dueDate = row.next_payment_due_date || addDays(row.sale_date, Number(settings?.payment_terms_days ?? 30));
  return insertSaleDocument(input.admin, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    row,
    documentType: "proforma",
    issueDate: row.sale_date,
    dueDate,
    paidAmount: 0,
    status: "approved",
    notes: "Pro forma générée automatiquement par Super Leader à partir de la vente soumise. Ce document sert d'instruction de paiement et ne constitue pas un reçu.",
  });
}

export async function ensureSaleInvoice(input: {
  admin: AdminClient;
  organizationId: string;
  saleId: string;
  actorId: string;
}) {
  const existing = await existingDocument(input.admin, input.organizationId, input.saleId, "invoice");
  if (existing) {
    await syncSaleInvoiceAndReceipt(input);
    return {id: existing.id, documentNumber: existing.document_number, created: false} satisfies EnsureResult;
  }
  const row = await sale(input.admin, input.organizationId, input.saleId);
  if (row.workflow_status !== "approved") throw new Error("La vente doit être approuvée avant de générer la facture.");
  const settings = await financeSettings(input.admin, input.organizationId);
  const dueDate = row.next_payment_due_date || addDays(row.sale_date, Number(settings?.payment_terms_days ?? 30));
  const paid = await confirmedPaid(input.admin, input.organizationId, input.saleId);
  const proforma = await existingDocument(input.admin, input.organizationId, input.saleId, "proforma");
  const total = n(row.total_amount);
  const status = paid >= total - 0.009 ? "paid" : paid > 0 ? "partial" : "approved";
  const result = await insertSaleDocument(input.admin, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    row,
    documentType: "invoice",
    issueDate: row.sale_date,
    dueDate,
    paidAmount: paid,
    status,
    relatedDocumentId: proforma?.id ?? null,
    notes: proforma ? `Facture générée automatiquement depuis ${proforma.document_number}.` : "Facture générée automatiquement depuis la vente approuvée.",
  });
  if (paid >= total - 0.009) await syncSaleInvoiceAndReceipt(input);
  return result;
}

export async function syncSaleInvoiceAndReceipt(input: {
  admin: AdminClient;
  organizationId: string;
  saleId: string;
  actorId: string;
}) {
  const row = await sale(input.admin, input.organizationId, input.saleId);
  const invoice = await existingDocument(input.admin, input.organizationId, input.saleId, "invoice");
  if (!invoice) return {invoiceUpdated: false, receiptCreated: false};
  const paid = await confirmedPaid(input.admin, input.organizationId, input.saleId);
  const total = n(row.total_amount);
  const status = paid >= total - 0.009 ? "paid" : paid > 0 ? "partial" : "approved";
  const {error: updateError} = await input.admin.from("finance_documents").update({
    paid_amount: Math.min(total, paid),
    status,
    published_at: paid > 0 ? new Date().toISOString() : null,
  }).eq("organization_id", input.organizationId).eq("id", invoice.id);
  if (updateError) throw new Error(updateError.message);
  await audit(input.admin, {
    organizationId: input.organizationId,
    documentId: invoice.id,
    actorId: input.actorId,
    action: "updated",
    previousStatus: invoice.status,
    newStatus: status,
    details: {saleId: input.saleId, automatic: true, confirmedPaid: paid},
  });
  if (paid < total - 0.009) return {invoiceUpdated: true, receiptCreated: false};
  const receipt = await existingDocument(input.admin, input.organizationId, input.saleId, "receipt");
  if (receipt) return {invoiceUpdated: true, receiptCreated: false};
  const result = await insertSaleDocument(input.admin, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    row,
    documentType: "receipt",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: null,
    paidAmount: total,
    status: "paid",
    relatedDocumentId: invoice.id,
    notes: `Reçu généré automatiquement après confirmation bancaire complète de ${invoice.document_number}.`,
  });
  return {invoiceUpdated: true, receiptCreated: result.created};
}

export async function cancelOpenSaleFinanceDocuments(input: {
  admin: AdminClient;
  organizationId: string;
  saleId: string;
  actorId: string;
  reason: string;
}) {
  const {data, error} = await input.admin.from("finance_documents")
    .select("id,status,document_type")
    .eq("organization_id", input.organizationId)
    .eq("sale_id", input.saleId)
    .in("document_type", ["proforma", "invoice"])
    .not("status", "in", '("cancelled","archived","paid")');
  if (error) throw new Error(error.message);
  for (const item of data ?? []) {
    const {error: updateError} = await input.admin.from("finance_documents").update({status: "cancelled"})
      .eq("organization_id", input.organizationId).eq("id", item.id);
    if (updateError) throw new Error(updateError.message);
    await audit(input.admin, {
      organizationId: input.organizationId,
      documentId: item.id,
      actorId: input.actorId,
      action: "cancelled",
      previousStatus: item.status,
      newStatus: "cancelled",
      details: {saleId: input.saleId, automatic: true, reason: input.reason},
    });
  }
}
