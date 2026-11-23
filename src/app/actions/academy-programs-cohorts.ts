"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canEnrollStudents, getAcademyAssignments } from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const txt = (v: FormDataEntryValue | null, n = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, n);
const iso = (v: FormDataEntryValue | null) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;
const code = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
function go(
  path: string,
  message: string,
  kind: "success" | "error" = "success",
): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}
async function ctx(schoolId: string) {
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
  const assignments = await getAcademyAssignments(
    a,
    m.organization_id,
    data.user.id,
  );
  if (!canEnrollStudents(m.role, assignments, schoolId))
    throw new Error("Gestion académique non autorisée pour cette école.");
  const { data: school } = await a
    .from("academy_schools")
    .select("id")
    .eq("id", schoolId)
    .eq("organization_id", m.organization_id)
    .eq("is_active", true)
    .maybeSingle();
  if (!school) throw new Error("École introuvable.");
  return { a, u: data.user, m };
}

export async function createAcademyProgramAction(fd: FormData) {
  const schoolId = txt(fd.get("school_id"), 80),
    name = txt(fd.get("name"), 180),
    path = `/dashboard/academy/schools/${schoolId}`;
  if (name.length < 3) go(path, "Le nom du programme est trop court.", "error");
  const { a, u, m } = await ctx(schoolId);
  const duration = Number(txt(fd.get("duration_months"), 3));
  const { error } = await a.from("academy_programs").insert({
    organization_id: m.organization_id,
    school_id: schoolId,
    code: code(txt(fd.get("code"), 80) || name),
    name,
    description: txt(fd.get("description"), 2000),
    duration_months:
      Number.isInteger(duration) && duration > 0 && duration <= 120
        ? duration
        : null,
    status: "active",
    created_by: u.id,
  });
  if (error)
    go(
      path,
      error.code === "23505"
        ? "Un programme avec ce nom ou ce code existe déjà."
        : error.message,
      "error",
    );
  revalidatePath(path);
  revalidatePath("/dashboard/academy/cohorts");
  go(path, "Programme créé.");
}

export async function updateAcademyProgramAction(fd: FormData) {
  const schoolId = txt(fd.get("school_id"), 80),
    programId = txt(fd.get("program_id"), 80),
    returnTo =
      txt(fd.get("return_to"), 300) ||
      `/dashboard/academy/schools/${schoolId}`,
    name = txt(fd.get("name"), 180),
    status = txt(fd.get("status"), 20),
    allowed = ["draft", "active", "archived"];
  if (name.length < 3)
    go(returnTo, "Le nom du programme est trop court.", "error");
  if (!allowed.includes(status)) go(returnTo, "Statut invalide.", "error");
  const { a, m } = await ctx(schoolId);
  const duration = Number(txt(fd.get("duration_months"), 3));
  const { error } = await a
    .from("academy_programs")
    .update({
      name,
      code: code(txt(fd.get("code"), 80) || name),
      description: txt(fd.get("description"), 2000),
      duration_months:
        Number.isInteger(duration) && duration > 0 && duration <= 120
          ? duration
          : null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", programId)
    .eq("school_id", schoolId)
    .eq("organization_id", m.organization_id);
  if (error)
    go(
      returnTo,
      error.code === "23505"
        ? "Un autre programme utilise déjà ce nom ou ce code."
        : error.message,
      "error",
    );
  revalidatePath(returnTo);
  revalidatePath("/dashboard/academy/cohorts");
  go(returnTo, "Programme mis à jour.");
}

export async function createAcademyCohortAction(fd: FormData) {
  const schoolId = txt(fd.get("school_id"), 80),
    name = txt(fd.get("name"), 180),
    returnTo =
      txt(fd.get("return_to"), 300) || `/dashboard/academy/schools/${schoolId}`;
  if (name.length < 2)
    go(returnTo, "Le nom de la cohorte est trop court.", "error");
  const { a, u, m } = await ctx(schoolId),
    programId = txt(fd.get("program_id"), 80) || null;
  const start = iso(fd.get("starts_on")),
    end = iso(fd.get("ends_on"));
  if (start && end && end < start)
    go(returnTo, "La date de fin doit suivre la date de début.", "error");
  if (programId) {
    const { data: p } = await a
      .from("academy_programs")
      .select("id")
      .eq("id", programId)
      .eq("school_id", schoolId)
      .eq("organization_id", m.organization_id)
      .maybeSingle();
    if (!p) go(returnTo, "Programme invalide.", "error");
  }
  const capacity = Number(txt(fd.get("capacity"), 6));
  const { error } = await a.from("academy_cohorts").insert({
    organization_id: m.organization_id,
    school_id: schoolId,
    program_id: programId,
    name,
    starts_on: start,
    ends_on: end,
    capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : null,
    status: txt(fd.get("status"), 20) || "planned",
    is_staff_default: false,
    created_by: u.id,
  });
  if (error)
    go(
      returnTo,
      error.code === "23505"
        ? "Une cohorte portant ce nom existe déjà dans cette école."
        : error.message,
      "error",
    );
  revalidatePath(`/dashboard/academy/schools/${schoolId}`);
  revalidatePath("/dashboard/academy/cohorts");
  go(returnTo, "Cohorte créée.");
}

export async function updateAcademyCohortStatusAction(fd: FormData) {
  const schoolId = txt(fd.get("school_id"), 80),
    cohortId = txt(fd.get("cohort_id"), 80),
    status = txt(fd.get("status"), 20),
    allowed = ["planned", "open", "active", "completed", "archived"],
    returnTo = txt(fd.get("return_to"), 300) || "/dashboard/academy/cohorts";
  if (!allowed.includes(status)) go(returnTo, "Statut invalide.", "error");
  const { a, m } = await ctx(schoolId);
  const { error } = await a
    .from("academy_cohorts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", cohortId)
    .eq("school_id", schoolId)
    .eq("organization_id", m.organization_id);
  if (error) go(returnTo, error.message, "error");
  revalidatePath(returnTo);
  revalidatePath(`/dashboard/academy/schools/${schoolId}`);
  go(returnTo, "Statut de la cohorte mis à jour.");
}

export async function updateAcademyCohortAction(fd: FormData) {
  const schoolId = txt(fd.get("school_id"), 80),
    cohortId = txt(fd.get("cohort_id"), 80),
    returnTo = txt(fd.get("return_to"), 300) || "/dashboard/academy/cohorts",
    name = txt(fd.get("name"), 180),
    programId = txt(fd.get("program_id"), 80) || null,
    status = txt(fd.get("status"), 20),
    start = iso(fd.get("starts_on")),
    end = iso(fd.get("ends_on")),
    allowed = ["planned", "open", "active", "completed", "archived"];
  if (name.length < 2)
    go(returnTo, "Le nom de la cohorte est trop court.", "error");
  if (!allowed.includes(status)) go(returnTo, "Statut invalide.", "error");
  if (start && end && end < start)
    go(returnTo, "La date de fin doit suivre la date de début.", "error");
  const { a, m } = await ctx(schoolId);
  if (programId) {
    const { data: p } = await a
      .from("academy_programs")
      .select("id")
      .eq("id", programId)
      .eq("school_id", schoolId)
      .eq("organization_id", m.organization_id)
      .maybeSingle();
    if (!p) go(returnTo, "Programme invalide.", "error");
  }
  const capacity = Number(txt(fd.get("capacity"), 6));
  const { error } = await a
    .from("academy_cohorts")
    .update({
      name,
      program_id: programId,
      starts_on: start,
      ends_on: end,
      capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cohortId)
    .eq("school_id", schoolId)
    .eq("organization_id", m.organization_id);
  if (error)
    go(
      returnTo,
      error.code === "23505"
        ? "Une autre cohorte porte déjà ce nom."
        : error.message,
      "error",
    );
  revalidatePath(returnTo);
  revalidatePath(`/dashboard/academy/schools/${schoolId}`);
  go(returnTo, "Cohorte entièrement mise à jour.");
}
