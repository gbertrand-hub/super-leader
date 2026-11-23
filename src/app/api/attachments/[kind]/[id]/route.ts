import {NextResponse} from "next/server";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {canReconcilePayments} from "@/lib/auth/payment-reconciliation-access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string; is_active: boolean};

type AttachmentRecord = {
  organizationId: string;
  ownerId: string;
  secondaryOwnerId?: string | null;
  storagePath: string | null;
  fileName: string | null;
  financeDocumentId?: string | null;
  payslipId?: string | null;
  payrollEntryId?: string | null;
  employeeUserId?: string | null;
  announcementId?: string | null;
  expenseId?: string | null;
  eventId?: string | null;
  contractId?: string | null;
};

async function loadRecord(kind: string, id: string, admin: ReturnType<typeof createAdminClient>): Promise<AttachmentRecord | null> {
  if (kind === "leave") {
    const {data} = await admin
      .from("leave_requests")
      .select("organization_id, user_id, document_storage_path, document_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.user_id,
      storagePath: data.document_storage_path,
      fileName: data.document_file_name,
    };
  }

  if (kind === "sale") {
    const {data} = await admin
      .from("sales_records")
      .select("organization_id, seller_id, collection_owner_id, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.seller_id,
      secondaryOwnerId: data.collection_owner_id,
      storagePath: data.proof_storage_path,
      fileName: data.proof_file_name,
    };
  }

  if (kind === "payment") {
    const {data: payment} = await admin
      .from("sales_payments")
      .select("organization_id, sale_id, recorded_by, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!payment) return null;

    const {data: sale} = await admin
      .from("sales_records")
      .select("seller_id, collection_owner_id")
      .eq("id", payment.sale_id)
      .eq("organization_id", payment.organization_id)
      .maybeSingle();

    return {
      organizationId: payment.organization_id,
      ownerId: sale?.seller_id ?? payment.recorded_by,
      secondaryOwnerId: sale?.collection_owner_id ?? payment.recorded_by,
      storagePath: payment.proof_storage_path,
      fileName: payment.proof_file_name,
    };
  }

  if (kind === "installment-payment") {
    const {data} = await admin
      .from("customer_service_installment_payments")
      .select("organization_id, recorded_by, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.recorded_by,
      storagePath: data.proof_storage_path,
      fileName: data.proof_file_name,
    };
  }

  if (kind === "impact") {
    const {data} = await admin
      .from("impact_contributions")
      .select("organization_id, user_id, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.user_id,
      storagePath: data.proof_storage_path,
      fileName: data.proof_file_name,
    };
  }

  if (kind === "finance") {
    const {data} = await admin
      .from("finance_documents")
      .select("id, organization_id, created_by, storage_path, file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.created_by,
      storagePath: data.storage_path,
      fileName: data.file_name,
      financeDocumentId: data.id,
    };
  }

  if (kind === "expense" || kind === "expense-payment") {
    const {data} = await admin
      .from("finance_expenses")
      .select("id,organization_id,submitted_by,receipt_storage_path,receipt_file_name,payment_proof_storage_path,payment_proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.submitted_by,
      storagePath: kind === "expense" ? data.receipt_storage_path : data.payment_proof_storage_path,
      fileName: kind === "expense" ? data.receipt_file_name : data.payment_proof_file_name,
      expenseId: data.id,
    };
  }

  if (kind === "payslip") {
    const {data} = await admin
      .from("payslips")
      .select("id, organization_id, payroll_entry_id, employee_user_id, published_by, storage_path, file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.employee_user_id,
      secondaryOwnerId: data.published_by,
      storagePath: data.storage_path,
      fileName: data.file_name,
      payslipId: data.id,
      payrollEntryId: data.payroll_entry_id,
      employeeUserId: data.employee_user_id,
    };
  }


  if (kind === "event-document") {
    const {data} = await admin
      .from("event_documents")
      .select("id, organization_id, event_id, uploaded_by, storage_path, file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.uploaded_by ?? "",
      storagePath: data.storage_path,
      fileName: data.file_name,
      eventId: data.event_id,
    };
  }

  if (kind === "contract-source") {
    const {data} = await admin
      .from("service_contracts")
      .select("id,organization_id,internal_owner_user_id,source_document_storage_path,source_document_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.internal_owner_user_id,
      storagePath: data.source_document_storage_path,
      fileName: data.source_document_file_name,
      contractId: data.id,
    };
  }

  if (kind === "contract-document") {
    const {data: document} = await admin
      .from("service_contract_documents")
      .select("id,organization_id,contract_id,created_by,storage_path,file_name")
      .eq("id", id)
      .maybeSingle();
    if (!document) return null;
    const {data: contract} = await admin
      .from("service_contracts")
      .select("internal_owner_user_id")
      .eq("id", document.contract_id)
      .eq("organization_id", document.organization_id)
      .maybeSingle<{internal_owner_user_id: string}>();
    return {
      organizationId: document.organization_id,
      ownerId: contract?.internal_owner_user_id ?? document.created_by,
      secondaryOwnerId: document.created_by,
      storagePath: document.storage_path,
      fileName: document.file_name,
      contractId: document.contract_id,
    };
  }

  if (kind === "announcement") {
    const {data} = await admin
      .from("official_announcements")
      .select("id, organization_id, created_by, attachment_storage_path, attachment_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.created_by,
      storagePath: data.attachment_storage_path,
      fileName: data.attachment_file_name,
      announcementId: data.id,
    };
  }

  return null;
}

export async function GET(
  request: Request,
  {params}: {params: Promise<{kind: string; id: string}>},
) {
  const {kind, id} = await params;
  if (!new Set(["leave", "sale", "payment", "installment-payment", "impact", "finance", "expense", "expense-payment", "payslip", "announcement", "event-document", "contract-source", "contract-document"]).has(kind)) {
    return NextResponse.json({error: "Not found"}, {status: 404});
  }

  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.redirect(new URL("/login", request.url));

  const admin = createAdminClient();
  const record = await loadRecord(kind, id, admin);
  if (!record?.storagePath) return NextResponse.json({error: "Attachment not found"}, {status: 404});

  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("organization_id", record.organizationId)
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle<Membership>();
  if (!membership) return NextResponse.json({error: "Forbidden"}, {status: 403});

  if (kind === "contract-document") {
    const {data: document} = await admin
      .from("service_contract_documents")
      .select("id,organization_id,contract_id,created_by,storage_path,file_name")
      .eq("id", id)
      .maybeSingle();
    if (!document) return null;
    const {data: contract} = await admin
      .from("service_contracts")
      .select("internal_owner_user_id")
      .eq("id", document.contract_id)
      .eq("organization_id", document.organization_id)
      .maybeSingle<{internal_owner_user_id: string}>();
    return {
      organizationId: document.organization_id,
      ownerId: contract?.internal_owner_user_id ?? document.created_by,
      secondaryOwnerId: document.created_by,
      storagePath: document.storage_path,
      fileName: document.file_name,
      contractId: document.contract_id,
    };
  }

  if (kind === "announcement") {
    const isPublisher = ["owner", "admin", "hr"].includes(membership.role);
    const {data: recipient} = isPublisher ? {data: {user_id: authData.user.id}} : await admin
      .from("official_announcement_recipients")
      .select("user_id")
      .eq("announcement_id", id)
      .eq("organization_id", record.organizationId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (!recipient) return NextResponse.json({error: "Forbidden"}, {status: 403});

  } else if (kind === "event-document") {
    const {data: event} = record.eventId ? await admin
      .from("events")
      .select("leader_id")
      .eq("id", record.eventId)
      .eq("organization_id", record.organizationId)
      .maybeSingle<{leader_id: string | null}>() : {data: null};
    const isEventAdmin = ["owner", "admin", "hr"].includes(membership.role);
    let allowed = isEventAdmin || event?.leader_id === authData.user.id;
    if (!allowed && record.eventId) {
      const {data: eventMember} = await admin
        .from("event_team_members")
        .select("user_id")
        .eq("event_id", record.eventId)
        .eq("user_id", authData.user.id)
        .in("status", ["assigned", "confirmed"])
        .maybeSingle<{user_id: string}>();
      allowed = Boolean(eventMember);
    }
    if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});
  } else if (kind === "contract-source" || kind === "contract-document") {
    const allowed = ["owner", "admin", "executive", "hr"].includes(membership.role)
      || record.ownerId === authData.user.id
      || record.secondaryOwnerId === authData.user.id;
    if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});
  } else if (kind === "finance") {
    if (!["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({error: "Forbidden"}, {status: 403});
    }
  } else if (kind === "expense" || kind === "expense-payment") {
    const allowed = ["owner", "admin"].includes(membership.role) || record.ownerId === authData.user.id;
    if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});
  } else if (kind === "payslip") {
    const allowed = ["owner", "admin"].includes(membership.role)
      || record.employeeUserId === authData.user.id;
    if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});
  } else {
    const visibleUserIds = await getVisibleUserIds({
      admin,
      organizationId: record.organizationId,
      actorId: authData.user.id,
      role: membership.role,
    });

    let allowed = membership.role === "owner"
      || membership.role === "admin"
      || (membership.role === "hr" && ["leave", "impact"].includes(kind))
      || record.ownerId === authData.user.id
      || record.secondaryOwnerId === authData.user.id;

    if (!allowed && ["sale", "payment", "installment-payment"].includes(kind)) {
      allowed = await canReconcilePayments(
        admin,
        record.organizationId,
        authData.user.id,
        membership.role,
      );
    }

    if (!allowed && membership.role === "manager") {
      allowed = visibleUserIds.includes(record.ownerId)
        || Boolean(record.secondaryOwnerId && visibleUserIds.includes(record.secondaryOwnerId));
    }

    if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});
  }

  const {data, error} = await admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUrl(record.storagePath, 60, {download: record.fileName || true});
  if (error || !data?.signedUrl) {
    return NextResponse.json({error: error?.message ?? "Unable to open attachment"}, {status: 500});
  }

  if (kind === "finance" && record.financeDocumentId) {
    const {error: auditError} = await admin.from("finance_document_audit_log").insert({
      organization_id: record.organizationId,
      document_id: record.financeDocumentId,
      actor_id: authData.user.id,
      action: "downloaded",
      details: {fileName: record.fileName},
    });
    if (auditError) console.error("Finance download audit failed", auditError);
  }

  if (kind === "payslip" && record.payslipId) {
    const {error: auditError} = await admin.from("payroll_audit_log").insert({
      organization_id: record.organizationId,
      payroll_entry_id: record.payrollEntryId ?? null,
      payslip_id: record.payslipId,
      employee_user_id: record.employeeUserId ?? null,
      actor_id: authData.user.id,
      action: "payslip_downloaded",
      details: {fileName: record.fileName},
    });
    if (auditError) console.error("Payslip download audit failed", auditError);
  }

  if ((kind === "expense" || kind === "expense-payment") && record.expenseId) {
    const {error: auditError} = await admin.from("finance_expense_audit_log").insert({
      organization_id: record.organizationId,
      expense_id: record.expenseId,
      actor_id: authData.user.id,
      action: kind === "expense" ? "receipt_opened" : "payment_proof_opened",
      details: {fileName: record.fileName},
    });
    if (auditError) console.error("Expense attachment audit failed", auditError);
  }

  if (kind === "contract-document" && record.contractId) {
    const {error: auditError} = await admin.from("service_contract_audit_log").insert({
      organization_id: record.organizationId,
      contract_id: record.contractId,
      actor_id: authData.user.id,
      action: "contract_document_opened",
      details: {fileName: record.fileName, documentId: id},
    });
    if (auditError) console.error("Contract document download audit failed", auditError);
  }

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
