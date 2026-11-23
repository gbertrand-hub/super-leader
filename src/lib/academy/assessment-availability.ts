import { normalizeTimeZone } from "@/lib/timezone";

export type AssessmentAvailabilitySource = {
  status: string;
  opens_at?: string | null;
  closes_at?: string | null;
};

export type AssessmentAvailability =
  | "draft"
  | "scheduled"
  | "open"
  | "closed"
  | "archived";

export function assessmentAvailability(
  assessment: AssessmentAvailabilitySource,
  now = new Date(),
): AssessmentAvailability {
  if (assessment.status === "archived") return "archived";
  if (assessment.status === "closed") return "closed";
  if (assessment.status !== "open") return "draft";

  const nowMs = now.getTime();
  const opensMs = assessment.opens_at
    ? new Date(assessment.opens_at).getTime()
    : null;
  const closesMs = assessment.closes_at
    ? new Date(assessment.closes_at).getTime()
    : null;

  if (opensMs !== null && Number.isFinite(opensMs) && nowMs < opensMs) {
    return "scheduled";
  }
  if (closesMs !== null && Number.isFinite(closesMs) && nowMs >= closesMs) {
    return "closed";
  }
  return "open";
}

export function isAssessmentOpen(
  assessment: AssessmentAvailabilitySource,
  now = new Date(),
) {
  return assessmentAvailability(assessment, now) === "open";
}

export function zonedLocalToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const desired = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let guess = desired;
  const zone = normalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    guess += desired - represented;
  }

  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

export function isoToZonedLocalInput(
  value: string | null | undefined,
  timeZone: string,
) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: normalizeTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatAssessmentDateTime(
  value: string | null | undefined,
  timeZone: string,
  locale = "fr-FR",
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
}
