import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {saveZoomSettingsAction, testZoomConnectionAction} from "@/app/actions/integrations";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {getSiteUrl} from "@/lib/supabase/env";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getZoomRuntimeStatus} from "@/lib/zoom/config";
import {getOrganizationZoomSettings} from "@/lib/zoom/settings";

type SearchParams = {success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type MeetingRow = {id: string; title: string; starts_at: string; zoom_status: string; zoom_last_synced_at: string | null; zoom_sync_error: string | null};

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

  const [settings, runtime, meetingsResult] = await Promise.all([
    getOrganizationZoomSettings(admin, membership.organization_id),
    Promise.resolve(getZoomRuntimeStatus()),
    admin
      .from("performance_meetings")
      .select("id,title,starts_at,zoom_status,zoom_last_synced_at,zoom_sync_error")
      .eq("organization_id", membership.organization_id)
      .eq("provider", "zoom")
      .order("starts_at", {ascending: false})
      .limit(10),
  ]);
  if (meetingsResult.error && !["42703", "42P01", "PGRST205"].includes(meetingsResult.error.code)) throw new Error(meetingsResult.error.message);
  const meetings = (meetingsResult.data || []) as MeetingRow[];
  const webhookUrl = `${getSiteUrl()}/api/zoom/webhook`;
  const ready = runtime.configured && runtime.webhookSecretPresent && settings.enabled && Boolean(settings.default_host_email);

  const c = fr ? {
    back: "Retour au tableau de bord",
    eyebrow: "INTÉGRATIONS",
    title: "Zoom Meetings",
    subtitle: "Crée les réunions Zoom depuis Super Leader, offre un accès en un clic et synchronise automatiquement les présences.",
    configured: "Identifiants API configurés",
    missing: "Configuration incomplète",
    enabled: "Intégration activée",
    disabled: "Intégration désactivée",
    webhook: "Adresse du webhook Zoom",
    webhookHelp: "Ajoute cette adresse dans les Event Subscriptions de ton application Zoom Server-to-Server OAuth.",
    settings: "Configuration de l’organisation",
    host: "Email du compte Zoom hôte",
    activate: "Activer Zoom pour cette organisation",
    autoCreate: "Proposer Zoom par défaut lors de la création d’une réunion",
    autoSync: "Synchroniser automatiquement les présences via les webhooks",
    grace: "Tolérance de retard (minutes)",
    minimum: "Présence minimale pour être considéré présent (%)",
    save: "Enregistrer la configuration",
    test: "Tester la connexion Zoom",
    recent: "Réunions Zoom récentes",
    noRecent: "Aucune réunion Zoom n’a encore été créée.",
    status: "Statut",
    lastSync: "Dernière synchronisation",
    environment: "Variables d’environnement requises",
    envHelp: "Configure ces variables dans .env.local et dans Vercel. Les secrets ne sont jamais affichés dans Super Leader.",
    ready: "Zoom est prêt",
    notReady: "Zoom n’est pas encore prêt",
  } : {
    back: "Back to dashboard",
    eyebrow: "INTEGRATIONS",
    title: "Zoom Meetings",
    subtitle: "Create Zoom meetings from Super Leader, provide one-click access and automatically sync attendance.",
    configured: "API credentials configured",
    missing: "Incomplete configuration",
    enabled: "Integration enabled",
    disabled: "Integration disabled",
    webhook: "Zoom webhook URL",
    webhookHelp: "Add this URL to the Event Subscriptions of your Zoom Server-to-Server OAuth app.",
    settings: "Organization settings",
    host: "Zoom host account email",
    activate: "Enable Zoom for this organization",
    autoCreate: "Offer Zoom by default when creating a meeting",
    autoSync: "Automatically sync attendance through webhooks",
    grace: "Late grace period (minutes)",
    minimum: "Minimum attendance to be marked present (%)",
    save: "Save configuration",
    test: "Test Zoom connection",
    recent: "Recent Zoom meetings",
    noRecent: "No Zoom meeting has been created yet.",
    status: "Status",
    lastSync: "Last sync",
    environment: "Required environment variables",
    envHelp: "Configure these variables in .env.local and Vercel. Secrets are never displayed in Super Leader.",
    ready: "Zoom is ready",
    notReady: "Zoom is not ready yet",
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
            <label className="block text-sm font-black">{c.host}<input name="defaultHostEmail" type="email" defaultValue={settings.default_host_email || ""} required className={fieldClass()} /></label>
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
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{c.environment}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{c.envHelp}</p><pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-white">ZOOM_ACCOUNT_ID=\nZOOM_CLIENT_ID=\nZOOM_CLIENT_SECRET=\nZOOM_WEBHOOK_SECRET_TOKEN=</pre></article>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{c.recent}</h2><div className="mt-5 space-y-3">{meetings.length ? meetings.map((meeting) => <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4"><div><p className="font-black">{meeting.title}</p><p className="mt-1 text-sm text-slate-500">{new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(meeting.starts_at))}</p>{meeting.zoom_sync_error ? <p className="mt-1 text-xs font-bold text-red-700">{meeting.zoom_sync_error}</p> : null}</div><div className="text-right"><Status ok={["scheduled","started","ended"].includes(meeting.zoom_status)}>{meeting.zoom_status}</Status><p className="mt-2 text-xs text-slate-500">{c.lastSync}: {meeting.zoom_last_synced_at ? new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "short", timeStyle: "short"}).format(new Date(meeting.zoom_last_synced_at)) : "—"}</p></div></div>) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{c.noRecent}</p>}</div></section>
    </div>
  </main>;
}
