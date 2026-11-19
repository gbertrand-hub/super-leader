/** Stage-only kill switch: never use the existing production Supabase keys for Canton test writes. */
const QA_PROJECT_REF = "xehstmnqljjhacjiukvc";
export function cantonLiveEnabled(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let projectRef = "";
  try { projectRef = new URL(url).hostname.split(".")[0] || ""; } catch { return false; }
  return process.env.CANTON_VISITOR_ENABLE_LIVE === "true"
    && process.env.VERCEL_ENV === "preview"
    && projectRef === QA_PROJECT_REF
    && process.env.CANTON_TEST_DATABASE_READY === "true";
}
export function assertCantonLive(): void {
  if (!cantonLiveEnabled()) {
    throw new Error("Canton live operations are disabled until an isolated preview database and auth have passed acceptance.");
  }
}
