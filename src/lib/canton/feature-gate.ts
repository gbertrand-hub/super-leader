/** Fail closed until a dedicated database and auth environment have been validated. */
export function assertCantonLive(): void {
  if (process.env.CANTON_VISITOR_ENABLE_LIVE !== "true") {
    throw new Error("Canton Visitor Center is not enabled in this environment.");
  }
}
export function cantonLiveEnabled(): boolean {
  return process.env.CANTON_VISITOR_ENABLE_LIVE === "true";
}
