import { createClient } from "@supabase/supabase-js";

function cleanEnvironmentValue(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['\"]|['\"]$/g, "");
}

export function createAdminClient() {
  const url = cleanEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");

  // Temporary compatibility path for the current hosted Auth issue affecting
  // some sb_secret_ admin requests. Prefer the legacy service_role JWT when set.
  const legacyServiceRoleKey = cleanEnvironmentValue(
    process.env.SUPABASE_LEGACY_SERVICE_ROLE_KEY,
  );
  const configuredAdminKey = cleanEnvironmentValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const adminKey = legacyServiceRoleKey || configuredAdminKey;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL manquante dans .env.local");
  }

  if (!adminKey) {
    throw new Error(
      "Clé administrateur Supabase manquante. Ajoute SUPABASE_LEGACY_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_ROLE_KEY dans .env.local.",
    );
  }

  if (adminKey.startsWith("sb_publishable_")) {
    throw new Error(
      "La clé administrateur ne peut pas être une clé publishable. Utilise la clé legacy service_role ou la clé sb_secret_ côté serveur.",
    );
  }

  return createClient(url, adminKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
