"use server";

import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function go(token: string, code: string): never {
  redirect(`/feedback/customer/${encodeURIComponent(token)}?${code}`);
}

export async function submitCustomerFeedbackAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const rating = Number(String(formData.get("rating") ?? "").trim());
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 5000) || null;
  const consentToContact = formData.get("consentToContact") === "on";

  if (!uuidPattern.test(token) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    go(token || "invalid", "error=invalid");
  }

  const admin = createAdminClient();
  const {data: request, error: requestError} = await admin
    .from("crm_feedback_requests")
    .select("id, organization_id, client_id, interaction_id, employee_id, locale, status, expires_at, created_by")
    .eq("public_token", token)
    .maybeSingle<{
      id: string;
      organization_id: string;
      client_id: string;
      interaction_id: string | null;
      employee_id: string;
      locale: "fr" | "en";
      status: string;
      expires_at: string;
      created_by: string;
    }>();

  if (requestError || !request) go(token, "error=invalid");
  if (request.status === "completed") go(token, "submitted=1");
  if (["cancelled", "expired"].includes(request.status) || new Date(request.expires_at).getTime() < Date.now()) {
    await admin.from("crm_feedback_requests").update({status: "expired"}).eq("id", request.id);
    go(token, "error=expired");
  }

  const [{data: settings}, {data: client}] = await Promise.all([
    admin
      .from("crm_settings")
      .select("low_score_threshold")
      .eq("organization_id", request.organization_id)
      .maybeSingle<{low_score_threshold: number}>(),
    admin
      .from("crm_clients")
      .select("full_name, follow_up_owner_id")
      .eq("id", request.client_id)
      .eq("organization_id", request.organization_id)
      .maybeSingle<{full_name: string; follow_up_owner_id: string | null}>(),
  ]);

  const threshold = settings?.low_score_threshold ?? 2;
  const needsResolution = rating <= threshold;
  const {data: response, error: responseError} = await admin
    .from("crm_feedback_responses")
    .insert({
      organization_id: request.organization_id,
      request_id: request.id,
      client_id: request.client_id,
      interaction_id: request.interaction_id,
      employee_id: request.employee_id,
      rating,
      comment,
      consent_to_contact: consentToContact,
      resolution_status: needsResolution ? "open" : "not_required",
      resolution_assigned_to: needsResolution ? client?.follow_up_owner_id ?? null : null,
    })
    .select("id")
    .single<{id: string}>();

  if (responseError) {
    if (responseError.code === "23505") go(token, "submitted=1");
    go(token, "error=failed");
  }

  await admin
    .from("crm_feedback_requests")
    .update({status: "completed", completed_at: new Date().toISOString(), next_reminder_at: null, scheduled_send_at: null})
    .eq("id", request.id);

  if (needsResolution && client?.follow_up_owner_id) {
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await admin.from("crm_follow_up_tasks").insert({
      organization_id: request.organization_id,
      client_id: request.client_id,
      interaction_id: request.interaction_id,
      assigned_to: client.follow_up_owner_id,
      title: request.locale === "fr"
        ? `Alerte satisfaction client : ${client.full_name} (${rating}/5)`
        : `Customer satisfaction alert: ${client.full_name} (${rating}/5)`,
      description: comment,
      due_at: dueAt,
      priority: rating === 1 ? "urgent" : "high",
      status: "todo",
      created_by: request.created_by,
    });
  }

  await admin.from("crm_audit_log").insert({
    organization_id: request.organization_id,
    actor_id: null,
    entity_type: "feedback_response",
    entity_id: response?.id ?? null,
    action: needsResolution ? "low_customer_feedback_received" : "customer_feedback_received",
    details: {rating, requestId: request.id, clientId: request.client_id},
  });

  go(token, "submitted=1");
}
