import { createNotification } from "@/lib/notifications/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { findPlatformOrganization } from "@/lib/acquisition/platform";

export type DemoRequestInput = {
  requesterUserId?: string | null;
  fullName: string;
  email: string;
  phone?: string | null;
  whatsapp?: string | null;
  organizationName: string;
  country: string;
  sector?: string | null;
  employeeCountRange?: string | null;
  needs: string;
  interestedModules: string[];
  preferredDemoDate?: string | null;
  requestedPlanCode?: string | null;
  contactConsent: boolean;
};

export async function saveDemoRequest(input: DemoRequestInput): Promise<string> {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  const openStatuses = [
    "new",
    "contact_pending",
    "demo_scheduled",
    "demo_completed",
    "trial_approved",
    "free_approved",
  ];

  const { data: existing, error: existingError } = await admin
    .from("demo_requests")
    .select("id")
    .eq("email", email)
    .in("status", openStatuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingError) throw new Error(existingError.message);

  const values = {
    requester_user_id: input.requesterUserId ?? null,
    full_name: input.fullName.trim(),
    email,
    phone: input.phone?.trim() || null,
    whatsapp: input.whatsapp?.trim() || null,
    organization_name: input.organizationName.trim(),
    country: input.country.trim(),
    sector: input.sector?.trim() || null,
    employee_count_range: input.employeeCountRange?.trim() || null,
    needs: input.needs.trim(),
    interested_modules: input.interestedModules,
    preferred_demo_date: input.preferredDemoDate || null,
    requested_plan_code: input.requestedPlanCode || null,
    contact_consent: input.contactConsent,
    source: "public_signup",
    updated_at: new Date().toISOString(),
  };

  let requestId: string;
  if (existing) {
    const { data, error } = await admin
      .from("demo_requests")
      .update(values)
      .eq("id", existing.id)
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(error.message);
    requestId = data.id;
  } else {
    const { data, error } = await admin
      .from("demo_requests")
      .insert({ ...values, status: "new" })
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(error.message);
    requestId = data.id;
  }

  await notifyPlatformReviewers({
    eventType: "demo_request_received",
    titleFr: "Nouvelle demande de démonstration",
    titleEn: "New demo request",
    bodyFr: input.requestedPlanCode === "free"
      ? `${input.fullName} demande l’activation du plan Free pour ${input.organizationName}.`
      : `${input.fullName} souhaite découvrir Super Leader pour ${input.organizationName}.`,
    bodyEn: input.requestedPlanCode === "free"
      ? `${input.fullName} is requesting Free plan activation for ${input.organizationName}.`
      : `${input.fullName} would like to discover Super Leader for ${input.organizationName}.`,
    actionUrl: `/dashboard/acquisition?view=demo&request=${requestId}`,
    dedupeKey: `demo-request-${requestId}`,
    roles: ["owner", "admin"],
  });

  return requestId;
}

export async function notifyPlatformReviewers(input: {
  eventType: string;
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
  actionUrl: string;
  dedupeKey: string;
  roles: string[];
}): Promise<void> {
  const platform = await findPlatformOrganization();
  if (!platform) return;

  const admin = createAdminClient();
  const { data: recipients, error } = await admin
    .from("organization_members")
    .select("user_id,role")
    .eq("organization_id", platform.id)
    .eq("is_active", true)
    .in("role", input.roles);

  if (error) {
    console.error("Unable to load platform reviewers", error);
    return;
  }

  await Promise.all(
    (recipients ?? []).map((recipient) =>
      createNotification({
        organizationId: platform.id,
        userId: String(recipient.user_id),
        category: "system",
        eventType: input.eventType,
        titleFr: input.titleFr,
        titleEn: input.titleEn,
        bodyFr: input.bodyFr,
        bodyEn: input.bodyEn,
        actionUrl: input.actionUrl,
        priority: "warning",
        requiresAction: true,
        dedupeKey: `${input.dedupeKey}-${recipient.user_id}`,
      }),
    ),
  );
}
