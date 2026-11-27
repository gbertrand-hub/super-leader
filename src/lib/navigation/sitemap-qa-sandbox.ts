/** The isolated Canton QA database contains only the tables needed for the
 * Canton test flow, not the entire Super Leader schema. When this separate
 * Smart Sitemap branch points to that database locally, keep QA navigation
 * inside the sitemap instead of executing unsupported production modules.
 *
 * Do not enable this mode in Vercel (preview or production) or when connected
 * to any other Supabase project.
 */
export function isSitemapLocalQaSandbox(): boolean {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL_ENV) return false;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.origin === "https://xehstmnqljjhacjiukvc.supabase.co";
  } catch {
    return false;
  }
}

/** For Next.js proxy: request-host scoping is stronger than relying on
 * NODE_ENV or a copied VERCEL_ENV variable in local .env.local. Only the
 * dedicated isolated QA project on a loopback host enters sitemap-only mode.
 * Neither production nor Vercel deployment hosts satisfy this predicate.
 */
export function isSitemapLocalQaRequest(hostname: string): boolean {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase())) return false;
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").origin ===
      "https://xehstmnqljjhacjiukvc.supabase.co";
  } catch {
    return false;
  }
}
