import { createAdminClient } from "@/lib/supabase/admin";

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}

export function isPlatformOrganization(input: {
  organizationId?: string | null;
  organizationName?: string | null;
}): boolean {
  const configuredId = clean(process.env.SUPER_LEADER_PLATFORM_ORGANIZATION_ID);
  if (configuredId) return input.organizationId === configuredId;

  const configuredName = clean(process.env.SUPER_LEADER_PLATFORM_ORGANIZATION_NAME)
    .toLocaleLowerCase();
  const expectedName = configuredName || "ilead global";
  return clean(input.organizationName).toLocaleLowerCase() === expectedName;
}

export async function findPlatformOrganization(): Promise<{
  id: string;
  name: string;
} | null> {
  const admin = createAdminClient();
  const configuredId = clean(process.env.SUPER_LEADER_PLATFORM_ORGANIZATION_ID);

  if (configuredId) {
    const { data } = await admin
      .from("organizations")
      .select("id,name")
      .eq("id", configuredId)
      .maybeSingle<{ id: string; name: string }>();
    return data ?? null;
  }

  const configuredName = clean(process.env.SUPER_LEADER_PLATFORM_ORGANIZATION_NAME) || "iLEAD Global";
  const { data } = await admin
    .from("organizations")
    .select("id,name")
    .ilike("name", configuredName)
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();

  return data ?? null;
}
