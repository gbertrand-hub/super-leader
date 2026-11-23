import type {SupabaseClient} from "@supabase/supabase-js";

const FINANCE_DEPARTMENTS = new Set(["finance", "finances", "financial"]);

type FinanceSettingsAccess = {
  customer_account_access_mode: "finance_team" | "selected_users" | null;
  customer_account_user_ids: string[] | null;
};

function isFinanceDepartment(value: unknown) {
  return FINANCE_DEPARTMENTS.has(String(value ?? "").trim().toLocaleLowerCase("fr"));
}

export async function getFinanceCustomerAccountAccess(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  organizationRole: string,
) {
  if (["owner", "admin", "executive"].includes(organizationRole)) {
    return {allowed: true, mode: "leadership" as const};
  }

  const {data: settings} = await admin
    .from("finance_settings")
    .select("customer_account_access_mode,customer_account_user_ids")
    .eq("organization_id", organizationId)
    .maybeSingle<FinanceSettingsAccess>();

  const mode = settings?.customer_account_access_mode ?? "finance_team";
  if (mode === "selected_users") {
    return {allowed: (settings?.customer_account_user_ids ?? []).includes(userId), mode};
  }

  const [{data: managedTeams}, {data: memberTeams}] = await Promise.all([
    admin.from("teams").select("department").eq("organization_id", organizationId).eq("manager_id", userId).eq("is_active", true),
    admin.from("team_members").select("teams!inner(department,organization_id,is_active)").eq("user_id", userId).eq("teams.organization_id", organizationId).eq("teams.is_active", true),
  ]);

  const managesFinance = (managedTeams ?? []).some((team) => isFinanceDepartment(team.department));
  const belongsToFinance = (memberTeams ?? []).some((row) => {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return isFinanceDepartment(team?.department);
  });

  return {allowed: managesFinance || belongsToFinance, mode};
}
