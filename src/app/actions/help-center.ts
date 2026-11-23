"use server";

import {revalidatePath} from "next/cache";
import {requireAccessContext} from "@/lib/auth/access-control";
import {guidesForRole} from "@/lib/help-center/guides";

function allowedGuide(role: string, guideId: string) {
  return guidesForRole(role).some((guide) => guide.id === guideId);
}

export async function updateHelpGuideProgressAction(formData: FormData) {
  const context = await requireAccessContext();
  const guideId = String(formData.get("guideId") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!allowedGuide(context.role, guideId) || !["in_progress", "completed"].includes(status)) return;

  const completedAt = status === "completed" ? new Date().toISOString() : null;
  const {error} = await context.admin.from("help_guide_progress").upsert({
    organization_id: context.organizationId,
    user_id: context.user.id,
    guide_id: guideId,
    status,
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  }, {onConflict: "organization_id,user_id,guide_id"});
  if (error) throw new Error("Unable to save help guide progress");
  revalidatePath("/dashboard/help-center");
}

export async function submitHelpGuideFeedbackAction(formData: FormData) {
  const context = await requireAccessContext();
  const guideId = String(formData.get("guideId") ?? "").trim();
  const helpfulValue = String(formData.get("helpful") ?? "");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000);
  if (!allowedGuide(context.role, guideId) || !["true", "false"].includes(helpfulValue)) return;

  const {error} = await context.admin.from("help_guide_feedback").upsert({
    organization_id: context.organizationId,
    user_id: context.user.id,
    guide_id: guideId,
    helpful: helpfulValue === "true",
    comment: comment || null,
    updated_at: new Date().toISOString(),
  }, {onConflict: "organization_id,user_id,guide_id"});
  if (error) throw new Error("Unable to save help guide feedback");
  revalidatePath("/dashboard/help-center");
}

