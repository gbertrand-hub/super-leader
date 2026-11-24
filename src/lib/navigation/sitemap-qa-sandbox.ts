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
