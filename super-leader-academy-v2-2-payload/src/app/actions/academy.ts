"use server";

import {randomUUID} from "crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const academyAdminRoles = new Set(["owner", "admin", "hr"]);
const academyAssignmentRoles = new Set(["owner", "admin", "hr", "manager"]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type CourseRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  training_month: string;
  deadline: string;
  is_required: boolean;
  passing_score: number | string;
  max_attempts: number;
  certificate_enabled: boolean;
};

type EnrollmentRow = {
  id: string;
  organization_id: string;
  course_id: string;
  user_id: string;
  status: string;
  attempts_count: number;
  best_score: number | string | null;
};

type QuestionRow = {
  id: string;
  question_text: string;
  options: unknown;
  correct_option: number;
  points: number | string;
};

function go(message: string, kind: "success" | "error" = "success", courseId?: string): never {
  const params = new URLSearchParams({[kind]: message});
  if (courseId) params.set("course", courseId);
  redirect(`/dashboard/academy?${params.toString()}`);
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : raw;
}

function normalizeMonth(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : "";
}

function parseInteger(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseNumber(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function context() {
  const {t} = await getI18n();
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

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: data.user.id,
    role: membership.role,
  });

  return {user: data.user, membership, admin, t, visibleUserIds};
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
  if (error) console.error("Academy audit failed", error);
}

async function loadCourse(courseId: string, organizationId: string) {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("academy_courses")
    .select("id, organization_id, title, status, training_month, deadline, is_required, passing_score, max_attempts, certificate_enabled")
    .eq("id", courseId)
    .eq("organization_id", organizationId)
    .maybeSingle<CourseRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function createAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");

  const title = cleanText(formData.get("title"), 180);
  const description = cleanText(formData.get("description"), 5000);
  const category = cleanText(formData.get("category"), 80) || "professional_development";
  const trainingMonth = normalizeMonth(formData.get("trainingMonth"));
  const deadline = normalizeDate(formData.get("deadline"));
  const durationMinutes = parseInteger(formData.get("durationMinutes"));
  const passingScore = parseNumber(formData.get("passingScore"));
  const maxAttempts = parseInteger(formData.get("maxAttempts"));
  const resourceUrl = cleanText(formData.get("resourceUrl"), 1000) || null;
  const isRequired = formData.get("isRequired") === "on";
  const certificateEnabled = formData.get("certificateEnabled") === "on";

  if (
    title.length < 3 ||
    !trainingMonth ||
    !deadline ||
    deadline < trainingMonth ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080 ||
    !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20
  ) {
    go(t("academy.messages.invalidCourse"), "error");
  }

  const {data: course, error} = await admin.from("academy_courses").insert({
    organization_id: membership.organization_id,
    title,
    description,
    category,
    training_month: trainingMonth,
    deadline,
    duration_minutes: durationMinutes,
    is_required: isRequired,
    passing_score: passingScore,
    max_attempts: maxAttempts,
    certificate_enabled: certificateEnabled,
    resource_url: resourceUrl,
    status: "draft",
    created_by: user.id,
  }).select("id").single<{id: string}>();

  if (error || !course) go(t("academy.messages.courseCreateFailed", {message: error?.message ?? ""}), "error");

  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "academy_course",
    entityId: course.id,
    action: "created",
    details: {title, training_month: trainingMonth, required: isRequired},
  });

  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseCreated"), "success", course.id);
}

export async function updateAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");

  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const title = cleanText(formData.get("title"), 180);
  const description = cleanText(formData.get("description"), 5000);
  const category = cleanText(formData.get("category"), 80) || "professional_development";
  const trainingMonth = normalizeMonth(formData.get("trainingMonth"));
  const deadline = normalizeDate(formData.get("deadline"));
  const durationMinutes = parseInteger(formData.get("durationMinutes"));
  const passingScore = parseNumber(formData.get("passingScore"));
  const maxAttempts = parseInteger(formData.get("maxAttempts"));
  const resourceUrl = cleanText(formData.get("resourceUrl"), 1000) || null;
  const isRequired = formData.get("isRequired") === "on";
  const certificateEnabled = formData.get("certificateEnabled") === "on";

  if (
    title.length < 3 ||
    !trainingMonth ||
    !deadline ||
    deadline < trainingMonth ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080 ||
    !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20
  ) {
    go(t("academy.messages.invalidCourse"), "error", courseId);
  }

  const {error} = await admin.from("academy_courses").update({
    title,
    description,
    category,
    training_month: trainingMonth,
    deadline,
    duration_minutes: durationMinutes,
    is_required: isRequired,
    passing_score: passingScore,
    max_attempts: maxAttempts,
    certificate_enabled: certificateEnabled,
    resource_url: resourceUrl,
  }).eq("id", courseId).eq("organization_id", membership.organization_id);

  if (error) go(t("academy.messages.courseUpdateFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_course", entityId: courseId, action: "updated"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseUpdated"), "success", courseId);
}

export async function addAcademyQuestionAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const questionText = cleanText(formData.get("questionText"), 1000);
  const options = [1, 2, 3, 4]
    .map((index) => cleanText(formData.get(`option${index}`), 500))
    .filter(Boolean);
  const correctOption = parseInteger(formData.get("correctOption"));
  const points = parseNumber(formData.get("points"), 1);

  if (questionText.length < 3 || options.length < 2 || correctOption < 0 || correctOption >= options.length || points <= 0) {
    go(t("academy.messages.invalidQuestion"), "error", courseId);
  }

  const {data: lastQuestion} = await admin
    .from("academy_quiz_questions")
    .select("position")
    .eq("course_id", courseId)
    .order("position", {ascending: false})
    .limit(1)
    .maybeSingle<{position: number}>();

  const {error} = await admin.from("academy_quiz_questions").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    question_text: questionText,
    options,
    correct_option: correctOption,
    points,
    position: (lastQuestion?.position ?? 0) + 1,
  });
  if (error) go(t("academy.messages.questionCreateFailed", {message: error.message}), "error", courseId);

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_question", action: "created", details: {course_id: courseId}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.questionCreated"), "success", courseId);
}

export async function deleteAcademyQuestionAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const questionId = cleanText(formData.get("questionId"), 80);
  const {error} = await admin.from("academy_quiz_questions").delete().eq("id", questionId).eq("course_id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.questionDeleteFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_question", entityId: questionId, action: "deleted"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.questionDeleted"), "success", courseId);
}

export async function publishAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const {count, error: countError} = await admin
    .from("academy_quiz_questions")
    .select("id", {count: "exact", head: true})
    .eq("course_id", courseId);
  if (countError) go(t("academy.messages.coursePublishFailed", {message: countError.message}), "error", courseId);
  if (!count) go(t("academy.messages.quizRequiredBeforePublish"), "error", courseId);

  const now = new Date().toISOString();
  const {error} = await admin.from("academy_courses").update({status: "published", published_by: user.id, published_at: now}).eq("id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.coursePublishFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_course", entityId: courseId, action: "published"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.coursePublished"), "success", courseId);
}

export async function archiveAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const {error} = await admin.from("academy_courses").update({status: "archived"}).eq("id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.courseArchiveFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_course", entityId: courseId, action: "archived"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseArchived"), "success", courseId);
}

export async function assignAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await context();
  if (!academyAssignmentRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const userId = cleanText(formData.get("userId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course || course.status !== "published") go(t("academy.messages.courseNotPublished"), "error", courseId);
  if (!visibleUserIds.includes(userId)) go(t("academy.messages.outOfScope"), "error", courseId);

  const {data: activeMember} = await admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!activeMember) go(t("academy.messages.memberNotFound"), "error", courseId);

  const {error} = await admin.from("academy_enrollments").upsert({
    organization_id: membership.organization_id,
    course_id: courseId,
    user_id: userId,
    status: "assigned",
    progress_percent: 0,
    assigned_by: user.id,
    assigned_at: new Date().toISOString(),
  }, {onConflict: "course_id,user_id", ignoreDuplicates: true});
  if (error) go(t("academy.messages.assignmentFailed", {message: error.message}), "error", courseId);

  await createNotification({
    organizationId: membership.organization_id,
    userId,
    actorId: user.id,
    category: "performance",
    eventType: "academy_course_assigned",
    titleFr: "Nouvelle formation assignée",
    titleEn: "New training assigned",
    bodyFr: `${course.title} doit être terminée avant le ${course.deadline}.`,
    bodyEn: `${course.title} must be completed by ${course.deadline}.`,
    actionUrl: `/dashboard/academy?course=${courseId}`,
    priority: course.is_required ? "warning" : "info",
    requiresAction: course.is_required,
    dedupeKey: `academy-assigned-${courseId}-${userId}`,
  });

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: userId, entityType: "academy_enrollment", action: "assigned", details: {course_id: courseId}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseAssigned"), "success", courseId);
}

export async function selfEnrollAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course || course.status !== "published") go(t("academy.messages.courseNotPublished"), "error", courseId);

  const {error} = await admin.from("academy_enrollments").upsert({
    organization_id: membership.organization_id,
    course_id: courseId,
    user_id: user.id,
    status: "assigned",
    progress_percent: 0,
    assigned_by: user.id,
    assigned_at: new Date().toISOString(),
  }, {onConflict: "course_id,user_id", ignoreDuplicates: true});
  if (error) go(t("academy.messages.assignmentFailed", {message: error.message}), "error", courseId);
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.selfEnrolled"), "success", courseId);
}

export async function startAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);
  const courseId = cleanText(formData.get("courseId"), 80);
  const {error} = await admin.from("academy_enrollments").update({
    status: "in_progress",
    progress_percent: 25,
    started_at: new Date().toISOString(),
  }).eq("id", enrollmentId).eq("course_id", courseId).eq("user_id", user.id).eq("organization_id", membership.organization_id).in("status", ["assigned", "failed"]);
  if (error) go(t("academy.messages.startFailed", {message: error.message}), "error", courseId);
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseStarted"), "success", courseId);
}

async function createCertificate({
  enrollment,
  course,
  userId,
  score,
}: {
  enrollment: EnrollmentRow;
  course: CourseRow;
  userId: string;
  score: number | null;
}) {
  const admin = createAdminClient();
  const {data: existing} = await admin.from("academy_certificates").select("id").eq("enrollment_id", enrollment.id).maybeSingle<{id: string}>();
  if (existing) return existing.id;

  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const certificateNumber = `SLA-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const {data, error} = await admin.from("academy_certificates").insert({
    organization_id: enrollment.organization_id,
    course_id: course.id,
    enrollment_id: enrollment.id,
    user_id: userId,
    certificate_number: certificateNumber,
    final_score: score,
    issued_by: userId,
    status: "active",
  }).select("id").single<{id: string}>();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function submitAcademyQuizAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  const courseId = cleanText(formData.get("courseId"), 80);
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);

  const [course, enrollmentResult, questionsResult] = await Promise.all([
    loadCourse(courseId, membership.organization_id),
    admin.from("academy_enrollments").select("id, organization_id, course_id, user_id, status, attempts_count, best_score").eq("id", enrollmentId).eq("course_id", courseId).eq("user_id", user.id).eq("organization_id", membership.organization_id).maybeSingle<EnrollmentRow>(),
    admin.from("academy_quiz_questions").select("id, question_text, options, correct_option, points").eq("course_id", courseId).eq("organization_id", membership.organization_id).order("position"),
  ]);

  const enrollment = enrollmentResult.data;
  const questions = (questionsResult.data ?? []) as QuestionRow[];
  if (!course || course.status !== "published" || !enrollment) go(t("academy.messages.enrollmentNotFound"), "error", courseId);
  if (enrollment.status === "completed") go(t("academy.messages.alreadyCompleted"), "error", courseId);
  if (!questions.length) go(t("academy.messages.quizMissing"), "error", courseId);
  if (enrollment.attempts_count >= course.max_attempts) go(t("academy.messages.noAttemptsLeft"), "error", courseId);

  let earned = 0;
  let total = 0;
  const answers: Record<string, number | null> = {};
  for (const question of questions) {
    const answerRaw = String(formData.get(`question_${question.id}`) ?? "");
    const answer = /^\d+$/.test(answerRaw) ? Number(answerRaw) : null;
    answers[question.id] = answer;
    const points = Number(question.points) || 1;
    total += points;
    if (answer === question.correct_option) earned += points;
  }

  const score = total > 0 ? Math.round((earned / total) * 10000) / 100 : 0;
  const passed = score >= Number(course.passing_score);
  const attemptsCount = enrollment.attempts_count + 1;
  const bestScore = Math.max(Number(enrollment.best_score ?? 0), score);
  const now = new Date().toISOString();

  const {error: attemptError} = await admin.from("academy_quiz_attempts").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    enrollment_id: enrollmentId,
    user_id: user.id,
    answers,
    score,
    passed,
    attempted_at: now,
  });
  if (attemptError) go(t("academy.messages.quizSaveFailed", {message: attemptError.message}), "error", courseId);

  const nextStatus = passed ? "completed" : attemptsCount >= course.max_attempts ? "failed" : "in_progress";
  const {error: enrollmentError} = await admin.from("academy_enrollments").update({
    status: nextStatus,
    progress_percent: passed ? 100 : 75,
    attempts_count: attemptsCount,
    best_score: bestScore,
    completed_at: passed ? now : null,
    started_at: now,
  }).eq("id", enrollmentId).eq("user_id", user.id);
  if (enrollmentError) go(t("academy.messages.quizSaveFailed", {message: enrollmentError.message}), "error", courseId);

  let certificateId: string | null = null;
  if (passed && course.certificate_enabled) {
    try {
      certificateId = await createCertificate({enrollment: {...enrollment, attempts_count: attemptsCount, best_score: bestScore, status: nextStatus}, course, userId: user.id, score});
    } catch (error) {
      console.error("Certificate creation failed", error);
    }
  }

  await createNotification({
    organizationId: membership.organization_id,
    userId: user.id,
    actorId: user.id,
    category: "performance",
    eventType: passed ? "academy_course_completed" : "academy_quiz_failed",
    titleFr: passed ? "Formation terminée" : "Quiz à reprendre",
    titleEn: passed ? "Training completed" : "Quiz needs another attempt",
    bodyFr: passed ? `${course.title} est terminée avec ${score} %.` : `Résultat : ${score} %. Le seuil est ${course.passing_score} %.`,
    bodyEn: passed ? `${course.title} was completed with ${score}%.` : `Result: ${score}%. The pass mark is ${course.passing_score}%.`,
    actionUrl: certificateId ? `/dashboard/academy/certificate/${certificateId}` : `/dashboard/academy?course=${courseId}`,
    priority: passed ? "success" : "warning",
    requiresAction: !passed,
    dedupeKey: passed ? `academy-completed-${enrollmentId}` : null,
  });

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: user.id, entityType: "academy_quiz_attempt", action: passed ? "passed" : "failed", details: {course_id: courseId, score, attempt: attemptsCount}});
  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/performance");
  go(passed ? t("academy.messages.quizPassed", {score}) : t("academy.messages.quizFailed", {score, passingScore: course.passing_score}), passed ? "success" : "error", courseId);
}

export async function exemptAcademyEnrollmentAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);
  const reason = cleanText(formData.get("reason"), 1000);
  const {data: enrollment} = await admin.from("academy_enrollments").select("user_id").eq("id", enrollmentId).eq("course_id", courseId).eq("organization_id", membership.organization_id).maybeSingle<{user_id: string}>();
  if (!enrollment || !visibleUserIds.includes(enrollment.user_id) || reason.length < 3) go(t("academy.messages.invalidExemption"), "error", courseId);
  const {error} = await admin.from("academy_enrollments").update({status: "exempted", exempted_reason: reason, progress_percent: 100}).eq("id", enrollmentId);
  if (error) go(t("academy.messages.exemptionFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: enrollment.user_id, entityType: "academy_enrollment", entityId: enrollmentId, action: "exempted", details: {reason}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.enrollmentExempted"), "success", courseId);
}
