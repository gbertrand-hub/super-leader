import type {SupabaseClient} from "@supabase/supabase-js";

const SENSITIVE_ROLES = new Set(["owner", "admin", "hr"]);
const SENSITIVE_DEPARTMENTS = new Set([
  "finance",
  "finances",
  "financial",
  "rh",
  "hr",
  "human resources",
  "ressources humaines",
]);

const FINANCE_DEPARTMENTS = new Set(["finance", "finances", "financial"]);

export async function canVerifySalesForFinance(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
) {
  if (["owner", "admin"].includes(role)) return true;

  const [{data: managedTeams, error: managedError}, {data: memberTeams, error: memberError}] = await Promise.all([
    admin.from("teams").select("department").eq("organization_id", organizationId).eq("manager_id", userId).eq("is_active", true),
    admin.from("team_members").select("teams!inner(department,organization_id,is_active)").eq("user_id", userId).eq("teams.organization_id", organizationId).eq("teams.is_active", true),
  ]);
  if (managedError || memberError) return false;

  const departments = [
    ...(managedTeams ?? []).map((team) => team.department),
    ...(memberTeams ?? []).map((row) => {
      const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
      return team?.department;
    }),
  ];
  return departments.some((department) => FINANCE_DEPARTMENTS.has(String(department ?? "").trim().toLocaleLowerCase("fr")));
}

export async function canManageCommissions(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
) {
  return canVerifySalesForFinance(admin, organizationId, userId, role);
}

export async function canManageSensitiveFinanceData(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
) {
  if (SENSITIVE_ROLES.has(role)) return true;
  if (role !== "manager") return false;

  const {data, error} = await admin
    .from("teams")
    .select("department")
    .eq("organization_id", organizationId)
    .eq("manager_id", userId)
    .eq("is_active", true);

  if (error) return false;
  return (data ?? []).some((team) =>
    SENSITIVE_DEPARTMENTS.has(String(team.department ?? "").trim().toLocaleLowerCase("fr")),
  );
}
