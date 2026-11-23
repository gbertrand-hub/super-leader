"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireAccessContext} from "@/lib/auth/access-control";
import {finalizeTemporaryAttachment, readPendingAttachment, removePrivateAttachment} from "@/lib/storage/private-attachments";

const PUBLISHERS = new Set(["owner", "admin", "hr"]);
const CATEGORIES = new Set(["direction", "hr", "finance", "platform", "event", "recognition", "urgent"]);
const PRIORITIES = new Set(["normal", "important", "urgent"]);
const SCOPES = new Set(["organization", "role", "department", "team"]);

function value(formData: FormData, name: string, max = 500) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function values(formData: FormData, name: string, max = 100) {
  return [...new Set(formData.getAll(name).map((item) => String(item).trim().slice(0, max)).filter(Boolean))].slice(0, 100);
}

function dateValue(formData: FormData, name: string) {
  const raw = value(formData, name, 40);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function go(message: string, kind: "success" | "error"): never {
  redirect(`/dashboard/announcements?${kind}=${encodeURIComponent(message)}`);
}

async function audit(context: Awaited<ReturnType<typeof requireAccessContext>>, announcementId: string, action: string, details: Record<string, unknown> = {}) {
  const {error} = await context.admin.from("official_announcement_audit_log").insert({
    organization_id: context.organizationId,
    announcement_id: announcementId,
    actor_id: context.user.id,
    action,
    details,
  });
  if (error) console.error("Official announcement audit failed", error);
}

async function recipientIds(context: Awaited<ReturnType<typeof requireAccessContext>>, scope: string, audienceValues: string[]) {
  const {data: memberships, error: membershipError} = await context.admin
    .from("organization_members")
    .select("user_id,role")
    .eq("organization_id", context.organizationId)
    .eq("is_active", true);
  if (membershipError) throw membershipError;
  const activeIds = new Set((memberships ?? []).map((row) => String(row.user_id)));
  if (scope === "organization") return [...activeIds];
  if (scope === "role") return (memberships ?? []).filter((row) => audienceValues.includes(String(row.role))).map((row) => String(row.user_id));

  let teamQuery = context.admin.from("teams").select("id,manager_id,department").eq("organization_id", context.organizationId).eq("is_active", true);
  if (scope === "team") teamQuery = teamQuery.in("id", audienceValues);
  if (scope === "department") teamQuery = teamQuery.in("department", audienceValues);
  const {data: teams, error: teamsError} = await teamQuery;
  if (teamsError) throw teamsError;
  const teamIds = (teams ?? []).map((team) => String(team.id));
  if (!teamIds.length) return [];
  const {data: members, error: teamMembersError} = await context.admin.from("team_members").select("user_id").in("team_id", teamIds);
  if (teamMembersError) throw teamMembersError;
  const ids = new Set((members ?? []).map((row) => String(row.user_id)));
  for (const team of teams ?? []) if (team.manager_id) ids.add(String(team.manager_id));
  return [...ids].filter((id) => activeIds.has(id));
}

export async function saveOfficialAnnouncementAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PUBLISHERS.has(context.role)) go("Accès refusé.", "error");
  const titleFr = value(formData, "titleFr", 220);
  const bodyFr = value(formData, "bodyFr", 12000);
  const titleEn = value(formData, "titleEn", 220);
  const bodyEn = value(formData, "bodyEn", 12000);
  const category = value(formData, "category", 40);
  const priority = value(formData, "priority", 40);
  const audienceScope = value(formData, "audienceScope", 40);
  const audienceValues = values(formData, "audienceValues", 100);
  const publishAt = dateValue(formData, "publishAt");
  const expiresAt = dateValue(formData, "expiresAt");
  if (titleFr.length < 3 || bodyFr.length < 10 || titleEn.length < 3 || bodyEn.length < 10 || !CATEGORIES.has(category) || !PRIORITIES.has(priority) || !SCOPES.has(audienceScope)) {
    go("Renseigne le titre et le contenu en français et en anglais, puis vérifie la catégorie, la priorité et l’audience.", "error");
  }
  if (audienceScope !== "organization" && audienceValues.length === 0) go("Sélectionne au moins un destinataire.", "error");
  if (publishAt && expiresAt && new Date(expiresAt) <= new Date(publishAt)) go("La date d’expiration doit suivre la publication.", "error");

  const {data: created, error} = await context.admin.from("official_announcements").insert({
    organization_id: context.organizationId,
    title: titleFr,
    body: bodyFr,
    title_fr: titleFr,
    body_fr: bodyFr,
    title_en: titleEn,
    body_en: bodyEn,
    category,
    priority,
    audience_scope: audienceScope,
    audience_values: audienceScope === "organization" ? [] : audienceValues,
    acknowledgement_required: formData.get("acknowledgementRequired") === "on",
    publish_at: publishAt,
    expires_at: expiresAt,
    created_by: context.user.id,
    updated_by: context.user.id,
  }).select("id").single<{id: string}>();
  if (error || !created) go(`Création impossible : ${error?.message ?? "erreur inconnue"}`, "error");

  const pending = readPendingAttachment(formData, "announcementAttachment");
  if (pending) {
    try {
      const attachment = await finalizeTemporaryAttachment({admin: context.admin, organizationId: context.organizationId, userId: context.user.id, purpose: "announcement", recordId: created.id, pending});
      const {error: attachmentError} = await context.admin.from("official_announcements").update({attachment_storage_path: attachment.storagePath, attachment_file_name: attachment.fileName, attachment_mime_type: attachment.mimeType, attachment_size_bytes: attachment.sizeBytes}).eq("id", created.id);
      if (attachmentError) throw attachmentError;
    } catch (attachmentError) {
      await context.admin.from("official_announcements").delete().eq("id", created.id);
      await removePrivateAttachment(context.admin, pending.storagePath);
      go(`La pièce jointe n’a pas pu être sécurisée : ${attachmentError instanceof Error ? attachmentError.message : "erreur inconnue"}`, "error");
    }
  }
  await audit(context, created.id, "draft_created", {audienceScope, audienceValues, priority});
  revalidatePath("/dashboard/announcements");
  go("Brouillon enregistré.", "success");
}

export async function publishOfficialAnnouncementAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PUBLISHERS.has(context.role)) go("Accès refusé.", "error");
  const announcementId = value(formData, "announcementId", 80);
  const {data: announcement, error} = await context.admin.from("official_announcements").select("id,status,audience_scope,audience_values,publish_at").eq("id", announcementId).eq("organization_id", context.organizationId).maybeSingle<{id: string;status: string;audience_scope: string;audience_values: string[];publish_at: string | null}>();
  if (error || !announcement || announcement.status !== "draft") go("Ce brouillon ne peut pas être publié.", "error");
  const recipients = await recipientIds(context, announcement.audience_scope, announcement.audience_values ?? []);
  if (!recipients.length) go("Aucun destinataire actif ne correspond à cette audience.", "error");
  const rows = recipients.map((userId) => ({announcement_id: announcement.id, organization_id: context.organizationId, user_id: userId}));
  const {error: recipientError} = await context.admin.from("official_announcement_recipients").upsert(rows, {onConflict: "announcement_id,user_id"});
  if (recipientError) go(`Publication impossible : ${recipientError.message}`, "error");
  const publishedAt = new Date().toISOString();
  const {error: publishError} = await context.admin.from("official_announcements").update({status: "published", published_at: publishedAt, publish_at: announcement.publish_at ?? publishedAt, updated_by: context.user.id, updated_at: publishedAt}).eq("id", announcement.id).eq("status", "draft");
  if (publishError) go(`Publication impossible : ${publishError.message}`, "error");
  await audit(context, announcement.id, "published", {recipientCount: recipients.length});
  revalidatePath("/dashboard/announcements");
  go(`Annonce publiée pour ${recipients.length} destinataire(s).`, "success");
}

export async function updateOfficialAnnouncementAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PUBLISHERS.has(context.role)) go("Accès refusé.", "error");
  const id = value(formData, "announcementId", 80);
  const titleFr = value(formData, "titleFr", 220);
  const bodyFr = value(formData, "bodyFr", 12000);
  const titleEn = value(formData, "titleEn", 220);
  const bodyEn = value(formData, "bodyEn", 12000);
  const category = value(formData, "category", 40);
  const priority = value(formData, "priority", 40);
  const expiresAt = dateValue(formData, "expiresAt");
  const acknowledgementRequired = formData.get("acknowledgementRequired") === "on";
  const resetAcknowledgements = formData.get("resetAcknowledgements") === "on";
  if (!id || titleFr.length < 3 || bodyFr.length < 10 || titleEn.length < 3 || bodyEn.length < 10 || !CATEGORIES.has(category) || !PRIORITIES.has(priority)) {
    go("Renseigne le titre et le contenu en français et en anglais, puis vérifie la catégorie et la priorité.", "error");
  }

  const {data: current, error: readError} = await context.admin
    .from("official_announcements")
    .select("id,title,body,title_fr,body_fr,title_en,body_en,category,priority,status,publish_at,expires_at,acknowledgement_required")
    .eq("id", id)
    .eq("organization_id", context.organizationId)
    .maybeSingle<{id: string;title: string;body: string;title_fr: string | null;body_fr: string | null;title_en: string | null;body_en: string | null;category: string;priority: string;status: string;publish_at: string | null;expires_at: string | null;acknowledgement_required: boolean}>();
  if (readError || !current || current.status === "archived") go("Cette annonce ne peut pas être modifiée.", "error");
  if (current.publish_at && expiresAt && new Date(expiresAt) <= new Date(current.publish_at)) {
    go("La date d’expiration doit suivre la publication.", "error");
  }

  const changes: Record<string, {before: unknown; after: unknown}> = {};
  const next = {
    title: titleFr,
    body: bodyFr,
    title_fr: titleFr,
    body_fr: bodyFr,
    title_en: titleEn,
    body_en: bodyEn,
    category,
    priority,
    expires_at: expiresAt,
    acknowledgement_required: acknowledgementRequired,
  };
  const previous = {
    title: current.title,
    body: current.body,
    title_fr: current.title_fr,
    body_fr: current.body_fr,
    title_en: current.title_en,
    body_en: current.body_en,
    category: current.category,
    priority: current.priority,
    expires_at: current.expires_at,
    acknowledgement_required: current.acknowledgement_required,
  };
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (previous[key] !== next[key]) changes[key] = {before: previous[key], after: next[key]};
  }
  if (!Object.keys(changes).length && !resetAcknowledgements) go("Aucune modification détectée.", "error");

  const {error: updateError} = await context.admin.from("official_announcements").update({
    ...next,
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("organization_id", context.organizationId).neq("status", "archived");
  if (updateError) go(`Modification impossible : ${updateError.message}`, "error");

  if (resetAcknowledgements && current.status === "published") {
    const {error: resetError} = await context.admin.from("official_announcement_recipients").update({acknowledged_at: null}).eq("announcement_id", id).eq("organization_id", context.organizationId);
    if (resetError) go(`Annonce modifiée, mais les confirmations n’ont pas pu être réinitialisées : ${resetError.message}`, "error");
  }
  await audit(context, id, "updated", {changes, acknowledgementsReset: resetAcknowledgements && current.status === "published"});
  revalidatePath("/dashboard/announcements");
  revalidatePath("/dashboard/my-day");
  go(resetAcknowledgements && current.status === "published" ? "Annonce modifiée et nouvelles confirmations demandées." : "Annonce modifiée.", "success");
}

export async function archiveOfficialAnnouncementAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PUBLISHERS.has(context.role)) go("Accès refusé.", "error");
  const id = value(formData, "announcementId", 80);
  const {error} = await context.admin.from("official_announcements").update({status: "archived", updated_by: context.user.id, updated_at: new Date().toISOString()}).eq("id", id).eq("organization_id", context.organizationId);
  if (error) go(`Archivage impossible : ${error.message}`, "error");
  await audit(context, id, "archived");
  revalidatePath("/dashboard/announcements");
  go("Annonce archivée.", "success");
}

export async function markOfficialAnnouncementReadAction(formData: FormData) {
  const context = await requireAccessContext();
  const id = value(formData, "announcementId", 80);
  await context.admin.from("official_announcement_recipients").update({first_opened_at: new Date().toISOString()}).eq("announcement_id", id).eq("organization_id", context.organizationId).eq("user_id", context.user.id).is("first_opened_at", null);
  revalidatePath("/dashboard/announcements");
}

export async function acknowledgeOfficialAnnouncementAction(formData: FormData) {
  const context = await requireAccessContext();
  const id = value(formData, "announcementId", 80);
  const {data: announcement} = await context.admin.from("official_announcements").select("acknowledgement_required,status").eq("id", id).eq("organization_id", context.organizationId).maybeSingle<{acknowledgement_required: boolean;status: string}>();
  if (!announcement || announcement.status !== "published" || !announcement.acknowledgement_required) return;
  const now = new Date().toISOString();
  await context.admin.from("official_announcement_recipients").update({first_opened_at: now, acknowledged_at: now}).eq("announcement_id", id).eq("organization_id", context.organizationId).eq("user_id", context.user.id);
  await audit(context, id, "acknowledged");
  revalidatePath("/dashboard/announcements");
}
