export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "executive",
  "hr",
  "manager",
  "employee",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const PEOPLE_ADMIN_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "hr",
]);

export const TEAM_MANAGER_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "executive",
  "hr",
  "manager",
]);

export const TEAM_STRUCTURE_ADMIN_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
]);

export const TEAM_ASSIGNMENT_ADMIN_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "hr",
]);

export const TEAM_MEMBER_ASSIGNMENT_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "hr",
  "manager",
]);

// A team responsibility is distinct from the member's organization-wide role.
// HR and executive leaders must not be downgraded to "manager" merely to lead a team.
export const TEAM_LEADER_ELIGIBLE_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "executive",
  "hr",
  "manager",
]);

export const ORGANIZATION_WIDE_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
]);

export const HR_PERFORMANCE_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "hr",
]);

export const COMMERCIAL_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "hr",
  "manager",
  "employee",
]);

export const COMMERCIAL_MANAGER_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "manager",
]);

export const FINANCE_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
]);

export const PRODUCT_MANAGER_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
]);

export const REPORT_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "executive",
  "hr",
  "manager",
]);

export function normalizeOrganizationRole(role: string | null | undefined): OrganizationRole {
  return ORGANIZATION_ROLES.includes(role as OrganizationRole)
    ? (role as OrganizationRole)
    : "employee";
}

export function isPeopleAdmin(role: string | null | undefined): boolean {
  return PEOPLE_ADMIN_ROLES.has(normalizeOrganizationRole(role));
}

export function isTeamManager(role: string | null | undefined): boolean {
  return TEAM_MANAGER_ROLES.has(normalizeOrganizationRole(role));
}

export function canManageTeamStructure(role: string | null | undefined): boolean {
  return TEAM_STRUCTURE_ADMIN_ROLES.has(normalizeOrganizationRole(role));
}

export function canManageTeamAssignments(role: string | null | undefined): boolean {
  return TEAM_ASSIGNMENT_ADMIN_ROLES.has(normalizeOrganizationRole(role));
}

export function canManageTeamMembers(role: string | null | undefined): boolean {
  return TEAM_MEMBER_ASSIGNMENT_ROLES.has(normalizeOrganizationRole(role));
}

export function canBeAssignedTeamManager(role: string | null | undefined): boolean {
  return TEAM_LEADER_ELIGIBLE_ROLES.has(normalizeOrganizationRole(role));
}

export function hasOrganizationWideAccess(role: string | null | undefined): boolean {
  return ORGANIZATION_WIDE_ROLES.has(normalizeOrganizationRole(role));
}

export function canUseCommercialModules(role: string | null | undefined): boolean {
  return COMMERCIAL_ROLES.has(normalizeOrganizationRole(role));
}

export function canManageCommercialData(role: string | null | undefined): boolean {
  return COMMERCIAL_MANAGER_ROLES.has(normalizeOrganizationRole(role));
}

export function canManageFinance(role: string | null | undefined): boolean {
  return FINANCE_ROLES.has(normalizeOrganizationRole(role));
}

export function canManageProducts(role: string | null | undefined): boolean {
  return PRODUCT_MANAGER_ROLES.has(normalizeOrganizationRole(role));
}
