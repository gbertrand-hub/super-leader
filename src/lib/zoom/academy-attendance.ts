import type {ZoomMeetingRegistrant, ZoomPastMeetingInstance, ZoomPastParticipant} from "@/lib/zoom/client";

export type AcademyZoomClassification = "present" | "late" | "partial" | "absent";

export type AggregatedZoomParticipant = {
  key: string;
  registrantId: string | null;
  zoomUserId: string | null;
  email: string | null;
  name: string;
  firstJoinAt: string | null;
  lastLeaveAt: string | null;
  durationMinutes: number;
  rawSegments: ZoomPastParticipant[];
};

export function normalizeZoomMeetingId(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 12);
}

export function extractZoomMeetingId(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const pathMatch = raw.match(/zoom\.[^/]+\/j\/(\d{9,12})/i) || raw.match(/\/j\/(\d{9,12})/i);
  if (pathMatch?.[1]) return normalizeZoomMeetingId(pathMatch[1]);
  const digits = normalizeZoomMeetingId(raw);
  return digits.length >= 9 ? digits : "";
}

export function normalizeAttendanceEmail(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.includes("@") ? normalized : "";
}

function participantEmail(participant: ZoomPastParticipant) {
  return normalizeAttendanceEmail(participant.user_email || participant.email);
}

function participantName(participant: ZoomPastParticipant) {
  return String(participant.name || participant.user_name || "Participant Zoom").trim() || "Participant Zoom";
}

function participantMinutes(participant: ZoomPastParticipant) {
  const seconds = Number(participant.duration || 0);
  if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;
  if (!participant.join_time || !participant.leave_time) return 0;
  const start = new Date(participant.join_time).getTime();
  const end = new Date(participant.leave_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 60000;
}

export function aggregateZoomParticipants(
  participants: ZoomPastParticipant[],
  registrants: ZoomMeetingRegistrant[],
): AggregatedZoomParticipant[] {
  const registrantEmail = new Map<string, string>();
  for (const registrant of registrants) {
    const id = String(registrant.id || registrant.registrant_id || "").trim();
    const email = normalizeAttendanceEmail(registrant.email);
    if (id && email) registrantEmail.set(id, email);
  }

  const groups = new Map<string, ZoomPastParticipant[]>();
  for (const participant of participants) {
    const registrantId = String(participant.registrant_id || "").trim();
    const email = participantEmail(participant) || registrantEmail.get(registrantId) || "";
    const zoomUserId = String(participant.user_id || participant.id || "").trim();
    const key = registrantId
      ? `registrant:${registrantId}`
      : email
        ? `email:${email}`
        : zoomUserId
          ? `user:${zoomUserId}`
          : `name:${participantName(participant).toLowerCase()}:${participant.join_time || ""}`;
    const current = groups.get(key) ?? [];
    current.push(participant);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const first = rows[0] || {};
    const registrantId = rows.map((row) => String(row.registrant_id || "").trim()).find(Boolean) || null;
    const email = rows.map((row) => participantEmail(row)).find(Boolean)
      || (registrantId ? registrantEmail.get(registrantId) || "" : "")
      || null;
    const zoomUserId = rows.map((row) => String(row.user_id || row.id || "").trim()).find(Boolean) || null;
    const joins = rows.map((row) => row.join_time).filter(Boolean).map(String).sort();
    const leaves = rows.map((row) => row.leave_time).filter(Boolean).map(String).sort();
    const durationMinutes = rows.reduce((sum, row) => sum + Math.max(0, participantMinutes(row)), 0);
    return {
      key,
      registrantId,
      zoomUserId,
      email,
      name: participantName(first),
      firstJoinAt: joins[0] || null,
      lastLeaveAt: leaves.at(-1) || null,
      durationMinutes: Math.max(0, Math.round(durationMinutes)),
      rawSegments: rows,
    };
  });
}

function localDate(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function localMinuteOfDay(iso: string, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return 0;
  }
}

function clockMinute(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function choosePastMeetingInstance(input: {
  instances: ZoomPastMeetingInstance[];
  sessionDate: string;
  startsAt: string | null;
  timeZone: string;
}) {
  const sameDate = input.instances.filter((instance) => localDate(instance.start_time, input.timeZone) === input.sessionDate);
  if (!sameDate.length) return null;
  const scheduledMinute = clockMinute(input.startsAt);
  if (scheduledMinute === null) {
    return [...sameDate].sort((a, b) => a.start_time.localeCompare(b.start_time)).at(-1) ?? null;
  }
  return [...sameDate].sort((a, b) => {
    const aDistance = Math.abs(localMinuteOfDay(a.start_time, input.timeZone) - scheduledMinute);
    const bDistance = Math.abs(localMinuteOfDay(b.start_time, input.timeZone) - scheduledMinute);
    return aDistance - bDistance;
  })[0] ?? null;
}

export function classifyAcademyZoomAttendance(input: {
  durationMinutes: number;
  scheduledMinutes: number;
  firstJoinAt: string | null;
  meetingStartedAt: string;
  lateGraceMinutes: number;
  presentThresholdPercent: number;
  partialThresholdPercent: number;
}) {
  const scheduledMinutes = Math.max(1, Math.round(input.scheduledMinutes || 60));
  const attendancePercent = Math.max(0, Math.min(100, Math.round((Math.max(0, input.durationMinutes) / scheduledMinutes) * 100)));
  const joinMs = input.firstJoinAt ? new Date(input.firstJoinAt).getTime() : Number.NaN;
  const startMs = new Date(input.meetingStartedAt).getTime();
  const lateMinutes = Number.isFinite(joinMs) && Number.isFinite(startMs)
    ? Math.max(0, Math.round((joinMs - startMs) / 60000))
    : 0;

  let classification: AcademyZoomClassification;
  if (attendancePercent >= input.presentThresholdPercent) {
    classification = lateMinutes > input.lateGraceMinutes ? "late" : "present";
  } else if (attendancePercent >= input.partialThresholdPercent) {
    classification = "partial";
  } else {
    classification = "absent";
  }

  return {classification, attendancePercent, lateMinutes};
}

export function formatTimeInZone(value: string | null, timeZone: string) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  } catch {
    return null;
  }
}
