import Link from "next/link";
import {redirect} from "next/navigation";
import {addCustomerServiceMessageAction, createCustomerServiceTicketAction, updateCustomerServiceTicketAction} from "@/app/actions/customer-service";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {CustomerServiceModuleNav} from "@/components/customer-service/module-nav";

type Params = {ticket?: string | string[]; status?: string | string[]; priority?: string | string[]; success?: string | string[]; error?: string | string[]};
type Props = {searchParams?: Promise<Params>};
type Membership = {organization_id: string; role: string};
type Ticket = {id: string; reference: string; client_id: string; subject: string; description: string; category: string; channel: string; priority: string; status: string; assigned_to: string | null; first_response_due_at: string; resolution_due_at: string; first_responded_at: string | null; resolved_at: string | null; resolution_summary: string | null; satisfaction_rating: number | null; created_at: string; updated_at: string};
type Client = {id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null};
type Message = {id: string; author_id: string; direction: string; channel: string; body: string; is_internal: boolean; created_at: string};
type Event = {id: string; actor_id: string; event_type: string; note: string | null; created_at: string};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";
const statusLabels: Record<string, {fr: string; en: string}> = {open:{fr:"Ouvert",en:"Open"},assigned:{fr:"Attribué",en:"Assigned"},in_progress:{fr:"En traitement",en:"In progress"},waiting_customer:{fr:"Attente client",en:"Waiting for customer"},escalated:{fr:"Escaladé",en:"Escalated"},resolved:{fr:"Résolu",en:"Resolved"},closed:{fr:"Fermé",en:"Closed"},cancelled:{fr:"Annulé",en:"Cancelled"}};
const priorityLabels: Record<string, {fr: string; en: string}> = {low:{fr:"Basse",en:"Low"},normal:{fr:"Normale",en:"Normal"},high:{fr:"Haute",en:"High"},urgent:{fr:"Urgente",en:"Urgent"}};
const tone: Record<string, string> = {open:"bg-blue-100 text-blue-800",assigned:"bg-indigo-100 text-indigo-800",in_progress:"bg-amber-100 text-amber-900",waiting_customer:"bg-violet-100 text-violet-800",escalated:"bg-red-100 text-red-800",resolved:"bg-emerald-100 text-emerald-800",closed:"bg-slate-200 text-slate-700",cancelled:"bg-slate-100 text-slate-600",urgent:"bg-red-100 text-red-800",high:"bg-orange-100 text-orange-800",normal:"bg-sky-100 text-sky-800",low:"bg-slate-100 text-slate-700"};

function Badge({value, label}: {value: string; label: string}) { return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${tone[value] ?? "bg-slate-100"}`}>{label}</span>; }
function Metric({label, value, detail}: {label: string; value: string | number; detail: string}) { return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black">{value}</p><p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p></article>; }

export default async function CustomerServicePage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const locale = "fr";
  const selectedId = first(params.ticket);
  const statusFilter = first(params.status);
  const priorityFilter = first(params.priority);
  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  if (!["owner","admin","manager","employee"].includes(membership.role)) redirect("/dashboard?error=access-denied");
  const leader = ["owner","admin","manager"].includes(membership.role);
  const visibleIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role});

  const schema = await admin.from("customer_service_tickets").select("id", {head:true, count:"exact"}).limit(1);
  if (schema.error) return <main className="min-h-screen bg-slate-50 p-6"><div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-3xl font-black text-amber-950">Service Client — installation requise</h1><p className="mt-3 text-amber-900">Exécutez la migration suivante dans Supabase SQL Editor, puis rechargez cette page.</p><code className="mt-5 block rounded-xl bg-slate-950 p-4 font-bold text-white">supabase/054_customer_service_growth_v3_6_0.sql</code></div></main>;

  const [clientsResult, membersResult] = await Promise.all([
    admin.from("crm_clients").select("id,full_name,email,phone,whatsapp_phone").eq("organization_id", membership.organization_id).order("full_name"),
    admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleIds),
  ]);
  const clients = (clientsResult.data ?? []) as Client[];
  const memberIds = (membersResult.data ?? []).map(row => String(row.user_id));
  const {data: profiles} = memberIds.length ? await admin.from("profiles").select("id,full_name,email").in("id", memberIds) : {data: []};
  const names = new Map((profiles ?? []).map(row => [String(row.id), String(row.full_name || row.email || "Membre")]));
  const clientNames = new Map(clients.map(client => [client.id, client.full_name]));

  let query = admin.from("customer_service_tickets").select("id,reference,client_id,subject,description,category,channel,priority,status,assigned_to,first_response_due_at,resolution_due_at,first_responded_at,resolved_at,resolution_summary,satisfaction_rating,created_at,updated_at").eq("organization_id", membership.organization_id).order("updated_at", {ascending:false}).limit(250);
  if (!leader) query = query.eq("assigned_to", authData.user.id);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (priorityFilter) query = query.eq("priority", priorityFilter);
  const {data: ticketData, error: ticketError} = await query;
  if (ticketError) throw new Error(ticketError.message);
  const tickets = (ticketData ?? []) as Ticket[];
  const selected = tickets.find(ticket => ticket.id === selectedId) ?? null;
  const requestNow = new Date().getTime();
  const openTickets = tickets.filter(ticket => !["resolved","closed","cancelled"].includes(ticket.status));
  const overdue = openTickets.filter(ticket => new Date(ticket.resolution_due_at).getTime() < requestNow);
  const responded = tickets.filter(ticket => ticket.first_responded_at);
  const withinFirstSla = responded.filter(ticket => new Date(ticket.first_responded_at!).getTime() <= new Date(ticket.first_response_due_at).getTime());
  const ratings = tickets.flatMap(ticket => ticket.satisfaction_rating ? [ticket.satisfaction_rating] : []);
  const slaRate = responded.length ? Math.round(withinFirstSla.length / responded.length * 100) : 100;
  const csat = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : "—";

  let messages: Message[] = [];
  let events: Event[] = [];
  if (selected) {
    const [messageResult, eventResult] = await Promise.all([
      admin.from("customer_service_messages").select("id,author_id,direction,channel,body,is_internal,created_at").eq("ticket_id", selected.id).order("created_at"),
      admin.from("customer_service_events").select("id,actor_id,event_type,note,created_at").eq("ticket_id", selected.id).order("created_at", {ascending:false}).limit(50),
    ]);
    messages = (messageResult.data ?? []) as Message[];
    events = (eventResult.data ?? []) as Event[];
  }
  const date = (value: string) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle:"medium", timeStyle:"short"}).format(new Date(value));

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-sky-950 to-cyan-800 p-7 text-white shadow-xl">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-300">Super Leader · Croissance client</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-4xl font-black">Centre de Service Client</h1><p className="mt-2 max-w-3xl text-sky-100">Résoudre vite, restaurer la confiance et transformer chaque interaction en fidélité, recommandation et croissance.</p></div><Link href="/dashboard/crm" className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-black">Voir le CRM</Link></div>
        <CustomerServiceModuleNav current="/dashboard/customer-service" />
      </header>
      {first(params.success) ? <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{first(params.success)}</p> : null}
      {first(params.error) ? <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{first(params.error)}</p> : null}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Tickets actifs" value={openTickets.length} detail={`${tickets.length} tickets visibles`} /><Metric label="SLA première réponse" value={`${slaRate}%`} detail="Objectif : répondre avant l’échéance" /><Metric label="Tickets en retard" value={overdue.length} detail="À traiter ou escalader maintenant" /><Metric label="Satisfaction client" value={csat === "—" ? csat : `${csat}/5`} detail={`${ratings.length} évaluations reçues`} /></section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">Nouveau ticket</h2><form action={createCustomerServiceTicketAction} className="mt-4 space-y-3">
            <label className="block text-sm font-black">Client<select name="clientId" required className={field}><option value="">Sélectionner…</option>{clients.map(client => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
            <label className="block text-sm font-black">Objet<input name="subject" required maxLength={220} className={field} /></label>
            <label className="block text-sm font-black">Description<textarea name="description" required rows={4} className={field} /></label>
            <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">Catégorie<select name="category" className={field}>{["information","complaint","payment","technical","training","delivery","cancellation","other"].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="block text-sm font-black">Canal<select name="channel" className={field}>{["manual","phone","email","whatsapp","sms","web","social_media","in_person","other"].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
            <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">Priorité<select name="priority" defaultValue="normal" className={field}>{Object.keys(priorityLabels).map(value => <option key={value} value={value}>{priorityLabels[value].fr}</option>)}</select></label><label className="block text-sm font-black">Agent<select name="assignedTo" className={field}><option value="">Non attribué</option>{memberIds.map(id => <option key={id} value={id}>{names.get(id)}</option>)}</select></label></div>
            <button className="w-full rounded-xl bg-sky-700 px-4 py-3 font-black text-white hover:bg-sky-800">Créer et démarrer le SLA</button>
          </form></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Filtres de la file</h2><form className="mt-3 grid grid-cols-2 gap-3"><select name="status" defaultValue={statusFilter} className={field}><option value="">Tous les statuts</option>{Object.keys(statusLabels).map(value => <option key={value} value={value}>{statusLabels[value].fr}</option>)}</select><select name="priority" defaultValue={priorityFilter} className={field}><option value="">Toutes priorités</option>{Object.keys(priorityLabels).map(value => <option key={value} value={value}>{priorityLabels[value].fr}</option>)}</select><button className="col-span-2 rounded-xl border border-slate-300 px-4 py-2.5 font-black">Appliquer</button></form></article>
        </div>

        <div className="space-y-6">
          <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-5"><h2 className="text-xl font-black">File de traitement</h2><p className="text-sm text-slate-500">Les tickets urgents et en retard doivent être traités en premier.</p></div><div className="divide-y divide-slate-100">
            {tickets.length ? tickets.map(ticket => { const late = !["resolved","closed","cancelled"].includes(ticket.status) && new Date(ticket.resolution_due_at).getTime() < requestNow; return <Link key={ticket.id} href={`/dashboard/customer-service?ticket=${ticket.id}${statusFilter ? `&status=${statusFilter}` : ""}${priorityFilter ? `&priority=${priorityFilter}` : ""}`} className={`block p-5 transition hover:bg-sky-50 ${selected?.id === ticket.id ? "bg-sky-50" : ""}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-sky-700">{ticket.reference} · {clientNames.get(ticket.client_id)}</p><h3 className="mt-1 font-black">{ticket.subject}</h3><p className="mt-1 text-xs text-slate-500">Agent : {ticket.assigned_to ? names.get(ticket.assigned_to) ?? "Membre" : "Non attribué"} · Échéance : {date(ticket.resolution_due_at)}</p></div><div className="flex gap-2"><Badge value={ticket.priority} label={priorityLabels[ticket.priority]?.fr ?? ticket.priority} /><Badge value={ticket.status} label={statusLabels[ticket.status]?.fr ?? ticket.status} />{late ? <Badge value="urgent" label="SLA dépassé" /> : null}</div></div></Link>; }) : <p className="p-8 text-center font-semibold text-slate-500">Aucun ticket dans cette file.</p>}
          </div></article>

          {selected ? <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-black text-sky-700">{selected.reference}</p><h2 className="mt-1 text-2xl font-black">{selected.subject}</h2><p className="mt-2 text-sm text-slate-500">{clientNames.get(selected.client_id)} · {selected.channel} · créé le {date(selected.created_at)}</p></div><Link href="/dashboard/customer-service" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-black">Fermer la fiche</Link></div><p className="mt-5 rounded-2xl bg-slate-50 p-4 leading-7 text-slate-700">{selected.description}</p>
            <div className="mt-6 grid gap-6 lg:grid-cols-2"><form action={updateCustomerServiceTicketAction} className="rounded-2xl border border-slate-200 p-5"><input type="hidden" name="ticketId" value={selected.id} /><h3 className="font-black">Pilotage et résolution</h3><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm font-black">Statut<select name="status" defaultValue={selected.status} className={field}>{Object.keys(statusLabels).map(value => <option key={value} value={value}>{statusLabels[value].fr}</option>)}</select></label><label className="text-sm font-black">Priorité<select name="priority" defaultValue={selected.priority} className={field}>{Object.keys(priorityLabels).map(value => <option key={value} value={value}>{priorityLabels[value].fr}</option>)}</select></label></div><label className="mt-3 block text-sm font-black">Agent<select name="assignedTo" defaultValue={selected.assigned_to ?? ""} className={field}><option value="">Non attribué</option>{memberIds.map(id => <option key={id} value={id}>{names.get(id)}</option>)}</select></label><label className="mt-3 block text-sm font-black">Résumé de résolution<textarea name="resolutionSummary" defaultValue={selected.resolution_summary ?? ""} rows={3} className={field} /></label><button className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 font-black text-white">Enregistrer et auditer</button></form>
              <form action={addCustomerServiceMessageAction} className="rounded-2xl border border-slate-200 p-5"><input type="hidden" name="ticketId" value={selected.id} /><h3 className="font-black">Ajouter un échange</h3><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm font-black">Type<select name="direction" className={field}><option value="outbound">Réponse au client</option><option value="inbound">Message du client</option><option value="internal">Note interne</option></select></label><label className="text-sm font-black">Canal<select name="channel" className={field}>{["internal","phone","email","whatsapp","sms","web","social_media","in_person","other"].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><label className="mt-3 block text-sm font-black">Message<textarea name="body" required rows={5} className={field} /></label><button className="mt-4 w-full rounded-xl bg-sky-700 px-4 py-3 font-black text-white">Ajouter à l’historique</button></form></div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2"><section><h3 className="font-black">Conversation</h3><div className="mt-3 space-y-3">{messages.length ? messages.map(message => <div key={message.id} className={`rounded-2xl p-4 ${message.is_internal ? "border border-amber-200 bg-amber-50" : message.direction === "outbound" ? "bg-sky-50" : "bg-slate-100"}`}><div className="flex justify-between gap-3 text-xs font-black text-slate-500"><span>{message.direction} · {message.channel} · {names.get(message.author_id) ?? "Membre"}</span><span>{date(message.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p></div>) : <p className="text-sm text-slate-500">Aucun échange enregistré.</p>}</div></section><section><h3 className="font-black">Journal d’audit</h3><div className="mt-3 space-y-3">{events.map(event => <div key={event.id} className="border-l-2 border-sky-300 pl-4"><p className="text-sm font-black">{event.event_type.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{names.get(event.actor_id) ?? "Membre"} · {date(event.created_at)}</p>{event.note ? <p className="mt-1 text-sm text-slate-600">{event.note}</p> : null}</div>)}</div></section></div>
          </article> : null}
        </div>
      </section>
    </div>
  </main>;
}
