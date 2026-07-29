import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getZoomWebhookSecret} from "@/lib/zoom/config";
import {listPastMeetingParticipants} from "@/lib/zoom/client";
import {syncZoomParticipantsToAttendance} from "@/lib/zoom/attendance";

export const runtime = "nodejs";

type ZoomWebhookPayload = {
  event?: string;
  event_ts?: number;
  payload?: {
    plainToken?: string;
    account_id?: string;
    object?: {
      id?: string | number;
      uuid?: string;
      start_time?: string;
      participant?: {
        id?: string;
        user_id?: string;
        user_name?: string;
        email?: string;
        join_time?: string;
        leave_time?: string;
      };
    };
  };
};

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySignature(rawBody: string, request: Request, secret: string) {
  const timestamp = request.headers.get("x-zm-request-timestamp") || "";
  const signature = request.headers.get("x-zm-signature") || "";
  const numericTimestamp = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(numericTimestamp)) return false;
  if (Math.abs(Date.now() / 1000 - numericTimestamp) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return safeEqual(expected, signature);
}

async function findMeeting(admin: ReturnType<typeof createAdminClient>, zoomMeetingId: string, zoomMeetingUuid: string | null) {
  if (zoomMeetingUuid) {
    const {data} = await admin
      .from("performance_meetings")
      .select("id,organization_id,starts_at,ends_at")
      .eq("zoom_meeting_uuid", zoomMeetingUuid)
      .maybeSingle<{id: string; organization_id: string; starts_at: string; ends_at: string | null}>();
    if (data) return data;
  }
  const {data} = await admin
    .from("performance_meetings")
    .select("id,organization_id,starts_at,ends_at")
    .eq("zoom_meeting_id", zoomMeetingId)
    .maybeSingle<{id: string; organization_id: string; starts_at: string; ends_at: string | null}>();
  return data || null;
}

async function resolveAttendance(
  admin: ReturnType<typeof createAdminClient>,
  meetingId: string,
  organizationId: string,
  participantEmail: string,
) {
  const normalizedEmail = participantEmail.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const {data: profile} = await admin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .limit(1)
    .maybeSingle<{id: string}>();
  if (!profile) return null;
  const {data: attendance} = await admin
    .from("performance_meeting_attendance")
    .select("id,user_id")
    .eq("organization_id", organizationId)
    .eq("meeting_id", meetingId)
    .eq("user_id", profile.id)
    .maybeSingle<{id: string; user_id: string}>();
  return attendance || null;
}

async function processParticipantEvent(
  admin: ReturnType<typeof createAdminClient>,
  body: ZoomWebhookPayload,
  eventType: string,
) {
  const object = body.payload?.object;
  const participant = object?.participant;
  const zoomMeetingId = String(object?.id ?? "");
  const zoomMeetingUuid = object?.uuid ? String(object.uuid) : null;
  if (!zoomMeetingId || !participant) return;
  const meeting = await findMeeting(admin, zoomMeetingId, zoomMeetingUuid);
  if (!meeting) return;

  const participantId = String(participant.id || participant.user_id || "");
  const participantEmail = String(participant.email || "").trim();
  const participantName = String(participant.user_name || "Zoom participant").trim();
  const attendance = await resolveAttendance(admin, meeting.id, meeting.organization_id, participantEmail);
  const settingsResult = await admin
    .from("organization_zoom_settings")
    .select("auto_sync_attendance,late_grace_minutes,minimum_attendance_percent")
    .eq("organization_id", meeting.organization_id)
    .maybeSingle<{auto_sync_attendance: boolean; late_grace_minutes: number; minimum_attendance_percent: number}>();
  if (settingsResult.data?.auto_sync_attendance === false) return;
  const lateGrace = settingsResult.data?.late_grace_minutes ?? 5;

  if (eventType === "meeting.participant_joined") {
    const parsedEventTs = body.event_ts ? new Date(body.event_ts).toISOString() : new Date().toISOString();
    const effectiveJoin = participant.join_time || parsedEventTs;
    const lateMinutes = Math.max(0, Math.round((new Date(effectiveJoin).getTime() - new Date(meeting.starts_at).getTime()) / 60000));
    const {data: session} = await admin.from("zoom_participant_sessions").insert({
      organization_id: meeting.organization_id,
      performance_meeting_id: meeting.id,
      attendance_id: attendance?.id || null,
      zoom_meeting_id: zoomMeetingId,
      zoom_meeting_uuid: zoomMeetingUuid,
      zoom_participant_id: participantId || null,
      zoom_participant_uuid: participant.user_id || null,
      participant_email: participantEmail || null,
      participant_name: participantName,
      joined_at: effectiveJoin,
      source: "webhook",
      raw_payload: body,
    }).select("id").single<{id: string}>();
    if (attendance) {
      await admin.from("performance_meeting_attendance").update({
        status: lateMinutes > lateGrace ? "late" : "present",
        joined_at: effectiveJoin,
        late_minutes: lateMinutes > lateGrace ? lateMinutes : 0,
        attendance_source: "zoom_webhook",
        zoom_participant_id: participantId || null,
        zoom_participant_uuid: participant.user_id || null,
        zoom_email: participantEmail || null,
        zoom_display_name: participantName,
        zoom_last_synced_at: new Date().toISOString(),
        marked_at: new Date().toISOString(),
      }).eq("id", attendance.id);
    }
    return session;
  }

  if (eventType === "meeting.participant_left") {
    if (!participantId && !participantEmail) return;
    const leftAt = participant.leave_time || (body.event_ts ? new Date(body.event_ts).toISOString() : new Date().toISOString());
    let query = admin
      .from("zoom_participant_sessions")
      .select("id,joined_at")
      .eq("performance_meeting_id", meeting.id)
      .is("left_at", null)
      .order("joined_at", {ascending: false})
      .limit(1);
    if (participantId) query = query.eq("zoom_participant_id", participantId);
    else if (participantEmail) query = query.ilike("participant_email", participantEmail);
    const {data: session} = await query.maybeSingle<{id: string; joined_at: string}>();
    if (session) {
      const duration = Math.max(0, Math.round((new Date(leftAt).getTime() - new Date(session.joined_at).getTime()) / 60000));
      await admin.from("zoom_participant_sessions").update({left_at: leftAt, duration_minutes: duration, raw_payload: body}).eq("id", session.id);
    }
    if (attendance) {
      const {data: sessions} = await admin
        .from("zoom_participant_sessions")
        .select("joined_at,left_at,duration_minutes")
        .eq("attendance_id", attendance.id);
      const durationMinutes = (sessions || []).reduce((sum, row) => sum + Math.max(0, Number(row.duration_minutes || 0)), 0);
      const firstJoin = (sessions || []).map((row) => String(row.joined_at)).sort()[0] || null;
      const lateMinutes = firstJoin ? Math.max(0, Math.round((new Date(firstJoin).getTime() - new Date(meeting.starts_at).getTime()) / 60000)) : 0;
      await admin.from("performance_meeting_attendance").update({
        status: lateMinutes > lateGrace ? "late" : "present",
        joined_at: firstJoin,
        left_at: leftAt,
        duration_minutes: durationMinutes,
        late_minutes: lateMinutes > lateGrace ? lateMinutes : 0,
        attendance_source: "zoom_webhook",
        zoom_last_synced_at: new Date().toISOString(),
        marked_at: new Date().toISOString(),
      }).eq("id", attendance.id);
    }
  }
}

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getZoomWebhookSecret();
  } catch {
    return NextResponse.json({error: "Zoom webhook is not configured."}, {status: 503});
  }

  const rawBody = await request.text();
  let body: ZoomWebhookPayload;
  try {
    body = JSON.parse(rawBody) as ZoomWebhookPayload;
  } catch {
    return NextResponse.json({error: "Invalid JSON."}, {status: 400});
  }

  if (body.event === "endpoint.url_validation") {
    const plainToken = String(body.payload?.plainToken || "");
    if (!plainToken) return NextResponse.json({error: "Missing plain token."}, {status: 400});
    const encryptedToken = createHmac("sha256", secret).update(plainToken).digest("hex");
    return NextResponse.json({plainToken, encryptedToken});
  }

  if (!verifySignature(rawBody, request, secret)) {
    return NextResponse.json({error: "Invalid Zoom signature."}, {status: 401});
  }

  const eventType = String(body.event || "unknown");
  const zoomMeetingId = String(body.payload?.object?.id || "");
  const zoomMeetingUuid = body.payload?.object?.uuid ? String(body.payload.object.uuid) : null;
  const eventKey = createHash("sha256")
    .update(`${eventType}:${body.event_ts || 0}:${zoomMeetingId}:${rawBody}`)
    .digest("hex");
  const admin = createAdminClient();
  const {error: insertError} = await admin.from("zoom_webhook_events").insert({
    event_key: eventKey,
    event_type: eventType,
    event_timestamp: body.event_ts || null,
    zoom_meeting_id: zoomMeetingId || null,
    zoom_meeting_uuid: zoomMeetingUuid,
    payload: body,
  });
  if (insertError && insertError.code === "23505") return NextResponse.json({received: true, duplicate: true});
  if (insertError) return NextResponse.json({error: insertError.message}, {status: 500});

  try {
    if (["meeting.started", "meeting.ended", "meeting.deleted"].includes(eventType)) {
      const status = eventType === "meeting.started" ? "started" : eventType === "meeting.ended" ? "ended" : "cancelled";
      if (zoomMeetingUuid) {
        await admin.from("performance_meetings").update({zoom_status: status}).eq("zoom_meeting_uuid", zoomMeetingUuid);
      }
      if (zoomMeetingId) {
        await admin.from("performance_meetings").update({zoom_status: status}).eq("zoom_meeting_id", zoomMeetingId);
      }
      if (eventType === "meeting.ended" && zoomMeetingId) {
        const meeting = await findMeeting(admin, zoomMeetingId, zoomMeetingUuid);
        if (meeting) {
          const {data: settings} = await admin
            .from("organization_zoom_settings")
            .select("auto_sync_attendance,late_grace_minutes,minimum_attendance_percent")
            .eq("organization_id", meeting.organization_id)
            .maybeSingle<{auto_sync_attendance: boolean; late_grace_minutes: number; minimum_attendance_percent: number}>();
          if (settings?.auto_sync_attendance !== false) {
            try {
              const participants = await listPastMeetingParticipants(zoomMeetingUuid || zoomMeetingId);
              await syncZoomParticipantsToAttendance({
                admin,
                organizationId: meeting.organization_id,
                performanceMeetingId: meeting.id,
                zoomMeetingId,
                zoomMeetingUuid,
                meetingStartsAt: meeting.starts_at,
                meetingEndsAt: meeting.ends_at,
                participants,
                lateGraceMinutes: settings?.late_grace_minutes ?? 5,
                minimumAttendancePercent: settings?.minimum_attendance_percent ?? 50,
                source: "zoom_report",
              });
              await admin.from("performance_meetings").update({zoom_last_synced_at: new Date().toISOString(), zoom_sync_error: null}).eq("id", meeting.id);
            } catch (syncError) {
              await admin.from("performance_meetings").update({zoom_sync_error: syncError instanceof Error ? syncError.message : "Automatic Zoom attendance sync failed."}).eq("id", meeting.id);
            }
          }
        }
      }
    }
    if (["meeting.participant_joined", "meeting.participant_left"].includes(eventType)) {
      await processParticipantEvent(admin, body, eventType);
    }
    await admin.from("zoom_webhook_events").update({processed_at: new Date().toISOString(), processing_error: null}).eq("event_key", eventKey);
    return NextResponse.json({received: true});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    await admin.from("zoom_webhook_events").update({processed_at: new Date().toISOString(), processing_error: message}).eq("event_key", eventKey);
    return NextResponse.json({received: true, processingError: message});
  }
}
