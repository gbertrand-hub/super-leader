const DEFAULT_TIME_ZONE = "Europe/Dublin";

const TIME_ZONE_ALIASES: Record<string, string> = {
  "afrique centrale": "Africa/Douala",
  "central africa": "Africa/Douala",
  "central african time": "Africa/Douala",
  "w. central africa standard time": "Africa/Douala",
  cameroun: "Africa/Douala",
  cameroon: "Africa/Douala",
  douala: "Africa/Douala",
  yaounde: "Africa/Douala",
  "yaoundé": "Africa/Douala",
  dublin: "Europe/Dublin",
  ireland: "Europe/Dublin",
  irlande: "Europe/Dublin",
  dallas: "America/Chicago",
  texas: "America/Chicago",
};

export function isValidTimeZone(value: string | null | undefined) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat("en", {timeZone: candidate}).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(
  value: string | null | undefined,
  fallback: string = DEFAULT_TIME_ZONE,
) {
  const raw = String(value ?? "").trim();
  const alias = TIME_ZONE_ALIASES[raw.toLocaleLowerCase("fr")];
  const candidate = alias || raw;
  if (isValidTimeZone(candidate)) return candidate;
  if (isValidTimeZone(fallback)) return fallback;
  return DEFAULT_TIME_ZONE;
}

export const commonTimeZones = [
  "Africa/Douala",
  "Africa/Lagos",
  "Africa/Kinshasa",
  "Africa/Lubumbashi",
  "Europe/Dublin",
  "Europe/London",
  "America/Chicago",
  "America/New_York",
  "UTC",
] as const;
