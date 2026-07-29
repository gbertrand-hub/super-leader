import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  saveZoomHostAction,
  saveZoomSettingsAction,
  syncZoomHostsAction,
  testZoomConnectionAction,
} from "@/app/actions/integrations";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {getSiteUrl} from "@/lib/supabase/env";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getZoomRuntimeStatus} from "@/lib/zoom/config";
import {getOrganizationZoomHosts, getOrganizationZoomSettings} from "@/lib/zoom/settings";

type SearchParams = {success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type MeetingRow = {id: string; title: string; starts_at: string; zoom_status: string; zoom_last_synced_at: string | null; zoom_sync_error: string | null; zoom_host_email: string | null; zoom_department: string | null};
type TeamRow = {department: string | null};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";
}

function Status({ok, children}: {ok: boolean; children: ReactNode}) {
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{children}</span>;
}

export default async function IntegrationsPage({searchParams}: PageProps) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const params = await searchParams;
  const success = first(params?.success);
  const errorMessage = first(params?.error);
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership || !["owner", "admin"].includes(membership.role)) redirect("/dashboard");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");

  const [settings, runtime, hosts, meetingsResult, teamsResult] = await Promise.all([
    getOrganizationZoomSettings(admin, membership.organization_id),
    Promise.resolve(getZoomRuntimeStatus()),
    getOrganizationZoomHosts(admin, membership.organization_id),
    admin
      .from("performance_meetings")
      .select("id,title,starts_at,zoom_status,zoom_last_synced_at,zoom_sync_error,zoom_host_email,zoom_department")
      .eq("organization_id", membership.organization_id)
      .eq("provider", "zoom")
      .order("starts_at", {ascending: false})
      .limit(10),
    admin.from("teams").select("department").eq("organization_id", membership.organization_id).eq("is_active", true),
  ]);
  if (meetingsResult.error && !["42703", "42P01", "PGRST205"].includes(meetingsResult.error.code)) throw new Error(meetingsResult.error.message);
  if (teamsResult.error && !["42703", "42P01", "PGRST205"].includes(teamsResult.error.code)) throw new Error(teamsResult.error.message);
  const meetings = (meetingsResult.data || []) as MeetingRow[];
  const departments = [...new Set([
    ...((teamsResult.data || []) as TeamRow[]).map((team) => String(team.department || "").trim()),
    ...hosts.map((host) => String(host.department || "").trim()),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const webhookUrl = `${getSiteUrl()}/api/zoom/webhook`;
  const activeHosts = hosts.filter((host) => host.is_active && host.zoom_status === "active");
  const ready = runtime.configured && runtime.webhookSecretPresent && settings.enabled && (activeHosts.length > 0 || Boolean(settings.default_host_email));

  const c = fr ? {
    back: "Retour au tableau de bord",
    eyebrow: "INTÉGRATIONS",
    title: "Zoom Meetings",
    subtitle: "Crée les réunions Zoom depuis Super Leader, sélectionne le bon hôte par département et synchronise automatiquement les présences.",
    configured: "Identifiants API configurés",
    missing: "Configuration incomplète",
    enabled: "Intégration activée",
    disabled: "Intégration désactivée",
    webhook: "Adresse du webhook Zoom",
    webhookHelp: "Ajoute cette adresse dans les Event Subscriptions de ton application Zoom Server-to-Server OAuth.",
    settings: "Configuration de l’organisation",
    host: "Compte Zoom hôte général par défaut",
    activate: "Activer Zoom pour cette organisation",
    autoCreate: "Proposer Zoom par défaut lors de la création d’une réunion",
    autoSync: "Synchroniser automatiquement les présences via les webhooks",
    grace: "Tolérance de retard (minutes)",
    minimum: "Présence minimale pour être considéré présent (%)",
    save: "Enregistrer la configuration",
    test: "Tester la connexion Zoom",
    recent: "Réunions Zoom récentes",
    noRecent: "Aucune réunion Zoom n’a encore été créée.",
    lastSync: "Dernière synchronisation",
    environment: "Variables d’environnement requises",
    envHelp: "Configure ces variables dans .env.local et dans Vercel. Les secrets ne sont jamais affichés dans Super Leader.",
    ready: "Zoom est prêt",
    notReady: "Zoom n’est pas encore prêt",
    hostsTitle: "Comptes Zoom hôtes par département",
    hostsHelp: "Synchronise les utilisateurs du compte Zoom, puis associe chaque hôte à son département. Un compte marqué par défaut sera sélectionné automatiquement.",
    syncHosts: "Synchroniser les comptes Zoom",
    noHosts: "Aucun compte hôte n’est encore synchronisé. Exécute la migration V2.8, vérifie le scope Zoom de lecture de la liste des utilisateurs, puis clique sur Synchroniser.",
    department: "Département / pôle",
    active: "Compte actif dans Super Leader",
    departmentDefault: "Compte par défaut de ce département",
    organizationDefault: "Utiliser aussi comme hôte général par défaut",
    concurrent: "Autoriser les réunions simultanées sur ce compte",
    saveHost: "Enregistrer ce compte",
    synced: "Dernière synchronisation Zoom",
    migration: "Migration requise : supabase/036_zoom_multi_hosts_v2_8.sql",
  } : {
    back: "Back to dashboard",
    eyebrow: "INTEGRATIONS",
    title: "Zoom Meetings",
    subtitle: "Create Zoom meetings from Super Leader, select the correct departmental host and automatically sync attendance.",
    configured: "API credentials configured",
    missing: "Incomplete configuration",
    enabled: "Integration enabled",
    disabled: "Integration disabled",
    webhook: "Zoom webhook URL",
    webhookHelp: "Add this URL to the Event Subscriptions of your Zoom Server-to-Server OAuth app.",
    settings: "Organization settings",
    host: "General default Zoom host account",
    activate: "Enable Zoom for this organization",
    autoCreate: "Offer Zoom by default when creating a meeting",
    autoSync: "Automatically sync attendance through webhooks",
    grace: "Late grace period (minutes)",
    minimum: "Minimum attendance to be marked present (%)",
    save: "Save configuration",
    test: "Test Zoom connection",
    recent: "Recent Zoom meetings",
    noRecent: "No Zoom meeting has been created yet.",
    lastSync: "Last sync",
    environment: "Required environment variables",
    envHelp: "Configure these variables in .env.local and Vercel. Secrets are never displayed in Super Leader.",
    ready: "Zoom is ready",
    notReady: "Zoom is not ready yet",
    hostsTitle: "Department Zoom host accounts",
    hostsHelp: "Sync users from the Zoom account, then assign each host to a department. A departmental default is selected automatically.",
    syncHosts: "Sync Zoom host accounts",
    noHosts: "No host account has been synced. Run the V2.8 migration, verify the Zoom scope for listing users, then click Sync.",
    department: "Department / unit",
    active: "Active account in Super Leader",
    departmentDefault: "Default account for this department",
    organizationDefault: "Also use as the general default host",
    concurrent: "Allow simultaneous meetings on this account",
    saveHost: "Save this account",
    synced: "Last Zoom sync",
    migration: "Required migration: supabase/036_zoom_multi_hosts_v2_8.sql",
  };

  return <main className="min-h-screen bg-slate-50 p-5 text-slate-950 lg:p-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/dashboard" className="font-bold text-indigo-700">← {c.back}</Link>
      <section className="rounded-[2rem] bg-slate-950 p-7 text-white lg:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-black tracking-[0.2em] text-amber-400">{c.eyebrow}</p><h1 className="mt-3 text-4xl font-black">{c.title}</h1><p className="mt-3 max-w-3xl leading-7 text-slate-300">{c.subtitle}</p></div>
          <Status ok={ready}>{ready ? c.ready : c.notReady}</Status>
        </div>
      </section>
      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</div> : null}
      {errorMessage ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</div> : null}

      <section className="grid gap-5 md:grid-cols-3">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-black text-slate-500">OAuth</p><div className="mt-3"><Status ok={runtime.configured}>{runtime.configured ? c.configured : c.missing}</Status></div></article>
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-black text-slate-500">Webhook</p><div className="mt-3"><Status ok={runtime.webhookSecretPresent}>{runtime.webhookSecretPresent ? c.configured : c.missing}</Status></div></article>
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-black text-slate-500">Super Leader</p><div className="mt-3"><Status ok={settings.enabled}>{settings.enabled ? c.enabled : c.disabled}</Status></div></article>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">{c.settings}</h2>
          <form action={saveZoomSettingsAction} className="mt-5 space-y-4">
            <label className="block text-sm font-black">{c.host}<input name="defaultHostEmail" list="zoom-host-emails" type="email" defaultValue={settings.default_host_email || ""} required className={fieldClass()} /></label>
            <datalist id="zoom-host-emails">{hosts.map((host) => <option key={host.id} value={host.email}>{host.display_name || host.email}</option>)}</datalist>
            <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} />{c.activate}</label>
            <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="autoCreateMeetings" type="checkbox" defaultChecked={settings.auto_create_meetings} />{c.autoCreate}</label>
            <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="autoSyncAttendance" type="checkbox" defaultChecked={settings.auto_sync_attendance} />{c.autoSync}</label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-black">{c.grace}<input name="lateGraceMinutes" type="number" min="0" max="120" defaultValue={settings.late_grace_minutes} className={fieldClass()} /></label>
              <label className="block text-sm font-black">{c.minimum}<input name="minimumAttendancePercent" type="number" min="1" max="100" defaultValue={settings.minimum_attendance_percent} className={fieldClass()} /></label>
            </div>
            <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{c.save}</button>
          </form>
          <form action={testZoomConnectionAction} className="mt-3"><button className="w-full rounded-xl border border-indigo-300 bg-indigo-50 px-5 py-3 font-black text-indigo-800">{c.test}</button></form>
        </article>

        <div className="space-y-6">
          <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6"><h2 className="text-xl font-black text-indigo-950">{c.webhook}</h2><code className="mt-4 block break-all rounded-xl bg-slate-950 p-4 text-sm text-white">{webhookUrl}</code><p className="mt-3 text-sm leading-6 text-indigo-900">{c.webhookHelp}</p></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{c.environment}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{c.envHelp}</p><pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-white">{"ZOOM_ACCOUNT_ID=\nZOOM_CLIENT_ID=\nZOOM_CLIENT_SECRET=\nZOOM_WEBHOOK_SECRET_TOKEN="}</pre></article>
        </div>
      </section>

      <section className="rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-2xl font-black">{c.hostsTitle}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{c.hostsHelp}</p></div>
          <form action={syncZoomHostsAction}><button className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white">{c.syncHosts}</button></form>
        </div>
        {!hosts.length ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-900"><p>{c.noHosts}</p><code className="mt-3 block rounded-xl bg-slate-950 p-3 text-white">{c.migration}</code></div> : null}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {hosts.map((host) => {
            const hostDepartments = host.department && !departments.includes(host.department) ? [host.department, ...departments] : departments;
            const isGeneralDefault = settings.default_host_email?.toLocaleLowerCase() === host.email.toLocaleLowerCase();
            return <form key={host.id} action={saveZoomHostAction} className={`rounded-2xl border p-5 ${host.is_active ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-slate-50"}`}>
              <input type="hidden" name="hostId" value={host.id} />
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-slate-950">{host.display_name || host.email}</p><p className="mt-1 text-sm text-slate-600">{host.email}</p><p className="mt-1 text-xs font-bold text-slate-500">Zoom ID: {host.zoom_user_id}</p></div><Status ok={host.zoom_status === "active"}>{host.zoom_status}</Status></div>
              <label className="mt-4 block text-sm font-black">{c.department}<select name="department" defaultValue={host.department || ""} className={fieldClass()}><option value="">—</option>{hostDepartments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold"><input name="isActive" type="checkbox" defaultChecked={host.is_active} />{c.active}</label>
                <label className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold"><input name="isDepartmentDefault" type="checkbox" defaultChecked={host.is_department_default} />{c.departmentDefault}</label>
                <label className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold"><input name="organizationDefault" type="checkbox" defaultChecked={isGeneralDefault} />{c.organizationDefault}</label>
                <label className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold"><input name="allowConcurrentMeetings" type="checkbox" defaultChecked={host.allow_concurrent_meetings} />{c.concurrent}</label>
              </div>
              <p className="mt-3 text-xs text-slate-500">{c.synced}: {host.last_synced_at ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "short", timeStyle: "short"}).format(new Date(host.last_synced_at)) : "—"}</p>
              <button className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{c.saveHost}</button>
            </form>;
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{c.recent}</h2><div className="mt-5 space-y-3">{meetings.length ? meetings.map((meeting) => <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4"><div><p className="font-black">{meeting.title}</p><p className="mt-1 text-sm text-slate-500">{new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(meeting.starts_at))}</p><p className="mt-1 text-xs font-bold text-indigo-700">{[meeting.zoom_department, meeting.zoom_host_email].filter(Boolean).join(" · ")}</p>{meeting.zoom_sync_error ? <p className="mt-1 text-xs font-bold text-red-700">{meeting.zoom_sync_error}</p> : null}</div><div className="text-right"><Status ok={["scheduled","started","ended"].includes(meeting.zoom_status)}>{meeting.zoom_status}</Status><p className="mt-2 text-xs text-slate-500">{c.lastSync}: {meeting.zoom_last_synced_at ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "short", timeStyle: "short"}).format(new Date(meeting.zoom_last_synced_at)) : "—"}</p></div></div>) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{c.noRecent}</p>}</div></section>
    </div>
  </main>;
}
