"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const CONTENT_ROLES = new Set(["owner", "admin", "executive"]);
const OPERATIONS_ROLES = new Set(["owner", "admin", "hr"]);
const COMMUNICATION_TYPES = new Set(["announcement", "invitation", "alert", "newsletter", "recognition", "operational_update", "other"]);
const PRIORITIES = new Set(["normal", "important", "urgent"]);
const AUDIENCE_SCOPES = new Set(["all_members", "active_members", "internal_only", "external_only", "honorary_only", "country", "category", "selected_members"]);
const CHANNELS = new Set(["manual", "email", "whatsapp", "in_person"]);
const DELIVERY_STATUSES = new Set(["planned", "sent", "delivered", "read", "acknowledged", "failed", "skipped"]);

type VipMember = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  member_type: string;
  recognition_category: string;
  status: string;
};

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function uuidList(values: FormDataEntryValue[]) {
  return values
    .map((value) => String(value).trim())
    .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    .slice(0, 2000);
}

function dateTimeValue(value: FormDataEntryValue | null) {
  const raw = text(value, 40);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function go(message: string, kind: "success" | "error", view = "campaigns"): never {
  const query = new URLSearchParams({view, [kind]: message});
  redirect(`/dashboard/vip/communications?${query.toString()}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const translate = (frText: string, enText: string) => locale === "fr" ? frText : enText;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();

  if (error || !membership) redirect("/dashboard/company");
  const {data: vipSettings} = await admin
    .from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_communications_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_communications_assistant_user_id: string | null}>();
  const isVipLeadership = vipSettings?.vip_manager_user_id === authData.user.id || vipSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipCommunicationsAssistant = vipSettings?.vip_communications_assistant_user_id === authData.user.id;
  const hasVipCommunicationsRole = isVipLeadership || isVipCommunicationsAssistant;
  if (!VIP_ROLES.has(membership.role) && !hasVipCommunicationsRole) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin, translate, isVipLeadership, isVipCommunicationsAssistant, hasVipCommunicationsRole};
}

async function audit(input: {
  organizationId: string;
  entityType: "communication" | "communication_delivery";
  entityId: string;
  actorId: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await input.admin.from("vip_audit_log").insert({
    organization_id: input.organizationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("VIP communications audit failed", error);
}

function matchesAudience(member: VipMember, communication: {
  audience_scope: string;
  audience_country: string | null;
  audience_category: string | null;
  selected_member_ids: string[];
}) {
  switch (communication.audience_scope) {
    case "all_members":
      return !["withdrawn"].includes(member.status);
    case "active_members":
      return ["active", "pending_renewal", "honorary"].includes(member.status);
    case "internal_only":
      return member.member_type === "internal" && !["withdrawn"].includes(member.status);
    case "external_only":
      return member.member_type === "external" && !["withdrawn"].includes(member.status);
    case "honorary_only":
      return member.status === "honorary";
    case "country":
      return Boolean(member.country && communication.audience_country && member.country.toLocaleLowerCase() === communication.audience_country.toLocaleLowerCase());
    case "category":
      return Boolean(communication.audience_category && member.recognition_category === communication.audience_category);
    case "selected_members":
      return communication.selected_member_ids.includes(member.id);
    default:
      return false;
  }
}

export async function saveVipCommunicationAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipCommunicationsRole} = await getContext();
  if (!CONTENT_ROLES.has(membership.role) && !hasVipCommunicationsRole) {
    go(translate("Tu n’as pas l’autorisation de créer les communications VIP.", "You are not allowed to create VIP communications."), "error");
  }

  const communicationId = text(formData.get("communicationId"), 80);
  const title = text(formData.get("title"), 220);
  const body = text(formData.get("body"), 12000);
  const communicationType = text(formData.get("communicationType"), 60) || "announcement";
  const priority = text(formData.get("priority"), 40) || "normal";
  const audienceScope = text(formData.get("audienceScope"), 60) || "active_members";
  const audienceCountry = text(formData.get("audienceCountry"), 120) || null;
  const audienceCategory = text(formData.get("audienceCategory"), 120) || null;
  const selectedMemberIds = uuidList(formData.getAll("selectedMemberIds"));
  const channels = formData.getAll("channels").map((value) => String(value)).filter((value) => CHANNELS.has(value));
  const publishAt = dateTimeValue(formData.get("publishAt"));
  const expiresAt = dateTimeValue(formData.get("expiresAt"));

  if (title.length < 3 || body.length < 10 || !COMMUNICATION_TYPES.has(communicationType) || !PRIORITIES.has(priority) || !AUDIENCE_SCOPES.has(audienceScope)) {
    go(translate("Vérifie le titre, le contenu, le type, la priorité et l’audience.", "Check the title, content, type, priority and audience."), "error");
  }
  if (channels.length === 0) {
    go(translate("Sélectionne au moins un canal de diffusion.", "Select at least one delivery channel."), "error");
  }
  if (audienceScope === "country" && !audienceCountry) {
    go(translate("Sélectionne le pays de l’audience.", "Select the audience country."), "error");
  }
  if (audienceScope === "category" && !audienceCategory) {
    go(translate("Sélectionne la catégorie de reconnaissance.", "Select the recognition category."), "error");
  }
  if (audienceScope === "selected_members" && selectedMemberIds.length === 0) {
    go(translate("Sélectionne au moins un membre VIP.", "Select at least one VIP member."), "error");
  }
  if (publishAt && expiresAt && expiresAt < publishAt) {
    go(translate("La date d’expiration ne peut pas précéder la publication.", "The expiry date cannot be before publication."), "error");
  }

  const payload = {
    title,
    body,
    communication_type: communicationType,
    priority,
    audience_scope: audienceScope,
    audience_country: audienceScope === "country" ? audienceCountry : null,
    audience_category: audienceScope === "category" ? audienceCategory : null,
    selected_member_ids: audienceScope === "selected_members" ? selectedMemberIds : [],
    channel_plan: channels,
    response_required: formData.get("responseRequired") === "on",
    publish_at: publishAt,
    expires_at: expiresAt,
    updated_by: user.id,
  };

  if (communicationId) {
    const {data: current, error: currentError} = await admin
      .from("vip_communications")
      .select("id,status,title")
      .eq("id", communicationId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; status: string; title: string}>();
    if (currentError || !current) go(translate("Communication introuvable.", "Communication not found."), "error");
    if (current.status !== "draft") go(translate("Seules les communications en brouillon peuvent être modifiées.", "Only draft communications can be edited."), "error");

    const {error} = await admin.from("vip_communications").update(payload).eq("id", communicationId).eq("organization_id", membership.organization_id);
    if (error) go(translate("La communication n’a pas pu être mise à jour : ", "The communication could not be updated: ") + error.message, "error");

    await audit({
      organizationId: membership.organization_id,
      entityType: "communication",
      entityId: communicationId,
      actorId: user.id,
      action: "communication_updated",
      previousStatus: current.status,
      newStatus: current.status,
      details: {title, previousTitle: current.title, audienceScope, channels},
      admin,
    });
    revalidatePath("/dashboard/vip/communications");
    go(translate("Brouillon mis à jour.", "Draft updated."), "success");
  }

  const {data: created, error} = await admin.from("vip_communications").insert({
    organization_id: membership.organization_id,
    ...payload,
    status: "draft",
    created_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !created) go(translate("La communication n’a pas pu être créée : ", "The communication could not be created: ") + (error?.message ?? ""), "error");

  await audit({
    organizationId: membership.organization_id,
    entityType: "communication",
    entityId: created.id,
    actorId: user.id,
    action: "communication_created",
    newStatus: "draft",
    details: {title, communicationType, audienceScope, channels},
    admin,
  });
  revalidatePath("/dashboard/vip/communications");
  go(translate("Communication enregistrée en brouillon.", "Communication saved as draft."), "success");
}

export async function duplicateVipCommunicationAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipCommunicationsRole} = await getContext();
  if (!CONTENT_ROLES.has(membership.role) && !hasVipCommunicationsRole) {
    go(translate("Tu n’as pas l’autorisation de dupliquer cette communication.", "You are not allowed to duplicate this communication."), "error");
  }
  const communicationId = text(formData.get("communicationId"), 80);
  if (!communicationId) go(translate("Communication invalide.", "Invalid communication."), "error");
  const {data: current, error: currentError} = await admin.from("vip_communications")
    .select("title,body,communication_type,priority,audience_scope,audience_country,audience_category,selected_member_ids,channel_plan,response_required,publish_at,expires_at")
    .eq("id", communicationId).eq("organization_id", membership.organization_id).maybeSingle();
  if (currentError || !current) go(translate("Communication introuvable.", "Communication not found."), "error");
  const {data: created, error} = await admin.from("vip_communications").insert({
    organization_id: membership.organization_id,
    ...current,
    title: `${String(current.title)} — ${translate("copie", "copy")}`,
    status: "draft",
    published_at: null,
    publish_at: null,
    created_by: user.id,
    updated_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !created) go(translate("La copie n’a pas pu être créée : ", "The copy could not be created: ") + (error?.message ?? ""), "error");
  await audit({organizationId: membership.organization_id, entityType: "communication", entityId: created.id, actorId: user.id, action: "communication_duplicated", newStatus: "draft", details: {sourceCommunicationId: communicationId}, admin});
  revalidatePath("/dashboard/vip/communications");
  const query = new URLSearchParams({view: "campaigns", edit: created.id, success: translate("Copie créée en brouillon.", "Copy created as draft.")});
  redirect(`/dashboard/vip/communications?${query.toString()}`);
}

export async function publishVipCommunicationAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipCommunicationsRole} = await getContext();
  if (!CONTENT_ROLES.has(membership.role) && !hasVipCommunicationsRole) {
    go(translate("Tu n’as pas l’autorisation de publier.", "You are not allowed to publish."), "error");
  }
  const communicationId = text(formData.get("communicationId"), 80);
  if (!communicationId) go(translate("Communication invalide.", "Invalid communication."), "error");

  const {data: communication, error: communicationError} = await admin
    .from("vip_communications")
    .select("id,title,status,audience_scope,audience_country,audience_category,selected_member_ids,channel_plan")
    .eq("id", communicationId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      id: string;
      title: string;
      status: string;
      audience_scope: string;
      audience_country: string | null;
      audience_category: string | null;
      selected_member_ids: string[];
      channel_plan: string[];
    }>();
  if (communicationError || !communication) go(translate("Communication introuvable.", "Communication not found."), "error");
  if (communication.status !== "draft") go(translate("Cette communication n’est plus un brouillon.", "This communication is no longer a draft."), "error");

  const {data: memberData, error: memberError} = await admin
    .from("vip_members")
    .select("id,full_name,email,phone,country,member_type,recognition_category,status")
    .eq("organization_id", membership.organization_id)
    .limit(5000);
  if (memberError) go(translate("Les membres n’ont pas pu être chargés : ", "Members could not be loaded: ") + memberError.message, "error");

  const recipients = ((memberData ?? []) as VipMember[]).filter((member) => matchesAudience(member, communication));
  if (recipients.length === 0) go(translate("Aucun membre ne correspond à cette audience.", "No members match this audience."), "error");

  const deliveries = recipients.flatMap((member) => communication.channel_plan.map((channel) => {
    const missingContact = (channel === "email" && !member.email) || (channel === "whatsapp" && !member.phone);
    return {
      organization_id: membership.organization_id,
      communication_id: communication.id,
      member_id: member.id,
      channel,
      status: missingContact ? "skipped" : "planned",
      recipient_name: member.full_name,
      recipient_email: member.email,
      recipient_phone: member.phone,
      failure_reason: missingContact ? (channel === "email" ? "missing_email" : "missing_phone") : null,
      updated_by: user.id,
    };
  }));

  const {error: deliveryError} = await admin.from("vip_communication_deliveries").insert(deliveries);
  if (deliveryError) go(translate("Les destinataires n’ont pas pu être préparés : ", "Recipients could not be prepared: ") + deliveryError.message, "error");

  const now = new Date().toISOString();
  const {error: updateError} = await admin.from("vip_communications").update({
    status: "published",
    published_by: user.id,
    published_at: now,
    publish_at: now,
    updated_by: user.id,
  }).eq("id", communication.id).eq("organization_id", membership.organization_id);
  if (updateError) go(translate("La publication n’a pas pu être finalisée : ", "Publication could not be finalized: ") + updateError.message, "error");

  await audit({
    organizationId: membership.organization_id,
    entityType: "communication",
    entityId: communication.id,
    actorId: user.id,
    action: "communication_published",
    previousStatus: "draft",
    newStatus: "published",
    details: {title: communication.title, recipientCount: recipients.length, deliveryCount: deliveries.length, channels: communication.channel_plan},
    admin,
  });
  revalidatePath("/dashboard/vip/communications");
  go(translate(`Communication publiée pour ${recipients.length} membre(s).`, `Communication published for ${recipients.length} member(s).`), "success", "deliveries");
}

export async function updateVipCommunicationStatusAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipCommunicationsRole} = await getContext();
  if (!CONTENT_ROLES.has(membership.role) && !hasVipCommunicationsRole) go(translate("Action non autorisée.", "Action not allowed."), "error");
  const communicationId = text(formData.get("communicationId"), 80);
  const nextStatus = text(formData.get("nextStatus"), 30);
  if (!communicationId || !["archived", "cancelled"].includes(nextStatus)) go(translate("Action invalide.", "Invalid action."), "error");

  const {data: current, error: currentError} = await admin.from("vip_communications")
    .select("id,status,title").eq("id", communicationId).eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; title: string}>();
  if (currentError || !current) go(translate("Communication introuvable.", "Communication not found."), "error");

  const {error} = await admin.from("vip_communications").update({status: nextStatus, updated_by: user.id})
    .eq("id", communicationId).eq("organization_id", membership.organization_id);
  if (error) go(translate("Le statut n’a pas pu être modifié : ", "Status could not be changed: ") + error.message, "error");

  await audit({
    organizationId: membership.organization_id,
    entityType: "communication",
    entityId: communicationId,
    actorId: user.id,
    action: nextStatus === "archived" ? "communication_archived" : "communication_cancelled",
    previousStatus: current.status,
    newStatus: nextStatus,
    details: {title: current.title},
    admin,
  });
  revalidatePath("/dashboard/vip/communications");
  go(nextStatus === "archived" ? translate("Communication archivée.", "Communication archived.") : translate("Communication annulée.", "Communication cancelled."), "success");
}

export async function updateVipCommunicationDeliveryAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipCommunicationsRole} = await getContext();
  if (!OPERATIONS_ROLES.has(membership.role) && !hasVipCommunicationsRole) go(translate("Tu n’as pas l’autorisation de mettre à jour les envois.", "You are not allowed to update deliveries."), "error", "deliveries");
  const deliveryId = text(formData.get("deliveryId"), 80);
  const nextStatus = text(formData.get("nextStatus"), 40);
  if (!deliveryId || !DELIVERY_STATUSES.has(nextStatus)) go(translate("Statut d’envoi invalide.", "Invalid delivery status."), "error", "deliveries");

  const {data: current, error: currentError} = await admin.from("vip_communication_deliveries")
    .select("id,status,channel,communication_id,member_id")
    .eq("id", deliveryId).eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; channel: string; communication_id: string; member_id: string}>();
  if (currentError || !current) go(translate("Envoi introuvable.", "Delivery not found."), "error", "deliveries");

  const now = new Date().toISOString();
  const payload: Record<string, string | null> = {
    status: nextStatus,
    external_reference: text(formData.get("externalReference"), 500) || null,
    delivery_notes: text(formData.get("deliveryNotes"), 2000) || null,
    failure_reason: nextStatus === "failed" ? (text(formData.get("failureReason"), 1000) || "unspecified") : null,
    updated_by: user.id,
  };
  if (["sent", "delivered", "read", "acknowledged"].includes(nextStatus)) payload.sent_at = now;
  if (["delivered", "read", "acknowledged"].includes(nextStatus)) payload.delivered_at = now;
  if (["read", "acknowledged"].includes(nextStatus)) payload.read_at = now;
  if (nextStatus === "acknowledged") payload.acknowledged_at = now;

  const {error} = await admin.from("vip_communication_deliveries").update(payload).eq("id", deliveryId).eq("organization_id", membership.organization_id);
  if (error) go(translate("L’envoi n’a pas pu être mis à jour : ", "Delivery could not be updated: ") + error.message, "error", "deliveries");

  await audit({
    organizationId: membership.organization_id,
    entityType: "communication_delivery",
    entityId: deliveryId,
    actorId: user.id,
    action: "communication_delivery_status_changed",
    previousStatus: current.status,
    newStatus: nextStatus,
    details: {communicationId: current.communication_id, memberId: current.member_id, channel: current.channel},
    admin,
  });
  revalidatePath("/dashboard/vip/communications");
  go(translate("Statut de diffusion mis à jour.", "Delivery status updated."), "success", "deliveries");
}
