// V4_10_110_STAFF_MODULE_UX
// V4_10_109_R4_ACADEMY_ACCESS
"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {
  finalizeStaffTrainingResource,
  readPendingStaffTrainingResource,
  removeStaffTrainingResource,
} from "@/lib/academy/staff-training-storage";
import {createNotification} from "@/lib/notifications/service";
import {requireAcademyAccessContext} from "@/lib/academy/access-context";

const STAFF_TRAINING_ADMIN_ROLES = new Set(["owner", "admin", "hr"]);
const RESOURCE_TYPES = new Set(["document", "presentation", "worksheet", "guide", "template", "spreadsheet", "other"]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type ModuleQuiz = {
  id: string;
  course_id: string;
  module_label: string;
  title: string;
  passing_score: number | string;
  max_attempts: number;
  is_required: boolean;
  is_published: boolean;
  available_from: string | null;
  available_until: string | null;
};

type ModuleQuizQuestion = {
  id: string;
  quiz_id: string;
  question_text: string;
  options: unknown;
  correct_option: number;
  points: number | string;
  position: number;
};

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseInteger(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : fallback;
}


function quizAvailabilityState(quiz: ModuleQuiz, now = new Date()) {
  if (!quiz.is_published) return {open: false, reason: "locked" as const};
  const opensAt = quiz.available_from ? new Date(quiz.available_from) : null;
  const closesAt = quiz.available_until ? new Date(quiz.available_until) : null;
  if (opensAt && now < opensAt) return {open: false, reason: "scheduled" as const};
  if (closesAt && now > closesAt) return {open: false, reason: "closed" as const};
  return {open: true, reason: "open" as const};
}

function go(message: string, kind: "success" | "error" = "success", courseId?: string): never {
  const params = new URLSearchParams({[kind]: message});
  if (courseId) params.set("course", courseId);
  redirect(`/dashboard/academy/staff-training?${params.toString()}`);
}

function moduleGo(message: string, kind: "success" | "error", courseId: string, month = "", moduleLabel = ""): never {
  const params = new URLSearchParams({[kind]: message});
  if (month) params.set("month", month);
  else if (courseId) params.set("course", courseId);
  if (moduleLabel) params.set("module", moduleLabel);
  redirect(`/dashboard/academy/staff-training?${params.toString()}`);
}

async function getContext() {
  const access = await requireAcademyAccessContext();
  const membership: Membership = {
    organization_id: access.organizationId,
    role: access.role,
    is_active: true,
  };
  return {user: access.user, membership, admin: access.admin};
}

async function requireAdminCourse(courseId: string) {
  const context = await getContext();
  if (!STAFF_TRAINING_ADMIN_ROLES.has(context.membership.role)) {
    go("Accès réservé à l'administration Academy.", "error", courseId);
  }

  const {data: course, error} = await context.admin
    .from("academy_courses")
    .select("id, organization_id, title, deadline, is_required, status, is_staff_training")
    .eq("id", courseId)
    .eq("organization_id", context.membership.organization_id)
    .maybeSingle();

  if (error || !course) go("Formation introuvable.", "error");
  return {...context, course};
}

export async function activateStaffTrainingCourseAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  if (!courseId) go("Sélectionne une formation Academy.", "error");

  const {admin, membership, user} = await requireAdminCourse(courseId);
  const {error} = await admin
    .from("academy_courses")
    .update({is_staff_training: true})
    .eq("id", courseId)
    .eq("organization_id", membership.organization_id);
  if (error) go(error.message, "error", courseId);

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action: "staff_training_enabled",
    details: {},
  });

  revalidatePath("/dashboard/academy/staff-training");
  revalidatePath("/dashboard/academy");
  go("Formation ajoutée au Centre de formation du personnel.", "success", courseId);
}

export async function assignAllActiveStaffTrainingAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const {admin, membership, user, course} = await requireAdminCourse(courseId);

  if (!course.is_staff_training) go("Active d'abord cette formation comme formation du staff.", "error", courseId);
  if (course.status !== "published") go("Publie d'abord la formation Academy avant de l'affecter au staff.", "error", courseId);

  const [{data: members, error: membersError}, {data: existing, error: existingError}] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true),
    admin
      .from("academy_enrollments")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("course_id", courseId),
  ]);

  if (membersError) go(`Impossible de charger le staff actif : ${membersError.message}`, "error", courseId);
  if (existingError) go(`Impossible de charger les affectations existantes : ${existingError.message}`, "error", courseId);

  const activeUserIds = [...new Set((members ?? []).map((row) => String(row.user_id)).filter(Boolean))];
  const existingUserIds = new Set((existing ?? []).map((row) => String(row.user_id)));
  const missingUserIds = activeUserIds.filter((userId) => !existingUserIds.has(userId));

  if (!missingUserIds.length) {
    go("Tout le staff actif est déjà affecté à cette formation.", "success", courseId);
  }

  const assignedAt = new Date().toISOString();
  const {error: enrollmentError} = await admin.from("academy_enrollments").insert(
    missingUserIds.map((userId) => ({
      organization_id: membership.organization_id,
      course_id: courseId,
      user_id: userId,
      status: "assigned",
      progress_percent: 0,
      assigned_by: user.id,
      assigned_at: assignedAt,
    })),
  );
  if (enrollmentError) go(`Affectation impossible : ${enrollmentError.message}`, "error", courseId);

  await Promise.allSettled(
    missingUserIds.map((userId) => createNotification({
      organizationId: membership.organization_id,
      userId,
      actorId: user.id,
      category: "performance",
      eventType: "staff_training_assigned",
      titleFr: "Formation du staff assignée",
      titleEn: "Staff training assigned",
      bodyFr: `${course.title} est maintenant disponible dans le Centre de formation du personnel${course.deadline ? ` et doit être terminée avant le ${course.deadline}` : ""}.`,
      bodyEn: `${course.title} is now available in the Staff Training Center${course.deadline ? ` and should be completed by ${course.deadline}` : ""}.`,
      actionUrl: `/dashboard/academy/staff-training?course=${courseId}`,
      priority: course.is_required ? "warning" : "info",
      requiresAction: Boolean(course.is_required),
      dedupeKey: `staff-training-assigned-${courseId}-${userId}`,
    })),
  );

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action: "staff_training_bulk_assigned",
    details: {assignedCount: missingUserIds.length, activeStaffCount: activeUserIds.length},
  });

  revalidatePath("/dashboard/academy/staff-training");
  revalidatePath("/dashboard/academy");
  go(`${missingUserIds.length} collaborateur(s) affecté(s) à la formation.`, "success", courseId);
}

export async function deactivateStaffTrainingCourseAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const {admin, membership, user} = await requireAdminCourse(courseId);

  const {error} = await admin
    .from("academy_courses")
    .update({is_staff_training: false})
    .eq("id", courseId)
    .eq("organization_id", membership.organization_id);
  if (error) go(error.message, "error", courseId);

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action: "staff_training_disabled",
    details: {},
  });

  revalidatePath("/dashboard/academy/staff-training");
  go("Formation retirée du Centre de formation du personnel. Les données Academy sont conservées.", "success");
}

export async function addStaffTrainingModuleAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const moduleLabel = cleanText(formData.get("moduleLabel"), 120);
  const title = cleanText(formData.get("title"), 180);
  const moduleDate = cleanText(formData.get("moduleDate"), 20);
  const month = cleanText(formData.get("month"), 20);
  if (!courseId || !moduleLabel || !title) moduleGo("Le libellé et le titre du jour sont obligatoires.", "error", courseId, month, moduleLabel);

  const {admin, membership, user, course} = await requireAdminCourse(courseId);
  if (!course.is_staff_training) moduleGo("Active d'abord cette formation comme formation du staff.", "error", courseId, month, moduleLabel);

  const {data: existing} = await admin
    .from("academy_staff_training_modules")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("course_id", courseId)
    .eq("module_label", moduleLabel)
    .maybeSingle();
  if (existing) moduleGo("Ce jour existe déjà dans cette formation.", "error", courseId, month, moduleLabel);

  const {data: currentModules, error: orderError} = await admin
    .from("academy_staff_training_modules")
    .select("sort_order")
    .eq("organization_id", membership.organization_id)
    .eq("course_id", courseId)
    .order("sort_order", {ascending: false})
    .limit(1);
  if (orderError) moduleGo(orderError.message, "error", courseId, month, moduleLabel);
  const nextSort = Math.min(9999, Number(currentModules?.[0]?.sort_order ?? 0) + 10);

  const {error} = await admin.from("academy_staff_training_modules").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    module_label: moduleLabel,
    title,
    module_date: moduleDate || null,
    sort_order: nextSort,
    is_published: true,
    created_by: user.id,
  });
  if (error) moduleGo(error.message, "error", courseId, month, moduleLabel);

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action: "staff_training_module_created",
    details: {moduleLabel, title, moduleDate: moduleDate || null},
  });

  revalidatePath("/dashboard/academy/staff-training");
  moduleGo("Jour ajouté à la formation.", "success", courseId, month, moduleLabel);
}

export async function addStaffTrainingResourceAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const moduleLabel = cleanText(formData.get("moduleLabel"), 120);
  const title = cleanText(formData.get("title"), 180);
  const description = cleanText(formData.get("description"), 1200);
  const resourceType = cleanText(formData.get("resourceType"), 40);
  const sortOrder = Math.max(0, Math.min(9999, parseInteger(formData.get("sortOrder"), 0)));
  const publishNow = String(formData.get("publishNow") ?? "") === "on";

  if (!courseId || !title || !moduleLabel) go("Le jour/module et le titre du document sont obligatoires.", "error", courseId);
  if (!RESOURCE_TYPES.has(resourceType)) go("Type de ressource invalide.", "error", courseId);

  const pending = readPendingStaffTrainingResource(formData, "resource");
  if (!pending) go("Sélectionne un document à téléverser.", "error", courseId);

  const {admin, membership, user, course} = await requireAdminCourse(courseId);
  if (!course.is_staff_training) go("Active d'abord cette formation comme formation du staff.", "error", courseId);

  const {data: configuredModules, error: modulesError} = await admin
    .from("academy_staff_training_modules")
    .select("module_label")
    .eq("organization_id", membership.organization_id)
    .eq("course_id", courseId);
  if (modulesError) go(modulesError.message, "error", courseId);
  if ((configuredModules ?? []).length && !(configuredModules ?? []).some((row) => row.module_label === moduleLabel)) {
    go("Sélectionne un jour configuré pour cette formation.", "error", courseId);
  }

  const resourceId = randomUUID();
  let finalized: Awaited<ReturnType<typeof finalizeStaffTrainingResource>> | null = null;
  try {
    finalized = await finalizeStaffTrainingResource({
      admin,
      organizationId: membership.organization_id,
      userId: user.id,
      recordId: resourceId,
      pending,
    });

    const {error} = await admin.from("academy_staff_training_resources").insert({
      id: resourceId,
      organization_id: membership.organization_id,
      course_id: courseId,
      module_label: moduleLabel,
      title,
      description,
      resource_type: resourceType,
      storage_path: finalized.storagePath,
      file_name: finalized.fileName,
      mime_type: finalized.mimeType,
      size_bytes: finalized.sizeBytes,
      sort_order: sortOrder,
      is_published: publishNow,
      published_at: publishNow ? new Date().toISOString() : null,
      created_by: user.id,
    });
    if (error) throw new Error(error.message);

    await admin.from("academy_staff_training_audit_log").insert({
      organization_id: membership.organization_id,
      course_id: courseId,
      resource_id: resourceId,
      actor_id: user.id,
      action: publishNow ? "resource_uploaded_and_published" : "resource_uploaded",
      details: {fileName: finalized.fileName, moduleLabel, resourceType},
    });
  } catch (error) {
    await removeStaffTrainingResource(admin, finalized?.storagePath ?? pending.storagePath);
    go(error instanceof Error ? error.message : "Impossible d'ajouter le document.", "error", courseId);
  }

  revalidatePath("/dashboard/academy/staff-training");
  go("Document ajouté à la formation.", "success", courseId);
}

export async function toggleStaffTrainingResourceAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const resourceId = cleanText(formData.get("resourceId"), 80);
  const publish = String(formData.get("publish") ?? "") === "true";
  const {admin, membership, user} = await requireAdminCourse(courseId);

  const {data: resource, error: resourceError} = await admin
    .from("academy_staff_training_resources")
    .select("id")
    .eq("id", resourceId)
    .eq("course_id", courseId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (resourceError || !resource) go("Document introuvable.", "error", courseId);

  const {error} = await admin
    .from("academy_staff_training_resources")
    .update({is_published: publish, published_at: publish ? new Date().toISOString() : null})
    .eq("id", resourceId)
    .eq("organization_id", membership.organization_id);
  if (error) go(error.message, "error", courseId);

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    resource_id: resourceId,
    actor_id: user.id,
    action: publish ? "resource_published" : "resource_unpublished",
    details: {},
  });

  revalidatePath("/dashboard/academy/staff-training");
  go(publish ? "Document publié." : "Document remis en brouillon.", "success", courseId);
}

export async function deleteStaffTrainingResourceAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const resourceId = cleanText(formData.get("resourceId"), 80);
  const {admin, membership, user} = await requireAdminCourse(courseId);

  const {data: resource, error} = await admin
    .from("academy_staff_training_resources")
    .select("id, storage_path, file_name")
    .eq("id", resourceId)
    .eq("course_id", courseId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (error || !resource) go("Document introuvable.", "error", courseId);

  const {error: deleteError} = await admin
    .from("academy_staff_training_resources")
    .delete()
    .eq("id", resourceId)
    .eq("organization_id", membership.organization_id);
  if (deleteError) go(deleteError.message, "error", courseId);

  await removeStaffTrainingResource(admin, resource.storage_path);
  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action: "resource_deleted",
    details: {fileName: resource.file_name},
  });

  revalidatePath("/dashboard/academy/staff-training");
  go("Document supprimé.", "success", courseId);
}



export async function saveStaffTrainingModuleQuizAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const month = cleanText(formData.get("month"), 20);
  const moduleLabel = cleanText(formData.get("moduleLabel"), 120);
  const quizId = cleanText(formData.get("quizId"), 80);
  const title = cleanText(formData.get("title"), 180);
  const passingScore = Math.max(1, Math.min(100, parseInteger(formData.get("passingScore"), 70)));
  const maxAttempts = Math.max(1, Math.min(10, parseInteger(formData.get("maxAttempts"), 2)));
  const isRequired = String(formData.get("isRequired") ?? "") === "on";
  const questionCount = Math.max(1, Math.min(30, parseInteger(formData.get("questionCount"), 0)));

  if (!courseId || !moduleLabel || !title || !questionCount) {
    moduleGo("Complète le titre et au moins une question.", "error", courseId, month, moduleLabel);
  }

  const {admin, membership, user, course} = await requireAdminCourse(courseId);
  if (!course.is_staff_training) moduleGo("Cette formation n'est pas active dans le Centre Staff Training.", "error", courseId, month, moduleLabel);

  const {data: moduleRow, error: moduleError} = await admin
    .from("academy_staff_training_modules")
    .select("id,module_label")
    .eq("organization_id", membership.organization_id)
    .eq("course_id", courseId)
    .eq("module_label", moduleLabel)
    .maybeSingle();
  if (moduleError || !moduleRow) moduleGo("Jour de formation introuvable.", "error", courseId, month, moduleLabel);

  const questions = Array.from({length: questionCount}, (_, index) => {
    const questionText = cleanText(formData.get(`question_${index}_text`), 800);
    const options = [0, 1, 2, 3].map((optionIndex) => cleanText(formData.get(`question_${index}_option_${optionIndex}`), 400));
    const correctOption = Math.max(0, Math.min(3, parseInteger(formData.get(`question_${index}_correct`), 0)));
    return {questionText, options, correctOption, position: index + 1};
  });

  if (questions.some((question) => !question.questionText || question.options.some((option) => !option))) {
    moduleGo("Chaque question doit contenir un énoncé et quatre réponses.", "error", courseId, month, moduleLabel);
  }

  let targetQuizId = quizId;
  let action = "staff_training_module_quiz_updated";

  if (quizId) {
    const [{data: existingQuiz, error: quizError}, {count: attemptCount}] = await Promise.all([
      admin
        .from("academy_staff_training_module_quizzes")
        .select("id,module_label")
        .eq("id", quizId)
        .eq("organization_id", membership.organization_id)
        .eq("course_id", courseId)
        .eq("module_label", moduleLabel)
        .maybeSingle(),
      admin
        .from("academy_staff_training_module_quiz_attempts")
        .select("id", {count: "exact", head: true})
        .eq("quiz_id", quizId)
        .eq("organization_id", membership.organization_id)
        .eq("course_id", courseId),
    ]);
    if (quizError || !existingQuiz) moduleGo("Quiz introuvable pour ce jour.", "error", courseId, month, moduleLabel);
    if (Number(attemptCount ?? 0) > 0) moduleGo("Ce quiz contient déjà des tentatives. Les questions sont protégées pour préserver l'historique.", "error", courseId, month, moduleLabel);

    const {error: updateError} = await admin
      .from("academy_staff_training_module_quizzes")
      .update({
        title,
        passing_score: passingScore,
        max_attempts: maxAttempts,
        is_required: isRequired,
        is_published: false,
        published_at: null,
        available_from: null,
        available_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quizId)
      .eq("organization_id", membership.organization_id)
      .eq("course_id", courseId);
    if (updateError) moduleGo(updateError.message, "error", courseId, month, moduleLabel);

    const {data: oldQuestions, error: oldQuestionsError} = await admin
      .from("academy_staff_training_module_quiz_questions")
      .select("id")
      .eq("quiz_id", quizId)
      .eq("organization_id", membership.organization_id);
    if (oldQuestionsError) moduleGo(oldQuestionsError.message, "error", courseId, month, moduleLabel);

    const replacementRows = questions.map((question) => ({
      organization_id: membership.organization_id,
      course_id: courseId,
      quiz_id: quizId,
      question_text: question.questionText,
      options: question.options,
      correct_option: question.correctOption,
      points: 1,
      position: 1000 + question.position,
    }));
    const {data: insertedQuestions, error: insertReplacementError} = await admin
      .from("academy_staff_training_module_quiz_questions")
      .insert(replacementRows)
      .select("id,position");
    if (insertReplacementError || !insertedQuestions?.length) moduleGo(insertReplacementError?.message ?? "Impossible d'enregistrer les nouvelles questions.", "error", courseId, month, moduleLabel);

    const oldIds = (oldQuestions ?? []).map((row) => String(row.id));
    if (oldIds.length) {
      const {error: deleteOldError} = await admin
        .from("academy_staff_training_module_quiz_questions")
        .delete()
        .in("id", oldIds)
        .eq("organization_id", membership.organization_id);
      if (deleteOldError) moduleGo(deleteOldError.message, "error", courseId, month, moduleLabel);
    }

    for (const row of insertedQuestions) {
      const finalPosition = Number(row.position) - 1000;
      const {error: positionError} = await admin
        .from("academy_staff_training_module_quiz_questions")
        .update({position: finalPosition})
        .eq("id", row.id)
        .eq("organization_id", membership.organization_id);
      if (positionError) moduleGo(positionError.message, "error", courseId, month, moduleLabel);
    }
  } else {
    const {data: existingQuiz, error: duplicateError} = await admin
      .from("academy_staff_training_module_quizzes")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("course_id", courseId)
      .eq("module_label", moduleLabel)
      .limit(1)
      .maybeSingle();
    if (duplicateError) moduleGo(duplicateError.message, "error", courseId, month, moduleLabel);
    if (existingQuiz) moduleGo("Un quiz existe déjà pour ce jour. Ouvre-le puis utilise Modifier le quiz.", "error", courseId, month, moduleLabel);

    const newQuizId = randomUUID();
    const {error: quizInsertError} = await admin.from("academy_staff_training_module_quizzes").insert({
      id: newQuizId,
      organization_id: membership.organization_id,
      course_id: courseId,
      module_label: moduleLabel,
      title,
      passing_score: passingScore,
      max_attempts: maxAttempts,
      is_required: isRequired,
      is_published: false,
      published_at: null,
      available_from: null,
      available_until: null,
      created_by: user.id,
    });
    if (quizInsertError) moduleGo(quizInsertError.message, "error", courseId, month, moduleLabel);

    const {error: questionInsertError} = await admin.from("academy_staff_training_module_quiz_questions").insert(
      questions.map((question) => ({
        organization_id: membership.organization_id,
        course_id: courseId,
        quiz_id: newQuizId,
        question_text: question.questionText,
        options: question.options,
        correct_option: question.correctOption,
        points: 1,
        position: question.position,
      })),
    );
    if (questionInsertError) {
      await admin.from("academy_staff_training_module_quizzes").delete().eq("id", newQuizId).eq("organization_id", membership.organization_id);
      moduleGo(questionInsertError.message, "error", courseId, month, moduleLabel);
    }
    targetQuizId = newQuizId;
    action = "staff_training_module_quiz_created";
  }

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action,
    details: {quizId: targetQuizId, moduleLabel, title, questionCount, passingScore, maxAttempts, isRequired},
  });

  revalidatePath("/dashboard/academy/staff-training");
  revalidatePath("/dashboard/academy/staff-training/quiz-builder");
  moduleGo(quizId ? "Quiz mis à jour et verrouillé pour prévisualisation." : "Quiz créé en brouillon. Prévisualise-le avant de l'ouvrir au staff.", "success", courseId, month, moduleLabel);
}

export async function setStaffTrainingModuleQuizAvailabilityAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const quizId = cleanText(formData.get("quizId"), 80);
  const mode = cleanText(formData.get("mode"), 40);
  if (!courseId || !quizId) go("Évaluation introuvable.", "error", courseId);

  const {admin, membership, user} = await requireAdminCourse(courseId);
  const {data: quiz, error: quizError} = await admin
    .from("academy_staff_training_module_quizzes")
    .select("id, course_id, module_label, title, passing_score, max_attempts, is_required, is_published, available_from, available_until")
    .eq("id", quizId)
    .eq("course_id", courseId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<ModuleQuiz>();
  if (quizError || !quiz) go("Évaluation introuvable.", "error", courseId);

  const now = new Date();
  let update: {is_published: boolean; published_at: string | null; available_from: string | null; available_until: string | null};
  let action = "module_quiz_locked";
  let message = "Évaluation verrouillée.";

  if (mode === "lock") {
    update = {is_published: false, published_at: null, available_from: null, available_until: null};
  } else {
    const durationHours = mode === "open_6h" ? 6 : mode === "open_12h" ? 12 : mode === "open_24h" ? 24 : mode === "open_48h" ? 48 : null;
    if (mode !== "open" && durationHours === null) go("Option d'ouverture invalide.", "error", courseId);
    const closesAt = durationHours ? new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString() : null;
    update = {is_published: true, published_at: now.toISOString(), available_from: now.toISOString(), available_until: closesAt};
    action = durationHours ? "module_quiz_opened_timed" : "module_quiz_opened";
    message = durationHours ? `Évaluation ouverte pour ${durationHours} heure(s).` : "Évaluation ouverte maintenant.";
  }

  const {error} = await admin
    .from("academy_staff_training_module_quizzes")
    .update({...update, updated_at: now.toISOString()})
    .eq("id", quizId)
    .eq("course_id", courseId)
    .eq("organization_id", membership.organization_id);
  if (error) go(error.message, "error", courseId);

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action,
    details: {quizId, moduleLabel: quiz.module_label, mode, availableUntil: update.available_until},
  });

  revalidatePath("/dashboard/academy/staff-training");
  go(message, "success", courseId);
}

export async function submitStaffTrainingModuleQuizAction(formData: FormData) {
  const courseId = cleanText(formData.get("courseId"), 80);
  const quizId = cleanText(formData.get("quizId"), 80);
  if (!courseId || !quizId) go("Évaluation introuvable.", "error", courseId);

  const {admin, membership, user} = await getContext();

  const [{data: course, error: courseError}, {data: quiz, error: quizError}, {data: enrollment, error: enrollmentError}] = await Promise.all([
    admin
      .from("academy_courses")
      .select("id, organization_id, title, is_staff_training")
      .eq("id", courseId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle(),
    admin
      .from("academy_staff_training_module_quizzes")
      .select("id, course_id, module_label, title, passing_score, max_attempts, is_required, is_published, available_from, available_until")
      .eq("id", quizId)
      .eq("course_id", courseId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<ModuleQuiz>(),
    admin
      .from("academy_enrollments")
      .select("id, course_id, user_id")
      .eq("course_id", courseId)
      .eq("user_id", user.id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle(),
  ]);

  if (courseError || !course || !course.is_staff_training) go("Formation du staff introuvable.", "error", courseId);
  if (quizError || !quiz) go("Cette évaluation n'est pas disponible.", "error", courseId);
  const availability = quizAvailabilityState(quiz);
  if (!availability.open) {
    const message = availability.reason === "scheduled"
      ? "Cette évaluation n'est pas encore ouverte."
      : availability.reason === "closed"
        ? "La période d'accès à cette évaluation est terminée."
        : "Cette évaluation est verrouillée par le formateur.";
    go(message, "error", courseId);
  }
  if (enrollmentError || !enrollment) go("Cette évaluation est réservée aux participants affectés à la formation.", "error", courseId);

  const [{data: questionsData, error: questionsError}, {data: attemptsData, error: attemptsError}] = await Promise.all([
    admin
      .from("academy_staff_training_module_quiz_questions")
      .select("id, quiz_id, question_text, options, correct_option, points, position")
      .eq("quiz_id", quizId)
      .eq("organization_id", membership.organization_id)
      .order("position", {ascending: true}),
    admin
      .from("academy_staff_training_module_quiz_attempts")
      .select("id, score, passed, attempt_no")
      .eq("quiz_id", quizId)
      .eq("user_id", user.id)
      .eq("organization_id", membership.organization_id)
      .order("attempt_no", {ascending: true}),
  ]);

  if (questionsError || attemptsError) go("Impossible de charger l'évaluation.", "error", courseId);
  const questions = (questionsData ?? []) as ModuleQuizQuestion[];
  const attempts = attemptsData ?? [];
  if (!questions.length) go("Cette évaluation ne contient aucune question.", "error", courseId);
  if (attempts.some((attempt) => attempt.passed)) go("Cette évaluation est déjà réussie.", "success", courseId);
  if (attempts.length >= Number(quiz.max_attempts)) go("Le nombre maximum de tentatives est atteint.", "error", courseId);

  let totalPoints = 0;
  let earnedPoints = 0;
  const answers: Record<string, number> = {};

  for (const question of questions) {
    const raw = String(formData.get(`staff_quiz_${question.id}`) ?? "").trim();
    const answer = Number(raw);
    const options = Array.isArray(question.options) ? question.options : [];
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      go("Réponds à toutes les questions avant de soumettre l'évaluation.", "error", courseId);
    }
    answers[question.id] = answer;
    const points = Number(question.points) || 1;
    totalPoints += points;
    if (answer === Number(question.correct_option)) earnedPoints += points;
  }

  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 10000) / 100 : 0;
  const passed = score >= Number(quiz.passing_score);
  const attemptNo = attempts.length + 1;
  const {error: saveError} = await admin.from("academy_staff_training_module_quiz_attempts").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    quiz_id: quizId,
    enrollment_id: enrollment.id,
    user_id: user.id,
    answers,
    score,
    passed,
    attempt_no: attemptNo,
  });
  if (saveError) go(`Impossible d'enregistrer l'évaluation : ${saveError.message}`, "error", courseId);

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    actor_id: user.id,
    action: passed ? "module_quiz_passed" : "module_quiz_failed",
    details: {quizId, moduleLabel: quiz.module_label, score, attemptNo},
  });

  revalidatePath("/dashboard/academy/staff-training");
  go(
    passed
      ? `Évaluation réussie : ${score} %.`
      : `Résultat : ${score} %. Seuil requis : ${Number(quiz.passing_score)} %.`,
    passed ? "success" : "error",
    courseId,
  );
}
