export type TemporaryAccessState = {
  mustChangePassword: boolean;
  expiresAt: string | null;
  expired: boolean;
};

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function readTemporaryAccessState(
  metadata: unknown,
  nowMs: number,
): TemporaryAccessState {
  const values = asMetadata(metadata);
  const mustChangePassword = values.must_change_password === true;
  const rawExpiresAt = values.temporary_password_expires_at;
  const expiresAt = typeof rawExpiresAt === "string" ? rawExpiresAt : null;
  const expiryMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;

  return {
    mustChangePassword,
    expiresAt,
    expired:
      mustChangePassword &&
      expiresAt !== null &&
      Number.isFinite(expiryMs) &&
      expiryMs <= nowMs,
  };
}
