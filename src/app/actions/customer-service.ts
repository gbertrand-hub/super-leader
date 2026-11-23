"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {canAccessCustomer,getCustomerServiceContext} from "@/lib/customer-service/server";

const priorities = new Set(["low", "normal", "high", "urgent"]);
const statuses = new Set(["open", "assigned", "in_progress", "waiting_customer", "escalated", "resolved", "closed", "cancelled"]);
const categories = new Set(["information", "complaint", "payment", "technical", "training", "delivery", "cancellation", "other"]);
const channels = new Set(["manual", "phone", "email", "whatsapp", "sms", "web", "social_media", "in_person", "other"]);

function text(value: FormDataEntryValue | null, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function go(message: string, kind: "success" | "error" = "success", ticket = ""): never {
  const query = new URLSearchParams({[kind]: message});
  if (ticket) query.set("ticket", ticket);
  redirect(`/dashboard/customer-service?${query.toString()}`);
}

async function ticketForOrganization(id: string, organizationId: string, admin: ReturnType<typeof createAdminClient>) {
  return admin.from("customer_service_tickets").select("id,client_id,assigned_to,status,priority").eq("id", id).eq("organization_id", organizationId).maybeSingle();
}

export async function createCustomerServiceTicketAction(formData: FormData) {
  const customerContext=await getCustomerServiceContext(); const {admin,user,membership}=customerContext;
  const clientId = text(formData.get("clientId"), 80);
  const subject = text(formData.get("subject"), 220);
  const description = text(formData.get("description"), 10000);
  const priority = text(formData.get("priority"), 20);
  const category = text(formData.get("category"), 30);
  const channel = text(formData.get("channel"), 30);
  const assignedTo = text(formData.get("assignedTo"), 80) || null;
  if (!clientId || subject.length < 2 || description.length < 2 || !priorities.has(priority) || !categories.has(category) || !channels.has(channel)) go("Données du ticket invalides.", "error");
  if(!(await canAccessCustomer(customerContext,clientId))) go("Accès refusé à ce client.","error");

  const [{data: client}, {data: settings}] = await Promise.all([
    admin.from("crm_clients").select("id").eq("id", clientId).eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("customer_service_settings").select("first_response_hours,resolution_hours").eq("organization_id", membership.organization_id).maybeSingle<{first_response_hours: number; resolution_hours: number}>(),
  ]);
  if (!client) go("Client introuvable.", "error");
  const now = Date.now();
  const firstHours = settings?.first_response_hours ?? 4;
  const resolutionHours = settings?.resolution_hours ?? 48;
  const reference = `SC-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const {data: ticket, error} = await admin.from("customer_service_tickets").insert({
    organization_id: membership.organization_id, reference, client_id: clientId, subject, description, priority, category, channel,
    assigned_to: assignedTo, status: assignedTo ? "assigned" : "open",
    first_response_due_at: new Date(now + firstHours * 3600000).toISOString(), resolution_due_at: new Date(now + resolutionHours * 3600000).toISOString(),
    created_by: user.id, updated_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !ticket) go(error?.message ?? "Création impossible.", "error");
  await admin.from("customer_service_events").insert({organization_id: membership.organization_id, ticket_id: ticket.id, actor_id: user.id, event_type: "created", note: description});
  revalidatePath("/dashboard/customer-service");
  go(`Ticket ${reference} créé.`, "success", ticket.id);
}

export async function updateCustomerServiceTicketAction(formData: FormData) {
  const customerContext=await getCustomerServiceContext(); const {admin,user,membership}=customerContext;
  const id = text(formData.get("ticketId"), 80);
  const status = text(formData.get("status"), 30);
  const priority = text(formData.get("priority"), 20);
  const assignedTo = text(formData.get("assignedTo"), 80) || null;
  const summary = text(formData.get("resolutionSummary"), 5000) || null;
  if (!id || !statuses.has(status) || !priorities.has(priority)) go("Mise à jour invalide.", "error");
  const {data: current} = await ticketForOrganization(id, membership.organization_id, admin);
  if (!current) go("Ticket introuvable.", "error");
  if(!(await canAccessCustomer(customerContext,String(current.client_id)))) go("Accès refusé.","error");
  const isLeader = ["owner", "admin", "manager"].includes(membership.role);
  if (!isLeader && current.assigned_to !== user.id) go("Accès refusé.", "error", id);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {status, priority, assigned_to: assignedTo, resolution_summary: summary, updated_by: user.id};
  if (status === "resolved" && current.status !== "resolved") patch.resolved_at = now;
  if (status === "closed") patch.closed_at = now;
  const {error} = await admin.from("customer_service_tickets").update(patch).eq("id", id).eq("organization_id", membership.organization_id);
  if (error) go(error.message, "error", id);
  const eventType = status === "escalated" ? "escalated" : status === "resolved" ? "resolved" : current.status === "resolved" && status !== "resolved" ? "reopened" : "status_changed";
  await admin.from("customer_service_events").insert({organization_id: membership.organization_id, ticket_id: id, actor_id: user.id, event_type: eventType, note: summary, metadata: {from_status: current.status, to_status: status, from_priority: current.priority, to_priority: priority}});
  revalidatePath("/dashboard/customer-service");
  go("Ticket mis à jour.", "success", id);
}

export async function addCustomerServiceMessageAction(formData: FormData) {
  const customerContext=await getCustomerServiceContext(); const {admin,user,membership}=customerContext;
  const id = text(formData.get("ticketId"), 80);
  const body = text(formData.get("body"), 10000);
  const direction = text(formData.get("direction"), 20);
  const channel = text(formData.get("channel"), 30);
  if (!id || !body || !new Set(["inbound", "outbound", "internal"]).has(direction)) go("Message invalide.", "error", id);
  const {data: ticket} = await ticketForOrganization(id, membership.organization_id, admin);
  if (!ticket) go("Ticket introuvable.", "error");
  if(!(await canAccessCustomer(customerContext,String(ticket.client_id)))) go("Accès refusé.","error");
  const now = new Date().toISOString();
  const {error} = await admin.from("customer_service_messages").insert({organization_id: membership.organization_id, ticket_id: id, author_id: user.id, direction, channel, body, is_internal: direction === "internal"});
  if (error) go(error.message, "error", id);
  if (direction === "outbound") await admin.from("customer_service_tickets").update({first_responded_at: now, status: ticket.status === "open" || ticket.status === "assigned" ? "in_progress" : ticket.status, updated_by: user.id}).eq("id", id).is("first_responded_at", null);
  await admin.from("customer_service_events").insert({organization_id: membership.organization_id, ticket_id: id, actor_id: user.id, event_type: "message_added", metadata: {direction, channel}});
  revalidatePath("/dashboard/customer-service");
  go("Message ajouté à l’historique.", "success", id);
}
