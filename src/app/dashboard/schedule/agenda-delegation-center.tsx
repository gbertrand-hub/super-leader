import Link from "next/link";
import {redirect} from "next/navigation";
import {
  cancelPersonalAgendaAppointmentAction,
  revokeScheduleDelegationAction,
  savePersonalAgendaAppointmentAction,
  saveScheduleDelegationAction,
} from "@/app/actions/agenda-delegation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

type Props = {
  month: string;
  agendaOwner?: string;
  appointment?: string;
  locale: string;
};

type Membership = {organization_id: string; role: string};
type Member = {user_id: string; role: string};
type Profile = {id: string; full_name: string | null; email: string | null};
type Delegation = {
  id: string;
  principal_user_id: string;
  delegate_user_id: string;
  access_level: "availability" | "manage" | "executive";
  can_view_private_details: boolean;
  expires_on: string | null;
  is_active: boolean;
  created_at: string;
};
type Appointment = {
  id: string;
  owner_user_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  title: string;
  location: string | null;
  meeting_link: string | null;
  attendees: string | null;
  notes: string | null;
  visibility: "normal" | "private";
  source: "self" | "delegate";
  status: "scheduled" | "cancelled";
  created_by: string;
  updated_by: string;
  created_at: string;
};
type WorkSchedule = {
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  work_mode: string;
  location: string | null;
  timezone: string;
  status: string;
};
type MeetingAttendance = {meeting_id: string; user_id: string};
type Meeting = {id: string; title: string; starts_at: string; ends_at: string | null; mandatory: boolean};

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

function bounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  };
}

function active(delegation: Delegation) {
  return delegation.is_active && (!delegation.expires_on || delegation.expires_on >= new Date().toISOString().slice(0, 10));
}

function fmtTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "—";
}

function levelLabel(level: Delegation["access_level"], fr: boolean) {
  if (level === "availability") return fr ? "Disponibilités seulement" : "Availability only";
  if (level === "manage") return fr ? "Gestion d'agenda" : "Calendar management";
  return fr ? "Assistant exécutif" : "Executive assistant";
}

function levelTone(level: Delegation["access_level"]) {
  if (level === "executive") return "bg-violet-100 text-violet-800";
  if (level === "manage") return "bg-indigo-100 text-indigo-800";
  return "bg-slate-100 text-slate-700";
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
}

function dateInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: normalizeTimeZone(timezone), year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeInTimezone(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {timeZone: normalizeTimeZone(timezone), hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(new Date(value));
}

function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <label className="block text-sm font-black text-slate-800">{label}{children}</label>;
}

export default async function AgendaDelegationCenter({month, agendaOwner = "", appointment = "", locale}: Props) {
  const fr = locale === "fr";
  const t = (frText: string, enText: string) => fr ? frText : enText;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) return null;

  const schemaCheck = await admin.from("schedule_delegations").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = schemaCheck.error.code === "42P01" || schemaCheck.error.code === "PGRST205";
    return (
      <section id="agenda-delegation-center" className="mt-6 scroll-mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.16em] text-amber-700">V4.8.64</p>
        <h2 className="mt-1 text-2xl font-black text-amber-950">{t("Délégation d'agenda & assistant exécutif", "Calendar delegation & executive assistant")}</h2>
        <p className="mt-3 text-sm leading-6 text-amber-900">
          {missing
            ? t("La migration de délégation d'agenda n'est pas encore installée.", "The calendar delegation migration is not installed yet.")
            : schemaCheck.error.message}
        </p>
        {missing ? <code className="mt-4 block rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">supabase/105_agenda_delegation_executive_assistant_v4_8_64.sql</code> : null}
      </section>
    );
  }

  const [{data: membersData}, {data: outgoingData}, {data: incomingData}] = await Promise.all([
    admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).order("created_at"),
    admin.from("schedule_delegations").select("id, principal_user_id, delegate_user_id, access_level, can_view_private_details, expires_on, is_active, created_at").eq("organization_id", membership.organization_id).eq("principal_user_id", authData.user.id).eq("is_active", true).order("created_at", {ascending: false}),
    admin.from("schedule_delegations").select("id, principal_user_id, delegate_user_id, access_level, can_view_private_details, expires_on, is_active, created_at").eq("organization_id", membership.organization_id).eq("delegate_user_id", authData.user.id).eq("is_active", true).order("created_at", {ascending: false}),
  ]);

  const members = (membersData ?? []) as Member[];
  const memberIds = members.map((row) => row.user_id);
  const {data: profilesData} = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : {data: [] as Profile[]};
  const profiles = (profilesData ?? []) as Profile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const memberName = (id: string) => profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || t("Collaborateur", "Member");

  const outgoing = ((outgoingData ?? []) as Delegation[]).filter(active);
  const incoming = ((incomingData ?? []) as Delegation[]).filter(active);
  const incomingByPrincipal = new Map(incoming.map((row) => [row.principal_user_id, row]));
  const requestedOwnerAllowed = agendaOwner === authData.user.id || incomingByPrincipal.has(agendaOwner);
  const selectedOwnerId = requestedOwnerAllowed && agendaOwner ? agendaOwner : authData.user.id;
  const selectedDelegation = selectedOwnerId === authData.user.id ? null : incomingByPrincipal.get(selectedOwnerId) ?? null;
  const canManage = selectedOwnerId === authData.user.id || selectedDelegation?.access_level === "manage" || selectedDelegation?.access_level === "executive";
  const canCancel = selectedOwnerId === authData.user.id || selectedDelegation?.access_level === "executive";
  const canSeeNormalDetails = selectedOwnerId === authData.user.id || selectedDelegation?.access_level !== "availability";
  const canSeePrivateDetails = selectedOwnerId === authData.user.id || Boolean(selectedDelegation?.can_view_private_details);
  const monthBounds = bounds(month);

  const [{data: appointmentsData}, {data: workSchedulesData}, {data: attendanceData}] = await Promise.all([
    admin.from("personal_agenda_appointments")
      .select("id, owner_user_id, work_date, start_time, end_time, timezone, title, location, meeting_link, attendees, notes, visibility, source, status, created_by, updated_by, created_at")
      .eq("organization_id", membership.organization_id)
      .eq("owner_user_id", selectedOwnerId)
      .eq("status", "scheduled")
      .gte("work_date", monthBounds.start)
      .lte("work_date", monthBounds.end)
      .order("work_date")
      .order("start_time"),
    admin.from("work_schedule_entries")
      .select("work_date, start_time, end_time, work_mode, location, timezone, status")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", selectedOwnerId)
      .eq("status", "published")
      .gte("work_date", monthBounds.start)
      .lte("work_date", monthBounds.end)
      .order("work_date"),
    admin.from("performance_meeting_attendance").select("meeting_id, user_id").eq("user_id", selectedOwnerId),
  ]);

  const appointments = (appointmentsData ?? []) as Appointment[];
  const workSchedules = (workSchedulesData ?? []) as WorkSchedule[];
  const attendance = (attendanceData ?? []) as MeetingAttendance[];
  const meetingIds = Array.from(new Set(attendance.map((row) => row.meeting_id)));
  const {data: meetingsData} = meetingIds.length
    ? await admin.from("performance_meetings")
        .select("id, title, starts_at, ends_at, mandatory")
        .eq("organization_id", membership.organization_id)
        .in("id", meetingIds)
        .gte("starts_at", `${monthBounds.start}T00:00:00Z`)
        .lte("starts_at", `${monthBounds.end}T23:59:59Z`)
        .order("starts_at")
    : {data: [] as Meeting[]};
  const meetings = (meetingsData ?? []) as Meeting[];

  const selectedAppointment = appointment
    ? appointments.find((row) => row.id === appointment) ?? null
    : null;
  const selectedAppointmentVisible = selectedAppointment && (selectedAppointment.visibility !== "private" || canSeePrivateDetails) && canSeeNormalDetails
    ? selectedAppointment
    : null;

  const appointmentBusy = appointments.map((row) => ({
    id: `appointment-${row.id}`,
    date: row.work_date,
    start: fmtTime(row.start_time),
    end: fmtTime(row.end_time),
    kind: "appointment" as const,
    appointment: row,
  }));
  const meetingBusy = meetings.map((row) => {
    const timezone = workSchedules.find((schedule) => schedule.work_date === dateInTimezone(row.starts_at, schedule.timezone))?.timezone || "Europe/Dublin";
    return {
      id: `meeting-${row.id}`,
      date: dateInTimezone(row.starts_at, timezone),
      start: timeInTimezone(row.starts_at, timezone),
      end: row.ends_at ? timeInTimezone(row.ends_at, timezone) : timeInTimezone(row.starts_at, timezone),
      kind: "meeting" as const,
      meeting: row,
    };
  }).filter((row) => row.date >= monthBounds.start && row.date <= monthBounds.end);
  const busyItems = [...appointmentBusy, ...meetingBusy].sort((a, b) => `${a.date}-${a.start}`.localeCompare(`${b.date}-${b.start}`));

  const assistantCandidates = members
    .filter((member) => member.user_id !== authData.user.id)
    .map((member) => ({id: member.user_id, role: member.role, name: memberName(member.user_id)}))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section id="agenda-delegation-center" className="mt-6 scroll-mt-6 space-y-6">
      <article className="rounded-3xl bg-gradient-to-r from-slate-950 via-indigo-950 to-violet-950 p-7 text-white shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">V4.8.64 · {t("Gouvernance du temps", "Time governance")}</p>
            <h2 className="mt-2 text-3xl font-black">{t("Délégation d'agenda & assistant exécutif", "Calendar delegation & executive assistant")}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
              {t(
                "Déléguez votre agenda sans déléguer votre identité. Chaque création, modification ou annulation conserve le nom du propriétaire et celui de la personne qui agit pour son compte.",
                "Delegate your calendar without delegating your identity. Every creation, update or cancellation keeps both the calendar owner and the person acting on their behalf.",
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-sm">
            <p className="font-black">{t("Agenda affiché", "Calendar shown")}</p>
            <p className="mt-1 text-lg font-black text-amber-300">{memberName(selectedOwnerId)}</p>
            <p className="mt-1 text-xs text-slate-300">
              {selectedOwnerId === authData.user.id
                ? t("Vous êtes propriétaire de cet agenda.", "You own this calendar.")
                : t(`Vous agissez avec le niveau : ${levelLabel(selectedDelegation!.access_level, true)}.`, `You are acting with: ${levelLabel(selectedDelegation!.access_level, false)}.`)}
            </p>
          </div>
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{t("Votre délégation", "Your delegation")}</p>
          <h3 className="mt-1 text-2xl font-black text-indigo-950">{t("Désigner un(e) assistant(e)", "Assign an assistant")}</h3>
          <p className="mt-2 text-sm leading-6 text-indigo-900">
            {t("Le collaborateur conserve son rôle normal dans Super Leader. Cette autorisation ne concerne que votre agenda.", "The member keeps their normal Super Leader role. This permission applies only to your calendar.")}
          </p>
          {assistantCandidates.length ? (
            <form action={saveScheduleDelegationAction} className="mt-5 space-y-4">
              <input type="hidden" name="month" value={month} />
              <Field label={t("Assistant(e) / secrétaire", "Assistant / secretary")}>
                <select name="delegateUserId" required className={inputClass}>
                  <option value="">{t("Sélectionner un collaborateur...", "Select a member...")}</option>
                  {assistantCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role}</option>)}
                </select>
              </Field>
              <Field label={t("Niveau d'accès", "Access level")}>
                <select name="accessLevel" defaultValue="manage" className={inputClass}>
                  <option value="availability">{t("Niveau 1 — Disponibilités seulement", "Level 1 — Availability only")}</option>
                  <option value="manage">{t("Niveau 2 — Gestion d'agenda", "Level 2 — Calendar management")}</option>
                  <option value="executive">{t("Niveau 3 — Assistant exécutif", "Level 3 — Executive assistant")}</option>
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("Expiration (facultatif)", "Expiry (optional)")}><input name="expiresOn" type="date" className={inputClass} /></Field>
                <label className="mt-2 flex items-center gap-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm font-bold text-indigo-950">
                  <input name="canViewPrivateDetails" type="checkbox" />
                  {t("Autoriser les détails privés", "Allow private details")}
                </label>
              </div>
              <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800">{t("Enregistrer la délégation", "Save delegation")}</button>
            </form>
          ) : <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm text-indigo-900">{t("Aucun autre membre actif disponible.", "No other active member is available.")}</p>}

          <div className="mt-6 space-y-3">
            <p className="text-sm font-black text-indigo-950">{t("Assistants actuellement autorisés", "Currently authorized assistants")}</p>
            {outgoing.length ? outgoing.map((row) => (
              <div key={row.id} className="rounded-2xl border border-indigo-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-black">{memberName(row.delegate_user_id)}</p>
                    <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${levelTone(row.access_level)}`}>{levelLabel(row.access_level, fr)}</span>
                    <p className="mt-2 text-xs text-slate-500">{row.expires_on ? `${t("Expire le", "Expires")}: ${formatDate(row.expires_on, locale)}` : t("Sans expiration", "No expiry")}{row.can_view_private_details ? ` · ${t("Détails privés autorisés", "Private details allowed")}` : ""}</p>
                  </div>
                  <form action={revokeScheduleDelegationAction}>
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="delegationId" value={row.id} />
                    <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700 hover:bg-red-100">{t("Retirer l'accès", "Remove access")}</button>
                  </form>
                </div>
              </div>
            )) : <p className="rounded-xl bg-white/70 p-4 text-sm text-indigo-900">{t("Vous n'avez encore délégué votre agenda à personne.", "You have not delegated your calendar yet.")}</p>}
          </div>
        </article>

        <article className="rounded-3xl border border-violet-200 bg-violet-50 p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{t("Agendas délégués", "Delegated calendars")}</p>
          <h3 className="mt-1 text-2xl font-black text-violet-950">{t("Agendas que vous pouvez assister", "Calendars you can assist")}</h3>
          <p className="mt-2 text-sm leading-6 text-violet-900">
            {t("Vous agissez toujours en votre propre nom, pour le compte du propriétaire de l'agenda. Vos actions sont auditées.", "You always act under your own identity, on behalf of the calendar owner. Your actions are audited.")}
          </p>
          <div className="mt-5 space-y-3">
            <Link href={`/dashboard/schedule?month=${month}&agendaOwner=${authData.user.id}#agenda-delegation-center`} className={`block rounded-2xl border p-4 transition ${selectedOwnerId === authData.user.id ? "border-violet-500 bg-white ring-2 ring-violet-100" : "border-violet-200 bg-white hover:border-violet-400"}`}>
              <p className="font-black">{t("Mon agenda", "My calendar")}</p>
              <p className="mt-1 text-xs text-slate-500">{memberName(authData.user.id)}</p>
            </Link>
            {incoming.length ? incoming.map((row) => (
              <Link key={row.id} href={`/dashboard/schedule?month=${month}&agendaOwner=${row.principal_user_id}#agenda-delegation-center`} className={`block rounded-2xl border p-4 transition ${selectedOwnerId === row.principal_user_id ? "border-violet-500 bg-white ring-2 ring-violet-100" : "border-violet-200 bg-white hover:border-violet-400"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div><p className="font-black">{memberName(row.principal_user_id)}</p><p className="mt-1 text-xs text-slate-500">{levelLabel(row.access_level, fr)}</p></div>
                  <span className="text-sm font-black text-violet-700">{t("Ouvrir →", "Open →")}</span>
                </div>
              </Link>
            )) : <p className="rounded-xl bg-white/70 p-4 text-sm text-violet-900">{t("Aucun agenda ne vous a encore été délégué.", "No calendar has been delegated to you yet.")}</p>}
          </div>
        </article>
      </div>

      <div className={`grid gap-6 ${canManage ? "xl:grid-cols-[minmax(0,1fr)_410px]" : ""}`}>
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-emerald-700">{t("Disponibilités & rendez-vous", "Availability & appointments")}</p>
              <h3 className="mt-1 text-2xl font-black">{memberName(selectedOwnerId)} · {month}</h3>
              <p className="mt-2 text-sm text-slate-500">{t("Les plages de travail servent de repère. Les réunions et rendez-vous représentent les périodes occupées.", "Work windows are shown for context. Meetings and appointments represent busy periods.")}</p>
            </div>
            {selectedDelegation ? <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ${levelTone(selectedDelegation.access_level)}`}>{levelLabel(selectedDelegation.access_level, fr)}</span> : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {workSchedules.length ? workSchedules.map((row, index) => (
              <div key={`${row.work_date}-${index}`} className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-cyan-700">{t("Plage de travail", "Work window")}</p>
                <p className="mt-1 font-black">{formatDate(row.work_date, locale)}</p>
                <p className="mt-1 text-sm text-cyan-900">{row.work_mode === "off" ? t("Repos", "Day off") : `${fmtTime(row.start_time)}–${fmtTime(row.end_time)}`}</p>
              </div>
            )) : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{t("Aucune plage de travail publiée pour ce mois.", "No published work window for this month.")}</div>}
          </div>

          <div className="mt-6 space-y-3">
            <h4 className="text-lg font-black">{t("Périodes occupées", "Busy periods")}</h4>
            {busyItems.length ? busyItems.map((item) => {
              if (item.kind === "meeting") {
                const title = canSeeNormalDetails ? item.meeting.title : t("Indisponible", "Busy");
                return (
                  <div key={item.id} className="rounded-2xl border border-purple-200 bg-purple-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div><p className="font-black">{title}</p><p className="mt-1 text-sm text-purple-900">{formatDate(item.date, locale)} · {item.start}–{item.end}</p></div>
                      <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-black text-purple-800">{t("Réunion", "Meeting")}</span>
                    </div>
                  </div>
                );
              }

              const row = item.appointment;
              const canViewThis = canSeeNormalDetails && (row.visibility !== "private" || canSeePrivateDetails);
              const title = canViewThis ? row.title : t("Indisponible", "Busy");
              const creator = row.created_by === row.owner_user_id
                ? memberName(row.owner_user_id)
                : memberName(row.created_by);
              const canEditThis = canManage && canViewThis;
              return (
                <div key={item.id} className={`rounded-2xl border p-4 ${row.visibility === "private" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-black">{title}</p>{row.visibility === "private" ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">{t("PRIVÉ", "PRIVATE")}</span> : null}</div>
                      <p className="mt-1 text-sm text-slate-700">{formatDate(row.work_date, locale)} · {fmtTime(row.start_time)}–{fmtTime(row.end_time)} · {normalizeTimeZone(row.timezone)}</p>
                      {canViewThis && row.location ? <p className="mt-1 text-sm text-slate-600">{row.location}</p> : null}
                      {canViewThis && row.attendees ? <p className="mt-1 text-xs text-slate-500">{t("Participants", "Attendees")}: {row.attendees}</p> : null}
                      {canViewThis && row.notes ? <p className="mt-2 text-sm text-slate-600">{row.notes}</p> : null}
                      {canViewThis && row.meeting_link ? <a href={row.meeting_link} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-black text-indigo-700 hover:underline">{t("Ouvrir le lien de réunion →", "Open meeting link →")}</a> : null}
                      <p className="mt-2 text-[11px] font-semibold text-slate-500">{row.source === "delegate" ? t(`Planifié par ${creator} pour ${memberName(row.owner_user_id)}`, `Scheduled by ${creator} for ${memberName(row.owner_user_id)}`) : t("Planifié par le propriétaire", "Scheduled by the owner")}</p>
                    </div>
                    {canEditThis ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Link href={`/dashboard/schedule?month=${month}&agendaOwner=${selectedOwnerId}&appointment=${row.id}#agenda-editor`} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-50">{t("Modifier", "Edit")}</Link>
                        {canCancel ? (
                          <form action={cancelPersonalAgendaAppointmentAction}>
                            <input type="hidden" name="month" value={month} />
                            <input type="hidden" name="ownerUserId" value={selectedOwnerId} />
                            <input type="hidden" name="appointmentId" value={row.id} />
                            <input type="hidden" name="reason" value={t("Annulé depuis l'agenda", "Cancelled from calendar")} />
                            <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50">{t("Annuler", "Cancel")}</button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">{t("Aucune période occupée enregistrée pour ce mois.", "No busy period is recorded for this month.")}</p>}
          </div>
        </article>

        {canManage ? (
          <aside id="agenda-editor" className="scroll-mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-emerald-700">{selectedOwnerId === authData.user.id ? t("Mon rendez-vous", "My appointment") : t("Agir pour le compte de", "Acting on behalf of")}</p>
            <h3 className="mt-1 text-2xl font-black text-emerald-950">{selectedAppointmentVisible ? t("Modifier le rendez-vous", "Edit appointment") : t("Planifier un rendez-vous", "Schedule appointment")}</h3>
            <p className="mt-2 text-sm text-emerald-900">{selectedOwnerId === authData.user.id ? t("Ajoutez un engagement personnel à votre agenda.", "Add a personal commitment to your calendar.") : t(`Vous planifiez pour ${memberName(selectedOwnerId)}. L'audit conservera votre identité.`, `You are scheduling for ${memberName(selectedOwnerId)}. The audit will keep your identity.`)}</p>
            <form action={savePersonalAgendaAppointmentAction} className="mt-5 space-y-4">
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="ownerUserId" value={selectedOwnerId} />
              <input type="hidden" name="appointmentId" value={selectedAppointmentVisible?.id ?? ""} />
              <Field label={t("Titre", "Title")}><input name="title" required defaultValue={selectedAppointmentVisible?.title ?? ""} placeholder={t("Ex. Rendez-vous avec ABC Investment", "e.g. Meeting with ABC Investment")} className={inputClass} /></Field>
              <Field label={t("Date", "Date")}><input name="workDate" type="date" required defaultValue={selectedAppointmentVisible?.work_date ?? monthBounds.start} className={inputClass} /></Field>
              <div className="grid gap-4 sm:grid-cols-2"><Field label={t("Début", "Start")}><input name="startTime" type="time" required defaultValue={fmtTime(selectedAppointmentVisible?.start_time || "09:00")} className={inputClass} /></Field><Field label={t("Fin", "End")}><input name="endTime" type="time" required defaultValue={fmtTime(selectedAppointmentVisible?.end_time || "10:00")} className={inputClass} /></Field></div>
              <Field label={t("Fuseau horaire", "Time zone")}><input name="timezone" defaultValue={normalizeTimeZone(selectedAppointmentVisible?.timezone || "Europe/Dublin")} className={inputClass} /></Field>
              <Field label={t("Lieu", "Location")}><input name="location" defaultValue={selectedAppointmentVisible?.location ?? ""} placeholder={t("Bureau, restaurant, adresse...", "Office, restaurant, address...")} className={inputClass} /></Field>
              <Field label={t("Participants / invités", "Attendees / guests")}><input name="attendees" defaultValue={selectedAppointmentVisible?.attendees ?? ""} placeholder={t("Noms, e-mails ou organisation", "Names, emails or organization")} className={inputClass} /></Field>
              <Field label={t("Lien de réunion (facultatif)", "Meeting link (optional)")}><input name="meetingLink" type="url" defaultValue={selectedAppointmentVisible?.meeting_link ?? ""} placeholder="https://..." className={inputClass} /></Field>
              <Field label={t("Notes", "Notes")}><textarea name="notes" rows={3} defaultValue={selectedAppointmentVisible?.notes ?? ""} className={inputClass} /></Field>
              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-white p-4 text-sm font-bold text-amber-950">
                <input name="private" type="checkbox" defaultChecked={selectedAppointmentVisible?.visibility === "private"} disabled={selectedOwnerId !== authData.user.id && !selectedDelegation?.can_view_private_details} />
                <span><span className="block font-black">{t("Privé / confidentiel", "Private / confidential")}</span><span className="mt-1 block text-xs font-semibold text-amber-800">{t("Sans autorisation spéciale, l'assistant voit seulement « Indisponible ».", "Without special permission, the assistant only sees “Busy”.")}</span></span>
              </label>
              <button className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-black text-white hover:bg-emerald-800">{selectedAppointmentVisible ? t("Enregistrer les modifications", "Save changes") : t("Ajouter à l'agenda", "Add to calendar")}</button>
              {selectedAppointmentVisible ? <Link href={`/dashboard/schedule?month=${month}&agendaOwner=${selectedOwnerId}#agenda-editor`} className="block text-center text-sm font-black text-emerald-800 hover:underline">{t("Annuler la modification", "Cancel editing")}</Link> : null}
            </form>
          </aside>
        ) : (
          <aside className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">{t("Lecture seule", "Read only")}</p>
            <h3 className="mt-1 text-2xl font-black">{t("Disponibilités uniquement", "Availability only")}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("Ce niveau permet de savoir quand le responsable est disponible ou occupé, sans créer ni modifier de rendez-vous.", "This level lets you see when the leader is available or busy, without creating or editing appointments.")}</p>
          </aside>
        )}
      </div>
    </section>
  );
}
