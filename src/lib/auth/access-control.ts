import type {SupabaseClient, User} from "@supabase/supabase-js";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export const appRoles = ["owner", "admin", "hr", "manager", "employee"] as const;
export type AppRole = (typeof appRoles)[number];

export type AccessDomain =
  | "organization"
  | "people"
  | "teams"
  | "performance"
  | "schedule"
  | "finance"
  | "crm"
  | "feedbackAutomation"
  | "reports"
  | "settings";

export type AccessContext = {
  user: User;
  organizationId: string;
  role: AppRole;
  admin: SupabaseClient;
};

const roleModules: Record<AppRole, ReadonlySet<AccessDomain>> = {
  owner: new Set(["organization", "people", "teams", "performance", "schedule", "finance", "crm", "feedbackAutomation", "reports", "settings"]),
  admin: new Set(["organization", "people", "teams", "performance", "schedule", "finance", "crm", "feedbackAutomation", "reports", "settings"]),
  hr: new Set(["organization", "people", "teams", "performance", "schedule", "reports"]),
  manager: new Set(["people", "teams", "performance", "schedule", "finance", "crm", "reports"]),
  employee: new Set(["performance", "schedule", "finance", "crm"]),
};

export function normalizeRole(value: string | null | undefined): AppRole {
  return appRoles.includes(value as AppRole) ? (value as AppRole) : "employee";
}

export function canAccessDomain(role: string, domain: AccessDomain): boolean {
  return roleModules[normalizeRole(role)].has(domain);
}

export function isOrganizationAdministrator(role: string): boolean {
  return ["owner", "admin"].includes(role);
}

export function isPeopleAdministrator(role: string): boolean {
  return ["owner", "admin", "hr"].includes(role);
}

export function canManageTargetRole(actorRole: string, targetRole: string): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole !== "owner";
  if (actorRole === "hr") return ["manager", "employee"].includes(targetRole);
  return false;
}

export function assignableRolesFor(actorRole: string): AppRole[] {
  if (actorRole === "owner" || actorRole === "admin") return ["admin", "hr", "manager", "employee"];
  if (actorRole === "hr") return ["manager", "employee"];
  return [];
}

export async function requireAccessContext(domain?: AccessDomain): Promise<AccessContext> {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (membershipError || !membership) redirect("/dashboard/company");
  const role = normalizeRole(membership.role);
  if (domain && !canAccessDomain(role, domain)) redirect("/dashboard/my-day");

  return {user: authData.user, organizationId: membership.organization_id, role, admin};
}

async function loadDirectReports(admin: SupabaseClient, organizationId: string, supervisorId: string): Promise<string[]> {
  const [baseSchedules, datedSchedules] = await Promise.all([
    admin.from("member_work_schedules").select("user_id").eq("organization_id", organizationId).eq("supervisor_id", supervisorId).eq("is_active", true),
    admin.from("work_schedule_entries").select("user_id").eq("organization_id", organizationId).eq("supervisor_id", supervisorId).neq("status", "cancelled"),
  ]);
  const ids = new Set<string>();
  for (const row of baseSchedules.data ?? []) ids.add(String(row.user_id));
  for (const row of datedSchedules.data ?? []) ids.add(String(row.user_id));
  return [...ids];
}

export async function accessibleUserIds(
  context: {admin: SupabaseClient; organizationId: string; role: AppRole; user: {id: string}},
  domain: "people" | "performance" | "schedule" | "finance" | "crm" | "reports",
): Promise<string[]> {
  const {admin, organizationId, role, user} = context;
  const organizationWide = role === "owner" || role === "admin" || (role === "hr" && ["people", "performance", "schedule", "reports"].includes(domain));
  if (organizationWide) {
    let query = admin.from("organization_members").select("user_id").eq("organization_id", organizationId);
    if (domain !== "people") query = query.eq("is_active", true);
    const {data, error} = await query;
    if (error) throw error;
    return (data ?? []).map((row) => String(row.user_id));
  }
  if (role === "manager") {
    const managed = await loadDirectReports(admin, organizationId, user.id);
    return Array.from(new Set([user.id, ...managed]));
  }
  return [user.id];
}

export function restrictRequestedUserId(requestedId: string | null | undefined, allowedIds: string[], fallbackId: string): string {
  const value = String(requestedId ?? "").trim();
  return value && allowedIds.includes(value) ? value : fallbackId;
}
