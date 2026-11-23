import "server-only";

import type {User} from "@supabase/supabase-js";
import {createAdminClient} from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type AcademyStudentAccessResult = {
  userId: string;
  email: string;
  invited: boolean;
  linkedEnrollments: number;
  auditWarning?: string;
};

function cleanUrl(value?: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "");
  return normalized || null;
}

function applicationUrl() {
  const configured = cleanUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;

  const productionDomain = cleanUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (productionDomain) return `https://${productionDomain.replace(/^https?:\/\//, "")}`;

  const deploymentDomain = cleanUrl(process.env.VERCEL_URL);
  if (deploymentDomain) return `https://${deploymentDomain.replace(/^https?:\/\//, "")}`;

  return "http://localhost:3002";
}

async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
  const {data: profiles, error: profileError} = await admin
    .from("profiles")
    .select("id,email")
    .ilike("email", email)
    .limit(2);

  if (profileError) throw new Error(profileError.message);
  if ((profiles ?? []).length > 1) {
    throw new Error("Plusieurs profils utilisent cette adresse email. Une vérification administrative est nécessaire.");
  }

  const profileId = profiles?.[0]?.id ? String(profiles[0].id) : "";
  if (profileId) {
    const {data, error} = await admin.auth.admin.getUserById(profileId);
    if (error) throw new Error(error.message);
    return data.user ?? null;
  }

  for (let page = 1; page <= 20; page += 1) {
    const {data, error} = await admin.auth.admin.listUsers({page, perPage: 200});
    if (error) throw new Error(error.message);
    const match = data.users.find((user) => String(user.email ?? "").toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) break;
  }

  return null;
}

export async function ensureAcademyStudentAccess(input: {
  organizationId: string;
  crmClientId: string;
  actorId: string;
  enrollmentIds?: string[];
}): Promise<AcademyStudentAccessResult> {
  const admin = createAdminClient();
  const {data: client, error: clientError} = await admin
    .from("crm_clients")
    .select("id,full_name,email")
    .eq("id", input.crmClientId)
    .eq("organization_id", input.organizationId)
    .maybeSingle<{id: string; full_name: string | null; email: string | null}>();

  if (clientError || !client) {
    throw new Error(clientError?.message || "Fiche CRM introuvable.");
  }

  const email = String(client.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Une adresse email valide est obligatoire pour créer l’accès étudiant.");
  }

  let enrollmentQuery = admin
    .from("academy_school_enrollments")
    .select("id,user_id")
    .eq("organization_id", input.organizationId)
    .eq("crm_client_id", input.crmClientId);

  if (input.enrollmentIds?.length) {
    enrollmentQuery = enrollmentQuery.in("id", input.enrollmentIds);
  }

  const {data: enrollments, error: enrollmentError} = await enrollmentQuery;
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (!(enrollments ?? []).length) throw new Error("Aucune inscription Academy à rattacher.");

  const existingUserIds = [
    ...new Set((enrollments ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean)),
  ];
  if (existingUserIds.length > 1) {
    throw new Error("Ces inscriptions sont déjà liées à plusieurs comptes. Une vérification administrative est nécessaire.");
  }

  let user: User | null = null;
  if (existingUserIds[0]) {
    const {data, error} = await admin.auth.admin.getUserById(existingUserIds[0]);
    if (error) throw new Error(error.message);
    user = data.user ?? null;
  } else {
    user = await findAuthUserByEmail(admin, email);
  }
  let invited = false;

  if (!user) {
    const nextPath = "/update-password";
    const redirectTo = `${applicationUrl()}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const {data, error} = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        full_name: String(client.full_name ?? "Étudiant").trim() || "Étudiant",
        academy_student: true,
      },
    });
    if (error || !data.user) {
      throw new Error(error?.message || "Invitation étudiante impossible.");
    }
    user = data.user;
    invited = true;

    const {error: profileCreateError} = await admin.from("profiles").upsert({
      id: user.id,
      email,
      full_name: String(client.full_name ?? "Étudiant").trim() || "Étudiant",
    });
    if (profileCreateError) throw new Error(profileCreateError.message);
  }

  const enrollmentIds = (enrollments ?? []).map((row) => String(row.id));
  const {data: linked, error: linkError} = await admin
    .from("academy_school_enrollments")
    .update({user_id: user.id, updated_at: new Date().toISOString()})
    .eq("organization_id", input.organizationId)
    .eq("crm_client_id", input.crmClientId)
    .in("id", enrollmentIds)
    .select("id");

  if (linkError) throw new Error(linkError.message);
  if ((linked ?? []).length !== enrollmentIds.length) {
    throw new Error("Toutes les inscriptions n’ont pas pu être rattachées au compte étudiant.");
  }

  const action = invited ? "account_invited" : existingUserIds.length ? "enrollments_linked" : "existing_account_linked";
  const {error: auditError} = await admin.from("academy_student_access_audit_log").insert({
    organization_id: input.organizationId,
    crm_client_id: input.crmClientId,
    student_user_id: user.id,
    actor_id: input.actorId,
    action,
    enrollment_ids: enrollmentIds,
    details: {email, invited},
  });

  return {
    userId: user.id,
    email,
    invited,
    linkedEnrollments: enrollmentIds.length,
    auditWarning: auditError?.message,
  };
}
