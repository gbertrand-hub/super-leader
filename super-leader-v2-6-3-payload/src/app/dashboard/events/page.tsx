import Link from "next/link";
import {redirect} from "next/navigation";
import {
  addEventDocumentAction,
  assignEventMemberAction,
  createEventAction,
  createEventScheduleItemAction,
  createEventTaskAction,
  removeEventMemberAction,
  saveEventClosureReportAction,
  updateEventAction,
  updateEventTaskAction,
} from "@/app/actions/events";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {event?: string | string[]; success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type EventRow = {
  id: string;
  organization_id: string;
  name: string;
  event_type: string;
  status: string;
  description: string | null;
  objectives: string | null;
  country: string | null;
  city: string | null;
  venue: string | null;
  timezone: string;
  start_at: string;
  end_at: string;
  expected_participants: number;
  budget_amount: number | string | null;
  currency: string;
  leader_id: string | null;
  created_by: string;
  created_at: string;
};
type EventMemberRow = {
  id: string;
  user_id: string;
  mission_role: string;
  unit_name: string | null;
  responsibilities: string | null;
  can_manage: boolean;
  status: string;
};
type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  milestone: string | null;
  assignee_id: string | null;
  priority: string;
  status: string;
  progress: number;
  due_at: string | null;
  budget_estimate: number | string | null;
  actual_cost: number | string | null;
  currency: string;
  proof_url: string | null;
  notes: string | null;
};
type ScheduleRow = {
  id: string;
  title: string;
  item_type: string;
  start_at: string;
  end_at: string;
  location: string | null;
  meeting_url: string | null;
  unit_name: string | null;
  owner_id: string | null;
  status: string;
  notes: string | null;
};
type DocumentRow = {id: string; title: string; category: string; document_url: string; notes: string | null; created_at: string};
type ReportRow = {
  actual_participants: number;
  revenue_amount: number | string | null;
  expense_amount: number | string | null;
  currency: string;
  objectives_achieved: string | null;
  highlights: string | null;
  incidents: string | null;
  lessons_learned: string | null;
  recommendations: string | null;
  submitted_at: string | null;
};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type MemberRoleRow = {user_id: string; role: string};

const adminRoles = new Set(["owner", "admin", "hr"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

function textAreaClass() {
  return `${fieldClass()} min-h-24 resize-y`;
}

function formatDateTime(iso: string, timeZone: string, locale: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function localDateTime(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function Badge({children, tone = "slate"}: {children: React.ReactNode; tone?: "slate" | "indigo" | "emerald" | "amber" | "red" | "violet"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    indigo: "bg-indigo-100 text-indigo-800",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    violet: "bg-violet-100 text-violet-800",
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function statusTone(status: string): "slate" | "indigo" | "emerald" | "amber" | "red" | "violet" {
  if (["completed", "done", "confirmed"].includes(status)) return "emerald";
  if (["in_progress", "open", "normal"].includes(status)) return "indigo";
  if (["planning", "assigned", "todo", "planned", "high"].includes(status)) return "amber";
  if (["cancelled", "blocked", "declined", "critical"].includes(status)) return "red";
  if (status === "draft") return "violet";
  return "slate";
}

function labelValue(value: string, locale: string) {
  const labels: Record<string, [string, string]> = {
    conference: ["Conférence", "Conference"], masterclass: ["Masterclass", "Masterclass"], training: ["Formation", "Training"], ceremony: ["Cérémonie", "Ceremony"], networking: ["Réseautage", "Networking"], community: ["Communautaire", "Community"], other: ["Autre", "Other"],
    draft: ["Brouillon", "Draft"], planning: ["Préparation", "Planning"], open: ["Ouvert", "Open"], in_progress: ["En cours", "In progress"], completed: ["Terminé", "Completed"], cancelled: ["Annulé", "Cancelled"], archived: ["Archivé", "Archived"],
    assigned: ["Affecté", "Assigned"], confirmed: ["Confirmé", "Confirmed"], declined: ["Refusé", "Declined"], removed: ["Retiré", "Removed"],
    todo: ["À faire", "To do"], blocked: ["Bloquée", "Blocked"], done: ["Terminée", "Done"],
    low: ["Faible", "Low"], normal: ["Normale", "Normal"], high: ["Élevée", "High"], critical: ["Critique", "Critical"],
    meeting: ["Réunion", "Meeting"], session: ["Session", "Session"], travel: ["Voyage", "Travel"], logistics: ["Logistique", "Logistics"], rehearsal: ["Répétition", "Rehearsal"], setup: ["Installation", "Setup"], break: ["Pause", "Break"], planned: ["Planifiée", "Planned"],
    contract: ["Contrat", "Contract"], quote: ["Devis", "Quote"], invoice: ["Facture", "Invoice"], programme: ["Programme", "Programme"], marketing: ["Marketing", "Marketing"], hotel: ["Hôtel", "Hotel"], presentation: ["Présentation", "Presentation"], photo_video: ["Photos & vidéos", "Photos & videos"], report: ["Rapport", "Report"],
  };
  const label = labels[value];
  return label ? label[locale === "fr" ? 0 : 1] : value.replaceAll("_", " ");
}

function Metric({label, value, detail}: {label: string; value: string; detail: string}) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></article>;
}

function eventCopy(locale: string) {
  const fr = locale === "fr";
  return {
    eyebrow: fr ? "Opérations événementielles" : "Event operations",
    title: fr ? "Événements & équipes de mission" : "Events & mission teams",
    subtitle: fr ? "Crée des conférences, réunis des collaborateurs de plusieurs équipes et pilote les responsabilités sans modifier la structure permanente." : "Create conferences, bring colleagues together across teams and manage responsibilities without changing the permanent structure.",
    setupTitle: fr ? "Activation du module Événements requise" : "Events module setup required",
    setupHelp: fr ? "Exécute la migration V2.6.3 dans Supabase avant d’utiliser ce module." : "Run the V2.6.3 migration in Supabase before using this module.",
    loadFailed: fr ? "Chargement des événements impossible" : "Unable to load events",
    create: fr ? "Créer un événement" : "Create an event",
    createHelp: fr ? "Le responsable et l’équipe de mission seront temporaires et n’affecteront pas les équipes permanentes." : "The lead and mission team are temporary and will not alter permanent teams.",
    myEvents: fr ? "Mes événements" : "My events",
    allEvents: fr ? "Événements visibles" : "Visible events",
    noEvents: fr ? "Aucun événement n’est encore disponible." : "No events are available yet.",
    selectEvent: fr ? "Sélectionne un événement pour ouvrir son centre opérationnel." : "Select an event to open its operations centre.",
    eventName: fr ? "Nom de l’événement" : "Event name",
    type: fr ? "Type" : "Type",
    status: fr ? "Statut" : "Status",
    start: fr ? "Début" : "Start",
    end: fr ? "Fin" : "End",
    timezone: fr ? "Fuseau horaire" : "Time zone",
    country: fr ? "Pays" : "Country",
    city: fr ? "Ville" : "City",
    venue: fr ? "Lieu" : "Venue",
    description: fr ? "Description" : "Description",
    objectives: fr ? "Objectifs" : "Objectives",
    expected: fr ? "Participants attendus" : "Expected attendees",
    budget: fr ? "Budget prévisionnel" : "Planned budget",
    currency: fr ? "Devise" : "Currency",
    leader: fr ? "Responsable principal" : "Event lead",
    noLeader: fr ? "À désigner" : "Assign later",
    createButton: fr ? "Créer l’événement" : "Create event",
    saveChanges: fr ? "Enregistrer les modifications" : "Save changes",
    missionTeam: fr ? "Équipe de mission" : "Mission team",
    missionTeamHelp: fr ? "Les membres conservent leurs équipes permanentes. Cette affectation prend fin avec l’événement." : "Members keep their permanent teams. This assignment ends with the event.",
    addMember: fr ? "Ajouter un membre" : "Add member",
    colleague: fr ? "Collaborateur" : "Colleague",
    missionRole: fr ? "Rôle dans l’événement" : "Event role",
    unit: fr ? "Cellule / pôle" : "Unit / workstream",
    responsibilities: fr ? "Responsabilités" : "Responsibilities",
    canManage: fr ? "Peut gérer cet événement" : "Can manage this event",
    assigned: fr ? "Affecté" : "Assigned",
    confirmed: fr ? "Confirmé" : "Confirmed",
    remove: fr ? "Retirer" : "Remove",
    tasks: fr ? "Tâches & jalons" : "Tasks & milestones",
    addTask: fr ? "Créer une tâche" : "Create task",
    taskTitle: fr ? "Titre de la tâche" : "Task title",
    milestone: fr ? "Jalon" : "Milestone",
    assignee: fr ? "Responsable" : "Assignee",
    unassigned: fr ? "Non affectée" : "Unassigned",
    priority: fr ? "Priorité" : "Priority",
    due: fr ? "Échéance" : "Due date",
    progress: fr ? "Avancement" : "Progress",
    notes: fr ? "Notes" : "Notes",
    proof: fr ? "Lien de preuve" : "Proof link",
    actualCost: fr ? "Coût réel" : "Actual cost",
    update: fr ? "Mettre à jour" : "Update",
    schedule: fr ? "Planning événementiel" : "Event schedule",
    addSchedule: fr ? "Ajouter une activité" : "Add activity",
    activityTitle: fr ? "Activité" : "Activity",
    owner: fr ? "Responsable de l’activité" : "Activity owner",
    meetingUrl: fr ? "Lien Zoom ou réunion" : "Zoom or meeting link",
    location: fr ? "Lieu" : "Location",
    add: fr ? "Ajouter" : "Add",
    documents: fr ? "Documents" : "Documents",
    addDocument: fr ? "Ajouter un document" : "Add document",
    documentTitle: fr ? "Titre du document" : "Document title",
    documentUrl: fr ? "Lien sécurisé ou externe" : "Secure or external link",
    category: fr ? "Catégorie" : "Category",
    open: fr ? "Ouvrir" : "Open",
    finalReport: fr ? "Rapport final" : "Final report",
    finalReportHelp: fr ? "À compléter après l’événement pour conserver les résultats, difficultés et leçons apprises." : "Complete after the event to preserve results, issues and lessons learned.",
    actualParticipants: fr ? "Participants réels" : "Actual attendees",
    revenue: fr ? "Revenus" : "Revenue",
    expenses: fr ? "Dépenses" : "Expenses",
    objectivesAchieved: fr ? "Objectifs atteints" : "Objectives achieved",
    highlights: fr ? "Points forts et résultats" : "Highlights and outcomes",
    incidents: fr ? "Incidents ou difficultés" : "Incidents or issues",
    lessons: fr ? "Leçons apprises" : "Lessons learned",
    recommendations: fr ? "Recommandations" : "Recommendations",
    saveReport: fr ? "Enregistrer le rapport final" : "Save final report",
    teamMembers: fr ? "membres" : "members",
    tasksDone: fr ? "tâches terminées" : "tasks completed",
    eventProgress: fr ? "Progression globale" : "Overall progress",
    upcoming: fr ? "À venir" : "Upcoming",
    active: fr ? "En cours" : "Active",
    overdue: fr ? "Tâches en retard" : "Overdue tasks",
    dateRange: fr ? "Période" : "Dates",
    operationalCentre: fr ? "Centre opérationnel" : "Operations centre",
    noTeam: fr ? "Aucun membre n’est encore affecté." : "No members have been assigned yet.",
    noTasks: fr ? "Aucune tâche n’est encore créée." : "No tasks have been created yet.",
    noSchedule: fr ? "Aucune activité n’est encore planifiée." : "No activities have been scheduled yet.",
    noDocuments: fr ? "Aucun document n’est encore ajouté." : "No documents have been added yet.",
    permanentTeamNotice: fr ? "Les affectations ci-dessous sont temporaires. Les équipes et rôles permanents restent inchangés." : "The assignments below are temporary. Permanent teams and system roles remain unchanged.",
  };
}

const typeValues = ["conference", "masterclass", "training", "ceremony", "networking", "community", "other"];
const statusValues = ["draft", "planning", "open", "in_progress", "completed", "cancelled", "archived"];
const taskStatusValues = ["todo", "in_progress", "blocked", "done", "cancelled"];
const priorities = ["low", "normal", "high", "critical"];
const scheduleTypes = ["meeting", "session", "travel", "logistics", "rehearsal", "setup", "break", "other"];
const documentCategories = ["contract", "quote", "invoice", "programme", "marketing", "travel", "hotel", "presentation", "photo_video", "report", "other"];

export default async function EventsPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {locale} = await getI18n();
  const c = eventCopy(locale);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");

  const eventsResult = await admin.from("events").select("id,organization_id,name,event_type,status,description,objectives,country,city,venue,timezone,start_at,end_at,expected_participants,budget_amount,currency,leader_id,created_by,created_at").eq("organization_id", membership.organization_id).order("start_at", {ascending: true});
  if (eventsResult.error && ["42P01", "PGRST205"].includes(eventsResult.error.code)) {
    return <main className="p-6 lg:p-10"><section className="mx-auto max-w-5xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><p className="text-sm font-black uppercase tracking-[0.2em] text-amber-700">Super Leader V2.6.3</p><h1 className="mt-3 text-3xl font-black text-amber-950">{c.setupTitle}</h1><p className="mt-3 text-amber-900">{c.setupHelp}</p><code className="mt-5 block rounded-2xl bg-slate-950 p-4 text-sm text-white">supabase/034_events_temporary_teams_v2_6_3.sql</code></section></main>;
  }
  if (eventsResult.error) {
    return <main className="p-6 lg:p-10"><section className="mx-auto max-w-5xl rounded-3xl border border-red-200 bg-red-50 p-8"><h1 className="text-3xl font-black text-red-900">{c.loadFailed}</h1><p className="mt-3 text-red-800">{eventsResult.error.message}</p></section></main>;
  }

  await enforceOrganizationFeature(membership.organization_id, "events");
  const allEvents = (eventsResult.data ?? []) as EventRow[];
  const {data: ownEventMemberships} = await admin.from("event_team_members").select("event_id,can_manage,status").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).in("status", ["assigned", "confirmed"]);
  const ownEventIds = new Set((ownEventMemberships ?? []).map((row) => String(row.event_id)));
  const visibleEvents = adminRoles.has(membership.role)
    ? allEvents
    : allEvents.filter((event) => event.leader_id === authData.user.id || ownEventIds.has(event.id));

  const requestedEventId = first(params.event);
  const selectedEvent = visibleEvents.find((event) => event.id === requestedEventId)
    ?? visibleEvents.find((event) => !["archived", "cancelled", "completed"].includes(event.status))
    ?? visibleEvents[0]
    ?? null;

  const [memberRowsResult, profileRowsResult] = await Promise.all([
    admin.from("organization_members").select("user_id,role").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("profiles").select("id,full_name,email"),
  ]);
  const memberRoleRows = (memberRowsResult.data ?? []) as MemberRoleRow[];
  const activeUserIds = memberRoleRows.map((row) => row.user_id);
  const profiles = ((profileRowsResult.data ?? []) as ProfileRow[]).filter((profile) => activeUserIds.includes(profile.id));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(memberRoleRows.map((row) => [row.user_id, row.role]));
  const people = activeUserIds.map((id) => ({
    id,
    name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || id,
    email: profileById.get(id)?.email || "",
    role: roleById.get(id) || "employee",
  })).sort((a, b) => a.name.localeCompare(b.name));

  let eventMembers: EventMemberRow[] = [];
  let tasks: TaskRow[] = [];
  let schedule: ScheduleRow[] = [];
  let documents: DocumentRow[] = [];
  let report: ReportRow | null = null;
  if (selectedEvent) {
    const [eventMembersResult, tasksResult, scheduleResult, documentsResult, reportResult] = await Promise.all([
      admin.from("event_team_members").select("id,user_id,mission_role,unit_name,responsibilities,can_manage,status").eq("event_id", selectedEvent.id).neq("status", "removed").order("assigned_at", {ascending: true}),
      admin.from("event_tasks").select("id,title,description,milestone,assignee_id,priority,status,progress,due_at,budget_estimate,actual_cost,currency,proof_url,notes").eq("event_id", selectedEvent.id).order("due_at", {ascending: true, nullsFirst: false}).order("created_at", {ascending: false}),
      admin.from("event_schedule_items").select("id,title,item_type,start_at,end_at,location,meeting_url,unit_name,owner_id,status,notes").eq("event_id", selectedEvent.id).order("start_at", {ascending: true}),
      admin.from("event_documents").select("id,title,category,document_url,notes,created_at").eq("event_id", selectedEvent.id).order("created_at", {ascending: false}),
      admin.from("event_closure_reports").select("actual_participants,revenue_amount,expense_amount,currency,objectives_achieved,highlights,incidents,lessons_learned,recommendations,submitted_at").eq("event_id", selectedEvent.id).maybeSingle<ReportRow>(),
    ]);
    const detailError = [eventMembersResult.error, tasksResult.error, scheduleResult.error, documentsResult.error, reportResult.error].find(Boolean);
    if (detailError) {
      return <main className="p-6 lg:p-10"><section className="mx-auto max-w-5xl rounded-3xl border border-red-200 bg-red-50 p-8"><h1 className="text-3xl font-black text-red-900">{c.loadFailed}</h1><p className="mt-3 text-red-800">{detailError?.message}</p></section></main>;
    }
    eventMembers = (eventMembersResult.data ?? []) as EventMemberRow[];
    tasks = (tasksResult.data ?? []) as TaskRow[];
    schedule = (scheduleResult.data ?? []) as ScheduleRow[];
    documents = (documentsResult.data ?? []) as DocumentRow[];
    report = reportResult.data ?? null;
  }

  const currentEventMembership = selectedEvent ? eventMembers.find((row) => row.user_id === authData.user.id) : null;
  const canCreate = adminRoles.has(membership.role);
  const canManage = Boolean(selectedEvent && (canCreate || selectedEvent.leader_id === authData.user.id || currentEventMembership?.can_manage));
  const eventMemberIds = new Set(eventMembers.map((row) => row.user_id));
  const assignablePeople = people.filter((person) => !eventMemberIds.has(person.id));
  const eventPeople = eventMembers.map((member) => people.find((person) => person.id === member.user_id) ?? {id: member.user_id, name: member.user_id, email: "", role: "employee"});
  const eventProfileById = new Map(eventPeople.map((person) => [person.id, person]));
  const taskDone = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / tasks.length) : 0;
  const now = Date.now();
  const overdueTasks = tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < now && !["done", "cancelled"].includes(task.status)).length;
  const upcomingEvents = visibleEvents.filter((event) => new Date(event.start_at).getTime() > now && !["cancelled", "archived"].includes(event.status)).length;
  const activeEvents = visibleEvents.filter((event) => ["planning", "open", "in_progress"].includes(event.status)).length;
  const moneyFormatter = (currency: string) => new Intl.NumberFormat("en-GB", {style: "currency", currency: currency || "USD", maximumFractionDigits: 2});

  return <main className="p-5 lg:p-8">
    <div className="mx-auto max-w-[1500px] space-y-6">
      <Link href="/dashboard" className="inline-flex font-bold text-indigo-600 hover:text-indigo-800">← {locale === "fr" ? "Retour au tableau de bord" : "Back to dashboard"}</Link>
      <section className="rounded-[2rem] bg-slate-950 px-7 py-8 text-white lg:px-10">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-amber-400">{c.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-black lg:text-5xl">{c.title}</h1>
        <p className="mt-3 max-w-4xl leading-7 text-slate-300">{c.subtitle}</p>
      </section>

      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
      {errorMessage ? <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={c.allEvents} value={String(visibleEvents.length)} detail={c.myEvents} />
        <Metric label={c.upcoming} value={String(upcomingEvents)} detail={c.dateRange} />
        <Metric label={c.active} value={String(activeEvents)} detail={c.operationalCentre} />
        <Metric label={c.overdue} value={String(overdueTasks)} detail={c.tasks} />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="space-y-6 xl:sticky xl:top-6">
          {canCreate ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black text-slate-950">{c.create}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{c.createHelp}</p>
            <form action={createEventAction} className="mt-5 space-y-4">
              <label className="block text-sm font-black">{c.eventName}<input name="name" required minLength={3} className={fieldClass()} /></label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <label className="block text-sm font-black">{c.type}<select name="eventType" defaultValue="conference" className={fieldClass()}>{typeValues.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label>
                <label className="block text-sm font-black">{c.status}<select name="status" defaultValue="planning" className={fieldClass()}>{statusValues.slice(0, 4).map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label>
              </div>
              <label className="block text-sm font-black">{c.start}<input name="startAt" type="datetime-local" required className={fieldClass()} /></label>
              <label className="block text-sm font-black">{c.end}<input name="endAt" type="datetime-local" required className={fieldClass()} /></label>
              <label className="block text-sm font-black">{c.timezone}<input name="timezone" defaultValue="Europe/Dublin" required className={fieldClass()} /></label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><label className="block text-sm font-black">{c.country}<input name="country" className={fieldClass()} /></label><label className="block text-sm font-black">{c.city}<input name="city" className={fieldClass()} /></label></div>
              <label className="block text-sm font-black">{c.venue}<input name="venue" className={fieldClass()} /></label>
              <label className="block text-sm font-black">{c.leader}<select name="leaderId" defaultValue="" className={fieldClass()}><option value="">{c.noLeader}</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label>
              <label className="block text-sm font-black">{c.expected}<input name="expectedParticipants" type="number" min="0" defaultValue="0" className={fieldClass()} /></label>
              <div className="grid grid-cols-[1fr_90px] gap-3"><label className="block text-sm font-black">{c.budget}<input name="budgetAmount" type="number" min="0" step="0.01" className={fieldClass()} /></label><label className="block text-sm font-black">{c.currency}<input name="currency" defaultValue="USD" maxLength={3} className={fieldClass()} /></label></div>
              <label className="block text-sm font-black">{c.description}<textarea name="description" className={textAreaClass()} /></label>
              <label className="block text-sm font-black">{c.objectives}<textarea name="objectives" className={textAreaClass()} /></label>
              <button className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-black text-white hover:bg-indigo-700">{c.createButton}</button>
            </form>
          </section> : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black text-slate-950">{c.myEvents}</h2><Badge tone="indigo">{visibleEvents.length}</Badge></div>
            <div className="mt-4 space-y-3">
              {visibleEvents.length ? visibleEvents.map((event) => <Link key={event.id} href={`/dashboard/events?event=${event.id}`} className={`block rounded-2xl border p-4 transition hover:border-indigo-400 ${selectedEvent?.id === event.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{event.name}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(event.start_at, event.timezone, dateLocale)}</p></div><Badge tone={statusTone(event.status)}>{labelValue(event.status, locale)}</Badge></div>
                <p className="mt-3 text-xs text-slate-500">{[event.city, event.country].filter(Boolean).join(", ") || event.timezone}</p>
              </Link>) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{c.noEvents}</p>}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          {!selectedEvent ? <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500">{c.selectEvent}</div> : <>
            <section className="rounded-[2rem] bg-slate-950 p-7 text-white lg:p-9">
              <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{labelValue(selectedEvent.event_type, locale)}</p><h2 className="mt-2 text-3xl font-black lg:text-5xl">{selectedEvent.name}</h2><p className="mt-3 text-slate-300">{formatDateTime(selectedEvent.start_at, selectedEvent.timezone, dateLocale)} — {formatDateTime(selectedEvent.end_at, selectedEvent.timezone, dateLocale)}</p><p className="mt-1 text-sm text-slate-400">{[selectedEvent.venue, selectedEvent.city, selectedEvent.country].filter(Boolean).join(" · ") || selectedEvent.timezone}</p></div><Badge tone={statusTone(selectedEvent.status)}>{labelValue(selectedEvent.status, locale)}</Badge></div>
              <div className="mt-7 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{c.missionTeam}</p><p className="mt-2 text-2xl font-black">{eventMembers.length}</p><p className="text-xs text-slate-400">{c.teamMembers}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{c.tasks}</p><p className="mt-2 text-2xl font-black">{taskDone}/{tasks.length}</p><p className="text-xs text-slate-400">{c.tasksDone}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{c.eventProgress}</p><p className="mt-2 text-2xl font-black">{progress}%</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-amber-400" style={{width: `${progress}%`}} /></div></div></div>
            </section>

            {canManage ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-2xl font-black text-slate-950">{c.operationalCentre}</h3>
              <form action={updateEventAction} className="mt-5 grid gap-4 lg:grid-cols-2">
                <input type="hidden" name="eventId" value={selectedEvent.id} />
                <label className="block text-sm font-black lg:col-span-2">{c.eventName}<input name="name" defaultValue={selectedEvent.name} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.type}<select name="eventType" defaultValue={selectedEvent.event_type} className={fieldClass()}>{typeValues.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label>
                <label className="block text-sm font-black">{c.status}<select name="status" defaultValue={selectedEvent.status} className={fieldClass()}>{statusValues.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label>
                <label className="block text-sm font-black">{c.start}<input name="startAt" type="datetime-local" defaultValue={localDateTime(selectedEvent.start_at, selectedEvent.timezone)} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.end}<input name="endAt" type="datetime-local" defaultValue={localDateTime(selectedEvent.end_at, selectedEvent.timezone)} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.timezone}<input name="timezone" defaultValue={selectedEvent.timezone} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.leader}<select name="leaderId" defaultValue={selectedEvent.leader_id ?? ""} className={fieldClass()}><option value="">{c.noLeader}</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label>
                <label className="block text-sm font-black">{c.country}<input name="country" defaultValue={selectedEvent.country ?? ""} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.city}<input name="city" defaultValue={selectedEvent.city ?? ""} className={fieldClass()} /></label>
                <label className="block text-sm font-black lg:col-span-2">{c.venue}<input name="venue" defaultValue={selectedEvent.venue ?? ""} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.expected}<input name="expectedParticipants" type="number" min="0" defaultValue={selectedEvent.expected_participants} className={fieldClass()} /></label>
                <div className="grid grid-cols-[1fr_90px] gap-3"><label className="block text-sm font-black">{c.budget}<input name="budgetAmount" type="number" min="0" step="0.01" defaultValue={selectedEvent.budget_amount ?? ""} className={fieldClass()} /></label><label className="block text-sm font-black">{c.currency}<input name="currency" defaultValue={selectedEvent.currency} maxLength={3} className={fieldClass()} /></label></div>
                <label className="block text-sm font-black lg:col-span-2">{c.description}<textarea name="description" defaultValue={selectedEvent.description ?? ""} className={textAreaClass()} /></label>
                <label className="block text-sm font-black lg:col-span-2">{c.objectives}<textarea name="objectives" defaultValue={selectedEvent.objectives ?? ""} className={textAreaClass()} /></label>
                <button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white lg:col-span-2">{c.saveChanges}</button>
              </form>
            </section> : null}

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-2xl font-black text-slate-950">{c.missionTeam}</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{c.missionTeamHelp}</p></div><Badge tone="violet">{eventMembers.length}</Badge></div>
              <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-900">{c.permanentTeamNotice}</div>
              {canManage ? <form action={assignEventMemberAction} className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 lg:grid-cols-2">
                <input type="hidden" name="eventId" value={selectedEvent.id} />
                <label className="block text-sm font-black">{c.colleague}<select name="userId" required defaultValue="" className={fieldClass()}><option value="" disabled>{c.colleague}</option>{assignablePeople.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label>
                <label className="block text-sm font-black">{c.missionRole}<input name="missionRole" required placeholder={locale === "fr" ? "Ex. Responsable logistique" : "E.g. Logistics lead"} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.unit}<input name="unitName" placeholder={locale === "fr" ? "Logistique, Média, Protocole..." : "Logistics, Media, Protocol..."} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.status}<select name="memberStatus" defaultValue="assigned" className={fieldClass()}><option value="assigned">{c.assigned}</option><option value="confirmed">{c.confirmed}</option></select></label>
                <label className="block text-sm font-black lg:col-span-2">{c.responsibilities}<textarea name="responsibilities" className={textAreaClass()} /></label>
                <label className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm font-black"><input name="canManage" type="checkbox" />{c.canManage}</label>
                <button className="rounded-xl bg-indigo-600 px-5 py-3 font-black text-white">{c.addMember}</button>
              </form> : null}
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {eventMembers.length ? eventMembers.map((member) => {const person = eventProfileById.get(member.user_id); return <article key={member.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{person?.name ?? member.user_id}</p><p className="mt-1 text-xs text-slate-500">{person?.email}</p></div><Badge tone={statusTone(member.status)}>{labelValue(member.status, locale)}</Badge></div><p className="mt-4 font-bold text-indigo-700">{member.mission_role}</p><p className="mt-1 text-sm text-slate-500">{member.unit_name || "—"}</p>{member.responsibilities ? <p className="mt-3 text-sm leading-6 text-slate-600">{member.responsibilities}</p> : null}<div className="mt-4 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{member.can_manage ? c.canManage : person?.role}</span>{canManage && member.user_id !== selectedEvent.leader_id ? <form action={removeEventMemberAction}><input type="hidden" name="eventId" value={selectedEvent.id} /><input type="hidden" name="userId" value={member.user_id} /><button className="text-xs font-black text-red-600">{c.remove}</button></form> : null}</div></article>}) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500 lg:col-span-2">{c.noTeam}</p>}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><h3 className="text-2xl font-black text-slate-950">{c.tasks}</h3><Badge tone="amber">{taskDone}/{tasks.length}</Badge></div>
              {canManage ? <form action={createEventTaskAction} className="mt-5 grid gap-3 rounded-2xl bg-amber-50 p-4 lg:grid-cols-2">
                <input type="hidden" name="eventId" value={selectedEvent.id} />
                <label className="block text-sm font-black lg:col-span-2">{c.taskTitle}<input name="title" required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.milestone}<input name="milestone" className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.assignee}<select name="assigneeId" defaultValue="" className={fieldClass()}><option value="">{c.unassigned}</option>{eventMembers.map((member) => <option key={member.user_id} value={member.user_id}>{eventProfileById.get(member.user_id)?.name ?? member.user_id} · {member.mission_role}</option>)}</select></label>
                <label className="block text-sm font-black">{c.priority}<select name="priority" defaultValue="normal" className={fieldClass()}>{priorities.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label>
                <label className="block text-sm font-black">{c.due}<input name="dueAt" type="datetime-local" className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.budget}<input name="budgetEstimate" type="number" min="0" step="0.01" className={fieldClass()} /></label>
                <label className="block text-sm font-black">{c.currency}<input name="currency" defaultValue={selectedEvent.currency} maxLength={3} className={fieldClass()} /></label>
                <label className="block text-sm font-black lg:col-span-2">{c.description}<textarea name="description" className={textAreaClass()} /></label>
                <button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white lg:col-span-2">{c.addTask}</button>
              </form> : null}
              <div className="mt-5 space-y-4">
                {tasks.length ? tasks.map((task) => {const canUpdateTask = canManage || task.assignee_id === authData.user.id; return <article key={task.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black text-slate-950">{task.title}</p><Badge tone={statusTone(task.priority)}>{labelValue(task.priority, locale)}</Badge><Badge tone={statusTone(task.status)}>{labelValue(task.status, locale)}</Badge></div><p className="mt-2 text-sm text-slate-500">{task.milestone || "—"} · {task.assignee_id ? eventProfileById.get(task.assignee_id)?.name ?? task.assignee_id : c.unassigned}</p>{task.due_at ? <p className="mt-1 text-xs font-bold text-slate-500">{c.due}: {formatDateTime(task.due_at, selectedEvent.timezone, dateLocale)}</p> : null}</div><p className="text-2xl font-black text-indigo-700">{task.progress}%</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-500" style={{width: `${task.progress}%`}} /></div>{task.description ? <p className="mt-4 text-sm leading-6 text-slate-600">{task.description}</p> : null}{canUpdateTask ? <form action={updateEventTaskAction} className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 lg:grid-cols-4"><input type="hidden" name="eventId" value={selectedEvent.id} /><input type="hidden" name="taskId" value={task.id} /><label className="block text-xs font-black">{c.status}<select name="status" defaultValue={task.status} className={fieldClass()}>{taskStatusValues.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label><label className="block text-xs font-black">{c.progress}<input name="progress" type="number" min="0" max="100" defaultValue={task.progress} className={fieldClass()} /></label><label className="block text-xs font-black">{c.proof}<input name="proofUrl" type="url" defaultValue={task.proof_url ?? ""} className={fieldClass()} /></label><label className="block text-xs font-black">{c.actualCost}<input name="actualCost" type="number" min="0" step="0.01" defaultValue={task.actual_cost ?? ""} disabled={!canManage} className={fieldClass()} /></label><label className="block text-xs font-black lg:col-span-3">{c.notes}<input name="notes" defaultValue={task.notes ?? ""} className={fieldClass()} /></label><button className="self-end rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white">{c.update}</button></form> : null}</article>}) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{c.noTasks}</p>}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><h3 className="text-2xl font-black text-slate-950">{c.schedule}</h3><Badge tone="indigo">{schedule.length}</Badge></div>
              {canManage ? <form action={createEventScheduleItemAction} className="mt-5 grid gap-3 rounded-2xl bg-indigo-50 p-4 lg:grid-cols-2"><input type="hidden" name="eventId" value={selectedEvent.id} /><label className="block text-sm font-black lg:col-span-2">{c.activityTitle}<input name="title" required className={fieldClass()} /></label><label className="block text-sm font-black">{c.type}<select name="itemType" defaultValue="session" className={fieldClass()}>{scheduleTypes.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label><label className="block text-sm font-black">{c.status}<select name="status" defaultValue="planned" className={fieldClass()}><option value="planned">{labelValue("planned", locale)}</option><option value="confirmed">{labelValue("confirmed", locale)}</option><option value="completed">{labelValue("completed", locale)}</option><option value="cancelled">{labelValue("cancelled", locale)}</option></select></label><label className="block text-sm font-black">{c.start}<input name="startAt" type="datetime-local" required className={fieldClass()} /></label><label className="block text-sm font-black">{c.end}<input name="endAt" type="datetime-local" required className={fieldClass()} /></label><label className="block text-sm font-black">{c.owner}<select name="ownerId" defaultValue="" className={fieldClass()}><option value="">{c.unassigned}</option>{eventMembers.map((member) => <option key={member.user_id} value={member.user_id}>{eventProfileById.get(member.user_id)?.name ?? member.user_id}</option>)}</select></label><label className="block text-sm font-black">{c.unit}<input name="unitName" className={fieldClass()} /></label><label className="block text-sm font-black">{c.location}<input name="location" className={fieldClass()} /></label><label className="block text-sm font-black">{c.meetingUrl}<input name="meetingUrl" type="url" className={fieldClass()} /></label><label className="block text-sm font-black lg:col-span-2">{c.notes}<textarea name="notes" className={textAreaClass()} /></label><button className="rounded-xl bg-indigo-600 px-5 py-3 font-black text-white lg:col-span-2">{c.addSchedule}</button></form> : null}
              <div className="mt-5 space-y-3">{schedule.length ? schedule.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black text-slate-950">{item.title}</p><Badge tone={statusTone(item.status)}>{labelValue(item.status, locale)}</Badge></div><p className="mt-2 text-sm text-slate-500">{formatDateTime(item.start_at, selectedEvent.timezone, dateLocale)} — {formatDateTime(item.end_at, selectedEvent.timezone, dateLocale)}</p><p className="mt-1 text-sm text-slate-500">{[item.location, item.unit_name, item.owner_id ? eventProfileById.get(item.owner_id)?.name : null].filter(Boolean).join(" · ")}</p></div>{item.meeting_url ? <a href={item.meeting_url} target="_blank" rel="noreferrer" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">{locale === "fr" ? "Rejoindre" : "Join"}</a> : null}</div>{item.notes ? <p className="mt-3 text-sm leading-6 text-slate-600">{item.notes}</p> : null}</article>) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{c.noSchedule}</p>}</div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><h3 className="text-2xl font-black text-slate-950">{c.documents}</h3><Badge tone="slate">{documents.length}</Badge></div>{canManage ? <form action={addEventDocumentAction} className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4"><input type="hidden" name="eventId" value={selectedEvent.id} /><label className="block text-sm font-black">{c.documentTitle}<input name="title" required className={fieldClass()} /></label><label className="block text-sm font-black">{c.category}<select name="category" defaultValue="other" className={fieldClass()}>{documentCategories.map((value) => <option key={value} value={value}>{labelValue(value, locale)}</option>)}</select></label><label className="block text-sm font-black">{c.documentUrl}<input name="documentUrl" type="url" required className={fieldClass()} /></label><label className="block text-sm font-black">{c.notes}<textarea name="notes" className={textAreaClass()} /></label><button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{c.addDocument}</button></form> : null}<div className="mt-5 space-y-3">{documents.length ? documents.map((document) => <div key={document.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="font-bold text-slate-950">{document.title}</p><p className="mt-1 text-xs text-slate-500">{labelValue(document.category, locale)}</p></div><a href={document.document_url} target="_blank" rel="noreferrer" className="text-sm font-black text-indigo-600">{c.open}</a></div>) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{c.noDocuments}</p>}</div></article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-2xl font-black text-slate-950">{c.finalReport}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{c.finalReportHelp}</p>{canManage ? <form action={saveEventClosureReportAction} className="mt-5 space-y-3"><input type="hidden" name="eventId" value={selectedEvent.id} /><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-black">{c.actualParticipants}<input name="actualParticipants" type="number" min="0" defaultValue={report?.actual_participants ?? 0} className={fieldClass()} /></label><label className="block text-sm font-black">{c.currency}<input name="currency" defaultValue={report?.currency ?? selectedEvent.currency} maxLength={3} className={fieldClass()} /></label><label className="block text-sm font-black">{c.revenue}<input name="revenueAmount" type="number" min="0" step="0.01" defaultValue={report?.revenue_amount ?? ""} className={fieldClass()} /></label><label className="block text-sm font-black">{c.expenses}<input name="expenseAmount" type="number" min="0" step="0.01" defaultValue={report?.expense_amount ?? ""} className={fieldClass()} /></label></div><label className="block text-sm font-black">{c.objectivesAchieved}<textarea name="objectivesAchieved" defaultValue={report?.objectives_achieved ?? ""} className={textAreaClass()} /></label><label className="block text-sm font-black">{c.highlights}<textarea name="highlights" defaultValue={report?.highlights ?? ""} className={textAreaClass()} /></label><label className="block text-sm font-black">{c.incidents}<textarea name="incidents" defaultValue={report?.incidents ?? ""} className={textAreaClass()} /></label><label className="block text-sm font-black">{c.lessons}<textarea name="lessonsLearned" defaultValue={report?.lessons_learned ?? ""} className={textAreaClass()} /></label><label className="block text-sm font-black">{c.recommendations}<textarea name="recommendations" defaultValue={report?.recommendations ?? ""} className={textAreaClass()} /></label><button className="w-full rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">{c.saveReport}</button></form> : report ? <div className="mt-5 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-900"><p className="font-black">{c.actualParticipants}: {report.actual_participants}</p><p className="mt-2">{c.revenue}: {report.revenue_amount === null ? "—" : moneyFormatter(report.currency).format(Number(report.revenue_amount))}</p><p>{c.expenses}: {report.expense_amount === null ? "—" : moneyFormatter(report.currency).format(Number(report.expense_amount))}</p></div> : null}</article>
            </section>
          </>}
        </section>
      </div>
    </div>
  </main>;
}
