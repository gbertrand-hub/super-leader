"use server";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {canEnrollStudents,getAcademyAssignments} from "@/lib/academy/access";
const val = (r: Record<string, unknown>, names: string[]) => {
  const entries = Object.entries(r).map(
    ([k, v]) =>
      [
        k
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, ""),
        String(v ?? "").trim(),
      ] as const,
  );
  for (const n of names) {
    const found = entries.find(([k]) => k === n);
    if (found?.[1]) return found[1];
  }
  return "";
};
const phone = (s: string) => s.replace(/\D/g, "");
const cleanImportedName = (s: string) =>
  s.replace(/^\s*\d+\s*[.)-]\s+/, "").trim();
export async function importTeachableStudentsAction(fd: FormData) {
  const schoolId = String(fd.get("school_id") || ""),
    programId = String(fd.get("program_id") || ""),
    cohortId = String(fd.get("cohort_id") || ""),
    fileName = String(fd.get("file_name") || "import"),
    returnTo = String(fd.get("return_to") || "school");
  let rows: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(String(fd.get("rows") || "[]"));
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {}
  if (!schoolId) throw new Error("Veuillez sélectionner une école.");
  if (!programId || !cohortId) throw new Error("Programme et cohorte obligatoires pour l import.");
  if (!rows.length) throw new Error("Le fichier ne contient aucune ligne à importer.");
  const s = await createClient();
  const { data } = await s.auth.getUser();
  if (!data.user) redirect("/login");
  const a = createAdminClient();
  const { data: m } = await a
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!m) throw new Error("Action non autorisée.");
  const assignments=await getAcademyAssignments(a,m.organization_id,data.user.id);
  if(!canEnrollStudents(m.role,assignments,schoolId))throw new Error("Import non autorisé dans cette école.");
  const [{ data: school }, { data: program }, { data: cohort }] = await Promise.all([
    a.from("academy_schools").select("id").eq("id", schoolId).eq("organization_id", m.organization_id).maybeSingle(),
    a.from("academy_programs").select("id").eq("id", programId).eq("organization_id", m.organization_id).eq("school_id", schoolId).maybeSingle(),
    a.from("academy_cohorts").select("id,program_id").eq("id", cohortId).eq("organization_id", m.organization_id).eq("school_id", schoolId).maybeSingle<any>(),
  ]);
  if (!school || !program || !cohort) throw new Error("École, programme ou cohorte introuvable.");
  if (cohort.program_id && String(cohort.program_id) !== programId) throw new Error("La cohorte sélectionnée appartient à un autre programme.");
  let created = 0,
    reused = 0,
    enrolled = 0,
    skipped = 0,
    conflicts = 0;
  const report: unknown[] = [];
  for (const [index, row] of rows.slice(0, 1000).entries()) {
    const fullName = cleanImportedName(
        val(row, ["nometprenom", "nomcomplet", "fullname", "name"]),
      ),
      email = val(row, ["email", "courriel"]).toLowerCase(),
      rawPhone = val(row, ["telephone", "phone", "tel"]),
      digits = phone(rawPhone),
      training = val(row, ["formation", "course", "cours"]),
      enrolledOn = val(row, [
        "datedinscription",
        "dateinscription",
        "enrollmentdate",
        "enrolledat",
      ]);
    if (!fullName || (!email && !digits)) {
      conflicts++;
      report.push({
        row: index + 2,
        status: "conflict",
        reason: "Nom et email/téléphone obligatoires",
      });
      continue;
    }
    const [{ data: byEmail }, { data: allPhones }] = await Promise.all([
      email
        ? a
            .from("crm_clients")
            .select("id")
            .eq("organization_id", m.organization_id)
            .ilike("email", email)
            .limit(1)
            .maybeSingle<{ id: string }>()
        : { data: null },
      digits
        ? a
            .from("crm_clients")
            .select("id,phone,whatsapp_phone")
            .eq("organization_id", m.organization_id)
            .limit(5000)
        : { data: [] },
    ]);
    const phoneMatches = (allPhones ?? []).filter((x) =>
      [x.phone, x.whatsapp_phone].some(
        (v) => phone(String(v ?? "")) === digits,
      ),
    );
    if (
      byEmail &&
      phoneMatches.length &&
      phoneMatches.every((x) => x.id !== byEmail.id)
    ) {
      conflicts++;
      report.push({
        row: index + 2,
        status: "conflict",
        reason: "Email et téléphone liés à deux contacts",
      });
      continue;
    }
    let clientId = byEmail?.id || phoneMatches[0]?.id;
    if (clientId) reused++;
    else {
      const { data: c, error } = await a
        .from("crm_clients")
        .insert({
          organization_id: m.organization_id,
          reference: `TEA-${randomUUID().slice(0, 8).toUpperCase()}`,
          full_name: fullName,
          email: email || null,
          phone: rawPhone || null,
          preferred_language: "fr",
          preferred_feedback_channel: email ? "email" : "whatsapp",
          feedback_opt_in: false,
          source: "other",
          status: "active",
          notes: `Import Teachable · ${training}`,
          created_by: data.user.id,
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !c) {
        conflicts++;
        report.push({
          row: index + 2,
          status: "conflict",
          reason: error?.message || "Création impossible",
        });
        continue;
      }
      clientId = c.id;
      created++;
    }
    const { data: existing } = await a
      .from("academy_school_enrollments")
      .select("id")
      .eq("school_id", schoolId)
      .eq("crm_client_id", clientId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      skipped++;
      report.push({
        row: index + 2,
        status: "skipped",
        reason: "Déjà inscrit",
      });
      continue;
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(enrolledOn)
      ? enrolledOn
      : new Date().toISOString().slice(0, 10);
    const { data: e, error } = await a
      .from("academy_school_enrollments")
      .insert({
        organization_id: m.organization_id,
        school_id: schoolId,
        program_id: programId,
        cohort_id: cohortId,
        crm_client_id: clientId,
        academic_status: "active",
        source: "import",
        source_type: "import",
        enrolled_on: date,
        notes: training ? `Formation Teachable : ${training}` : null,
        created_by: data.user.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !e) {
      conflicts++;
      continue;
    }
    await Promise.all([
      a
        .from("academy_student_finance")
        .insert({
          organization_id: m.organization_id,
          enrollment_id: e.id,
          is_internal_training: false,
          agreed_amount: 0,
          payment_status: "not_started",
          created_by: data.user.id,
        }),
      a
        .from("academy_student_progress")
        .insert({
          organization_id: m.organization_id,
          enrollment_id: e.id,
          training_status: "active",
          risk_level: "low",
          current_module: training || null,
          updated_by: data.user.id,
        }),
    ]);
    const { error: syncError } = await a.rpc("sync_academy_inherited_finance", { target_enrollment_id: e.id });
    if (syncError) { conflicts++; report.push({ row: index + 2, status: "conflict", reason: syncError.message }); continue; }
    enrolled++;
  }
  await a
    .from("academy_teachable_imports")
    .insert({
      organization_id: m.organization_id,
      school_id: schoolId,
      file_name: fileName,
      total_rows: rows.length,
      contacts_created: created,
      contacts_reused: reused,
      enrollments_created: enrolled,
      duplicates_skipped: skipped,
      conflicts_count: conflicts,
      imported_by: data.user.id,
      report,
    });
  const message = `Import terminé : ${enrolled} inscrit(s), ${created} contact(s) créé(s), ${reused} réutilisé(s), ${skipped} doublon(s), ${conflicts} conflit(s).`;
  const destination =
    returnTo === "directory"
      ? "/dashboard/academy/students"
      : `/dashboard/academy/schools/${schoolId}/students`;
  redirect(`${destination}?success=${encodeURIComponent(message)}`);
}
