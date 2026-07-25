function cleanEnvValue(value: string | undefined): string {
  if (!value) return "";

  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

export function getSupabasePublicConfig() {
  const rawUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = cleanEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!rawUrl || !publishableKey) {
    throw new Error(
      "Supabase configuration missing: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid absolute URL.");
  }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use http or https.");
  }

  const url = rawUrl.replace(/\/+$/, "");

  return {
    url,
    publishableKey,
  };
}

export function getSiteUrl(): string {
  const configured = cleanEnvValue(process.env.NEXT_PUBLIC_SITE_URL);
  return (configured || "http://localhost:3002").replace(/\/+$/, "");
}

export function getSupabaseServiceRoleKey(): string {
  const key = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return key;
}
