import Link from "next/link";
import {
  recordAbsenceContactAction,
  sendAttendanceContactRequestAction,
  updateEmployeeWorkContactAction,
} from "@/app/actions/performance";

export type AbsenceFollowupItem = {
  id: string;
  contact_channel: string;
  outcome: string;
  note: string;
  next_follow_up_at: string | null;
  created_at: string;
  actor_name: string;
};

export type AbsenceContactPanelProps = {
  locale: string;
  closeHref: string;
  returnTo: string;
  workDate: string;
  timezone: string;
  canEditContact: boolean;
  member: {
    id: string;
    name: string;
    email: string;
    workPhone: string;
    workWhatsapp: string;
    positionTitle: string;
    roleLabel: string;
    department: string;
    teams: string[];
  };
  attendance: {
    status: string;
    clockInAt: string | null;
    lateMinutes: number;
    justification: string | null;
  } | null;
  schedule: {
    startTime: string;
    endTime: string;
    timezone: string;
  } | null;
  onLeave: boolean;
  lastAttendanceAt: string | null;
  followups: AbsenceFollowupItem[];
};

function phoneHref(value: string) {
  const cleaned = value.replace(/[^+\d]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

function whatsappHref(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function statusClass(outcome: string | undefined) {
  if (outcome === "justified") return "bg-emerald-100 text-emerald-800";
  if (outcome === "escalated_hr") return "bg-red-100 text-red-800";
  if (outcome === "no_answer") return "bg-amber-100 text-amber-900";
  if (outcome === "notification_sent" || outcome?.startsWith("contacted_")) return "bg-indigo-100 text-indigo-800";
  return "bg-slate-100 text-slate-700";
}

export function AbsenceContactPanel(props: AbsenceContactPanelProps) {
  const fr = props.locale === "fr";
  const latest = props.followups[0] ?? null;
  const isLate = props.attendance?.status === "late" || Number(props.attendance?.lateMinutes ?? 0) > 0;
  const presenceLabel = props.onLeave
    ? (fr ? "Congé approuvé" : "Approved leave")
    : isLate
      ? (fr ? "En retard" : "Late")
      : (fr ? "Absent" : "Absent");

  const labels = {
    title: fr ? "Centre de contact et de suivi" : "Contact and follow-up centre",
    subtitle: fr
      ? "Contact direct, notification Super Leader et historique auditable pour agir rapidement."
      : "Direct contact, Super Leader notification and an auditable history for fast action.",
    close: fr ? "Fermer" : "Close",
    schedule: fr ? "Horaire prévu" : "Scheduled hours",
    lastPresence: fr ? "Dernière présence enregistrée" : "Last recorded attendance",
    noPreviousPresence: fr ? "Aucune présence antérieure trouvée" : "No previous attendance found",
    contact: fr ? "Contacter maintenant" : "Contact now",
    call: fr ? "Appeler" : "Call",
    whatsapp: "WhatsApp",
    email: fr ? "Envoyer un email" : "Send email",
    notify: fr ? "Notifier dans Super Leader" : "Notify in Super Leader",
    notifyHelp: fr
      ? "L’employé recevra une demande urgente de pointer ou de contacter son manager."
      : "The employee will receive an urgent request to clock in or contact their manager.",
    missingPhone: fr ? "Téléphone professionnel non renseigné" : "Professional phone not provided",
    missingWhatsapp: fr ? "WhatsApp professionnel non renseigné" : "Professional WhatsApp not provided",
    details: fr ? "Fiche du collaborateur" : "Employee profile",
    position: fr ? "Poste" : "Job title",
    department: fr ? "Département" : "Department",
    teams: fr ? "Équipes" : "Teams",
    role: fr ? "Rôle" : "Role",
    updateDirectory: fr ? "Mettre à jour les coordonnées professionnelles" : "Update professional contact details",
    saveDirectory: fr ? "Enregistrer les coordonnées" : "Save contact details",
    phone: fr ? "Téléphone professionnel" : "Professional phone",
    workWhatsapp: fr ? "WhatsApp professionnel" : "Professional WhatsApp",
    logTitle: fr ? "Enregistrer le résultat du contact" : "Record contact outcome",
    channel: fr ? "Canal utilisé" : "Contact channel",
    outcome: fr ? "Résultat" : "Outcome",
    note: fr ? "Note interne" : "Internal note",
    followUp: fr ? "Prochain suivi (facultatif)" : "Next follow-up (optional)",
    saveFollowUp: fr ? "Enregistrer le suivi" : "Save follow-up",
    history: fr ? "Historique des contacts" : "Contact history",
    noHistory: fr ? "Aucune tentative de contact enregistrée." : "No contact attempt has been recorded.",
    notContacted: fr ? "Pas encore contacté" : "Not contacted yet",
    migration: fr
      ? "La migration 038 doit être exécutée avant d’enregistrer les coordonnées ou l’historique."
      : "Migration 038 must be run before saving contact details or history.",
    lateMinutes: fr ? "Minutes de retard" : "Minutes late",
  };

  const outcomeLabels: Record<string, string> = {
    contacted_on_the_way: fr ? "Contacté — en route" : "Contacted — on the way",
    contacted_sick: fr ? "Contacté — malade" : "Contacted — sick",
    contacted_technical_issue: fr ? "Contacté — problème technique" : "Contacted — technical issue",
    contacted_other: fr ? "Contacté — autre motif" : "Contacted — other reason",
    no_answer: fr ? "Pas de réponse" : "No answer",
    justified: fr ? "Absence ou retard justifié" : "Absence or delay justified",
    escalated_hr: fr ? "Escalade RH nécessaire" : "HR escalation required",
    notification_sent: fr ? "Notification Super Leader envoyée" : "Super Leader notification sent",
  };
  const channelLabels: Record<string, string> = {
    phone: fr ? "Téléphone" : "Phone",
    whatsapp: "WhatsApp",
    email: "Email",
    notification: fr ? "Notification Super Leader" : "Super Leader notification",
    other: fr ? "Autre" : "Other",
  };

  const currentStatus = latest ? outcomeLabels[latest.outcome] ?? latest.outcome : labels.notContacted;
  const tel = phoneHref(props.member.workPhone);
  const wa = whatsappHref(props.member.workWhatsapp || props.member.workPhone);
  const emailHref = props.member.email
    ? `mailto:${props.member.email}?subject=${encodeURIComponent(fr ? `Suivi de présence du ${props.workDate}` : `Attendance follow-up on ${props.workDate}`)}`
    : "";
  const formatter = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: props.timezone,
  });

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/55 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={labels.title}>
      <Link href={props.closeHref} aria-label={labels.close} className="absolute inset-0" />
      <aside className="relative z-10 h-full w-full max-w-2xl overflow-y-auto bg-slate-50 shadow-2xl">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-950 px-6 py-6 text-white shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-400">Super Leader V2.9.2</p>
              <h2 className="mt-2 text-3xl font-black">{labels.title}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{labels.subtitle}</p>
            </div>
            <Link href={props.closeHref} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/20">
              × {labels.close}
            </Link>
          </div>
        </header>

        <div className="space-y-5 p-5 sm:p-6">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-r from-red-50 to-amber-50 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className={`text-sm font-black uppercase tracking-[0.14em] ${isLate ? "text-amber-700" : "text-red-700"}`}>{presenceLabel}</p>
                  <h3 className="mt-2 text-3xl font-black text-slate-950">{props.member.name}</h3>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{props.member.positionTitle || props.member.roleLabel}</p>
                </div>
                <span className={`rounded-full px-4 py-2 text-sm font-black ${statusClass(latest?.outcome)}`}>{currentStatus}</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white/80 p-4">
                  <p className="text-xs font-black uppercase text-slate-500">{labels.schedule}</p>
                  <p className="mt-1 font-black">{props.schedule ? `${props.schedule.startTime}–${props.schedule.endTime}` : "—"}</p>
                  {props.schedule?.timezone ? <p className="mt-1 text-xs text-slate-500">{props.schedule.timezone}</p> : null}
                </div>
                <div className="rounded-2xl bg-white/80 p-4">
                  <p className="text-xs font-black uppercase text-slate-500">{labels.lastPresence}</p>
                  <p className="mt-1 font-black">{props.lastAttendanceAt ? formatter.format(new Date(props.lastAttendanceAt)) : labels.noPreviousPresence}</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-4">
                  <p className="text-xs font-black uppercase text-slate-500">{labels.lateMinutes}</p>
                  <p className="mt-1 font-black">{Number(props.attendance?.lateMinutes ?? 0)} min</p>
                </div>
              </div>
              {props.attendance?.justification ? <p className="mt-4 rounded-2xl bg-white/80 p-4 text-sm text-slate-700">{props.attendance.justification}</p> : null}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-black">{labels.contact}</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {tel ? <a href={tel} className="rounded-2xl bg-slate-950 px-4 py-4 text-center font-black text-white">☎ {labels.call}</a> : <div className="rounded-2xl bg-slate-100 px-4 py-4 text-center text-xs font-bold text-slate-500">{labels.missingPhone}</div>}
              {wa ? <a href={wa} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-600 px-4 py-4 text-center font-black text-white">◉ {labels.whatsapp}</a> : <div className="rounded-2xl bg-slate-100 px-4 py-4 text-center text-xs font-bold text-slate-500">{labels.missingWhatsapp}</div>}
              {emailHref ? <a href={emailHref} className="rounded-2xl bg-indigo-700 px-4 py-4 text-center font-black text-white">✉ {labels.email}</a> : null}
            </div>
            <form action={sendAttendanceContactRequestAction} className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <input type="hidden" name="subjectUserId" value={props.member.id} />
              <input type="hidden" name="workDate" value={props.workDate} />
              <input type="hidden" name="returnTo" value={props.returnTo} />
              <p className="text-sm font-bold text-amber-900">{labels.notifyHelp}</p>
              <button className="mt-3 w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 hover:bg-amber-400">🔔 {labels.notify}</button>
            </form>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-black">{labels.details}</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs font-black uppercase text-slate-500">Email</dt><dd className="mt-1 break-all font-bold">{props.member.email || "—"}</dd></div>
              <div><dt className="text-xs font-black uppercase text-slate-500">{labels.role}</dt><dd className="mt-1 font-bold">{props.member.roleLabel}</dd></div>
              <div><dt className="text-xs font-black uppercase text-slate-500">{labels.position}</dt><dd className="mt-1 font-bold">{props.member.positionTitle || "—"}</dd></div>
              <div><dt className="text-xs font-black uppercase text-slate-500">{labels.department}</dt><dd className="mt-1 font-bold">{props.member.department || "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs font-black uppercase text-slate-500">{labels.teams}</dt><dd className="mt-2 flex flex-wrap gap-2">{props.member.teams.length ? props.member.teams.map((team) => <span key={team} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{team}</span>) : "—"}</dd></div>
            </dl>
          </section>

          {props.canEditContact ? (
            <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
              <h3 className="text-xl font-black text-indigo-950">{labels.updateDirectory}</h3>
              <form action={updateEmployeeWorkContactAction} className="mt-4 grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="subjectUserId" value={props.member.id} />
                <input type="hidden" name="workDate" value={props.workDate} />
                <input type="hidden" name="returnTo" value={props.returnTo} />
                <label className="text-sm font-black text-indigo-950 sm:col-span-2">{labels.position}<input name="positionTitle" defaultValue={props.member.positionTitle} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
                <label className="text-sm font-black text-indigo-950">{labels.phone}<input name="workPhone" type="tel" defaultValue={props.member.workPhone} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
                <label className="text-sm font-black text-indigo-950">{labels.workWhatsapp}<input name="workWhatsapp" type="tel" defaultValue={props.member.workWhatsapp} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3" /></label>
                <button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white sm:col-span-2">{labels.saveDirectory}</button>
              </form>
            </section>
          ) : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-black">{labels.logTitle}</h3>
            <form action={recordAbsenceContactAction} className="mt-4 space-y-4">
              <input type="hidden" name="subjectUserId" value={props.member.id} />
              <input type="hidden" name="workDate" value={props.workDate} />
              <input type="hidden" name="returnTo" value={props.returnTo} />
              <input type="hidden" name="timezone" value={props.timezone} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-black">{labels.channel}<select name="contactChannel" defaultValue={tel ? "phone" : emailHref ? "email" : "other"} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-sm font-black">{labels.outcome}<select name="outcome" defaultValue="no_answer" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">{Object.entries(outcomeLabels).filter(([value]) => value !== "notification_sent").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              </div>
              <label className="block text-sm font-black">{labels.note}<textarea name="note" rows={4} maxLength={3000} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
              <label className="block text-sm font-black">{labels.followUp}<input name="nextFollowUpAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
              <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{labels.saveFollowUp}</button>
            </form>
            <p className="mt-3 text-xs text-slate-500">{labels.migration}</p>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-black">{labels.history}</h3>
            <div className="mt-4 space-y-3">
              {props.followups.length ? props.followups.map((item) => (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-black">{outcomeLabels[item.outcome] ?? item.outcome}</p><p className="mt-1 text-xs font-semibold text-slate-500">{channelLabels[item.contact_channel] ?? item.contact_channel} · {item.actor_name}</p></div>
                    <time className="text-xs font-bold text-slate-500">{formatter.format(new Date(item.created_at))}</time>
                  </div>
                  {item.note ? <p className="mt-3 text-sm leading-6 text-slate-700">{item.note}</p> : null}
                  {item.next_follow_up_at ? <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-900">{labels.followUp}: {formatter.format(new Date(item.next_follow_up_at))}</p> : null}
                </article>
              )) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{labels.noHistory}</p>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
