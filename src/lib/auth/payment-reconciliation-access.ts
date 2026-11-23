import type {SupabaseClient} from "@supabase/supabase-js";

export type PaymentReconciliationAccess = {
  allowed: boolean;
  canManageTeam: boolean;
  assignmentRole: "agent" | "supervisor" | null;
};

export async function getPaymentReconciliationAccess(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  organizationRole: string,
): Promise<PaymentReconciliationAccess> {
  const canManageTeam = organizationRole === "owner" || organizationRole === "admin";
  if (canManageTeam) return {allowed: true, canManageTeam: true, assignmentRole: "supervisor"};

  const {data, error} = await admin
    .from("payment_reconciliation_assignments")
    .select("assignment_role,is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{assignment_role: "agent" | "supervisor"; is_active: boolean}>();

  if (!error && data) {
    return {allowed: true, canManageTeam: false, assignmentRole: data.assignment_role};
  }

  // Finance team membership is itself an operational assignment. A manager of
  // the team supervises reconciliation; another active member works as an agent.
  // Explicit payment-reconciliation assignments above still take precedence.
  const financeDepartments = new Set(["finance", "finances", "financial"]);
  const [{data: managedTeams}, {data: memberTeams}] = await Promise.all([
    admin
      .from("teams")
      .select("department")
      .eq("organization_id", organizationId)
      .eq("manager_id", userId)
      .eq("is_active", true),
    admin
      .from("team_members")
      .select("teams!inner(department,organization_id,is_active)")
      .eq("user_id", userId)
      .eq("teams.organization_id", organizationId)
      .eq("teams.is_active", true),
  ]);

  const managesFinance = (managedTeams ?? []).some((team) =>
    financeDepartments.has(String(team.department ?? "").trim().toLocaleLowerCase("fr")),
  );
  if (managesFinance) return {allowed: true, canManageTeam: false, assignmentRole: "supervisor"};

  const belongsToFinance = (memberTeams ?? []).some((row) => {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return financeDepartments.has(String(team?.department ?? "").trim().toLocaleLowerCase("fr"));
  });
  if (belongsToFinance) return {allowed: true, canManageTeam: false, assignmentRole: "agent"};

  return {allowed: false, canManageTeam: false, assignmentRole: null};
}

export async function canReconcilePayments(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  organizationRole: string,
) {
  return (await getPaymentReconciliationAccess(admin, organizationId, userId, organizationRole)).allowed;
}
