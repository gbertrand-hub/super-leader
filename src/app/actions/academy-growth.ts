"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const DEVELOPMENT_MANAGERS = new Set(["owner", "admin", "hr", "manager"]);
const ACADEMY_ADMINS = new Set(["owner", "admin", "hr"]);

type Membership = {organization_id: string; role: string; is_active: boolean};

function clean(value: FormDataEntryValue | null, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function dateValue(value: FormDataEntryValue | null) {
  const raw = clean(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  return Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime()) ? "" : raw;
}

function monthStart(value: FormDataEntryValue | null) {
  const raw = clean(value, 20);
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-01$/.test(raw)) return raw;
  return "";
}

function numberValue(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localized(locale: string, fr: string, en: string) {
  return locale === "fr" ? fr : en;
}

function go(message: string, kind: "success" | "error" = "success", anchor = "academy-growth-hub"): never {
  const params = new URLSearchParams({[kind]: message});
  redirect(`/dashboard/academy?${params.toString()}#${anchor}`);
}

async function context() {
  const {locale} = await getI18n();
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError || !membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "academy");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: data.user.id,
    role: membership.role,
  });
  return {admin, user: data.user, membership, visibleUserIds, locale};
}

async function audit(input: {
  organizationId: string;
  actorId: string;
  subjectUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const {error} = await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Academy growth audit failed", error);
}

export async function activateMonthlyStaffTrainingAction(formData: FormData) {
  const {admin, user, membership, locale} = await context();
  if (!ACADEMY_ADMINS.has(membership.role)) go(localized(locale, "Accès refusé.", "Access denied."), "error", "staff-monthly-training");

  const trainingMonth = monthStart(formData.get("trainingMonth"));
  const courseId = clean(formData.get("courseId"), 80);
  const startsOn = dateValue(formData.get("startsOn"));
  const dueOn = dateValue(formData.get("dueOn"));
  if (!trainingMonth || !courseId || !startsOn || !dueOn || dueOn < startsOn) {
    go(localized(locale, "Vérifiez le mois, la formation et les dates.", "Check the month, course and dates."), "error", "staff-monthly-training");
  }

  const {data: course, error: courseError} = await admin
    .from("academy_courses")
    .select("id, title, status")
    .eq("organization_id", membership.organization_id)
    .eq("id", courseId)
    .maybeSingle<{id: string; title: string; status: string}>();
  if (courseError || !course || course.status !== "published") {
    go(localized(locale, "Choisissez une formation publiée.", "Choose a published course."), "error", "staff-monthly-training");
  }

  const cyclePayload = {
    organization_id: membership.organization_id,
    training_month: trainingMonth,
    academy_course_id: courseId,
    title: course.title,
    starts_on: startsOn,
    due_on: dueOn,
    status: "active",
    reminder_enabled: true,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const {data: cycle, error: cycleError} = await admin
    .from("academy_staff_monthly_training_cycles")
    .upsert(cyclePayload, {onConflict: "organization_id,training_month"})
    .select("id")
    .single<{id: string}>();
  if (cycleError) go(localized(locale, `Impossible d'activer le cycle: ${cycleError.message}`, `Could not activate cycle: ${cycleError.message}`), "error", "staff-monthly-training");

  const {data: members, error: memberError} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true);
  if (memberError) go(localized(locale, memberError.message, memberError.message), "error", "staff-monthly-training");
  const userIds = [...new Set((members ?? []).map((row) => String(row.user_id)))];

  const {data: existing, error: existingError} = userIds.length
    ? await admin.from("academy_enrollments").select("user_id").eq("organization_id", membership.organization_id).eq("course_id", courseId).in("user_id", userIds)
    : {data: [], error: null};
  if (existingError) go(existingError.message, "error", "staff-monthly-training");
  const existingIds = new Set((existing ?? []).map((row) => String(row.user_id)));
  const missingIds = userIds.filter((id) => !existingIds.has(id));

  if (missingIds.length) {
    const assignedAt = new Date().toISOString();
    const {error: enrollmentError} = await admin.from("academy_enrollments").insert(missingIds.map((userId) => ({
      organization_id: membership.organization_id,
      course_id: courseId,
      user_id: userId,
      status: "assigned",
      progress_percent: 0,
      assigned_by: user.id,
      assigned_at: assignedAt,
    })));
    if (enrollmentError) go(localized(locale, `Cycle créé mais affectation impossible: ${enrollmentError.message}`, `Cycle created but assignment failed: ${enrollmentError.message}`), "error", "staff-monthly-training");

    await Promise.allSettled(missingIds.map((userId) => createNotification({
      organizationId: membership.organization_id,
      userId,
      actorId: user.id,
      category: "performance",
      eventType: "academy_monthly_staff_training",
      titleFr: "Formation mensuelle du staff",
      titleEn: "Monthly staff training",
      bodyFr: `${course.title} doit être terminée avant le ${dueOn}.`,
      bodyEn: `${course.title} must be completed by ${dueOn}.`,
      actionUrl: `/dashboard/academy/staff-training?course=${courseId}`,
      priority: "warning",
      requiresAction: true,
      dedupeKey: `academy-monthly-staff-${trainingMonth}-${courseId}-${userId}`,
    })));
  }

  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "academy_staff_monthly_training_cycle",
    entityId: cycle.id,
    action: "activated",
    details: {training_month: trainingMonth, course_id: courseId, participants: userIds.length, newly_assigned: missingIds.length},
  });
  revalidatePath("/dashboard/academy");
  go(localized(locale, `Formation mensuelle activée pour ${userIds.length} membre(s).`, `Monthly staff training activated for ${userIds.length} member(s).`), "success", "staff-monthly-training");
}

export async function createStaffGrowthPlanAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, locale} = await context();
  if (!DEVELOPMENT_MANAGERS.has(membership.role)) go(localized(locale, "Accès refusé.", "Access denied."), "error", "growth-plans");
  const userId = clean(formData.get("userId"), 80);
  const periodStart = dateValue(formData.get("periodStart"));
  const periodEnd = dateValue(formData.get("periodEnd"));
  const focusArea = clean(formData.get("focusArea"), 240);
  const objective = clean(formData.get("objective"), 4000);
  const actionPlan = clean(formData.get("actionPlan"), 6000);
  const targetMeasure = clean(formData.get("targetMeasure"), 1000);
  const nextReviewOn = dateValue(formData.get("nextReviewOn")) || null;
  const reviewFrequency = clean(formData.get("reviewFrequency"), 20) === "quarterly" ? "quarterly" : "monthly";
  if (!userId || !visibleUserIds.includes(userId) || !periodStart || !periodEnd || periodEnd < periodStart || focusArea.length < 2 || objective.length < 3) {
    go(localized(locale, "Plan de croissance incomplet ou collaborateur hors périmètre.", "Growth plan is incomplete or employee is outside your scope."), "error", "growth-plans");
  }

  const {data, error} = await admin.from("academy_staff_growth_plans").insert({
    organization_id: membership.organization_id,
    user_id: userId,
    manager_id: user.id,
    period_start: periodStart,
    period_end: periodEnd,
    focus_area: focusArea,
    objective,
    action_plan: actionPlan,
    target_measure: targetMeasure,
    status: "active",
    progress_percent: 0,
    review_frequency: reviewFrequency,
    next_review_on: nextReviewOn,
    created_by: user.id,
  }).select("id").single<{id: string}>();
  if (error) go(error.message, "error", "growth-plans");

  await createNotification({
    organizationId: membership.organization_id,
    userId,
    actorId: user.id,
    category: "performance",
    eventType: "academy_growth_plan_created",
    titleFr: "Nouveau plan de croissance",
    titleEn: "New growth plan",
    bodyFr: `Un plan de croissance a été créé: ${focusArea}.`,
    bodyEn: `A growth plan was created: ${focusArea}.`,
    actionUrl: "/dashboard/academy#growth-plans",
    priority: "info",
    requiresAction: true,
    dedupeKey: `academy-growth-${data.id}`,
  });
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: userId, entityType: "academy_staff_growth_plan", entityId: data.id, action: "created", details: {focus_area: focusArea, period_start: periodStart, period_end: periodEnd}});
  revalidatePath("/dashboard/academy");
  go(localized(locale, "Plan de croissance créé.", "Growth plan created."), "success", "growth-plans");
}

export async function updateStaffGrowthProgressAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, locale} = await context();
  const planId = clean(formData.get("planId"), 80);
  const progress = Math.max(0, Math.min(100, numberValue(formData.get("progressPercent"), 0)));
  const statusRaw = clean(formData.get("status"), 20);
  const status = ["active", "paused", "completed"].includes(statusRaw) ? statusRaw : progress >= 100 ? "completed" : "active";
  const nextReviewOn = dateValue(formData.get("nextReviewOn")) || null;

  const {data: plan, error: planError} = await admin.from("academy_staff_growth_plans").select("id, user_id").eq("organization_id", membership.organization_id).eq("id", planId).maybeSingle<{id: string; user_id: string}>();
  if (planError || !plan) go(localized(locale, "Plan introuvable.", "Plan not found."), "error", "growth-plans");
  const canEdit = plan.user_id === user.id || (DEVELOPMENT_MANAGERS.has(membership.role) && visibleUserIds.includes(plan.user_id));
  if (!canEdit) go(localized(locale, "Accès refusé.", "Access denied."), "error", "growth-plans");

  const {error} = await admin.from("academy_staff_growth_plans").update({progress_percent: progress, status, next_review_on: nextReviewOn, updated_at: new Date().toISOString()}).eq("organization_id", membership.organization_id).eq("id", planId);
  if (error) go(error.message, "error", "growth-plans");
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: plan.user_id, entityType: "academy_staff_growth_plan", entityId: planId, action: "progress_updated", details: {progress_percent: progress, status}});
  revalidatePath("/dashboard/academy");
  go(localized(locale, "Progression mise à jour.", "Progress updated."), "success", "growth-plans");
}

export async function createStaffReadingPlanAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, locale} = await context();
  if (!DEVELOPMENT_MANAGERS.has(membership.role)) go(localized(locale, "Accès refusé.", "Access denied."), "error", "reading-plans");
  const userId = clean(formData.get("userId"), 80);
  const growthPlanId = clean(formData.get("growthPlanId"), 80) || null;
  const bookTitle = clean(formData.get("bookTitle"), 300);
  const author = clean(formData.get("author"), 240);
  const startDate = dateValue(formData.get("startDate"));
  const targetDate = dateValue(formData.get("targetDate"));
  const totalUnits = Math.trunc(numberValue(formData.get("totalUnits"), 0));
  const unitLabel = clean(formData.get("unitLabel"), 60) || "chapters";
  const summaryRequired = formData.get("summaryRequired") === "on";
  if (!userId || !visibleUserIds.includes(userId) || bookTitle.length < 2 || !startDate || !targetDate || targetDate < startDate || totalUnits < 1 || totalUnits > 100000) {
    go(localized(locale, "Plan de lecture incomplet ou collaborateur hors périmètre.", "Reading plan is incomplete or employee is outside your scope."), "error", "reading-plans");
  }

  if (growthPlanId) {
    const {data: growthPlan} = await admin.from("academy_staff_growth_plans").select("id").eq("organization_id", membership.organization_id).eq("id", growthPlanId).eq("user_id", userId).maybeSingle();
    if (!growthPlan) go(localized(locale, "Le plan de croissance sélectionné ne correspond pas au collaborateur.", "The selected growth plan does not match the employee."), "error", "reading-plans");
  }

  const {data, error} = await admin.from("academy_staff_reading_plans").insert({
    organization_id: membership.organization_id,
    user_id: userId,
    growth_plan_id: growthPlanId,
    book_title: bookTitle,
    author,
    start_date: startDate,
    target_date: targetDate,
    total_units: totalUnits,
    completed_units: 0,
    unit_label: unitLabel,
    summary_required: summaryRequired,
    summary_status: "not_started",
    summary_text: "",
    status: "not_started",
    assigned_by: user.id,
  }).select("id").single<{id: string}>();
  if (error) go(error.message, "error", "reading-plans");

  await createNotification({
    organizationId: membership.organization_id,
    userId,
    actorId: user.id,
    category: "performance",
    eventType: "academy_reading_plan_created",
    titleFr: "Nouveau plan de lecture",
    titleEn: "New reading plan",
    bodyFr: `${bookTitle} est à terminer avant le ${targetDate}.`,
    bodyEn: `${bookTitle} is due by ${targetDate}.`,
    actionUrl: "/dashboard/academy#reading-plans",
    priority: "info",
    requiresAction: true,
    dedupeKey: `academy-reading-${data.id}`,
  });
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: userId, entityType: "academy_staff_reading_plan", entityId: data.id, action: "created", details: {book_title: bookTitle, target_date: targetDate, growth_plan_id: growthPlanId}});
  revalidatePath("/dashboard/academy");
  go(localized(locale, "Plan de lecture créé.", "Reading plan created."), "success", "reading-plans");
}

export async function updateStaffReadingProgressAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, locale} = await context();
  const readingPlanId = clean(formData.get("readingPlanId"), 80);
  const completedUnitsRaw = Math.trunc(numberValue(formData.get("completedUnits"), 0));
  const summaryText = clean(formData.get("summaryText"), 12000);
  const submitSummary = formData.get("submitSummary") === "on";

  const {data: plan, error: planError} = await admin.from("academy_staff_reading_plans").select("id, user_id, total_units, target_date, summary_required").eq("organization_id", membership.organization_id).eq("id", readingPlanId).maybeSingle<{id: string; user_id: string; total_units: number; target_date: string; summary_required: boolean}>();
  if (planError || !plan) go(localized(locale, "Plan de lecture introuvable.", "Reading plan not found."), "error", "reading-plans");
  const canEdit = plan.user_id === user.id || (DEVELOPMENT_MANAGERS.has(membership.role) && visibleUserIds.includes(plan.user_id));
  if (!canEdit) go(localized(locale, "Accès refusé.", "Access denied."), "error", "reading-plans");

  const completedUnits = Math.max(0, Math.min(Number(plan.total_units), completedUnitsRaw));
  const done = completedUnits >= Number(plan.total_units);
  const overdue = !done && plan.target_date < new Date().toISOString().slice(0, 10);
  const status = done ? "completed" : overdue ? "overdue" : completedUnits > 0 ? "in_progress" : "not_started";
  const summaryStatus = submitSummary && summaryText ? "submitted" : summaryText ? "draft" : "not_started";
  const {error} = await admin.from("academy_staff_reading_plans").update({
    completed_units: completedUnits,
    summary_text: summaryText,
    summary_status: summaryStatus,
    status,
    updated_at: new Date().toISOString(),
  }).eq("organization_id", membership.organization_id).eq("id", readingPlanId);
  if (error) go(error.message, "error", "reading-plans");
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: plan.user_id, entityType: "academy_staff_reading_plan", entityId: readingPlanId, action: "progress_updated", details: {completed_units: completedUnits, total_units: plan.total_units, status, summary_status: summaryStatus}});
  revalidatePath("/dashboard/academy");
  go(localized(locale, "Plan de lecture mis à jour.", "Reading plan updated."), "success", "reading-plans");
}
