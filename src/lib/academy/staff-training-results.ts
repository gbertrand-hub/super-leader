import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type CourseRow = {
  id: string;
  title: string;
  training_month: string | null;
};

type EnrollmentRow = {
  user_id: string;
  status: string;
};

type MembershipRow = {
  user_id: string;
  role: string;
  is_active: boolean;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type QuizRow = {
  id: string;
  module_label: string;
  title: string;
  passing_score: number | string;
  max_attempts: number;
  is_required: boolean;
};

type AttemptRow = {
  quiz_id: string;
  user_id: string;
  score: number | string;
  passed: boolean;
  attempt_no: number;
  attempted_at: string;
};

export type StaffTrainingQuizResult = {
  quizId: string;
  moduleLabel: string;
  title: string;
  passingScore: number;
  attempts: number;
  bestScore: number | null;
  passed: boolean;
  lastAttemptAt: string | null;
};

export type StaffTrainingParticipantResult = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  membershipActive: boolean;
  enrollmentStatus: string;
  quizResults: StaffTrainingQuizResult[];
  totalAttempts: number;
  requiredPassed: number;
  requiredTotal: number;
  progressPercent: number;
  status: "validated" | "in_progress" | "not_started";
  lastAttemptAt: string | null;
};

export type StaffTrainingResultsData = {
  course: CourseRow;
  quizzes: QuizRow[];
  participants: StaffTrainingParticipantResult[];
  scope: "organization" | "team";
};

const ORGANIZATION_RESULTS_ROLES = new Set(["owner", "admin", "hr"]);
const RESULTS_ROLES = new Set(["owner", "admin", "hr", "manager"]);

export function canViewStaffTrainingResults(role: string) {
  return RESULTS_ROLES.has(String(role || "").toLowerCase());
}

function bestAttempt(attempts: AttemptRow[]) {
  if (!attempts.length) return null;
  return attempts.reduce((best, current) => Number(current.score) > Number(best.score) ? current : best, attempts[0]);
}

export async function loadStaffTrainingResults({
  admin,
  organizationId,
  actorId,
  role,
  courseId,
}: {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  role: string;
  courseId?: string;
}): Promise<StaffTrainingResultsData | null> {
  if (!canViewStaffTrainingResults(role)) return null;

  let courseQuery = admin
    .from("academy_courses")
    .select("id,title,training_month")
    .eq("organization_id", organizationId)
    .eq("is_staff_training", true);

  if (courseId) courseQuery = courseQuery.eq("id", courseId);
  else courseQuery = courseQuery.order("training_month", {ascending: false}).order("created_at", {ascending: false}).limit(1);

  const {data: courseData, error: courseError} = courseId
    ? await courseQuery.maybeSingle<CourseRow>()
    : await courseQuery.maybeSingle<CourseRow>();

  if (courseError) throw new Error(courseError.message);
  if (!courseData) return null;
  const course = courseData;

  const [enrollmentsResult, quizzesResult] = await Promise.all([
    admin
      .from("academy_enrollments")
      .select("user_id,status")
      .eq("organization_id", organizationId)
      .eq("course_id", course.id),
    admin
      .from("academy_staff_training_module_quizzes")
      .select("id,module_label,title,passing_score,max_attempts,is_required")
      .eq("organization_id", organizationId)
      .eq("course_id", course.id)
      .order("module_label", {ascending: true})
      .order("created_at", {ascending: true}),
  ]);

  const firstError = enrollmentsResult.error ?? quizzesResult.error;
  if (firstError) throw new Error(firstError.message);

  const enrollments = (enrollmentsResult.data ?? []) as EnrollmentRow[];
  const quizzes = (quizzesResult.data ?? []) as QuizRow[];
  const enrolledIds = Array.from(new Set(enrollments.map((row) => String(row.user_id)).filter(Boolean)));
  if (!enrolledIds.length) return {course, quizzes, participants: [], scope: ORGANIZATION_RESULTS_ROLES.has(role) ? "organization" : "team"};

  const normalizedRole = String(role || "").toLowerCase();
  const organizationWide = ORGANIZATION_RESULTS_ROLES.has(normalizedRole);
  const scopedIds = organizationWide
    ? enrolledIds
    : (await getVisibleUserIds({admin, organizationId, actorId, role: normalizedRole})).filter((id) => enrolledIds.includes(id));

  if (!scopedIds.length) return {course, quizzes, participants: [], scope: organizationWide ? "organization" : "team"};

  const [profilesResult, membershipsResult, attemptsResult] = await Promise.all([
    admin.from("profiles").select("id,full_name,email").in("id", scopedIds),
    admin.from("organization_members").select("user_id,role,is_active").eq("organization_id", organizationId).in("user_id", scopedIds),
    admin
      .from("academy_staff_training_module_quiz_attempts")
      .select("quiz_id,user_id,score,passed,attempt_no,attempted_at")
      .eq("organization_id", organizationId)
      .eq("course_id", course.id)
      .in("user_id", scopedIds)
      .order("attempted_at", {ascending: false}),
  ]);

  const loadError = profilesResult.error ?? membershipsResult.error ?? attemptsResult.error;
  if (loadError) throw new Error(loadError.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const membershipById = new Map(memberships.map((row) => [row.user_id, row]));
  const enrollmentById = new Map(enrollments.map((row) => [row.user_id, row]));
  const requiredQuizzes = quizzes.filter((quiz) => quiz.is_required);

  const participants = scopedIds.map((userId): StaffTrainingParticipantResult => {
    const profile = profileById.get(userId);
    const membership = membershipById.get(userId);
    const userAttempts = attempts.filter((attempt) => attempt.user_id === userId);
    const quizResults = quizzes.map((quiz): StaffTrainingQuizResult => {
      const quizAttempts = userAttempts.filter((attempt) => attempt.quiz_id === quiz.id);
      const best = bestAttempt(quizAttempts);
      const latest = quizAttempts[0] ?? null;
      return {
        quizId: quiz.id,
        moduleLabel: quiz.module_label,
        title: quiz.title,
        passingScore: Number(quiz.passing_score) || 0,
        attempts: quizAttempts.length,
        bestScore: best ? Number(best.score) : null,
        passed: quizAttempts.some((attempt) => attempt.passed),
        lastAttemptAt: latest?.attempted_at ?? null,
      };
    });
    const requiredPassed = requiredQuizzes.filter((quiz) => quizResults.find((result) => result.quizId === quiz.id)?.passed).length;
    const requiredTotal = requiredQuizzes.length;
    const totalAttempts = userAttempts.length;
    const progressPercent = requiredTotal ? Math.round((requiredPassed / requiredTotal) * 100) : 100;
    const status: StaffTrainingParticipantResult["status"] = requiredTotal > 0 && requiredPassed === requiredTotal
      ? "validated"
      : totalAttempts > 0 ? "in_progress" : "not_started";
    const lastAttemptAt = userAttempts[0]?.attempted_at ?? null;
    return {
      userId,
      fullName: profile?.full_name?.trim() || profile?.email || userId,
      email: profile?.email || "",
      role: membership?.role || "",
      membershipActive: membership?.is_active ?? false,
      enrollmentStatus: enrollmentById.get(userId)?.status || "assigned",
      quizResults,
      totalAttempts,
      requiredPassed,
      requiredTotal,
      progressPercent,
      status,
      lastAttemptAt,
    };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName, "fr", {sensitivity: "base"}));

  return {course, quizzes, participants, scope: organizationWide ? "organization" : "team"};
}
