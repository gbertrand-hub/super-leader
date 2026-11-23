"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const LEADER_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const MESSAGE_MAX_LENGTH = 5000;
const REACTION_EMOJIS = new Set(["👍", "❤️", "👏", "✅", "😂"]);

type Membership = {
  organization_id: string;
  role: string;
};

type MessagingContext = {
  user: {id: string};
  membership: Membership;
  admin: ReturnType<typeof createAdminClient>;
  tr: (fr: string, en: string) => string;
};

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function go(
  message: string,
  kind: "success" | "error",
  conversationId?: string,
  view = "inbox",
): never {
  const query = new URLSearchParams({view, [kind]: message});
  if (conversationId) query.set("conversation", conversationId);
  redirect(`/dashboard/messages?${query.toString()}`);
}

async function getContext(): Promise<MessagingContext> {
  const {locale} = await getI18n();
  const tr = (fr: string, en: string) => locale === "fr" ? fr : en;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (error || !membership) redirect("/dashboard/company");
  return {user: {id: authData.user.id}, membership, admin, tr};
}

async function audit(
  context: MessagingContext,
  input: {
    action: string;
    conversationId?: string | null;
    messageId?: string | null;
    targetUserId?: string | null;
    details?: Record<string, unknown>;
  },
) {
  const {error} = await context.admin.from("internal_messaging_audit_log").insert({
    organization_id: context.membership.organization_id,
    conversation_id: input.conversationId ?? null,
    message_id: input.messageId ?? null,
    actor_id: context.user.id,
    target_user_id: input.targetUserId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Internal messaging audit failed", error);
}

async function ensureConversationAccess(context: MessagingContext, conversationId: string) {
  const {data, error} = await context.admin
    .from("internal_conversation_members")
    .select("id,conversation_id,user_id,is_muted,archived_at,left_at")
    .eq("organization_id", context.membership.organization_id)
    .eq("conversation_id", conversationId)
    .eq("user_id", context.user.id)
    .is("left_at", null)
    .maybeSingle<{
      id: string;
      conversation_id: string;
      user_id: string;
      is_muted: boolean;
      archived_at: string | null;
      left_at: string | null;
    }>();

  if (error || !data) {
    go(context.tr("Conversation introuvable ou accès refusé.", "Conversation not found or access denied."), "error");
  }
  return data;
}

function directPairKey(firstUserId: string, secondUserId: string) {
  return [firstUserId, secondUserId].sort().join(":");
}

async function activeOrganizationUsers(context: MessagingContext, userIds: string[]) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return [];
  const {data, error} = await context.admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", context.membership.organization_id)
    .eq("is_active", true)
    .in("user_id", unique);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.user_id));
}

export async function startDirectConversationAction(formData: FormData) {
  const context = await getContext();
  const targetUserId = text(formData.get("targetUserId"), 80);
  if (!targetUserId || targetUserId === context.user.id) {
    go(context.tr("Sélectionne un autre collaborateur.", "Select another colleague."), "error", undefined, "directory");
  }

  const [activeTarget] = await activeOrganizationUsers(context, [targetUserId]);
  if (!activeTarget) {
    go(context.tr("Ce collaborateur n’est pas actif dans ton organisation.", "This colleague is not active in your organization."), "error", undefined, "directory");
  }

  const pairKey = directPairKey(context.user.id, targetUserId);
  const {data: existing, error: existingError} = await context.admin
    .from("internal_conversations")
    .select("id")
    .eq("organization_id", context.membership.organization_id)
    .eq("kind", "direct")
    .eq("direct_pair_key", pairKey)
    .eq("is_active", true)
    .maybeSingle<{id: string}>();
  if (existingError) {
    go(context.tr("La conversation n’a pas pu être recherchée : ", "The conversation could not be searched: ") + existingError.message, "error", undefined, "directory");
  }

  if (existing) {
    await context.admin
      .from("internal_conversation_members")
      .update({archived_at: null, left_at: null})
      .eq("conversation_id", existing.id)
      .eq("user_id", context.user.id);
    revalidatePath("/dashboard/messages");
    go(context.tr("Conversation ouverte.", "Conversation opened."), "success", existing.id);
  }

  const {data: conversation, error} = await context.admin
    .from("internal_conversations")
    .insert({
      organization_id: context.membership.organization_id,
      kind: "direct",
      direct_pair_key: pairKey,
      created_by: context.user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !conversation) {
    if (String(error?.code ?? "") === "23505") {
      const {data: retry} = await context.admin
        .from("internal_conversations")
        .select("id")
        .eq("organization_id", context.membership.organization_id)
        .eq("kind", "direct")
        .eq("direct_pair_key", pairKey)
        .eq("is_active", true)
        .maybeSingle<{id: string}>();
      if (retry) go(context.tr("Conversation ouverte.", "Conversation opened."), "success", retry.id);
    }
    go(context.tr("La conversation n’a pas pu être créée : ", "The conversation could not be created: ") + (error?.message ?? "unknown error"), "error", undefined, "directory");
  }

  const {error: memberError} = await context.admin.from("internal_conversation_members").insert([
    {
      organization_id: context.membership.organization_id,
      conversation_id: conversation.id,
      user_id: context.user.id,
      member_role: "owner",
    },
    {
      organization_id: context.membership.organization_id,
      conversation_id: conversation.id,
      user_id: targetUserId,
      member_role: "member",
    },
  ]);

  if (memberError) {
    await context.admin.from("internal_conversations").delete().eq("id", conversation.id);
    go(context.tr("Les participants n’ont pas pu être ajoutés : ", "Participants could not be added: ") + memberError.message, "error", undefined, "directory");
  }

  await audit(context, {
    action: "direct_conversation_created",
    conversationId: conversation.id,
    targetUserId,
  });

  revalidatePath("/dashboard/messages");
  go(context.tr("Conversation créée.", "Conversation created."), "success", conversation.id);
}

async function accessibleTeam(context: MessagingContext, teamId: string) {
  const {data: team, error} = await context.admin
    .from("teams")
    .select("id,name,department,manager_id,is_active")
    .eq("id", teamId)
    .eq("organization_id", context.membership.organization_id)
    .eq("is_active", true)
    .maybeSingle<{id: string; name: string; department: string | null; manager_id: string | null; is_active: boolean}>();
  if (error || !team) return null;
  if (LEADER_ROLES.has(context.membership.role)) return team;
  if (context.membership.role === "manager" && team.manager_id === context.user.id) return team;
  const {data: ownMembership} = await context.admin
    .from("team_members")
    .select("team_id")
    .eq("team_id", team.id)
    .eq("user_id", context.user.id)
    .maybeSingle<{team_id: string}>();
  return ownMembership ? team : null;
}

async function syncChannelMembers(
  context: MessagingContext,
  conversationId: string,
  userIds: string[],
) {
  const activeUsers = await activeOrganizationUsers(context, [...userIds, context.user.id]);
  if (!activeUsers.length) return;
  const rows = activeUsers.map((userId) => ({
    organization_id: context.membership.organization_id,
    conversation_id: conversationId,
    user_id: userId,
    member_role: userId === context.user.id ? "owner" : "member",
    left_at: null,
  }));
  const {error} = await context.admin
    .from("internal_conversation_members")
    .upsert(rows, {onConflict: "conversation_id,user_id"});
  if (error) throw new Error(error.message);

  const {data: currentRows, error: currentError} = await context.admin
    .from("internal_conversation_members")
    .select("user_id")
    .eq("organization_id", context.membership.organization_id)
    .eq("conversation_id", conversationId)
    .is("left_at", null);
  if (currentError) throw new Error(currentError.message);
  const activeSet = new Set(activeUsers);
  const staleUserIds = (currentRows ?? [])
    .map((row) => String(row.user_id))
    .filter((userId) => !activeSet.has(userId));
  if (staleUserIds.length) {
    const {error: leaveError} = await context.admin
      .from("internal_conversation_members")
      .update({left_at: new Date().toISOString()})
      .eq("organization_id", context.membership.organization_id)
      .eq("conversation_id", conversationId)
      .in("user_id", staleUserIds);
    if (leaveError) throw new Error(leaveError.message);
  }
}

export async function openTeamChannelAction(formData: FormData) {
  const context = await getContext();
  const teamId = text(formData.get("teamId"), 80);
  const team = await accessibleTeam(context, teamId);
  if (!team) {
    go(context.tr("Tu n’as pas accès à cette équipe.", "You do not have access to this team."), "error", undefined, "channels");
  }

  const {data: existing, error: existingError} = await context.admin
    .from("internal_conversations")
    .select("id")
    .eq("organization_id", context.membership.organization_id)
    .eq("kind", "team")
    .eq("team_id", team.id)
    .eq("is_active", true)
    .maybeSingle<{id: string}>();
  if (existingError) go(context.tr("Le canal n’a pas pu être recherché.", "The channel could not be searched."), "error", undefined, "channels");

  let conversationId = existing?.id ?? "";
  if (!conversationId) {
    const {data: created, error} = await context.admin
      .from("internal_conversations")
      .insert({
        organization_id: context.membership.organization_id,
        kind: "team",
        title: team.name,
        team_id: team.id,
        created_by: context.user.id,
      })
      .select("id")
      .single<{id: string}>();
    if (error || !created) {
      go(context.tr("Le canal d’équipe n’a pas pu être créé : ", "The team channel could not be created: ") + (error?.message ?? "unknown error"), "error", undefined, "channels");
    }
    conversationId = created.id;
    await audit(context, {action: "team_channel_created", conversationId, details: {teamId: team.id, teamName: team.name}});
  }

  const {data: memberRows} = await context.admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", team.id);
  const participantIds = (memberRows ?? []).map((row) => String(row.user_id));
  if (team.manager_id) participantIds.push(team.manager_id);
  await syncChannelMembers(context, conversationId, participantIds);
  await context.admin
    .from("internal_conversation_members")
    .update({archived_at: null})
    .eq("conversation_id", conversationId)
    .eq("user_id", context.user.id);

  revalidatePath("/dashboard/messages");
  go(context.tr("Canal d’équipe ouvert.", "Team channel opened."), "success", conversationId, "channels");
}

export async function openDepartmentChannelAction(formData: FormData) {
  const context = await getContext();
  const department = text(formData.get("department"), 180);
  if (department.length < 2) {
    go(context.tr("Sélectionne un département.", "Select a department."), "error", undefined, "channels");
  }

  let teamsQuery = context.admin
    .from("teams")
    .select("id,name,department,manager_id,is_active")
    .eq("organization_id", context.membership.organization_id)
    .eq("is_active", true)
    .ilike("department", department);

  if (!LEADER_ROLES.has(context.membership.role)) {
    if (context.membership.role === "manager") {
      teamsQuery = teamsQuery.eq("manager_id", context.user.id);
    } else {
      const {data: ownTeamRows} = await context.admin
        .from("team_members")
        .select("team_id")
        .eq("user_id", context.user.id);
      const ownTeamIds = (ownTeamRows ?? []).map((row) => String(row.team_id));
      if (!ownTeamIds.length) {
        go(context.tr("Tu n’as accès à aucun canal de département.", "You do not have access to a department channel."), "error", undefined, "channels");
      }
      teamsQuery = teamsQuery.in("id", ownTeamIds);
    }
  }

  const {data: teams, error: teamError} = await teamsQuery;
  if (teamError || !teams?.length) {
    go(context.tr("Aucune équipe accessible n’est liée à ce département.", "No accessible team is linked to this department."), "error", undefined, "channels");
  }

  const canonicalDepartment = String(teams[0].department ?? department).trim();
  const {data: existing, error: existingError} = await context.admin
    .from("internal_conversations")
    .select("id")
    .eq("organization_id", context.membership.organization_id)
    .eq("kind", "department")
    .ilike("department", canonicalDepartment)
    .eq("is_active", true)
    .maybeSingle<{id: string}>();
  if (existingError) go(context.tr("Le canal n’a pas pu être recherché.", "The channel could not be searched."), "error", undefined, "channels");

  let conversationId = existing?.id ?? "";
  if (!conversationId) {
    const {data: created, error} = await context.admin
      .from("internal_conversations")
      .insert({
        organization_id: context.membership.organization_id,
        kind: "department",
        title: canonicalDepartment,
        department: canonicalDepartment,
        created_by: context.user.id,
      })
      .select("id")
      .single<{id: string}>();
    if (error || !created) {
      go(context.tr("Le canal de département n’a pas pu être créé : ", "The department channel could not be created: ") + (error?.message ?? "unknown error"), "error", undefined, "channels");
    }
    conversationId = created.id;
    await audit(context, {action: "department_channel_created", conversationId, details: {department: canonicalDepartment}});
  }

  const teamIds = teams.map((team) => String(team.id));
  const {data: teamMemberRows} = await context.admin
    .from("team_members")
    .select("user_id")
    .in("team_id", teamIds);
  const participantIds = (teamMemberRows ?? []).map((row) => String(row.user_id));
  for (const team of teams) if (team.manager_id) participantIds.push(String(team.manager_id));
  await syncChannelMembers(context, conversationId, participantIds);
  await context.admin
    .from("internal_conversation_members")
    .update({archived_at: null})
    .eq("conversation_id", conversationId)
    .eq("user_id", context.user.id);

  revalidatePath("/dashboard/messages");
  go(context.tr("Canal de département ouvert.", "Department channel opened."), "success", conversationId, "channels");
}

export async function sendInternalMessageAction(formData: FormData) {
  const context = await getContext();
  const conversationId = text(formData.get("conversationId"), 80);
  const body = text(formData.get("body"), MESSAGE_MAX_LENGTH);
  const pendingAttachment = readPendingAttachment(formData, "attachment");
  const voiceDurationSeconds = Math.max(0, Math.min(300, Number(text(formData.get("voiceDurationSeconds"), 8)) || 0));
  const requestedMentionIds = [...new Set(text(formData.get("mentionUserIds"), 5000).split(",").map((value) => value.trim()).filter(Boolean))];

  if (!conversationId) go(context.tr("Conversation manquante.", "Missing conversation."), "error");
  await ensureConversationAccess(context, conversationId);
  if (!body && !pendingAttachment) {
    go(context.tr("Écris un message ou ajoute une pièce jointe.", "Write a message or add an attachment."), "error", conversationId);
  }

  const isVoiceAttachment = Boolean(pendingAttachment?.mimeType.startsWith("audio/"));
  if (isVoiceAttachment && (voiceDurationSeconds < 1 || voiceDurationSeconds > 300)) {
    if (pendingAttachment) await removePrivateAttachment(context.admin, pendingAttachment.storagePath);
    go(context.tr("Le message vocal doit durer entre 1 seconde et 5 minutes.", "Voice messages must be between 1 second and 5 minutes."), "error", conversationId);
  }
  const messageType = isVoiceAttachment
    ? (body ? "text_voice" : "voice")
    : body && pendingAttachment ? "text_file" : pendingAttachment ? "file" : "text";
  const {data: message, error} = await context.admin
    .from("internal_messages")
    .insert({
      organization_id: context.membership.organization_id,
      conversation_id: conversationId,
      sender_id: context.user.id,
      body,
      message_type: messageType,
    })
    .select("id,sent_at")
    .single<{id: string; sent_at: string}>();

  if (error || !message) {
    if (pendingAttachment) await removePrivateAttachment(context.admin, pendingAttachment.storagePath);
    go(context.tr("Le message n’a pas pu être envoyé : ", "The message could not be sent: ") + (error?.message ?? "unknown error"), "error", conversationId);
  }

  if (pendingAttachment) {
    let finalizedStoragePath: string | null = null;
    try {
      const finalAttachment = await finalizeTemporaryAttachment({
        admin: context.admin,
        organizationId: context.membership.organization_id,
        userId: context.user.id,
        purpose: "message",
        recordId: message.id,
        pending: pendingAttachment,
      });
      finalizedStoragePath = finalAttachment.storagePath;
      const {error: attachmentError} = await context.admin.from("internal_message_attachments").insert({
        organization_id: context.membership.organization_id,
        conversation_id: conversationId,
        message_id: message.id,
        storage_path: finalAttachment.storagePath,
        file_name: finalAttachment.fileName,
        mime_type: finalAttachment.mimeType,
        size_bytes: finalAttachment.sizeBytes,
        voice_duration_seconds: isVoiceAttachment ? voiceDurationSeconds : null,
      });
      if (attachmentError) throw attachmentError;
    } catch (attachmentError) {
      await context.admin.from("internal_messages").delete().eq("id", message.id);
      await removePrivateAttachment(context.admin, finalizedStoragePath ?? pendingAttachment.storagePath);
      go(
        context.tr("La pièce jointe n’a pas pu être sécurisée : ", "The attachment could not be secured: ")
          + (attachmentError instanceof Error ? attachmentError.message : "unknown error"),
        "error",
        conversationId,
      );
    }
  }

  const {data: participantRows, error: participantError} = await context.admin
    .from("internal_conversation_members")
    .select("user_id,is_muted")
    .eq("organization_id", context.membership.organization_id)
    .eq("conversation_id", conversationId)
    .is("left_at", null);
  if (participantError) console.error("Unable to load message recipients", participantError);

  const recipients = (participantRows ?? []).filter((row) => String(row.user_id) !== context.user.id);
  const recipientIdSet = new Set(recipients.map((row) => String(row.user_id)));
  const mentionUserIds = requestedMentionIds.filter((userId) => recipientIdSet.has(userId));
  const mentionSet = new Set(mentionUserIds);

  if (mentionUserIds.length) {
    const {error: mentionError} = await context.admin.from("internal_message_mentions").insert(mentionUserIds.map((mentionedUserId) => ({
      organization_id: context.membership.organization_id,
      conversation_id: conversationId,
      message_id: message.id,
      mentioned_user_id: mentionedUserId,
      created_by: context.user.id,
    })));
    if (mentionError) console.error("Internal message mentions failed", mentionError);
  }

  if (recipients.length) {
    await context.admin.from("internal_message_receipts").insert(recipients.map((row) => ({
      organization_id: context.membership.organization_id,
      conversation_id: conversationId,
      message_id: message.id,
      user_id: row.user_id,
    })));

    await context.admin
      .from("internal_conversation_members")
      .update({archived_at: null})
      .eq("conversation_id", conversationId)
      .neq("user_id", context.user.id);

    const {data: senderProfile} = await context.admin
      .from("profiles")
      .select("full_name,email")
      .eq("id", context.user.id)
      .maybeSingle<{full_name: string | null; email: string | null}>();
    const senderName = senderProfile?.full_name?.trim() || senderProfile?.email || context.tr("Un collaborateur", "A colleague");
    const excerpt = body ? body.slice(0, 180) : isVoiceAttachment ? context.tr("Message vocal", "Voice message") : context.tr("Pièce jointe", "Attachment");
    const notificationRows = recipients
      .filter((row) => !row.is_muted && !mentionSet.has(String(row.user_id)))
      .map((row) => ({
        organization_id: context.membership.organization_id,
        user_id: row.user_id,
        actor_id: context.user.id,
        category: "system",
        event_type: "internal_message_received",
        priority: "info",
        title_fr: `Nouveau message de ${senderName}`,
        title_en: `New message from ${senderName}`,
        body_fr: excerpt,
        body_en: excerpt,
        action_url: `/dashboard/messages?conversation=${conversationId}#message-${message.id}`,
        requires_action: false,
        status: "unread",
        email_requested: false,
        email_status: "skipped",
        dedupe_key: `internal-message-${message.id}-${row.user_id}`,
        metadata: {conversationId, messageId: message.id},
      }));
    const mentionNotificationRows = mentionUserIds.map((mentionedUserId) => ({
      organization_id: context.membership.organization_id,
      user_id: mentionedUserId,
      actor_id: context.user.id,
      category: "system",
      event_type: "internal_message_mention",
      priority: "info",
      title_fr: `${senderName} vous a mentionné`,
      title_en: `${senderName} mentioned you`,
      body_fr: excerpt,
      body_en: excerpt,
      action_url: `/dashboard/messages?conversation=${conversationId}#message-${message.id}`,
      requires_action: false,
      status: "unread",
      email_requested: false,
      email_status: "skipped",
      dedupe_key: `internal-mention-${message.id}-${mentionedUserId}`,
      metadata: {conversationId, messageId: message.id, mentioned: true},
    }));
    const allNotifications = [...notificationRows, ...mentionNotificationRows];
    if (allNotifications.length) {
      const {error: notificationError} = await context.admin.from("notifications").insert(allNotifications);
      if (notificationError) console.error("Internal message notification failed", notificationError);
    }
  }

  await context.admin
    .from("internal_conversation_members")
    .update({archived_at: null, last_read_at: message.sent_at})
    .eq("conversation_id", conversationId)
    .eq("user_id", context.user.id);

  await audit(context, {
    action: "message_sent",
    conversationId,
    messageId: message.id,
    details: {
      hasAttachment: Boolean(pendingAttachment),
      isVoice: isVoiceAttachment,
      voiceDurationSeconds: isVoiceAttachment ? voiceDurationSeconds : null,
      bodyLength: body.length,
      recipientCount: recipients.length,
      mentionCount: mentionUserIds.length,
    },
  });

  revalidatePath("/dashboard/messages");
  go(context.tr("Message envoyé.", "Message sent."), "success", conversationId);
}

export async function toggleInternalMessageReactionAction(formData: FormData) {
  const context = await getContext();
  const conversationId = text(formData.get("conversationId"), 80);
  const messageId = text(formData.get("messageId"), 80);
  const emoji = text(formData.get("emoji"), 8);
  if (!conversationId || !messageId || !REACTION_EMOJIS.has(emoji)) return;
  await ensureConversationAccess(context, conversationId);

  const {data: message, error: messageError} = await context.admin
    .from("internal_messages")
    .select("id")
    .eq("organization_id", context.membership.organization_id)
    .eq("conversation_id", conversationId)
    .eq("id", messageId)
    .is("deleted_at", null)
    .maybeSingle<{id: string}>();
  if (messageError || !message) return;

  const {data: existing} = await context.admin
    .from("internal_message_reactions")
    .select("id")
    .eq("organization_id", context.membership.organization_id)
    .eq("message_id", messageId)
    .eq("user_id", context.user.id)
    .eq("emoji", emoji)
    .maybeSingle<{id: string}>();

  if (existing) {
    await context.admin.from("internal_message_reactions").delete().eq("id", existing.id);
    await audit(context, {action: "message_reaction_removed", conversationId, messageId, details: {emoji}});
  } else {
    await context.admin.from("internal_message_reactions").insert({
      organization_id: context.membership.organization_id,
      conversation_id: conversationId,
      message_id: messageId,
      user_id: context.user.id,
      emoji,
    });
    await audit(context, {action: "message_reaction_added", conversationId, messageId, details: {emoji}});
  }

  revalidatePath("/dashboard/messages");
}

export async function updateConversationPreferenceAction(formData: FormData) {
  const context = await getContext();
  const conversationId = text(formData.get("conversationId"), 80);
  const action = text(formData.get("preferenceAction"), 30);
  await ensureConversationAccess(context, conversationId);

  const updates: Record<string, unknown> = {};
  let auditAction = "conversation_preference_updated";
  let message = context.tr("Préférence mise à jour.", "Preference updated.");
  if (action === "archive") {
    updates.archived_at = new Date().toISOString();
    auditAction = "conversation_archived";
    message = context.tr("Conversation archivée.", "Conversation archived.");
  } else if (action === "unarchive") {
    updates.archived_at = null;
    auditAction = "conversation_unarchived";
    message = context.tr("Conversation restaurée.", "Conversation restored.");
  } else if (action === "mute") {
    updates.is_muted = true;
    auditAction = "conversation_muted";
    message = context.tr("Notifications de cette conversation désactivées.", "Notifications for this conversation muted.");
  } else if (action === "unmute") {
    updates.is_muted = false;
    auditAction = "conversation_unmuted";
    message = context.tr("Notifications de cette conversation réactivées.", "Notifications for this conversation unmuted.");
  } else {
    go(context.tr("Action inconnue.", "Unknown action."), "error", conversationId);
  }

  const {error} = await context.admin
    .from("internal_conversation_members")
    .update(updates)
    .eq("conversation_id", conversationId)
    .eq("user_id", context.user.id)
    .eq("organization_id", context.membership.organization_id);
  if (error) go(context.tr("La préférence n’a pas pu être modifiée : ", "The preference could not be updated: ") + error.message, "error", conversationId);

  await audit(context, {action: auditAction, conversationId});
  revalidatePath("/dashboard/messages");
  go(message, "success", action === "archive" ? undefined : conversationId, action === "archive" ? "archived" : "inbox");
}
