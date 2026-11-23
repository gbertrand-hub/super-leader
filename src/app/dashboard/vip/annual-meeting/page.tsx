import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createVipAnnualMeetingAction,
  inviteAllVipAnnualMeetingMembersAction,
  inviteVipAnnualMeetingMemberAction,
  saveVipAnnualMeetingAgendaItemAction,
  updateVipAnnualMeetingAction,
  updateVipAnnualMeetingInvitationAction,
  updateVipAnnualMeetingStatusAction,
} from "@/app/actions/vip-annual-meeting";
import {CountrySelect} from "@/components/forms/country-select";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings} from "@/lib/vip/settings";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const VIP_SETTINGS_ROLES = ["owner", "admin"];
const VIP_OPERATIONS_ROLES = ["owner", "admin", "hr"];
const VIP_DECISION_ROLES = ["owner", "admin", "executive"];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type VipMember = {
  id: string;
  member_number: string;
  full_name: string;
  country: string | null;
  status: string;
};
type AnnualMeeting = {
  id: string;
  event_year: number;
  title: string;
  theme: string | null;
  host_country: string;
  host_city: string;
  venue: string | null;
  start_date: string;
  end_date: string;
  registration_deadline: string | null;
  status: string;
  description: string | null;
  logistics_notes: string | null;
};
type MeetingInvitation = {
  id: string;
  meeting_id: string;
  member_id: string;
  status: string;
  guest_count: number;
  visa_support_required: boolean;
  travel_support_required: boolean;
  dietary_requirements: string | null;
  accommodation_notes: string | null;
  response_notes: string | null;
  invited_at: string;
  responded_at: string | null;
  checked_in_at: string | null;
};
type AgendaItem = {
  id: string;
  meeting_id: string;
  title: string;
  description: string | null;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  speaker: string | null;
  location: string | null;
  sort_order: number;
  status: string;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return <label className="mt-4 block font-bold text-slate-800">{label}{children}</label>;
}

function Badge({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet" | "rose"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    violet: "bg-violet-100 text-violet-800",
    rose: "bg-rose-100 text-rose-800",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function tone(status: string): "slate" | "blue" | "green" | "amber" | "red" | "violet" | "rose" {
  if (["confirmed", "completed", "attended"].includes(status)) return "green";
  if (["announced", "registration_open", "invited", "planned"].includes(status)) return "amber";
  if (["waitlisted"].includes(status)) return "blue";
  if (["declined", "absent", "cancelled"].includes(status)) return "red";
  if (["planning"].includes(status)) return "violet";
  return "slate";
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100";

export default async function VipAnnualMeetingPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const params = await searchParams;
  const success = first(params.success);
  const errorMessage = first(params.error);
  const requestedMeetingId = first(params.meeting);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  if (!VIP_ROLES.includes(membership.role)) redirect("/dashboard/my-day");

  const schemaCheck = await admin.from("vip_annual_meetings").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <MigrationRequired fr={fr} />;
  }

  const [meetingsResult, membersResult, invitationsResult, agendaResult] = await Promise.all([
    admin
      .from("vip_annual_meetings")
      .select("id,event_year,title,theme,host_country,host_city,venue,start_date,end_date,registration_deadline,status,description,logistics_notes")
      .eq("organization_id", membership.organization_id)
      .order("event_year", {ascending: false})
      .limit(30),
    admin
      .from("vip_members")
      .select("id,member_number,full_name,country,status")
      .eq("organization_id", membership.organization_id)
      .order("full_name")
      .limit(1000),
    admin
      .from("vip_annual_meeting_invitations")
      .select("id,meeting_id,member_id,status,guest_count,visa_support_required,travel_support_required,dietary_requirements,accommodation_notes,response_notes,invited_at,responded_at,checked_in_at")
      .eq("organization_id", membership.organization_id)
      .order("invited_at", {ascending: false})
      .limit(5000),
    admin
      .from("vip_annual_meeting_agenda_items")
      .select("id,meeting_id,title,description,session_date,start_time,end_time,speaker,location,sort_order,status")
      .eq("organization_id", membership.organization_id)
      .order("session_date")
      .order("sort_order")
      .order("start_time")
      .limit(2000),
  ]);

  for (const result of [meetingsResult, membersResult, invitationsResult, agendaResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const programSettings = await getVipProgramSettings(admin, membership.organization_id);

  const meetings = (meetingsResult.data ?? []) as AnnualMeeting[];
  const members = (membersResult.data ?? []) as VipMember[];
  const invitations = (invitationsResult.data ?? []) as MeetingInvitation[];
  const agendaItems = (agendaResult.data ?? []) as AgendaItem[];
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const selectedMeeting = meetings.find((meeting) => meeting.id === requestedMeetingId) ?? meetings.find((meeting) => !["completed", "cancelled"].includes(meeting.status)) ?? meetings[0] ?? null;
  const selectedInvitations = selectedMeeting ? invitations.filter((invitation) => invitation.meeting_id === selectedMeeting.id) : [];
  const selectedAgenda = selectedMeeting ? agendaItems.filter((item) => item.meeting_id === selectedMeeting.id) : [];
  const invitedMemberIds = new Set(selectedInvitations.map((invitation) => invitation.member_id));
  const eligibleMembers = members.filter((member) => ["active", "honorary", "pending_renewal"].includes(member.status));
  const uninvitedMembers = eligibleMembers.filter((member) => !invitedMemberIds.has(member.id));
  const confirmed = selectedInvitations.filter((invitation) => ["confirmed", "attended"].includes(invitation.status));
  const supportCases = selectedInvitations.filter((invitation) => invitation.visa_support_required || invitation.travel_support_required);
  const attended = selectedInvitations.filter((invitation) => invitation.status === "attended");
  const canManageMeetings = VIP_SETTINGS_ROLES.includes(membership.role);
  const canManageInvitations = VIP_OPERATIONS_ROLES.includes(membership.role);
  const canDecide = VIP_DECISION_ROLES.includes(membership.role);
  const statusLabel = (status: string) => c.statuses[status as keyof typeof c.statuses] ?? status;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-rose-950 to-amber-950 p-7 text-white shadow-2xl sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">Super Leader VIP · V3.2.8</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight">{c.title}</h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-200">{c.subtitle}</p>
            </div>
            <Link href="/dashboard/vip/travel" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950">{c.openTravel}</Link>
          </div>
        </header>

        <VipNav fr={fr} active="annual" />
        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          <Metric label={c.meetings} value={meetings.length} />
          <Metric label={c.invited} value={selectedInvitations.length} />
          <Metric label={c.confirmed} value={confirmed.length} />
          <Metric label={c.supportCases} value={supportCases.length} />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
          <div className="space-y-6">
            {canManageMeetings ? (
              <form action={createVipAnnualMeetingAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.createMeeting}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.createMeetingHelp}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={c.year}><input name="eventYear" type="number" min="2020" max="2100" defaultValue={new Date().getFullYear() + 1} required className={inputClass} /></Field>
                  <Field label={c.titleField}><input name="title" required minLength={3} maxLength={220} defaultValue={fr ? "Rencontre internationale Super Leader VIP" : "Super Leader VIP International Gathering"} className={inputClass} /></Field>
                  <Field label={c.hostCountry}><CountrySelect name="hostCountry" locale={fr ? "fr" : "en"} required className={inputClass} /></Field>
                  <Field label={c.hostCity}><input name="hostCity" required minLength={2} maxLength={120} className={inputClass} /></Field>
                  <Field label={c.startDate}><input name="startDate" type="date" required className={inputClass} /></Field>
                  <Field label={c.endDate}><input name="endDate" type="date" className={inputClass} /><span className="mt-1 block text-xs text-slate-500">{fr ? `Laisser vide pour appliquer ${programSettings.annual_meeting_default_duration_days} jour(s).` : `Leave blank to apply ${programSettings.annual_meeting_default_duration_days} day(s).`}</span></Field>
                  <Field label={c.registrationDeadline}><input name="registrationDeadline" type="date" className={inputClass} /></Field>
                  <Field label={c.venue}><input name="venue" maxLength={300} className={inputClass} /></Field>
                </div>
                <Field label={c.theme}><input name="theme" maxLength={300} className={inputClass} /></Field>
                <Field label={c.description}><textarea name="description" maxLength={5000} rows={4} className={inputClass} /></Field>
                <Field label={c.logisticsNotes}><textarea name="logisticsNotes" maxLength={5000} rows={3} className={inputClass} /></Field>
                <button type="submit" className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{c.create}</button>
              </form>
            ) : null}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.meetingHistory}</h2>
              <p className="mt-2 text-sm text-slate-600">{c.meetingHistoryHelp}</p>
              <div className="mt-5 space-y-3">
                {meetings.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-600">{c.noMeetings}</p> : meetings.map((meeting) => (
                  <Link key={meeting.id} href={`/dashboard/vip/annual-meeting?meeting=${meeting.id}`} className={`block rounded-2xl border p-4 transition ${selectedMeeting?.id === meeting.id ? "border-rose-300 bg-rose-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black">{meeting.event_year} · {meeting.title}</p><p className="mt-1 text-sm font-bold text-rose-800">{meeting.host_city}, {meeting.host_country}</p></div><Badge tone={tone(meeting.status)}>{statusLabel(meeting.status)}</Badge></div>
                    <p className="mt-2 text-xs text-slate-500">{new Date(`${meeting.start_date}T00:00:00Z`).toLocaleDateString(dateLocale)} → {new Date(`${meeting.end_date}T00:00:00Z`).toLocaleDateString(dateLocale)}</p>
                  </Link>
                ))}
              </div>
            </article>
          </div>

          <div className="space-y-6">
            {!selectedMeeting ? (
              <article className="rounded-3xl border border-amber-200 bg-amber-50 p-8"><h2 className="text-2xl font-black text-amber-950">{c.startHere}</h2><p className="mt-3 leading-7 text-amber-900">{c.startHereHelp}</p></article>
            ) : (
              <>
                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div><p className="text-sm font-black uppercase tracking-[0.15em] text-rose-700">{selectedMeeting.event_year}</p><h2 className="mt-1 text-3xl font-black">{selectedMeeting.title}</h2><p className="mt-2 font-bold text-rose-800">{selectedMeeting.host_city}, {selectedMeeting.host_country}</p></div>
                    <Badge tone={tone(selectedMeeting.status)}>{statusLabel(selectedMeeting.status)}</Badge>
                  </div>
                  {selectedMeeting.theme ? <p className="mt-4 rounded-2xl bg-amber-50 p-4 font-bold text-amber-950">{selectedMeeting.theme}</p> : null}
                  {selectedMeeting.description ? <p className="mt-4 whitespace-pre-wrap leading-7 text-slate-700">{selectedMeeting.description}</p> : null}
                  <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                    <p><strong>{c.dates}:</strong> {new Date(`${selectedMeeting.start_date}T00:00:00Z`).toLocaleDateString(dateLocale)} → {new Date(`${selectedMeeting.end_date}T00:00:00Z`).toLocaleDateString(dateLocale)}</p>
                    <p><strong>{c.venue}:</strong> {selectedMeeting.venue || c.notProvided}</p>
                    <p><strong>{c.registrationDeadline}:</strong> {selectedMeeting.registration_deadline ? new Date(`${selectedMeeting.registration_deadline}T00:00:00Z`).toLocaleDateString(dateLocale) : c.notProvided}</p>
                    <p><strong>{c.attendance}:</strong> {attended.length}</p>
                  </div>

                  {canDecide ? (
                    <form action={updateVipAnnualMeetingStatusAction} className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <input type="hidden" name="meetingId" value={selectedMeeting.id} />
                      <select name="status" defaultValue={selectedMeeting.status} className={inputClass}>
                        {Object.entries(c.meetingStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{c.updateStatus}</button>
                    </form>
                  ) : null}

                  {canManageMeetings ? (
                    <details className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
                      <summary className="cursor-pointer font-black text-rose-900">{c.editMeeting}</summary>
                      <form action={updateVipAnnualMeetingAction} className="mt-4">
                        <input type="hidden" name="meetingId" value={selectedMeeting.id} />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label={c.titleField}><input name="title" required minLength={3} maxLength={220} defaultValue={selectedMeeting.title} className={inputClass} /></Field>
                          <Field label={c.theme}><input name="theme" maxLength={300} defaultValue={selectedMeeting.theme ?? ""} className={inputClass} /></Field>
                          <Field label={c.hostCountry}><CountrySelect name="hostCountry" locale={fr ? "fr" : "en"} required defaultValue={selectedMeeting.host_country} className={inputClass} /></Field>
                          <Field label={c.hostCity}><input name="hostCity" required minLength={2} maxLength={120} defaultValue={selectedMeeting.host_city} className={inputClass} /></Field>
                          <Field label={c.startDate}><input name="startDate" type="date" required defaultValue={selectedMeeting.start_date} className={inputClass} /></Field>
                          <Field label={c.endDate}><input name="endDate" type="date" required defaultValue={selectedMeeting.end_date} className={inputClass} /></Field>
                          <Field label={c.registrationDeadline}><input name="registrationDeadline" type="date" defaultValue={selectedMeeting.registration_deadline ?? ""} className={inputClass} /></Field>
                          <Field label={c.venue}><input name="venue" maxLength={300} defaultValue={selectedMeeting.venue ?? ""} className={inputClass} /></Field>
                        </div>
                        <Field label={c.description}><textarea name="description" maxLength={5000} rows={4} defaultValue={selectedMeeting.description ?? ""} className={inputClass} /></Field>
                        <Field label={c.logisticsNotes}><textarea name="logisticsNotes" maxLength={5000} rows={3} defaultValue={selectedMeeting.logistics_notes ?? ""} className={inputClass} /></Field>
                        <button type="submit" className="mt-4 rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white">{c.saveMeeting}</button>
                      </form>
                    </details>
                  ) : null}
                </article>

                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-black">{c.invitations}</h2><p className="mt-1 text-sm text-slate-600">{c.invitationsHelp}</p></div><Badge tone="rose">{selectedInvitations.length}</Badge></div>
                  {canManageInvitations ? (
                    <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
                      <form action={inviteVipAnnualMeetingMemberAction} className="flex flex-col gap-3 sm:flex-row">
                        <input type="hidden" name="meetingId" value={selectedMeeting.id} />
                        <select name="memberId" required defaultValue="" className={inputClass}>
                          <option value="">{c.selectMember}</option>
                          {uninvitedMembers.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.member_number}</option>)}
                        </select>
                        <button type="submit" className="rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white">{c.invite}</button>
                      </form>
                      <form action={inviteAllVipAnnualMeetingMembersAction}>
                        <input type="hidden" name="meetingId" value={selectedMeeting.id} />
                        <button type="submit" className="mt-2 w-full rounded-xl border border-rose-300 bg-rose-50 px-5 py-3 text-sm font-black text-rose-900 lg:mt-0">{c.inviteAll}</button>
                      </form>
                    </div>
                  ) : null}

                  <div className="mt-6 space-y-4">
                    {selectedInvitations.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noInvitations}</p> : selectedInvitations.map((invitation) => {
                      const member = memberMap.get(invitation.member_id);
                      return (
                        <form key={invitation.id} action={updateVipAnnualMeetingInvitationAction} className="rounded-2xl border border-slate-200 p-5">
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{member?.full_name ?? c.unknown}</h3><p className="mt-1 text-xs font-bold text-rose-700">{member?.member_number}</p><p className="mt-1 text-sm text-slate-500">{member?.country || c.notProvided}</p></div><Badge tone={tone(invitation.status)}>{statusLabel(invitation.status)}</Badge></div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <Field label={c.responseStatus}><select name="status" defaultValue={invitation.status} className={inputClass}>{Object.entries(c.invitationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                            <Field label={c.guests}><input name="guestCount" type="number" min="0" max="5" defaultValue={invitation.guest_count} className={inputClass} /></Field>
                            <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm font-bold">
                              <label className="flex items-center gap-2"><input type="checkbox" name="visaSupportRequired" value="yes" defaultChecked={invitation.visa_support_required} />{c.visaSupport}</label>
                              <label className="flex items-center gap-2"><input type="checkbox" name="travelSupportRequired" value="yes" defaultChecked={invitation.travel_support_required} />{c.travelSupport}</label>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label={c.dietary}><textarea name="dietaryRequirements" rows={2} maxLength={2000} defaultValue={invitation.dietary_requirements ?? ""} className={inputClass} /></Field>
                            <Field label={c.accommodation}><textarea name="accommodationNotes" rows={2} maxLength={2000} defaultValue={invitation.accommodation_notes ?? ""} className={inputClass} /></Field>
                            <Field label={c.responseNotes}><textarea name="responseNotes" rows={2} maxLength={3000} defaultValue={invitation.response_notes ?? ""} className={inputClass} /></Field>
                          </div>
                          <button type="submit" className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{c.saveInvitation}</button>
                        </form>
                      );
                    })}
                  </div>
                </article>

                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-black">{c.programme}</h2><p className="mt-1 text-sm text-slate-600">{c.programmeHelp}</p></div><Badge tone="amber">{selectedAgenda.length}</Badge></div>
                  {canDecide ? (
                    <form action={saveVipAnnualMeetingAgendaItemAction} className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                      <input type="hidden" name="meetingId" value={selectedMeeting.id} />
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label={c.sessionTitle}><input name="title" required minLength={3} maxLength={220} className={inputClass} /></Field>
                        <Field label={c.sessionDate}><input name="sessionDate" type="date" min={selectedMeeting.start_date} max={selectedMeeting.end_date} defaultValue={selectedMeeting.start_date} required className={inputClass} /></Field>
                        <Field label={c.startTime}><input name="startTime" type="time" className={inputClass} /></Field>
                        <Field label={c.endTime}><input name="endTime" type="time" className={inputClass} /></Field>
                        <Field label={c.speaker}><input name="speaker" maxLength={220} className={inputClass} /></Field>
                        <Field label={c.location}><input name="location" maxLength={220} className={inputClass} /></Field>
                        <Field label={c.order}><input name="sortOrder" type="number" min="0" defaultValue="0" className={inputClass} /></Field>
                        <Field label={c.sessionStatus}><select name="status" defaultValue="planned" className={inputClass}>{Object.entries(c.agendaStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                      </div>
                      <Field label={c.sessionDescription}><textarea name="description" rows={3} maxLength={3000} className={inputClass} /></Field>
                      <button type="submit" className="mt-4 rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950">{c.addSession}</button>
                    </form>
                  ) : null}

                  <div className="mt-6 space-y-4">
                    {selectedAgenda.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noProgramme}</p> : selectedAgenda.map((item) => (
                      <details key={item.id} className="rounded-2xl border border-slate-200 p-5">
                        <summary className="cursor-pointer list-none">
                          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.12em] text-amber-700">{new Date(`${item.session_date}T00:00:00Z`).toLocaleDateString(dateLocale)} {item.start_time ? `· ${item.start_time.slice(0, 5)}` : ""}</p><h3 className="mt-1 text-lg font-black">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{[item.speaker, item.location].filter(Boolean).join(" · ") || c.notProvided}</p></div><Badge tone={tone(item.status)}>{statusLabel(item.status)}</Badge></div>
                        </summary>
                        {item.description ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{item.description}</p> : null}
                        {canDecide ? (
                          <form action={saveVipAnnualMeetingAgendaItemAction} className="mt-4 border-t border-slate-200 pt-4">
                            <input type="hidden" name="meetingId" value={selectedMeeting.id} />
                            <input type="hidden" name="agendaItemId" value={item.id} />
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <Field label={c.sessionTitle}><input name="title" required minLength={3} maxLength={220} defaultValue={item.title} className={inputClass} /></Field>
                              <Field label={c.sessionDate}><input name="sessionDate" type="date" min={selectedMeeting.start_date} max={selectedMeeting.end_date} defaultValue={item.session_date} required className={inputClass} /></Field>
                              <Field label={c.startTime}><input name="startTime" type="time" defaultValue={item.start_time?.slice(0, 5) ?? ""} className={inputClass} /></Field>
                              <Field label={c.endTime}><input name="endTime" type="time" defaultValue={item.end_time?.slice(0, 5) ?? ""} className={inputClass} /></Field>
                              <Field label={c.speaker}><input name="speaker" maxLength={220} defaultValue={item.speaker ?? ""} className={inputClass} /></Field>
                              <Field label={c.location}><input name="location" maxLength={220} defaultValue={item.location ?? ""} className={inputClass} /></Field>
                              <Field label={c.order}><input name="sortOrder" type="number" min="0" defaultValue={item.sort_order} className={inputClass} /></Field>
                              <Field label={c.sessionStatus}><select name="status" defaultValue={item.status} className={inputClass}>{Object.entries(c.agendaStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                            </div>
                            <Field label={c.sessionDescription}><textarea name="description" rows={3} maxLength={3000} defaultValue={item.description ?? ""} className={inputClass} /></Field>
                            <button type="submit" className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{c.saveSession}</button>
                          </form>
                        ) : null}
                      </details>
                    ))}
                  </div>
                </article>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function VipNav({fr, active}: {fr: boolean; active: "annual"}) {
  const items = fr ? [
    ["Vue VIP", "/dashboard/vip"], ["Membres", "/dashboard/vip?view=members"], ["Cartes", "/dashboard/vip?view=cards"], ["Déplacements", "/dashboard/vip/travel"], ["Accueil par pays", "/dashboard/vip/country-welcome"], ["Rencontre annuelle", "/dashboard/vip/annual-meeting"], ["Avantages", "/dashboard/vip/benefits"],
  ] : [
    ["VIP overview", "/dashboard/vip"], ["Members", "/dashboard/vip?view=members"], ["Cards", "/dashboard/vip?view=cards"], ["Travel", "/dashboard/vip/travel"], ["Country welcome", "/dashboard/vip/country-welcome"], ["Annual gathering", "/dashboard/vip/annual-meeting"], ["Benefits", "/dashboard/vip/benefits"],
  ];
  return <nav className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">{items.map(([label, href]) => <Link key={href} href={href} className={`shrink-0 rounded-xl px-4 py-3 text-sm font-black ${active === "annual" && href.endsWith("annual-meeting") ? "bg-rose-700 text-white" : "text-slate-600 hover:bg-rose-50"}`}>{label}</Link>)}</nav>;
}

function Metric({label, value}: {label: string; value: number}) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-4xl font-black">{value}</p><div className="mt-4 h-1.5 rounded-full bg-rose-200" /></article>;
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-3xl font-black text-amber-950">{fr ? "Migration Supabase requise" : "Supabase migration required"}</h1><p className="mt-3 leading-7 text-amber-900">{fr ? "Exécute la migration V3.2.5 pour activer la rencontre annuelle, les invitations et le programme." : "Run the V3.2.5 migration to activate the annual gathering, invitations and programme."}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/045_super_leader_vip_annual_meeting_v3_2_5.sql</code></div></main>;
}

const copy = {
  fr: {
    title: "Rencontre annuelle internationale",
    subtitle: "Choisis le pays hôte en début d’année, prépare les invitations, les besoins de voyage et de visa, puis organise le programme et la présence des membres VIP.",
    openTravel: "Ouvrir les déplacements",
    meetings: "Rencontres enregistrées",
    invited: "Membres invités",
    confirmed: "Présences confirmées",
    supportCases: "Besoins visa ou voyage",
    createMeeting: "Créer la rencontre de l’année",
    createMeetingHelp: "Une seule rencontre peut être enregistrée par année pour l’organisation.",
    year: "Année",
    titleField: "Titre officiel",
    hostCountry: "Pays hôte",
    hostCity: "Ville hôte",
    startDate: "Date de début",
    endDate: "Date de fin",
    registrationDeadline: "Date limite de confirmation",
    venue: "Lieu ou établissement",
    theme: "Thème de l’année",
    description: "Présentation de la rencontre",
    logisticsNotes: "Notes logistiques internes",
    create: "Créer la rencontre",
    meetingHistory: "Historique annuel",
    meetingHistoryHelp: "Sélectionne une année pour gérer son programme et ses invités.",
    noMeetings: "Aucune rencontre annuelle n’est encore enregistrée.",
    startHere: "Commencer par créer la rencontre",
    startHereHelp: "Définis l’année, le pays hôte, la ville et les dates. Tu pourras ensuite inviter les membres et construire le programme.",
    dates: "Dates",
    attendance: "Présences enregistrées",
    notProvided: "Non renseigné",
    updateStatus: "Mettre à jour le statut",
    editMeeting: "Modifier les informations de la rencontre",
    saveMeeting: "Enregistrer les modifications",
    invitations: "Invitations et confirmations",
    invitationsHelp: "Invite individuellement ou ajoute en une fois tous les membres actifs et honoraires.",
    selectMember: "Sélectionner un membre non invité",
    invite: "Inviter",
    inviteAll: "Inviter tous les membres admissibles",
    noInvitations: "Aucun membre n’est encore invité à cette rencontre.",
    unknown: "Membre VIP",
    responseStatus: "Réponse ou présence",
    guests: "Nombre d’accompagnants",
    visaSupport: "Assistance visa requise",
    travelSupport: "Assistance voyage requise",
    dietary: "Régime ou allergies",
    accommodation: "Besoins d’hébergement",
    responseNotes: "Notes de réponse",
    saveInvitation: "Enregistrer l’invitation",
    programme: "Programme de la rencontre",
    programmeHelp: "Planifie les sessions, intervenants, salles et horaires pour chaque journée.",
    sessionTitle: "Titre de la session",
    sessionDate: "Date",
    startTime: "Heure de début",
    endTime: "Heure de fin",
    speaker: "Intervenant",
    location: "Salle ou lieu",
    order: "Ordre d’affichage",
    sessionStatus: "Statut",
    sessionDescription: "Description de la session",
    addSession: "Ajouter au programme",
    saveSession: "Mettre à jour la session",
    noProgramme: "Le programme n’a pas encore été construit.",
    meetingStatuses: {planning: "Planification", announced: "Annoncée", registration_open: "Confirmations ouvertes", confirmed: "Confirmée", completed: "Terminée", cancelled: "Annulée"},
    invitationStatuses: {invited: "Invité", confirmed: "Confirmé", declined: "Décliné", waitlisted: "Liste d’attente", attended: "Présent", absent: "Absent", cancelled: "Annulé"},
    agendaStatuses: {planned: "Planifiée", confirmed: "Confirmée", completed: "Terminée", cancelled: "Annulée"},
    statuses: {planning: "Planification", announced: "Annoncée", registration_open: "Confirmations ouvertes", confirmed: "Confirmée", completed: "Terminée", cancelled: "Annulée", invited: "Invité", declined: "Décliné", waitlisted: "Liste d’attente", attended: "Présent", absent: "Absent", planned: "Planifiée"},
  },
  en: {
    title: "Annual international gathering",
    subtitle: "Choose the host country at the start of the year, prepare invitations, travel and visa support, then organise the programme and VIP member attendance.",
    openTravel: "Open travel",
    meetings: "Recorded gatherings",
    invited: "Invited members",
    confirmed: "Confirmed attendance",
    supportCases: "Visa or travel support",
    createMeeting: "Create this year’s gathering",
    createMeetingHelp: "Only one gathering can be registered per year for the organisation.",
    year: "Year",
    titleField: "Official title",
    hostCountry: "Host country",
    hostCity: "Host city",
    startDate: "Start date",
    endDate: "End date",
    registrationDeadline: "Confirmation deadline",
    venue: "Venue",
    theme: "Annual theme",
    description: "Gathering overview",
    logisticsNotes: "Internal logistics notes",
    create: "Create gathering",
    meetingHistory: "Annual history",
    meetingHistoryHelp: "Select a year to manage its programme and guests.",
    noMeetings: "No annual gathering has been recorded yet.",
    startHere: "Start by creating the gathering",
    startHereHelp: "Set the year, host country, city and dates. You can then invite members and build the programme.",
    dates: "Dates",
    attendance: "Recorded attendance",
    notProvided: "Not provided",
    updateStatus: "Update status",
    editMeeting: "Edit gathering details",
    saveMeeting: "Save changes",
    invitations: "Invitations and confirmations",
    invitationsHelp: "Invite members individually or add all active and honorary members at once.",
    selectMember: "Select an uninvited member",
    invite: "Invite",
    inviteAll: "Invite all eligible members",
    noInvitations: "No member has been invited to this gathering yet.",
    unknown: "VIP member",
    responseStatus: "Response or attendance",
    guests: "Number of guests",
    visaSupport: "Visa support required",
    travelSupport: "Travel support required",
    dietary: "Dietary needs or allergies",
    accommodation: "Accommodation needs",
    responseNotes: "Response notes",
    saveInvitation: "Save invitation",
    programme: "Gathering programme",
    programmeHelp: "Plan sessions, speakers, rooms and times for each day.",
    sessionTitle: "Session title",
    sessionDate: "Date",
    startTime: "Start time",
    endTime: "End time",
    speaker: "Speaker",
    location: "Room or location",
    order: "Display order",
    sessionStatus: "Status",
    sessionDescription: "Session description",
    addSession: "Add to programme",
    saveSession: "Update session",
    noProgramme: "The programme has not been built yet.",
    meetingStatuses: {planning: "Planning", announced: "Announced", registration_open: "Confirmations open", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled"},
    invitationStatuses: {invited: "Invited", confirmed: "Confirmed", declined: "Declined", waitlisted: "Waitlisted", attended: "Attended", absent: "Absent", cancelled: "Cancelled"},
    agendaStatuses: {planned: "Planned", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled"},
    statuses: {planning: "Planning", announced: "Announced", registration_open: "Confirmations open", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", invited: "Invited", declined: "Declined", waitlisted: "Waitlisted", attended: "Attended", absent: "Absent", planned: "Planned"},
  },
} as const;
