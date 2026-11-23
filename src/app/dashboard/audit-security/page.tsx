import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";

type AuditDomain = "access" | "people" | "crm" | "sales" | "performance" | "messaging" | "notifications" | "vip";
type AuditEntry = {id: string; domain: AuditDomain; actorId: string | null; action: string; details: Record<string, unknown>; createdAt: string};
type SearchParams = Promise<{domain?: string; period?: string}>;

const domainMeta: Record<AuditDomain, {fr: string; en: string; tone: string}> = {
  access: {fr: "Accès", en: "Access", tone: "bg-rose-50 text-rose-700 border-rose-200"},
  people: {fr: "Personnes", en: "People", tone: "bg-violet-50 text-violet-700 border-violet-200"},
  crm: {fr: "CRM", en: "CRM", tone: "bg-sky-50 text-sky-700 border-sky-200"},
  sales: {fr: "Ventes", en: "Sales", tone: "bg-emerald-50 text-emerald-700 border-emerald-200"},
  performance: {fr: "Performance", en: "Performance", tone: "bg-amber-50 text-amber-800 border-amber-200"},
  messaging: {fr: "Messagerie", en: "Messaging", tone: "bg-indigo-50 text-indigo-700 border-indigo-200"},
  notifications: {fr: "Notifications", en: "Notifications", tone: "bg-cyan-50 text-cyan-700 border-cyan-200"},
  vip: {fr: "VIP", en: "VIP", tone: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200"},
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readableAction(action: string) {
  return action.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function auditClock(period: number) {
  const now = new Date();
  return {nowMs: now.getTime(), since: new Date(now.getTime() - period * 86_400_000).toISOString()};
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const candidate = value.trim();
  if (!candidate.startsWith("[") && !candidate.startsWith("{")) return value;
  try { return JSON.parse(candidate); } catch { return value; }
}

function detailLabel(key: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    tasks: ["Tâches", "Tasks"], status: ["Statut", "Status"], work_date: ["Date de travail", "Work date"],
    previous_status: ["Statut précédent", "Previous status"], note: ["Note", "Note"], old_status: ["Ancien statut", "Old status"],
    new_status: ["Nouveau statut", "New status"], task_count: ["Nombre de tâches", "Task count"],
  };
  const label = labels[key.toLowerCase()];
  return label ? label[fr ? 0 : 1] : readableAction(key);
}

function detailValue(key: string, rawValue: unknown, fr: boolean) {
  const value = parsedJson(rawValue);
  if (Array.isArray(value)) {
    if (key.toLowerCase() === "tasks") return fr ? `${value.length} tâche${value.length > 1 ? "s" : ""}` : `${value.length} task${value.length === 1 ? "" : "s"}`;
    return fr ? `${value.length} élément${value.length > 1 ? "s" : ""}` : `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (value && typeof value === "object") return fr ? "Détails enregistrés" : "Details recorded";
  if (typeof value === "boolean") return value ? (fr ? "Oui" : "Yes") : (fr ? "Non" : "No");
  return String(value);
}

function detailSummary(details: Record<string, unknown>, fr: boolean) {
  const hidden = new Set(["password", "token", "secret", "temporary_password"]);
  const parts = Object.entries(details).filter(([key, value]) => !hidden.has(key.toLowerCase()) && value !== null && value !== "").slice(0, 3).map(([key, value]) => `${detailLabel(key, fr)} : ${detailValue(key, value, fr)}`);
  return parts.join(" · ") || (fr ? "Aucun détail supplémentaire" : "No additional details");
}

export default async function AuditSecurityPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const context = await requireAccessContext();
  if (![
    "owner", "admin"
  ].includes(context.role)) redirect("/dashboard/my-day");

  const params = await searchParams;
  const selectedDomain = Object.hasOwn(domainMeta, String(params.domain)) ? params.domain as AuditDomain : null;
  const period = ["7", "30", "90"].includes(String(params.period)) ? Number(params.period) : 30;
  const {nowMs, since} = auditClock(period);
  const {admin, organizationId} = context;

  const [membersResult, profilesResult, accessResult, crmResult, salesResult, performanceResult, messagingResult, notificationsResult, vipResult, executiveResult] = await Promise.all([
    admin.from("organization_members").select("user_id,role,is_active").eq("organization_id", organizationId),
    admin.from("profiles").select("id,full_name,must_change_password,temporary_password_expires_at"),
    admin.from("temporary_access_audit_log").select("id,actor_user_id,event_type,metadata,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("crm_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("sales_audit_log").select("id,actor_id,action,note,old_status,new_status,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("performance_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("internal_messaging_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("notification_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("vip_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
    admin.from("executive_supervision_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", {ascending: false}).limit(80),
  ]);

  const standardEntries = (domain: AuditDomain, rows: Array<Record<string, unknown>> | null): AuditEntry[] => (rows ?? []).map((row) => ({id: String(row.id), domain, actorId: row.actor_id ? String(row.actor_id) : null, action: String(row.action), details: objectValue(row.details), createdAt: String(row.created_at)}));
  const entries: AuditEntry[] = [
    ...(accessResult.data ?? []).map((row) => ({id: String(row.id), domain: "access" as const, actorId: row.actor_user_id ? String(row.actor_user_id) : null, action: String(row.event_type), details: objectValue(row.metadata), createdAt: String(row.created_at)})),
    ...standardEntries("crm", crmResult.data),
    ...(salesResult.data ?? []).map((row) => ({id: String(row.id), domain: "sales" as const, actorId: row.actor_id ? String(row.actor_id) : null, action: String(row.action), details: {note: row.note, old_status: row.old_status, new_status: row.new_status}, createdAt: String(row.created_at)})),
    ...standardEntries("performance", performanceResult.data), ...standardEntries("messaging", messagingResult.data),
    ...standardEntries("notifications", notificationsResult.data), ...standardEntries("vip", vipResult.data), ...standardEntries("people", executiveResult.data),
  ].filter((entry) => !selectedDomain || entry.domain === selectedDomain).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 120);

  const members = membersResult.data ?? [];
  const memberIds = new Set(members.map((member) => String(member.user_id)));
  const profiles = (profilesResult.data ?? []).filter((profile) => memberIds.has(String(profile.id)));
  const names = new Map(profiles.map((profile) => [String(profile.id), String(profile.full_name || (fr ? "Utilisateur" : "User"))]));
  const activeMembers = members.filter((member) => member.is_active).length;
  const administrators = members.filter((member) => member.is_active && ["owner", "admin"].includes(String(member.role))).length;
  const forcedChanges = profiles.filter((profile) => Boolean(profile.must_change_password)).length;
  const expiredTemporary = profiles.filter((profile) => profile.must_change_password && profile.temporary_password_expires_at && new Date(String(profile.temporary_password_expires_at)).getTime() < nowMs).length;
  const accessAlerts = (accessResult.data ?? []).filter((row) => ["email_failed", "expired_login_blocked"].includes(String(row.event_type))).length;
  const queryErrors = [accessResult, crmResult, salesResult, performanceResult, messagingResult, notificationsResult, vipResult, executiveResult].filter((result) => result.error).length;
  const dateFormatter = new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short"});

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6"><div className="mx-auto max-w-7xl">
    <header className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-9"><p className="text-sm font-black uppercase tracking-[0.18em] text-indigo-300">Super Leader V4.6.3</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">{fr ? "Audit & sécurité" : "Audit & security"}</h1><p className="mt-3 max-w-3xl leading-7 text-slate-300">{fr ? "Centre de contrôle des accès sensibles et des activités enregistrées dans les journaux de votre organisation." : "Control centre for sensitive access and activities recorded in your organisation audit logs."}</p></header>

    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[
        [fr ? "Membres actifs" : "Active members", activeMembers, "text-slate-950"], [fr ? "Administrateurs" : "Administrators", administrators, "text-indigo-700"],
        [fr ? "Changements requis" : "Changes required", forcedChanges, forcedChanges ? "text-amber-700" : "text-emerald-700"], [fr ? "Accès expirés" : "Expired access", expiredTemporary, expiredTemporary ? "text-rose-700" : "text-emerald-700"],
        [fr ? "Alertes sur 30 j" : "Alerts in 30 days", accessAlerts, accessAlerts ? "text-rose-700" : "text-emerald-700"],
      ].map(([label, value, tone]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${tone}`}>{value}</p></article>)}
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <article className={`rounded-2xl border p-5 ${expiredTemporary || accessAlerts ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}><h2 className="font-black">{fr ? "État des accès" : "Access status"}</h2><p className="mt-2 text-sm leading-6">{expiredTemporary || accessAlerts ? (fr ? "Des accès nécessitent une vérification. Consultez le journal ci-dessous et la gestion des membres." : "Some access requires review. Check the log below and member management.") : (fr ? "Aucune alerte d’accès critique détectée sur la période." : "No critical access alert detected during the period.")}</p></article>
      <article className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h2 className="font-black text-indigo-950">{fr ? "Protection appliquée" : "Enforced protection"}</h2><p className="mt-2 text-sm leading-6 text-indigo-900">{fr ? "Cette page est contrôlée côté serveur et réservée aux rôles Propriétaire et Administrateur." : "This page is protected server-side and restricted to Owner and Administrator roles."}</p><Link href="/dashboard/roles-permissions" className="mt-3 inline-flex text-sm font-black text-indigo-700 hover:underline">{fr ? "Voir les rôles et permissions" : "View roles and permissions"}</Link></article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">{fr ? "Couverture des journaux" : "Log coverage"}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{queryErrors === 0 ? (fr ? "Tous les journaux disponibles ont répondu correctement." : "All available logs responded successfully.") : (fr ? `${queryErrors} source(s) indisponible(s). Les autres journaux restent visibles.` : `${queryErrors} source(s) unavailable. Other logs remain visible.`)}</p></article>
    </section>

    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-6"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><h2 className="text-2xl font-black">{fr ? "Journal consolidé" : "Consolidated audit log"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? "Les événements les plus récents de l’organisation, sans exposer les secrets ni mots de passe." : "The organisation’s latest events, without exposing secrets or passwords."}</p></div><form className="flex flex-wrap gap-2"><select name="domain" defaultValue={selectedDomain ?? ""} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"><option value="">{fr ? "Tous les domaines" : "All domains"}</option>{Object.entries(domainMeta).map(([key, meta]) => <option key={key} value={key}>{fr ? meta.fr : meta.en}</option>)}</select><select name="period" defaultValue={String(period)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"><option value="7">7 {fr ? "jours" : "days"}</option><option value="30">30 {fr ? "jours" : "days"}</option><option value="90">90 {fr ? "jours" : "days"}</option></select><button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Filtrer" : "Filter"}</button></form></div></div>
      {entries.length ? <div className="divide-y divide-slate-100">{entries.map((entry) => {const meta = domainMeta[entry.domain]; return <article key={`${entry.domain}-${entry.id}`} className="grid gap-3 p-5 hover:bg-slate-50/70 md:grid-cols-[160px_1fr_210px]"><div><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${meta.tone}`}>{fr ? meta.fr : meta.en}</span><p className="mt-2 text-xs text-slate-500">{dateFormatter.format(new Date(entry.createdAt))}</p></div><div><h3 className="font-black text-slate-900">{readableAction(entry.action)}</h3><p className="mt-1 break-words text-sm leading-6 text-slate-600">{detailSummary(entry.details, fr)}</p></div><div className="text-sm"><p className="font-bold text-slate-700">{entry.actorId ? names.get(entry.actorId) ?? (fr ? "Utilisateur identifié" : "Identified user") : (fr ? "Système" : "System")}</p><p className="mt-1 truncate text-xs text-slate-400" title={entry.actorId ?? "system"}>{entry.actorId ?? "system"}</p></div></article>;})}</div> : <div className="p-10 text-center"><p className="text-lg font-black">{fr ? "Aucun événement trouvé" : "No events found"}</p><p className="mt-2 text-sm text-slate-500">{fr ? "Modifiez le domaine ou la période sélectionnée." : "Change the selected domain or period."}</p></div>}
    </section>
  </div></main>;
}
