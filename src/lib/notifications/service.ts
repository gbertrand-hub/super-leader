import {createAdminClient} from "@/lib/supabase/admin";

export type NotificationCategory =
  | "system"
  | "reports"
  | "absences"
  | "meetings"
  | "sales"
  | "collections"
  | "feedback"
  | "performance"
  | "crm";

export type NotificationPriority = "info" | "success" | "warning" | "urgent";

export async function createNotification(input: {
  organizationId: string;
  userId: string;
  actorId?: string | null;
  category: NotificationCategory;
  eventType: string;
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
  actionUrl?: string | null;
  priority?: NotificationPriority;
  requiresAction?: boolean;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  emailRequested?: boolean;
  scheduledFor?: string;
}) {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("notifications")
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      actor_id: input.actorId ?? null,
      category: input.category,
      event_type: input.eventType,
      title_fr: input.titleFr,
      title_en: input.titleEn,
      body_fr: input.bodyFr,
      body_en: input.bodyEn,
      action_url: input.actionUrl ?? null,
      priority: input.priority ?? "info",
      requires_action: input.requiresAction ?? false,
      dedupe_key: input.dedupeKey ?? null,
      metadata: input.metadata ?? {},
      email_requested: input.emailRequested ?? true,
      email_status: input.emailRequested === false ? "skipped" : "queued",
      scheduled_for: input.scheduledFor ?? new Date().toISOString(),
    })
    .select("id")
    .maybeSingle<{id: string}>();

  if (error) {
    if (error.code === "23505") return null;
    console.error("Notification creation failed", error);
  }

  return data?.id ?? null;
}
