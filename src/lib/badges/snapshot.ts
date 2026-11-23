import type {SupabaseClient} from "@supabase/supabase-js";

export const EMPLOYEE_BADGE_ADMIN_ROLES = new Set(["owner", "admin", "hr"]);

export function employeeRoleLabel(role: string, locale: "fr" | "en") {
  const labels: Record<string, {fr: string; en: string}> = {
    owner: {fr: "Propriétaire", en: "Owner"},
    admin: {fr: "Administrateur", en: "Administrator"},
    executive: {fr: "Exécutif", en: "Executive"},
    hr: {fr: "Ressources humaines", en: "Human Resources"},
    manager: {fr: "Manager", en: "Manager"},
    employee: {fr: "Collaborateur", en: "Employee"},
  };
  return labels[role]?.[locale] ?? role;
}

export type EmployeeBadgeSnapshot = {
  fullName: string;
  email: string | null;
  country: string | null;
  city: string | null;
  avatarStoragePath: string | null;
  role: string;
  roleLabel: string;
  positionTitle: string | null;
  department: string | null;
  teamName: string | null;
  organizationName: string;
};

export async function loadEmployeeBadgeSnapshot({
  admin,
  organizationId,
  userId,
  locale,
}: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  locale: "fr" | "en";
}): Promise<EmployeeBadgeSnapshot> {
  const [profileResult, membershipResult, organizationResult, contactResult, teamMembershipResult] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name,email,country,city,avatar_storage_path")
      .eq("id", userId)
      .maybeSingle<{
        full_name: string | null;
        email: string | null;
        country: string | null;
        city: string | null;
        avatar_storage_path: string | null;
      }>(),
    admin
      .from("organization_members")
      .select("role,is_active")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle<{role: string; is_active: boolean}>(),
    admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle<{name: string}>(),
    admin
      .from("employee_work_contacts")
      .select("position_title")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle<{position_title: string | null}>(),
    admin.from("team_members").select("team_id").eq("user_id", userId),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (organizationResult.error) throw new Error(organizationResult.error.message);
  if (!profileResult.data || !membershipResult.data || !organizationResult.data) {
    throw new Error(locale === "fr" ? "Le dossier du collaborateur est incomplet." : "The employee record is incomplete.");
  }
  if (!membershipResult.data.is_active) {
    throw new Error(locale === "fr" ? "Le compte du collaborateur est désactivé." : "The employee account is disabled.");
  }

  const teamIds = (teamMembershipResult.data ?? []).map((row) => String(row.team_id));
  let teams: {name: string; department: string | null}[] = [];
  if (teamIds.length) {
    const {data, error} = await admin
      .from("teams")
      .select("name,department")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("id", teamIds)
      .order("name");
    if (error) throw new Error(error.message);
    teams = (data ?? []) as {name: string; department: string | null}[];
  }

  const fullName = profileResult.data.full_name?.trim() ?? "";
  if (fullName.length < 2) {
    throw new Error(locale === "fr" ? "Le nom complet doit être renseigné avant l’émission du badge." : "A full name is required before the badge can be issued.");
  }

  const teamName = teams.map((team) => team.name).filter(Boolean).join(" · ") || null;
  const department = Array.from(new Set(teams.map((team) => team.department).filter((value): value is string => Boolean(value)))).join(" · ") || null;
  const role = membershipResult.data.role;

  return {
    fullName,
    email: profileResult.data.email,
    country: profileResult.data.country,
    city: profileResult.data.city,
    avatarStoragePath: profileResult.data.avatar_storage_path,
    role,
    roleLabel: contactResult.data?.position_title?.trim() || employeeRoleLabel(role, locale),
    positionTitle: contactResult.data?.position_title?.trim() || null,
    department,
    teamName,
    organizationName: organizationResult.data.name,
  };
}
