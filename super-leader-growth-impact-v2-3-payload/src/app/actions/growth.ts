"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createNotification} from "@/lib/notifications/service";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

const reviewRoles = new Set(["owner", "admin", "hr", "manager"]);
const settingsRoles = new Set(["owner", "admin", "hr"]);
const categories = new Set([
  "learning",
  "mentoring",
  "innovation",
  "documentation",
  "cross_team_support",
  "community",
  "process_improvement",
  "special_project",
  "representation",
  "other",
]);
const impactLevels = new Set(["low", "medium", "high", "strategic"]);

type Membership = {organization_id: string; role: string; is_active: boolean};
type GrowthSettings = {
  default_monthly_target_hours: number | string;
  target_credits: number | string;
  bonus_weight: number | string;
  max_monthly_credits: number | string;
  night_start_time: string;
  night_end_time: string;
  wellbeing_warning_hours: number | string;
};

function go(message: string, kind: "success" | "error" = "success", month?: string, member?: string): never {
  const params = new URLSearchParams({[kind]: message});
  if (month) params.set("month", month);
  if (member) params.set("member", member);
  redirect(`/dashboard/growth?${params.toString()}`);
}

function clean(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function parseNumber(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMonth(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : raw;
}

function normalizeTime(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function normalizeWebUrl(value: FormDataEntryValue | null) {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function timeMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function overlap(start: number, end: number, windowStart: number, windowEnd: number) {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

function calculateNightMinutes(start: number, end: number, nightStart: number, nightEnd: number) {
  let total = 0;
  const windows: Array<[number, number]> = [];
  for (let day = -1; day <= 1; day += 1) {
    const offset = day * 1440;
    if (nightStart > nightEnd) windows.push([offset + nightStart, offset + 1440 + nightEnd]);
    else windows.push([offset + nightStart, offset + nightEnd]);
  }
  for (const [windowStart, windowEnd] of windows) total += overlap(start, end, windowStart, windowEnd);
  return Math.min(end - start, total);
}

function calculateWeekendMinutes(date: string, start: number, end: number) {
  const day0 = new Date(`${date}T00:00:00Z`).getUTCDay();
  const firstEnd = Math.min(end, 1440);
  let total = day0 === 0 || day0 === 6 ? Math.max(0, firstEnd - start) : 0;
  if (end > 1440) {
    const day1 = (day0 + 1) % 7;
    if (day1 === 0 || day1 === 6) total += end - 1440;
  }
  return total;
}

async function getContext() {
  const {t} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  return {user: authData.user, membership, admin, visibleUserIds, t};
}

async function loadSettings(organizationId: string, admin: ReturnType<typeof createAdminClient>) {
  const {data} = await admin
    .from("growth_settings")
    .select("default_monthly_target_hours,target_credits,bonus_weight,max_monthly_credits,night_start_time,night_end_time,wellbeing_warning_hours")
    .eq("organization_id", organizationId)
    .maybeSingle<GrowthSettings>();
  return data;
}

async function audit(input: {
  organizationId: string;
  actorId: string;
  subjectUserId?: string | null;
  entityId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId ?? null,
    entity_type: "growth_impact",
    entity_id: input.entityId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
}

export async function upsertGrowthPlanAction(formData: FormData) {
  const {user, membership, admin, visibleUserIds, t} = await getContext();
  const month = normalizeMonth(formData.get("month"));
  const targetUserId = clean(formData.get("userId"), 80) || user.id;
  const targetHours = parseNumber(formData.get("targetHours"));
  const targetCredits = parseNumber(formData.get("targetCredits"));
  const focusSkill = clean(formData.get("focusSkill"), 160);
  const objective = clean(formData.get("objective"), 1500);

  if (!month || !visibleUserIds.includes(targetUserId)) go(t("growth.messages.outOfScope"), "error", month);
  if (!Number.isFinite(targetHours) || targetHours < 0 || targetHours > 200 || !Number.isFinite(targetCredits) || targetCredits < 1 || targetCredits > 500 || focusSkill.length < 2 || objective.length < 5) {
    go(t("growth.messages.invalidPlan"), "error", month, targetUserId);
  }

  const planMonth = `${month}-01`;
  const {data: existingPlan, error: existingPlanError} = await admin
    .from("growth_plans")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", targetUserId)
    .eq("plan_month", planMonth)
    .maybeSingle<{id: string}>();
  if (existingPlanError) go(t("growth.messages.planSaveFailed", {message: existingPlanError.message}), "error", month, targetUserId);

  const planPayload = {
    target_hours: targetHours,
    target_credits: targetCredits,
    focus_skill: focusSkill,
    objective,
    status: "active",
    updated_by: user.id,
  };
  const saveResult = existingPlan
    ? await admin.from("growth_plans").update(planPayload).eq("id", existingPlan.id).eq("organization_id", membership.organization_id)
    : await admin.from("growth_plans").insert({
        organization_id: membership.organization_id,
        user_id: targetUserId,
        plan_month: planMonth,
        ...planPayload,
        created_by: user.id,
      });
  if (saveResult.error) go(t("growth.messages.planSaveFailed", {message: saveResult.error.message}), "error", month, targetUserId);

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: targetUserId, action: "growth_plan_upserted", details: {month, targetHours, targetCredits, focusSkill}});
  revalidatePath("/dashboard/growth");
  go(t("growth.messages.planSaved"), "success", month, targetUserId);
}

export async function createImpactContributionAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const month = normalizeMonth(formData.get("month"));
  const contributionDate = normalizeDate(formData.get("contributionDate"));
  const startTime = normalizeTime(formData.get("startTime"));
  const endTime = normalizeTime(formData.get("endTime"));
  const crossesMidnight = formData.get("crossesMidnight") === "on";
  const category = clean(formData.get("category"), 80);
  const title = clean(formData.get("title"), 180);
  const description = clean(formData.get("description"), 3000);
  const skillDeveloped = clean(formData.get("skillDeveloped"), 180);
  const beneficiary = clean(formData.get("beneficiary"), 240) || null;
  const resultSummary = clean(formData.get("resultSummary"), 2000);
  const claimedImpact = clean(formData.get("claimedImpact"), 40);
  const evidenceUrlRaw = clean(formData.get("evidenceUrl"), 1000);
  const evidenceUrl = normalizeWebUrl(formData.get("evidenceUrl"));
  const timezone = normalizeTimeZone(clean(formData.get("timezone"), 120) || "Europe/Dublin");
  const pendingAttachment = readPendingAttachment(formData, "impactProof");

  if (!contributionDate || !startTime || !endTime || !categories.has(category) || !impactLevels.has(claimedImpact) || title.length < 3 || description.length < 10 || skillDeveloped.length < 2 || resultSummary.length < 5 || (evidenceUrlRaw && !evidenceUrl)) {
    go(t("growth.messages.invalidContribution"), "error", month);
  }

  const start = timeMinutes(startTime);
  const end = timeMinutes(endTime) + (crossesMidnight ? 1440 : 0);
  const durationMinutes = end - start;
  if (durationMinutes < 15 || durationMinutes > 720) go(t("growth.messages.invalidDuration"), "error", month);

  const settings = await loadSettings(membership.organization_id, admin);
  if (!settings) go(t("growth.messages.migrationRequired"), "error", month);
  const nightMinutes = calculateNightMinutes(start, end, timeMinutes(settings.night_start_time), timeMinutes(settings.night_end_time));
  const weekendMinutes = calculateWeekendMinutes(contributionDate, start, end);
  const id = randomUUID();

  const {error: insertError} = await admin.from("impact_contributions").insert({
    id,
    organization_id: membership.organization_id,
    user_id: user.id,
    contribution_date: contributionDate,
    start_time: startTime,
    end_time: endTime,
    crosses_midnight: crossesMidnight,
    timezone,
    duration_minutes: durationMinutes,
    night_minutes: nightMinutes,
    weekend_minutes: weekendMinutes,
    category,
    title,
    description,
    skill_developed: skillDeveloped,
    beneficiary,
    result_summary: resultSummary,
    claimed_impact: claimedImpact,
    status: "submitted",
    payroll_treatment: "not_assessed",
    evidence_url: evidenceUrl,
  });
  if (insertError) go(t("growth.messages.contributionCreateFailed", {message: insertError.message}), "error", month);

  if (pendingAttachment) {
    try {
      const attachment = await finalizeTemporaryAttachment({
        admin,
        organizationId: membership.organization_id,
        userId: user.id,
        purpose: "impact",
        recordId: id,
        pending: pendingAttachment,
      });
      await admin.from("impact_contributions").update({
        proof_storage_path: attachment.storagePath,
        proof_file_name: attachment.fileName,
        proof_mime_type: attachment.mimeType,
        proof_size_bytes: attachment.sizeBytes,
      }).eq("id", id).eq("organization_id", membership.organization_id);
    } catch (error) {
      await admin.from("impact_contributions").delete().eq("id", id).eq("organization_id", membership.organization_id);
      go(t("growth.messages.attachmentFailed", {message: error instanceof Error ? error.message : "Unknown error"}), "error", month);
    }
  }

  const [{data: schedule}, {data: teamMemberships}] = await Promise.all([
    admin.from("member_work_schedules").select("supervisor_id").eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("is_active", true).maybeSingle<{supervisor_id: string | null}>(),
    admin.from("team_members").select("teams!inner(manager_id)").eq("user_id", user.id).eq("teams.organization_id", membership.organization_id),
  ]);
  const teamManager = (teamMemberships ?? []).map((row) => {
    const teams = row.teams as {manager_id?: string | null} | {manager_id?: string | null}[] | null;
    return Array.isArray(teams) ? teams[0]?.manager_id : teams?.manager_id;
  }).find(Boolean);
  const reviewerId = schedule?.supervisor_id || teamManager;
  if (reviewerId && reviewerId !== user.id) {
    await createNotification({
      organizationId: membership.organization_id,
      userId: reviewerId,
      actorId: user.id,
      category: "performance",
      eventType: "impact_contribution_submitted",
      titleFr: "Contribution d'impact à valider",
      titleEn: "Impact contribution to review",
      bodyFr: `${title} a été déclarée dans le plan de croissance.`,
      bodyEn: `${title} was submitted in the growth plan.`,
      actionUrl: `/dashboard/growth?month=${contributionDate.slice(0, 7)}&member=${user.id}`,
      priority: "info",
      requiresAction: true,
      dedupeKey: `impact-review:${id}`,
      metadata: {contribution_id: id, employee_id: user.id},
    });
  }

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: user.id, entityId: id, action: "impact_contribution_submitted", details: {durationMinutes, nightMinutes, weekendMinutes, category, claimedImpact}});
  revalidatePath("/dashboard/growth");
  go(t("growth.messages.contributionSubmitted"), "success", month || contributionDate.slice(0, 7), user.id);
}

export async function cancelImpactContributionAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const contributionId = clean(formData.get("contributionId"), 80);
  const month = normalizeMonth(formData.get("month"));
  const {data: contribution} = await admin.from("impact_contributions").select("id,user_id,status,proof_storage_path").eq("id", contributionId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; user_id: string; status: string; proof_storage_path: string | null}>();
  if (!contribution || contribution.user_id !== user.id || contribution.status !== "submitted") go(t("growth.messages.cancelDenied"), "error", month);
  const {error} = await admin.from("impact_contributions").update({status: "cancelled"}).eq("id", contributionId).eq("organization_id", membership.organization_id);
  if (error) go(t("growth.messages.cancelFailed", {message: error.message}), "error", month);
  await removePrivateAttachment(admin, contribution.proof_storage_path);
  await admin.from("impact_contributions").update({proof_storage_path: null, proof_file_name: null, proof_mime_type: null, proof_size_bytes: null}).eq("id", contributionId);
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: user.id, entityId: contributionId, action: "impact_contribution_cancelled"});
  revalidatePath("/dashboard/growth");
  go(t("growth.messages.contributionCancelled"), "success", month, user.id);
}

export async function reviewImpactContributionAction(formData: FormData) {
  const {user, membership, admin, visibleUserIds, t} = await getContext();
  const contributionId = clean(formData.get("contributionId"), 80);
  const month = normalizeMonth(formData.get("month"));
  const decision = clean(formData.get("decision"), 40);
  const approvedMinutes = Math.round(parseNumber(formData.get("approvedMinutes")));
  const validatedImpact = clean(formData.get("validatedImpact"), 40);
  const reviewNote = clean(formData.get("reviewNote"), 2000);
  const payrollTreatment = clean(formData.get("payrollTreatment"), 40) || "growth_only";
  if (!reviewRoles.has(membership.role) || !["approved", "partially_approved", "rejected"].includes(decision) || !impactLevels.has(validatedImpact) || reviewNote.length < 3 || !["growth_only", "requires_hr_review"].includes(payrollTreatment)) {
    go(t("growth.messages.invalidReview"), "error", month);
  }

  const {data: contribution} = await admin.from("impact_contributions").select("id,user_id,title,duration_minutes,status").eq("id", contributionId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; user_id: string; title: string; duration_minutes: number; status: string}>();
  if (!contribution || !visibleUserIds.includes(contribution.user_id) || contribution.user_id === user.id || contribution.status !== "submitted") go(t("growth.messages.reviewDenied"), "error", month);

  const normalizedMinutes = decision === "rejected" ? 0 : approvedMinutes;
  if (!Number.isInteger(normalizedMinutes) || normalizedMinutes < 0 || normalizedMinutes > contribution.duration_minutes || (decision === "approved" && normalizedMinutes !== contribution.duration_minutes) || (decision === "partially_approved" && (normalizedMinutes <= 0 || normalizedMinutes >= contribution.duration_minutes))) {
    go(t("growth.messages.invalidApprovedDuration"), "error", month, contribution.user_id);
  }

  const multipliers: Record<string, number> = {low: 1, medium: 1.5, high: 2, strategic: 3};
  const growthCredits = decision === "rejected" ? 0 : Math.min(10, Math.round((normalizedMinutes / 60) * multipliers[validatedImpact] * 10) / 10);
  const {error} = await admin.from("impact_contributions").update({
    status: decision,
    approved_minutes: normalizedMinutes,
    validated_impact: validatedImpact,
    growth_credits: growthCredits,
    payroll_treatment: payrollTreatment,
    review_note: reviewNote,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", contributionId).eq("organization_id", membership.organization_id);
  if (error) go(t("growth.messages.reviewSaveFailed", {message: error.message}), "error", month, contribution.user_id);

  await createNotification({
    organizationId: membership.organization_id,
    userId: contribution.user_id,
    actorId: user.id,
    category: "performance",
    eventType: "impact_contribution_reviewed",
    titleFr: "Contribution d'impact examinée",
    titleEn: "Impact contribution reviewed",
    bodyFr: `${contribution.title} : ${decision === "rejected" ? "refusée" : `${growthCredits} crédit(s) de croissance validé(s)`}.`,
    bodyEn: `${contribution.title}: ${decision === "rejected" ? "rejected" : `${growthCredits} growth credit(s) approved`}.`,
    actionUrl: `/dashboard/growth?month=${month || new Date().toISOString().slice(0, 7)}`,
    priority: decision === "rejected" ? "warning" : "success",
    requiresAction: false,
    dedupeKey: `impact-reviewed:${contributionId}:${decision}`,
    metadata: {contribution_id: contributionId, decision, growth_credits: growthCredits},
  });

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: contribution.user_id, entityId: contributionId, action: `impact_contribution_${decision}`, details: {approvedMinutes: normalizedMinutes, validatedImpact, growthCredits, payrollTreatment, reviewNote}});
  revalidatePath("/dashboard/growth");
  revalidatePath("/dashboard/performance");
  go(t("growth.messages.reviewSaved"), "success", month, contribution.user_id);
}

export async function updateGrowthSettingsAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const month = normalizeMonth(formData.get("month"));
  if (!settingsRoles.has(membership.role)) go(t("growth.messages.permissionDenied"), "error", month);
  const defaultMonthlyTargetHours = parseNumber(formData.get("defaultMonthlyTargetHours"));
  const targetCredits = parseNumber(formData.get("targetCredits"));
  const bonusWeight = parseNumber(formData.get("bonusWeight"));
  const maxMonthlyCredits = parseNumber(formData.get("maxMonthlyCredits"));
  const wellbeingWarningHours = parseNumber(formData.get("wellbeingWarningHours"));
  const nightStartTime = normalizeTime(formData.get("nightStartTime"));
  const nightEndTime = normalizeTime(formData.get("nightEndTime"));
  if (![defaultMonthlyTargetHours, targetCredits, bonusWeight, maxMonthlyCredits, wellbeingWarningHours].every(Number.isFinite) || defaultMonthlyTargetHours < 0 || defaultMonthlyTargetHours > 200 || targetCredits < 1 || targetCredits > 500 || bonusWeight < 0 || bonusWeight > 20 || maxMonthlyCredits < 1 || maxMonthlyCredits > 1000 || wellbeingWarningHours < 0 || wellbeingWarningHours > 200 || !nightStartTime || !nightEndTime) {
    go(t("growth.messages.invalidSettings"), "error", month);
  }
  const {error} = await admin.from("growth_settings").upsert({
    organization_id: membership.organization_id,
    default_monthly_target_hours: defaultMonthlyTargetHours,
    target_credits: targetCredits,
    bonus_weight: bonusWeight,
    max_monthly_credits: maxMonthlyCredits,
    wellbeing_warning_hours: wellbeingWarningHours,
    night_start_time: nightStartTime,
    night_end_time: nightEndTime,
  }, {onConflict: "organization_id"});
  if (error) go(t("growth.messages.settingsSaveFailed", {message: error.message}), "error", month);
  await audit({organizationId: membership.organization_id, actorId: user.id, action: "growth_settings_updated", details: {defaultMonthlyTargetHours, targetCredits, bonusWeight, maxMonthlyCredits, wellbeingWarningHours, nightStartTime, nightEndTime}});
  revalidatePath("/dashboard/growth");
  go(t("growth.messages.settingsSaved"), "success", month);
}
