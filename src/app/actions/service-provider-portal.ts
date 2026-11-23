"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import type {User} from "@supabase/supabase-js";
import {requireAccessContext} from "@/lib/auth/access-control";
import {
  getProviderPortalContext,
  requireProviderContract,
  type ProviderPortalContext,
} from "@/lib/contracts/provider-portal-access";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  PRIVATE_ATTACHMENTS_BUCKET,
} from "@/lib/storage/private-attachments";
import {getSiteUrl} from "@/lib/supabase/env";
import {createClient} from "@/lib/supabase/server";

const PORTAL_ADMIN_ROLES = new Set(["owner", "admin"]);

type PendingProof = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function field(formData: FormData, name: string, max = 4000) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function dateField(formData: FormData, name: string) {
  const value = field(formData, name, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function optionalNumber(formData: FormData, name: string) {
  const raw = field(formData, name, 60);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return safe || "document";
}

function readPendingProof(formData: FormData): PendingProof | null {
  const storagePath = field(formData, "proofStoragePath", 1000);
  if (!storagePath) return null;
  const sizeBytes = Number(field(formData, "proofSizeBytes", 40));
  return {
    storagePath,
    fileName: safeFileName(field(formData, "proofFileName", 180) || "document"),
    mimeType: field(formData, "proofMimeType", 200).toLowerCase(),
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
  };
}

function providerPortalRedirect(message: string, kind: "success" | "error"): never {
  redirect(`/provider-portal?${kind}=${encodeURIComponent(message)}`);
}

function portalAdminRedirect(message: string, kind: "success" | "error"): never {
  redirect(`/dashboard/contracts/provider-portal?${kind}=${encodeURIComponent(message)}`);
}

function providerPasswordRedirect(message: string, kind: "success" | "error"): never {
  redirect(`/provider-set-password?${kind}=${encodeURIComponent(message)}`);
}

function validProviderPassword(value: string) {
  return value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

async function findAuthUserByEmail(admin: Awaited<ReturnType<typeof requireAccessContext>>["admin"], email: string) {
  const normalized = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const {data, error} = await admin.auth.admin.listUsers({page, perPage});
    if (error) throw new Error(error.message);
    const match = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function contractAudit(
  context: ProviderPortalContext,
  input: {organizationId: string; providerId: string; contractId: string; action: string; details?: Record<string, unknown>},
) {
  const {error} = await context.admin.from("service_contract_audit_log").insert({
    organization_id: input.organizationId,
    provider_id: input.providerId,
    contract_id: input.contractId,
    actor_id: context.userId,
    action: input.action,
    details: {source: "provider_portal", ...(input.details ?? {})},
  });
  if (error) console.error("Provider portal audit failed", error);
}

async function notifyContractOwner(
  context: ProviderPortalContext,
  contract: {id: string; organization_id: string; internal_owner_user_id: string; title: string},
  input: {eventType: string; titleFr: string; titleEn: string; bodyFr: string; bodyEn: string; dedupeKey: string},
) {
  const {error} = await context.admin.from("notifications").insert({
    organization_id: contract.organization_id,
    user_id: contract.internal_owner_user_id,
    actor_id: context.userId,
    category: "system",
    event_type: input.eventType,
    priority: "info",
    title_fr: input.titleFr,
    title_en: input.titleEn,
    body_fr: input.bodyFr,
    body_en: input.bodyEn,
    action_url: `/dashboard/contracts/${contract.id}`,
    requires_action: true,
    status: "unread",
    email_requested: false,
    email_status: "skipped",
    dedupe_key: input.dedupeKey,
    metadata: {contract_id: contract.id, source: "provider_portal"},
  });
  if (error && error.code !== "23505") console.error("Provider portal notification failed", error);
}

async function finalizeProof(
  context: ProviderPortalContext,
  contract: {id: string; organization_id: string; provider_id: string},
  resourceType: "obligation_occurrence" | "deliverable" | "report",
  resourceId: string,
  pending: PendingProof | null,
) {
  if (!pending) return null;
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(pending.mimeType)) throw new Error("Type de fichier non pris en charge.");
  if (!Number.isInteger(pending.sizeBytes) || pending.sizeBytes < 1 || pending.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error("Le fichier doit faire 10 Mo ou moins.");
  }
  const expectedPrefix = `${contract.organization_id}/temp/${context.userId}/provider-portal/${contract.id}/`;
  if (!pending.storagePath.startsWith(expectedPrefix) || pending.storagePath.includes("..")) {
    throw new Error("Chemin de preuve invalide.");
  }

  const bucket = context.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET);
  const {data: info, error: infoError} = await bucket.info(pending.storagePath);
  if (infoError || !info) throw new Error(infoError?.message ?? "Fichier téléversé introuvable.");
  const actualSize = Number(info.size ?? pending.sizeBytes);
  const actualMime = String(info.contentType ?? pending.mimeType).toLowerCase();
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(actualMime) || actualSize < 1 || actualSize > MAX_ATTACHMENT_BYTES) {
    throw new Error("Preuve non conforme.");
  }

  const attachmentId = randomUUID();
  const finalPath = `${contract.organization_id}/provider-portal/${contract.id}/${resourceType}/${resourceId}/${attachmentId}-${pending.fileName}`;
  const {error: moveError} = await bucket.move(pending.storagePath, finalPath);
  if (moveError) throw new Error(moveError.message);

  const {error: insertError} = await context.admin.from("service_provider_portal_attachments").insert({
    id: attachmentId,
    organization_id: contract.organization_id,
    provider_id: contract.provider_id,
    contract_id: contract.id,
    resource_type: resourceType,
    resource_id: resourceId,
    storage_path: finalPath,
    file_name: pending.fileName,
    mime_type: actualMime,
    size_bytes: actualSize,
    uploaded_by: context.userId,
  });
  if (insertError) {
    await bucket.remove([finalPath]);
    throw new Error(insertError.message);
  }
  return {id: attachmentId, fileName: pending.fileName};
}

export async function inviteProviderPortalAccessAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PORTAL_ADMIN_ROLES.has(context.role)) portalAdminRedirect("Seuls Owner et Admin peuvent ouvrir un accès prestataire.", "error");

  const providerId = field(formData, "providerId", 80);
  const email = field(formData, "email", 220).toLowerCase();
  const displayName = field(formData, "displayName", 180) || null;
  if (!providerId || !email || !email.includes("@")) portalAdminRedirect("Prestataire ou e-mail invalide.", "error");

  const {data: provider, error: providerError} = await context.admin
    .from("service_providers")
    .select("id,legal_name,status")
    .eq("id", providerId)
    .eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; legal_name: string; status: string}>();
  if (providerError || !provider) portalAdminRedirect("Prestataire introuvable.", "error");

  let authUser: User | null = null;
  let invitationSent = false;
  try {
    authUser = await findAuthUserByEmail(context.admin, email);
    if (!authUser) {
      const redirectTo = `${getSiteUrl()}/provider-login?next=${encodeURIComponent("/provider-portal")}`;
      const {data, error} = await context.admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          full_name: displayName || provider.legal_name,
          provider_portal: true,
          provider_id: provider.id,
          organization_id: context.organizationId,
        },
      });
      if (error || !data.user) throw new Error(error?.message ?? "Compte prestataire non créé.");
      authUser = data.user;
      invitationSent = true;
    }
  } catch (error) {
    portalAdminRedirect(`Invitation impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error");
  }

  if (!authUser) portalAdminRedirect("Compte prestataire indisponible.", "error");
  const {data: existingPortalLink} = await context.admin
    .from("service_provider_portal_users")
    .select("id,password_setup_required,password_set_at")
    .eq("organization_id", context.organizationId)
    .eq("provider_id", provider.id)
    .eq("email", email)
    .maybeSingle<{id: string; password_setup_required: boolean; password_set_at: string | null}>();
  const now = new Date().toISOString();
  const {error: linkError} = await context.admin.from("service_provider_portal_users").upsert({
    organization_id: context.organizationId,
    provider_id: provider.id,
    user_id: authUser.id,
    email,
    display_name: displayName,
    status: "active",
    invited_by: context.user.id,
    invited_at: now,
    activated_at: now,
    revoked_by: null,
    revoked_at: null,
    password_setup_required: existingPortalLink?.password_setup_required ?? true,
    password_set_at: existingPortalLink?.password_set_at ?? null,
    updated_at: now,
  }, {onConflict: "organization_id,provider_id,email"});
  if (linkError) portalAdminRedirect(`Accès non enregistré : ${linkError.message}`, "error");

  await context.admin.from("service_contract_audit_log").insert({
    organization_id: context.organizationId,
    provider_id: provider.id,
    actor_id: context.user.id,
    action: "provider_portal_access_granted",
    details: {email, displayName, invitationSent},
  });
  revalidatePath("/dashboard/contracts/provider-portal");
  portalAdminRedirect(
    invitationSent
      ? `Invitation envoyée à ${email}.`
      : `Compte existant relié au portail. ${email} peut utiliser /provider-login.`,
    "success",
  );
}

export async function setProviderPortalPasswordAction(formData: FormData) {
  const context = await getProviderPortalContext();
  if (!context) providerPasswordRedirect("Accès prestataire indisponible.", "error");

  const password = field(formData, "password", 200);
  const confirmPassword = field(formData, "confirmPassword", 200);
  if (!validProviderPassword(password)) {
    providerPasswordRedirect("Le mot de passe doit contenir au moins 10 caractères, une majuscule, une minuscule et un chiffre.", "error");
  }
  if (password !== confirmPassword) providerPasswordRedirect("Les mots de passe ne correspondent pas.", "error");

  const {error: authUpdateError} = await context.admin.auth.admin.updateUserById(context.userId, {password});
  if (authUpdateError) providerPasswordRedirect(`Mot de passe impossible à enregistrer : ${authUpdateError.message}`, "error");

  const now = new Date().toISOString();
  const {data: updatedLinks, error: linkError} = await context.admin
    .from("service_provider_portal_users")
    .update({
      password_setup_required: false,
      password_set_at: now,
      activated_at: now,
      updated_at: now,
    })
    .eq("user_id", context.userId)
    .eq("status", "active")
    .select("organization_id,provider_id,email");
  if (linkError) providerPasswordRedirect(`Mot de passe enregistré, mais profil prestataire non finalisé : ${linkError.message}`, "error");

  for (const link of updatedLinks ?? []) {
    await context.admin.from("service_contract_audit_log").insert({
      organization_id: link.organization_id,
      provider_id: link.provider_id,
      actor_id: context.userId,
      action: "provider_portal_password_created",
      details: {email: link.email, source: "provider_portal_first_login"},
    });
  }

  const email = context.email;
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/provider-login?success=password-created&email=${encodeURIComponent(email)}`);
}

export async function resendProviderPortalAccessLinkAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PORTAL_ADMIN_ROLES.has(context.role)) {
    portalAdminRedirect("Seuls Owner et Admin peuvent renvoyer un lien d’accès prestataire.", "error");
  }

  const portalUserId = field(formData, "portalUserId", 80);
  if (!portalUserId) portalAdminRedirect("Accès prestataire invalide.", "error");

  const {data: portalUser, error: portalUserError} = await context.admin
    .from("service_provider_portal_users")
    .select("id,provider_id,user_id,email,display_name,status")
    .eq("id", portalUserId)
    .eq("organization_id", context.organizationId)
    .maybeSingle<{
      id: string;
      provider_id: string;
      user_id: string;
      email: string;
      display_name: string | null;
      status: string;
    }>();

  if (portalUserError || !portalUser) portalAdminRedirect("Accès prestataire introuvable.", "error");
  if (portalUser.status !== "active") portalAdminRedirect("Cet accès est révoqué. Réactive-le avant d’envoyer un lien.", "error");

  try {
    const authUser = await findAuthUserByEmail(context.admin, portalUser.email);
    if (!authUser) throw new Error("Compte Auth prestataire introuvable.");
    if (authUser.id !== portalUser.user_id) throw new Error("Le compte Auth ne correspond plus à cet accès prestataire.");

    const redirectTo = `${getSiteUrl()}/provider-login?next=${encodeURIComponent("/provider-portal")}`;
    const {error} = await context.admin.auth.signInWithOtp({
      email: portalUser.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    portalAdminRedirect(
      `Lien non envoyé : ${error instanceof Error ? error.message : "erreur inconnue"}`,
      "error",
    );
  }

  await context.admin.from("service_contract_audit_log").insert({
    organization_id: context.organizationId,
    provider_id: portalUser.provider_id,
    actor_id: context.user.id,
    action: "provider_portal_access_link_resent",
    details: {
      email: portalUser.email,
      portalUserId: portalUser.id,
      source: "provider_portal_admin",
    },
  });

  revalidatePath("/dashboard/contracts/provider-portal");
  portalAdminRedirect(`Nouveau lien d’accès envoyé à ${portalUser.email}.`, "success");
}

export async function revokeProviderPortalAccessAction(formData: FormData) {
  const context = await requireAccessContext();
  if (!PORTAL_ADMIN_ROLES.has(context.role)) portalAdminRedirect("Seuls Owner et Admin peuvent révoquer un accès prestataire.", "error");
  const portalUserId = field(formData, "portalUserId", 80);
  const now = new Date().toISOString();
  const {data, error} = await context.admin
    .from("service_provider_portal_users")
    .update({status: "revoked", revoked_by: context.user.id, revoked_at: now, updated_at: now})
    .eq("id", portalUserId)
    .eq("organization_id", context.organizationId)
    .select("provider_id,email")
    .maybeSingle<{provider_id: string; email: string}>();
  if (error || !data) portalAdminRedirect("Accès prestataire introuvable.", "error");
  await context.admin.from("service_contract_audit_log").insert({
    organization_id: context.organizationId,
    provider_id: data.provider_id,
    actor_id: context.user.id,
    action: "provider_portal_access_revoked",
    details: {email: data.email},
  });
  revalidatePath("/dashboard/contracts/provider-portal");
  portalAdminRedirect(`Accès de ${data.email} révoqué.`, "success");
}

export async function submitProviderObligationAction(formData: FormData) {
  const context = await getProviderPortalContext();
  if (!context) providerPortalRedirect("Accès prestataire indisponible.", "error");
  const contractId = field(formData, "contractId", 80);
  const occurrenceId = field(formData, "occurrenceId", 80);
  const actualQuantity = optionalNumber(formData, "actualQuantity");
  const submissionNote = field(formData, "submissionNote", 4000);
  const pending = readPendingProof(formData);

  try {
    const contract = await requireProviderContract(context, contractId);
    const {data: occurrence, error} = await context.admin
      .from("service_contract_obligation_occurrences")
      .select("id,obligation_id,due_date,status")
      .eq("id", occurrenceId)
      .eq("contract_id", contract.id)
      .eq("organization_id", contract.organization_id)
      .maybeSingle<{id: string; obligation_id: string; due_date: string; status: string}>();
    if (error || !occurrence) throw new Error("Échéance d’obligation introuvable.");
    if (["accepted", "waived"].includes(occurrence.status)) throw new Error("Cette obligation est déjà validée.");

    const proof = await finalizeProof(context, contract, "obligation_occurrence", occurrence.id, pending);
    const now = new Date().toISOString();
    const {error: updateError} = await context.admin.from("service_contract_obligation_occurrences").update({
      actual_quantity: actualQuantity,
      evidence_reference: proof ? `Preuve portail: ${proof.fileName}` : "",
      submission_note: submissionNote,
      status: "submitted",
      submitted_by: context.userId,
      submitted_at: now,
      updated_at: now,
    }).eq("id", occurrence.id).eq("contract_id", contract.id).eq("organization_id", contract.organization_id);
    if (updateError) throw new Error(updateError.message);

    await contractAudit(context, {
      organizationId: contract.organization_id,
      providerId: contract.provider_id,
      contractId: contract.id,
      action: "provider_portal_obligation_submitted",
      details: {occurrenceId: occurrence.id, obligationId: occurrence.obligation_id, dueDate: occurrence.due_date, actualQuantity, attachmentId: proof?.id ?? null},
    });
    await notifyContractOwner(context, contract, {
      eventType: "provider_portal_obligation_submitted",
      titleFr: "Obligation soumise par le prestataire",
      titleEn: "Provider obligation submitted",
      bodyFr: `${contract.title} : une obligation a été soumise pour validation.`,
      bodyEn: `${contract.title}: an obligation was submitted for review.`,
      dedupeKey: `provider-portal-obligation:${occurrence.id}:${now}`,
    });
    revalidatePath("/provider-portal");
    revalidatePath(`/dashboard/contracts/${contract.id}`);
  } catch (error) {
    providerPortalRedirect(error instanceof Error ? error.message : "Soumission impossible.", "error");
  }
  providerPortalRedirect("Obligation soumise pour validation.", "success");
}

export async function submitProviderDeliverableAction(formData: FormData) {
  const context = await getProviderPortalContext();
  if (!context) providerPortalRedirect("Accès prestataire indisponible.", "error");
  const contractId = field(formData, "contractId", 80);
  const deliverableId = field(formData, "deliverableId", 80);
  const submissionNote = field(formData, "submissionNote", 4000);
  const pending = readPendingProof(formData);

  try {
    const contract = await requireProviderContract(context, contractId);
    const {data: deliverable, error} = await context.admin
      .from("service_contract_deliverables")
      .select("id,title,due_date,status")
      .eq("id", deliverableId)
      .eq("contract_id", contract.id)
      .eq("organization_id", contract.organization_id)
      .maybeSingle<{id: string; title: string; due_date: string; status: string}>();
    if (error || !deliverable) throw new Error("Livrable introuvable.");
    if (["accepted", "cancelled"].includes(deliverable.status)) throw new Error("Ce livrable ne peut plus être soumis.");

    const proof = await finalizeProof(context, contract, "deliverable", deliverable.id, pending);
    const now = new Date().toISOString();
    const {error: updateError} = await context.admin.from("service_contract_deliverables").update({
      evidence_reference: proof ? `Preuve portail: ${proof.fileName}` : "",
      submission_note: submissionNote,
      status: "submitted",
      submitted_at: now,
      updated_by: context.userId,
      updated_at: now,
    }).eq("id", deliverable.id).eq("contract_id", contract.id).eq("organization_id", contract.organization_id);
    if (updateError) throw new Error(updateError.message);

    await contractAudit(context, {
      organizationId: contract.organization_id,
      providerId: contract.provider_id,
      contractId: contract.id,
      action: "provider_portal_deliverable_submitted",
      details: {deliverableId: deliverable.id, title: deliverable.title, dueDate: deliverable.due_date, attachmentId: proof?.id ?? null},
    });
    await notifyContractOwner(context, contract, {
      eventType: "provider_portal_deliverable_submitted",
      titleFr: "Livrable soumis par le prestataire",
      titleEn: "Provider deliverable submitted",
      bodyFr: `${contract.title} : ${deliverable.title} a été soumis pour validation.`,
      bodyEn: `${contract.title}: ${deliverable.title} was submitted for review.`,
      dedupeKey: `provider-portal-deliverable:${deliverable.id}:${now}`,
    });
    revalidatePath("/provider-portal");
    revalidatePath(`/dashboard/contracts/${contract.id}`);
  } catch (error) {
    providerPortalRedirect(error instanceof Error ? error.message : "Soumission impossible.", "error");
  }
  providerPortalRedirect("Livrable soumis pour validation.", "success");
}

export async function submitProviderReportAction(formData: FormData) {
  const context = await getProviderPortalContext();
  if (!context) providerPortalRedirect("Accès prestataire indisponible.", "error");
  const contractId = field(formData, "contractId", 80);
  const periodStart = dateField(formData, "periodStart");
  const periodEnd = dateField(formData, "periodEnd");
  const workCompleted = field(formData, "workCompleted", 8000);
  const challenges = field(formData, "challenges", 6000);
  const nextActions = field(formData, "nextActions", 6000);
  const pending = readPendingProof(formData);
  if (!periodStart || !periodEnd || periodEnd < periodStart || workCompleted.length < 3) {
    providerPortalRedirect("Période ou contenu du rapport invalide.", "error");
  }

  try {
    const contract = await requireProviderContract(context, contractId);
    const reportId = randomUUID();
    const proof = await finalizeProof(context, contract, "report", reportId, pending);
    const now = new Date().toISOString();
    const {error} = await context.admin.from("service_contract_reports").insert({
      id: reportId,
      organization_id: contract.organization_id,
      contract_id: contract.id,
      period_start: periodStart,
      period_end: periodEnd,
      work_completed: workCompleted,
      challenges,
      next_actions: nextActions,
      evidence_reference: proof ? `Preuve portail: ${proof.fileName}` : "",
      status: "submitted",
      submitted_by: context.userId,
      submitted_at: now,
    });
    if (error) throw new Error(error.message);

    await contractAudit(context, {
      organizationId: contract.organization_id,
      providerId: contract.provider_id,
      contractId: contract.id,
      action: "provider_portal_report_submitted",
      details: {reportId, periodStart, periodEnd, attachmentId: proof?.id ?? null},
    });
    await notifyContractOwner(context, contract, {
      eventType: "provider_portal_report_submitted",
      titleFr: "Rapport prestataire reçu",
      titleEn: "Provider report received",
      bodyFr: `${contract.title} : un rapport ${periodStart} → ${periodEnd} a été soumis.`,
      bodyEn: `${contract.title}: a ${periodStart} → ${periodEnd} report was submitted.`,
      dedupeKey: `provider-portal-report:${reportId}`,
    });
    revalidatePath("/provider-portal");
    revalidatePath(`/dashboard/contracts/${contract.id}`);
  } catch (error) {
    providerPortalRedirect(error instanceof Error ? error.message : "Rapport impossible à soumettre.", "error");
  }
  providerPortalRedirect("Rapport soumis pour validation.", "success");
}

export async function signOutProviderPortalAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/provider-login");
}
