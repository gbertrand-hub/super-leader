export type PersonIdentityAssociation = {
  primary_user_id: string;
  crm_client_id: string;
  related_user_id: string | null;
  status: string;
};

export function createCanonicalPersonResolver(associations: PersonIdentityAssociation[]) {
  const active = associations.filter((row) => row.status === "active");
  const primaryByClient = new Map(active.map((row) => [row.crm_client_id, row.primary_user_id]));
  const primaryByUser = new Map<string, string>();
  for (const row of active) {
    primaryByUser.set(row.primary_user_id, row.primary_user_id);
    if (row.related_user_id) primaryByUser.set(row.related_user_id, row.primary_user_id);
  }
  return {
    key(input: { userId?: string | null; crmClientId?: string | null }) {
      if (input.crmClientId && primaryByClient.has(input.crmClientId)) return `person:${primaryByClient.get(input.crmClientId)}`;
      if (input.userId && primaryByUser.has(input.userId)) return `person:${primaryByUser.get(input.userId)}`;
      if (input.crmClientId) return `crm:${input.crmClientId}`;
      return `user:${input.userId ?? "unknown"}`;
    },
    primaryUserForClient(clientId: string) { return primaryByClient.get(clientId) ?? null; },
    active,
  };
}
