import {getZoomCredentials} from "@/lib/zoom/config";

type TokenCache = {token: string; expiresAt: number};
type ZoomGlobal = typeof globalThis & {__superLeaderZoomToken?: TokenCache};

export type ZoomMeeting = {
  id: number | string;
  uuid: string;
  host_id: string;
  host_email?: string;
  join_url: string;
  start_url: string;
  password?: string;
  status?: string;
};

export type ZoomPastParticipant = {
  id?: string;
  user_id?: string;
  name?: string;
  user_name?: string;
  email?: string;
  join_time?: string;
  leave_time?: string;
  duration?: number;
};

export class ZoomApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ZoomApiError";
    this.status = status;
    this.details = details;
  }
}

async function getAccessToken() {
  const zoomGlobal = globalThis as ZoomGlobal;
  const cached = zoomGlobal.__superLeaderZoomToken;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const {accountId, clientId, clientSecret} = getZoomCredentials();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({grant_type: "account_credentials", account_id: accountId});
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new ZoomApiError(data?.reason || data?.message || "Unable to obtain a Zoom access token.", response.status, data);
  }
  zoomGlobal.__superLeaderZoomToken = {
    token: String(data.access_token),
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000,
  };
  return String(data.access_token);
}

async function zoomRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ZoomApiError(data?.message || `Zoom API request failed (${response.status}).`, response.status, data);
  }
  return data as T;
}

export async function getZoomUser(userIdOrEmail: string) {
  return zoomRequest<{id: string; email: string; first_name?: string; last_name?: string}>(`/users/${encodeURIComponent(userIdOrEmail)}`);
}

export async function createZoomMeeting(input: {
  hostEmail: string;
  topic: string;
  startTime: string;
  durationMinutes: number;
  timezone: string;
  agenda?: string | null;
}): Promise<ZoomMeeting> {
  return zoomRequest<ZoomMeeting>(`/users/${encodeURIComponent(input.hostEmail)}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      topic: input.topic,
      type: 2,
      start_time: input.startTime,
      duration: Math.max(15, Math.min(1440, Math.round(input.durationMinutes || 60))),
      timezone: input.timezone,
      agenda: input.agenda || undefined,
      settings: {
        join_before_host: false,
        waiting_room: true,
        approval_type: 0,
        audio: "both",
        auto_recording: "none",
      },
    }),
  });
}

export async function getZoomMeeting(meetingId: string) {
  return zoomRequest<ZoomMeeting>(`/meetings/${encodeURIComponent(meetingId)}`);
}

export async function deleteZoomMeeting(meetingId: string) {
  await zoomRequest<null>(`/meetings/${encodeURIComponent(meetingId)}`, {method: "DELETE"});
}

function encodePastMeetingId(value: string) {
  const once = encodeURIComponent(value);
  return value.startsWith("/") || value.includes("//") ? encodeURIComponent(once) : once;
}

export async function listPastMeetingParticipants(meetingIdOrUuid: string): Promise<ZoomPastParticipant[]> {
  const participants: ZoomPastParticipant[] = [];
  let nextPageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({page_size: "300"});
    if (nextPageToken) query.set("next_page_token", nextPageToken);
    const data = await zoomRequest<{participants?: ZoomPastParticipant[]; next_page_token?: string}>(
      `/past_meetings/${encodePastMeetingId(meetingIdOrUuid)}/participants?${query.toString()}`,
    );
    participants.push(...(data.participants || []));
    nextPageToken = String(data.next_page_token || "");
    if (!nextPageToken) break;
  }
  return participants;
}
