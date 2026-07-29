import type {SupabaseClient} from "@supabase/supabase-js";
import type {ZoomPastParticipant} from "@/lib/zoom/client";

function email(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function displayName(participant: ZoomPastParticipant) {
  return String(participant.name || participant.user_name || "Zoom participant").trim();
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return 0;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

export async function syncZoomParticipantsToAttendance(input: {
  admin: SupabaseClient;
  organizationId: string;
  performanceMeetingId: string;
  zoomMeetingId: string;
  zoomMeetingUuid?: string | null;
  meetingStartsAt: string;
  meetingEndsAt: string | null;
  participants: ZoomPastParticipant[];
  lateGraceMinutes: number;
  minimumAttendancePercent: number;
  source: "zoom_report" | "zoom_webhook";
}) {
  const {admin, organizationId, performanceMeetingId} = input;
  const [{data: attendanceRows, error: attendanceError}, {data: memberRows, error: memberError}] = await Promise.all([
    admin
      .from("performance_meeting_attendance")
      .select("id,user_id,status")
      .eq("organization_id", organizationId)
      .eq("meeting_id", performanceMeetingId),
    admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
  ]);
  if (attendanceError) throw new Error(attendanceError.message);
  if (memberError) throw new Error(memberError.message);

  const memberIds = (memberRows || []).map((row) => String(row.user_id));
  const {data: profileRows, error: profileError} = memberIds.length
    ? await admin.from("profiles").select("id,email,full_name").in("id", memberIds)
    : {data: [], error: null};
  if (profileError) throw new Error(profileError.message);

  const emailToUser = new Map<string, string>();
  for (const row of profileRows || []) {
    const normalized = email(row.email);
    if (normalized) emailToUser.set(normalized, String(row.id));
  }

  const attendanceByUser = new Map((attendanceRows || []).map((row) => [String(row.user_id), row]));
  const grouped = new Map<string, ZoomPastParticipant[]>();
  for (const participant of input.participants) {
    const participantEmail = email(participant.email);
    if (!participantEmail) continue;
    const userId = emailToUser.get(participantEmail);
    if (!userId || !attendanceByUser.has(userId)) continue;
    const group = grouped.get(userId) || [];
    group.push(participant);
    grouped.set(userId, group);
  }

  const meetingStartMs = new Date(input.meetingStartsAt).getTime();
  const scheduledMinutes = input.meetingEndsAt
    ? Math.max(1, minutesBetween(input.meetingStartsAt, input.meetingEndsAt))
    : 60;
  const nowIso = new Date().toISOString();
  let updated = 0;

  if (input.source === "zoom_report") {
    const {error: cleanupError} = await admin
      .from("zoom_participant_sessions")
      .delete()
      .eq("performance_meeting_id", performanceMeetingId)
      .eq("source", "report");
    if (cleanupError) throw new Error(cleanupError.message);
  }

  for (const [userId, userParticipants] of grouped) {
    const attendance = attendanceByUser.get(userId);
    if (!attendance) continue;
    const joins = userParticipants.map((row) => row.join_time).filter(Boolean) as string[];
    const leaves = userParticipants.map((row) => row.leave_time).filter(Boolean) as string[];
    const firstJoin = joins.sort()[0] || null;
    const lastLeave = leaves.sort().at(-1) || null;
    const durationMinutes = userParticipants.reduce((sum, participant) => {
      const reportedSeconds = Number(participant.duration || 0);
      const reportedMinutes = reportedSeconds > 0 ? reportedSeconds / 60 : 0;
      return sum + (reportedMinutes > 0 ? reportedMinutes : minutesBetween(participant.join_time, participant.leave_time));
    }, 0);
    const attendancePercent = Math.min(100, Math.round((durationMinutes / scheduledMinutes) * 100));
    const lateMinutes = firstJoin && Number.isFinite(meetingStartMs)
      ? Math.max(0, Math.round((new Date(firstJoin).getTime() - meetingStartMs) / 60000))
      : 0;
    const status = attendancePercent < input.minimumAttendancePercent
      ? "absent"
      : lateMinutes > input.lateGraceMinutes
        ? "late"
        : "present";
    const firstParticipant = userParticipants[0];

    const {error: updateError} = await admin
      .from("performance_meeting_attendance")
      .update({
        status,
        joined_at: firstJoin,
        left_at: lastLeave,
        late_minutes: status === "late" ? lateMinutes : 0,
        duration_minutes: Math.max(0, Math.round(durationMinutes)),
        attendance_source: input.source,
        zoom_participant_id: firstParticipant?.id || firstParticipant?.user_id || null,
        zoom_participant_uuid: firstParticipant?.user_id || null,
        zoom_email: firstParticipant?.email || null,
        zoom_display_name: displayName(firstParticipant || {}),
        zoom_last_synced_at: nowIso,
        marked_at: nowIso,
      })
      .eq("id", attendance.id);
    if (updateError) throw new Error(updateError.message);
    updated += 1;

    for (const participant of userParticipants) {
      if (!participant.join_time) continue;
      await admin.from("zoom_participant_sessions").insert({
        organization_id: organizationId,
        performance_meeting_id: performanceMeetingId,
        attendance_id: attendance.id,
        zoom_meeting_id: input.zoomMeetingId,
        zoom_meeting_uuid: input.zoomMeetingUuid || null,
        zoom_participant_id: participant.id || participant.user_id || null,
        zoom_participant_uuid: participant.user_id || null,
        participant_email: participant.email || null,
        participant_name: displayName(participant),
        joined_at: participant.join_time,
        left_at: participant.leave_time || null,
        duration_minutes: Math.max(0, Math.round(
          Number(participant.duration || 0) > 0
            ? Number(participant.duration || 0) / 60
            : minutesBetween(participant.join_time, participant.leave_time),
        )),
        source: input.source === "zoom_report" ? "report" : "webhook",
        raw_payload: participant,
      });
    }
  }

  const meetingEnded = input.meetingEndsAt && new Date(input.meetingEndsAt).getTime() <= Date.now();
  if (meetingEnded) {
    const matchedIds = new Set(grouped.keys());
    for (const row of attendanceRows || []) {
      if (matchedIds.has(String(row.user_id))) continue;
      await admin
        .from("performance_meeting_attendance")
        .update({
          status: "absent",
          duration_minutes: 0,
          attendance_source: input.source,
          zoom_last_synced_at: nowIso,
          marked_at: nowIso,
        })
        .eq("id", row.id)
        .eq("status", "invited");
    }
  }

  return {updated, unmatched: input.participants.length - [...grouped.values()].reduce((sum, rows) => sum + rows.length, 0)};
}
