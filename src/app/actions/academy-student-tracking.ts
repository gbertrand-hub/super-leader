"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {assertEnrollmentPermission,canEnrollStudents,getAcademyAssignments} from "@/lib/academy/access";

const text = (v: FormDataEntryValue | null, n = 5000) =>
  String(v ?? "")
    .trim()
    .slice(0, n);
const money = (v: FormDataEntryValue | null) =>
  Math.max(0, Number(String(v ?? "0").replace(",", ".")) || 0);
const date = (v: FormDataEntryValue | null) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;
function go(
  schoolId: string,
  message: string,
  kind: "success" | "error" = "success",
): never {
  redirect(
    `/dashboard/academy/schools/${schoolId}/students?${kind}=${encodeURIComponent(message)}`,
  );
}
async function context() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!membership) throw new Error("Action non autorisée.");
  return { admin, user: data.user, membership };
}

export async function enrollAcademyStudentAction(formData: FormData) {
  const schoolId = text(formData.get("school_id"), 80),
    clientId = text(formData.get("crm_client_id"), 80),
    programId = text(formData.get("program_id"), 80),
    cohortId = text(formData.get("cohort_id"), 80);
  const { admin, user, membership } = await context();
  const assignments=await getAcademyAssignments(admin,membership.organization_id,user.id);
  if(!canEnrollStudents(membership.role,assignments,schoolId))go(schoolId,"Vous n’êtes pas autorisé à inscrire des étudiants dans cette école.","error");
  if (!programId || !cohortId) go(schoolId, "Le programme et la cohorte sont obligatoires pour finaliser une nouvelle inscription.", "error");
  const [{ data: school }, { data: client }, { data: program }, { data: cohort }] = await Promise.all([
    admin.from("academy_schools").select("id").eq("id", schoolId).eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("crm_clients").select("id").eq("id", clientId).eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("academy_programs").select("id,school_id").eq("id", programId).eq("organization_id", membership.organization_id).eq("school_id", schoolId).maybeSingle(),
    admin.from("academy_cohorts").select("id,school_id,program_id").eq("id", cohortId).eq("organization_id", membership.organization_id).eq("school_id", schoolId).maybeSingle<{id: string; school_id: string; program_id: string | null}>(),
  ]);
  if (!school || !client || !program || !cohort) go(schoolId, "École, contact, programme ou cohorte invalide.", "error");
  if (cohort.program_id && String(cohort.program_id) !== programId) go(schoolId, "La cohorte sélectionnée appartient à un autre programme.", "error");
  const {data: linkedEnrollment} = await admin
    .from("academy_school_enrollments")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("crm_client_id", clientId)
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle<{user_id: string}>();
  const { data: enrollment, error } = await admin.from("academy_school_enrollments").insert({
    organization_id: membership.organization_id, school_id: schoolId, program_id: programId, cohort_id: cohortId, crm_client_id: clientId,
    user_id: linkedEnrollment?.user_id ?? null,
    academic_status: "active", source: "manual", source_type: "crm", assigned_follow_up_user_id: text(formData.get("follow_up_user_id"), 80) || null, created_by: user.id,
  }).select("id").single<{ id: string }>();
  if (error || !enrollment) go(schoolId, error?.message ?? "Inscription impossible.", "error");
  const firstDue = date(formData.get("first_payment_due_on"));
  const { error: financeError } = await admin.from("academy_student_finance").insert({
    organization_id: membership.organization_id, enrollment_id: enrollment.id, is_internal_training: false, list_price: 0, discount_amount: 0, agreed_amount: 0, currency: "USD", payment_status: "not_started", first_payment_due_on: firstDue, created_by: user.id,
  });
  if (financeError) go(schoolId, financeError.message, "error");
  await admin.from("academy_student_progress").insert({ organization_id: membership.organization_id, enrollment_id: enrollment.id, training_status: "not_started", risk_level: "low", updated_by: user.id });
  const { error: syncError } = await admin.rpc("sync_academy_inherited_finance", { target_enrollment_id: enrollment.id });
  if (syncError) go(schoolId, syncError.message, "error");
  revalidatePath(`/dashboard/academy/schools/${schoolId}`);
  revalidatePath("/dashboard/academy/students");
  go(schoolId, "Étudiant inscrit. Le tarif homologué de la cohorte ou du programme a été hérité automatiquement.");
}

export async function recordAcademyStudentPaymentAction(formData: FormData) {
  const schoolId = text(formData.get("school_id"), 80),
    enrollmentId = text(formData.get("enrollment_id"), 80);
  const { admin, user, membership } = await context();
  if (!(await assertEnrollmentPermission(admin,membership.organization_id,user.id,membership.role,schoolId,enrollmentId,"finance"))) go(schoolId,"Accès financier non autorisé.","error");
  const amount = money(formData.get("amount"));
  if (amount <= 0)
    go(schoolId, "Le montant doit être supérieur à zéro.", "error");
  const { error } = await admin
    .from("academy_student_payments")
    .insert({
      organization_id: membership.organization_id,
      enrollment_id: enrollmentId,
      amount,
      currency: (text(formData.get("currency"), 3) || "USD").toUpperCase(),
      paid_on:
        date(formData.get("paid_on")) ?? new Date().toISOString().slice(0, 10),
      payment_method: text(formData.get("payment_method"), 30) || "other",
      reference: text(formData.get("reference"), 120) || null,
      notes: text(formData.get("notes"), 2000) || null,
      recorded_by: user.id,
    });
  if (error) go(schoolId, error.message, "error");
  revalidatePath(`/dashboard/academy/schools/${schoolId}/students`);
  go(schoolId, "Paiement enregistré.");
}

export async function updateAcademyStudentProgressAction(formData: FormData) {
  const schoolId = text(formData.get("school_id"), 80),
    enrollmentId = text(formData.get("enrollment_id"), 80);
  const { admin, user, membership } = await context();
  if (!(await assertEnrollmentPermission(admin,membership.organization_id,user.id,membership.role,schoolId,enrollmentId,"training"))) go(schoolId,"Accès pédagogique non autorisé.","error");
  const progress = Math.min(100, money(formData.get("progress_percent")));
  const payload = {
    organization_id: membership.organization_id,
    enrollment_id: enrollmentId,
    progress_percent: progress,
    current_module: text(formData.get("current_module"), 240) || null,
    last_activity_on: date(formData.get("last_activity_on")),
    expected_completion_on: date(formData.get("expected_completion_on")),
    training_status: text(formData.get("training_status"), 30) || "active",
    risk_level: text(formData.get("risk_level"), 20) || "low",
    blocker_notes: text(formData.get("blocker_notes"), 5000) || null,
    next_action: text(formData.get("next_action"), 500) || null,
    next_action_on: date(formData.get("next_action_on")),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("academy_student_progress")
    .upsert(payload, { onConflict: "enrollment_id" });
  if (error) go(schoolId, error.message, "error");
  revalidatePath(`/dashboard/academy/schools/${schoolId}/students`);
  go(schoolId, "Progression mise à jour.");
}

export async function addAcademyStudentFollowupAction(formData: FormData) {
  const schoolId = text(formData.get("school_id"), 80),
    enrollmentId = text(formData.get("enrollment_id"), 80);
  const { admin, user, membership } = await context();
  if (!(await assertEnrollmentPermission(admin,membership.organization_id,user.id,membership.role,schoolId,enrollmentId,"followup"))) go(schoolId,"Suivi non autorisé pour cet étudiant.","error");
  const summary = text(formData.get("summary"), 5000);
  if (summary.length < 2) go(schoolId, "Ajoute un résumé du suivi.", "error");
  const { error } = await admin
    .from("academy_student_followups")
    .insert({
      organization_id: membership.organization_id,
      enrollment_id: enrollmentId,
      employee_id: user.id,
      channel: text(formData.get("channel"), 30) || "phone",
      outcome: text(formData.get("outcome"), 30) || "follow_up",
      summary,
      next_action: text(formData.get("next_action"), 500) || null,
      next_action_on: date(formData.get("next_action_on")),
    });
  if (error) go(schoolId, error.message, "error");
  revalidatePath(`/dashboard/academy/schools/${schoolId}/students`);
  go(schoolId, "Suivi enregistré.");
}
