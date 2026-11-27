"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { academyGlobalRoles, canEnrollStudents, getAcademyAssignments } from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canEnrollInSchoolCohort } from "@/lib/academy/cohort-compatibility";

const txt = (v: FormDataEntryValue | null, n = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, n);
function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(
    `/dashboard/academy/students?${kind}=${encodeURIComponent(message)}`,
  );
}

export type AcademyCrmStudentSearchResult = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string | null;
};

export async function searchAcademyCrmStudentsAction(
  query: string,
): Promise<{ results: AcademyCrmStudentSearchResult[]; error?: string }> {
  const raw = String(query ?? "").trim();
  const term = raw
    .replace(/[,%_()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (term.length < 2) return { results: [] };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { results: [], error: "Session expirÃ©e. Reconnectez-vous." };
  }

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (membershipError || !membership) {
    return { results: [], error: "Recherche non autorisÃ©e." };
  }

  const assignments = await getAcademyAssignments(
    admin,
    membership.organization_id,
    auth.user.id,
  );
  const canSearch =
    academyGlobalRoles.has(membership.role) ||
    assignments.some((item) =>
      ["director", "academic_coordinator"].includes(item.assignment_role),
    );
  if (!canSearch) {
    return { results: [], error: "Recherche non autorisÃ©e." };
  }

  const pattern = `%${term}%`;
  const { data, error } = await admin
    .from("crm_clients")
    .select("id,full_name,email,phone,whatsapp_phone,status")
    .eq("organization_id", membership.organization_id)
    .or(
      `full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},whatsapp_phone.ilike.${pattern}`,
    )
    .order("full_name")
    .limit(12);
  if (error) {
    return {
      results: [],
      error: "La recherche est momentanÃ©ment indisponible.",
    };
  }

  return {
    results: (data ?? []).map((item) => ({
      id: String(item.id),
      fullName: String(item.full_name),
      email: item.email ? String(item.email) : null,
      phone: item.phone
        ? String(item.phone)
        : item.whatsapp_phone
          ? String(item.whatsapp_phone)
          : null,
      status: item.status ? String(item.status) : null,
    })),
  };
}
export async function enrollExistingStudentInSchoolsAction(fd: FormData) {
  const clientId = txt(fd.get("crm_client_id"), 80),
    schoolIds = [
      ...new Set(
        fd
          .getAll("school_ids")
          .map((x) => txt(x, 80))
          .filter(Boolean),
      ),
    ],
    followUpUserId = txt(fd.get("follow_up_user_id"), 80) || null;
  if (!clientId || !schoolIds.length)
    go("Sélectionne un étudiant et au moins une école.", "error");
  const s = await createClient(),
    { data: auth } = await s.auth.getUser();
  if (!auth.user) redirect("/login");
  const a = createAdminClient(),
    { data: m } = await a
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ organization_id: string; role: string }>();
  if (!m) go("Action non autorisée.", "error");
  const assignments = await getAcademyAssignments(
      a,
      m.organization_id,
      auth.user.id,
    ),
    allowedSchoolIds = schoolIds.filter((id) =>
      canEnrollStudents(m.role, assignments, id),
    );
  if (!allowedSchoolIds.length)
    go(
      "Aucune des écoles choisies ne peut être gérée avec votre affectation.",
      "error",
    );
  const [{ data: client }, { data: schools }, { data: follower }] =
    await Promise.all([
      a
        .from("crm_clients")
        .select("id,linked_user_id")
        .eq("id", clientId)
        .eq("organization_id", m.organization_id)
        .maybeSingle(),
      a
        .from("academy_schools")
        .select("id")
        .eq("organization_id", m.organization_id)
        .eq("is_active", true)
        .in("id", allowedSchoolIds),
      followUpUserId
        ? a
            .from("organization_members")
            .select("user_id")
            .eq("organization_id", m.organization_id)
            .eq("user_id", followUpUserId)
            .eq("is_active", true)
            .maybeSingle()
        : { data: null },
    ]);
  if (!client) go("Contact CRM introuvable.", "error");
  if (followUpUserId && !follower)
    go("Responsable de suivi invalide.", "error");
  const { data: identityLinks } = await a
    .from("person_identity_associations")
    .select("primary_user_id,related_user_id")
    .eq("organization_id", m.organization_id)
    .eq("crm_client_id", clientId)
    .eq("status", "active");
  const identityUserIds = [
    ...new Set(
      [
        client.linked_user_id,
        ...(identityLinks ?? []).flatMap((link) => [
          link.primary_user_id,
          link.related_user_id,
        ]),
      ]
        .filter(Boolean)
        .map(String),
    ),
  ];
  let created = 0,
    skipped = 0,
    failed = 0;
  for (const school of schools ?? []) {
    const schoolId = String(school.id),
      programId = txt(fd.get(`program_${schoolId}`), 80),
      cohortId = txt(fd.get(`cohort_${schoolId}`), 80),
      existingQuery = a
        .from("academy_school_enrollments")
        .select("id")
        .eq("organization_id", m.organization_id)
        .eq("school_id", schoolId),
      { data: existing } = await (identityUserIds.length
        ? existingQuery.or(
            `crm_client_id.eq.${clientId},user_id.in.(${identityUserIds.join(",")})`,
          )
        : existingQuery.eq("crm_client_id", clientId))
        .limit(1)
        .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    if (!programId || !cohortId) { failed++; continue; }
    const [{ data: validProgram }, { data: validCohort }] = await Promise.all([
      a.from("academy_programs").select("id,school_id,status").eq("id", programId).eq("organization_id", m.organization_id).eq("school_id", schoolId).maybeSingle<{id:string;school_id:string;status:string|null}>(),
      a.from("academy_cohorts").select("id,school_id,program_id,status").eq("id", cohortId).eq("organization_id", m.organization_id).eq("school_id", schoolId).maybeSingle<{id:string;school_id:string;program_id:string|null;status:string|null}>(),
    ]);
    // A promotion may serve the school's normal and staff programs.
    // Validate the actual school and active state, not cohort.program_id equality.
    if (!canEnrollInSchoolCohort(schoolId, validProgram, validCohort)) { failed++; continue; }
    const { data: enrollment, error } = await a
      .from("academy_school_enrollments")
      .insert({
        organization_id: m.organization_id,
        school_id: schoolId,
        program_id: programId,
        cohort_id: cohortId,
        crm_client_id: clientId,
        academic_status: "active",
        source: "manual",
        source_type: "crm",
        assigned_follow_up_user_id: followUpUserId,
        created_by: auth.user.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !enrollment) {
      failed++;
      continue;
    }
    const [finance, progress] = await Promise.all([
      a
        .from("academy_student_finance")
        .insert({
          organization_id: m.organization_id,
          enrollment_id: enrollment.id,
          is_internal_training: false,
          agreed_amount: 0,
          payment_status: "not_started",
          created_by: auth.user.id,
        }),
      a
        .from("academy_student_progress")
        .insert({
          organization_id: m.organization_id,
          enrollment_id: enrollment.id,
          training_status: "not_started",
          risk_level: "low",
          updated_by: auth.user.id,
        }),
    ]);
    if (finance.error || progress.error) {
      await a.from("academy_school_enrollments").delete().eq("id", enrollment.id);
      failed++;
      continue;
    }
    const { error: syncError } = await a.rpc("sync_academy_inherited_finance", { target_enrollment_id: enrollment.id });
    if (syncError) { failed++; continue; }
    created++;
  }
  revalidatePath("/dashboard/academy/students");
  go(
    `${created} inscription(s) créée(s), ${skipped} déjà existante(s)${failed ? `, ${failed} échec(s) — vérifiez le programme et la cohorte actifs de la même école` : ""}.`,
    failed > 0 && created === 0 ? "error" : "success",
  );
}

export async function assignAcademyStudentFollowerAction(fd: FormData) {
  const enrollmentId = txt(fd.get("enrollment_id"), 80),
    schoolId = txt(fd.get("school_id"), 80),
    followUpUserId = txt(fd.get("follow_up_user_id"), 80) || null;
  const s = await createClient(),
    { data: auth } = await s.auth.getUser();
  if (!auth.user) redirect("/login");
  const a = createAdminClient(),
    { data: m } = await a
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ organization_id: string; role: string }>();
  if (!m) go("Action non autorisée.", "error");
  const assignments = await getAcademyAssignments(
    a,
    m.organization_id,
    auth.user.id,
  );
  if (!canEnrollStudents(m.role, assignments, schoolId))
    go("Affectation non autorisée dans cette école.", "error");
  if (followUpUserId) {
    const { data: f } = await a
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", m.organization_id)
      .eq("user_id", followUpUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (!f) go("Responsable invalide.", "error");
  }
  const { error } = await a
    .from("academy_school_enrollments")
    .update({
      assigned_follow_up_user_id: followUpUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId)
    .eq("school_id", schoolId)
    .eq("organization_id", m.organization_id);
  if (error) go(error.message, "error");
  revalidatePath("/dashboard/academy/students");
  go("Responsable de suivi mis à jour.");
}
