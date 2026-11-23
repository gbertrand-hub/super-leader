/** Canton rollout gate.
 * Preview QA remains isolated. Production stays fail-closed until both
 * the production schema and the explicit production release flag are ready.
 */
const QA_PROJECT_REF = "xehstmnqljjhacjiukvc";
const PROD_PROJECT_REF = "jjbuxrlvxnlnrjcorpwt";
const QA_GIT_BRANCH = "feature/canton-visitor-v4-10-132";

function projectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try { return new URL(url).hostname.split(".")[0] || ""; } catch { return ""; }
}

/** Login-only QA test remains branch-scoped and isolated from production. */
export function cantonAuthTestEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview"
    && projectRef() === QA_PROJECT_REF
    && process.env.VERCEL_GIT_COMMIT_REF === QA_GIT_BRANCH;
}

/** Production activation requires explicit database readiness AND release approval. */
export function cantonProductionEnabled(): boolean {
  return process.env.VERCEL_ENV === "production"
    && projectRef() === PROD_PROJECT_REF
    && process.env.CANTON_VISITOR_ENABLE_LIVE === "true"
    && process.env.CANTON_PRODUCTION_DATABASE_READY === "true"
    && process.env.CANTON_PRODUCTION_RELEASE_APPROVED === "true";
}

/** Local QA write test: fail closed on every production or hosted environment.
 * Intentionally only exists on test/v4-10-139-local-qa-write.
 * Never enable local writes while pointing at the production project.
 */
export function cantonLocalQaWriteEnabled(): boolean {
  return process.env.NODE_ENV === "development"
    && !process.env.VERCEL_ENV
    && projectRef() === QA_PROJECT_REF
    && process.env.CANTON_LOCAL_QA_WRITE_ENABLED === "true"
    && process.env.CANTON_VISITOR_ENABLE_LIVE === "true"
    && process.env.CANTON_TEST_DATABASE_READY === "true";
}

export function cantonLiveEnabled(): boolean {
  const qaLive = cantonAuthTestEnabled()
    && process.env.CANTON_VISITOR_ENABLE_LIVE === "true"
    && process.env.CANTON_TEST_DATABASE_READY === "true";

  return cantonLocalQaWriteEnabled() || qaLive || cantonProductionEnabled();
}


/** Local recovery preview: allows the Canton UI to render without enabling
 * operational write actions. Server actions continue to use assertCantonLive().
 */
export function cantonUiPreviewEnabled(): boolean {
  return cantonLiveEnabled()
    || process.env.CANTON_LOCAL_UI_PREVIEW === "true";
}
export function assertCantonLive(): void {
  if (!cantonLiveEnabled()) {
    throw new Error("Visitor & Appointment Management is disabled until the target database and release gate are approved.");
  }
}
