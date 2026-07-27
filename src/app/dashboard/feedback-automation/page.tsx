import Link from "next/link";
import {redirect} from "next/navigation";
import {
  runFeedbackAutomationNowAction,
  updateFeedbackAutomationSettingsAction,
} from "@/app/actions/feedback-automation";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {getFeedbackProviderConfiguration} from "@/lib/crm/feedback-delivery";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type SearchParams = {success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type SettingsRow = {
  auto_request_feedback: boolean;
  auto_request_delay_minutes: number;
  auto_request_outcomes: string[];
  auto_send_email: boolean;
  auto_send_sms: boolean;
  auto_send_whatsapp: boolean;
  reminders_enabled: boolean;
  first_reminder_hours: number;
  reminder_interval_hours: number;
  max_reminders: number;
  fallback_channel: string;
};
type RequestRow = {
  id: string;
  employee_id: string;
  channel: string;
  status: string;
  automated: boolean;
  delivery_attempts: number;
  reminder_count: number;
  last_provider_status: string | null;
  scheduled_send_at: string | null;
  next_reminder_at: string | null;
  created_at: string;
  crm_clients: {full_name: string} | {full_name: string}[] | null;
};
type EventRow = {
  id: string;
  provider: string;
  event_type: string;
  event_status: string | null;
  created_at: string;
  crm_feedback_requests: {
    channel: string;
    employee_id: string;
    crm_clients: {full_name: string} | {full_name: string}[] | null;
  } | {
    channel: string;
    employee_id: string;
    crm_clients: {full_name: string} | {full_name: string}[] | null;
  }[] | null;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function Metric({label, value, detail}: {label: string; value: string | number; detail: string}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p>
    </article>
  );
}

const statusTone: Record<string, string> = {
  ready: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-indigo-100 text-indigo-800",
  opened: "bg-violet-100 text-violet-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  expired: "bg-slate-200 text-slate-700",
};

export default async function FeedbackAutomationPage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const query = (await searchParams) ?? {};
  const success = firstValue(query.success);
  const errorMessage = firstValue(query.error);

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
  if (!["owner", "admin", "manager"].includes(membership.role)) redirect("/dashboard/crm");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  const visibleUserIdSet = new Set(visibleUserIds);
  const canConfigure = ["owner", "admin"].includes(membership.role);
  const [settingsResult, requestsResult, eventsResult] = await Promise.all([
    admin
      .from("crm_settings")
      .select("auto_request_feedback, auto_request_delay_minutes, auto_request_outcomes, auto_send_email, auto_send_sms, auto_send_whatsapp, reminders_enabled, first_reminder_hours, reminder_interval_hours, max_reminders, fallback_channel")
      .eq("organization_id", membership.organization_id)
      .maybeSingle<SettingsRow>(),
    admin
      .from("crm_feedback_requests")
      .select("id, employee_id, channel, status, automated, delivery_attempts, reminder_count, last_provider_status, scheduled_send_at, next_reminder_at, created_at, crm_clients(full_name)")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(100),
    admin
      .from("crm_feedback_delivery_events")
      .select("id, provider, event_type, event_status, created_at, crm_feedback_requests(channel, employee_id, crm_clients(full_name))")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(30),
  ]);

  if (settingsResult.error && ["42703", "42P01", "PGRST205"].includes(settingsResult.error.code ?? "")) {
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("feedbackAutomation.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black">{t("feedbackAutomation.title")}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{t("feedbackAutomation.databaseTitle")}</h2>
            <p className="mt-3 leading-7 text-amber-900">{t("feedbackAutomation.databaseDescription")}</p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/011_feedback_automation_omnichannel.sql</code>
          </section>
        </div>
      </main>
    );
  }
  if (settingsResult.error || requestsResult.error || eventsResult.error) {
    throw new Error(settingsResult.error?.message || requestsResult.error?.message || eventsResult.error?.message || "Unable to load feedback automation.");
  }

  const settings: SettingsRow = settingsResult.data ?? {
    auto_request_feedback: false,
    auto_request_delay_minutes: 0,
    auto_request_outcomes: ["resolved", "follow_up", "payment_promise", "escalated", "other"],
    auto_send_email: false,
    auto_send_sms: false,
    auto_send_whatsapp: false,
    reminders_enabled: true,
    first_reminder_hours: 24,
    reminder_interval_hours: 48,
    max_reminders: 2,
    fallback_channel: "web",
  };
  const requests = ((requestsResult.data ?? []) as RequestRow[]).filter(
    (request) => membership.role !== "manager" || visibleUserIdSet.has(request.employee_id),
  );
  const events = ((eventsResult.data ?? []) as EventRow[]).filter((event) => {
    if (membership.role !== "manager") return true;
    const request = first(event.crm_feedback_requests);
    return Boolean(request && visibleUserIdSet.has(request.employee_id));
  });
  const providers = getFeedbackProviderConfiguration();
  const sent = requests.filter((item) => ["sent", "delivered", "opened", "completed"].includes(item.status)).length;
  const completed = requests.filter((item) => item.status === "completed").length;
  const failed = requests.filter((item) => item.status === "failed").length;
  const pendingReminders = requests.filter((item) => item.next_reminder_at && ["sent", "delivered", "opened"].includes(item.status)).length;
  const responseRate = sent ? Math.round((completed / sent) * 100) : 0;

  const providerCards = [
    {key: "email", configured: providers.email, webhook: providers.resendWebhook, variables: "RESEND_API_KEY · FEEDBACK_FROM_EMAIL · RESEND_WEBHOOK_SECRET"},
    {key: "sms", configured: providers.sms, webhook: providers.twilioWebhook, variables: "TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_MESSAGING_SERVICE_SID"},
    {key: "whatsapp", configured: providers.whatsapp, webhook: providers.whatsappWebhook, variables: "WHATSAPP_ACCESS_TOKEN · WHATSAPP_PHONE_NUMBER_ID · WHATSAPP_GRAPH_VERSION"},
    {key: "web", configured: true, webhook: true, variables: t("feedbackAutomation.providers.noVariables")},
  ];
  const outcomes = ["resolved", "follow_up", "payment_promise", "escalated", "other"];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-gradient-to-br from-indigo-800 via-slate-950 to-slate-950 p-7 text-white shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">{t("feedbackAutomation.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black">{t("feedbackAutomation.title")}</h1>
              <p className="mt-3 max-w-3xl leading-7 text-indigo-100">{t("feedbackAutomation.subtitle")}</p>
            </div>
            <Link href="/dashboard/crm?view=feedback" className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-black text-white hover:bg-white/20">
              {t("feedbackAutomation.openCrm")}
            </Link>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={t("feedbackAutomation.metrics.sent")} value={sent} detail={t("feedbackAutomation.metrics.sentHelp")} />
          <Metric label={t("feedbackAutomation.metrics.responseRate")} value={`${responseRate}%`} detail={t("feedbackAutomation.metrics.responseRateHelp", {completed})} />
          <Metric label={t("feedbackAutomation.metrics.reminders")} value={pendingReminders} detail={t("feedbackAutomation.metrics.remindersHelp")} />
          <Metric label={t("feedbackAutomation.metrics.failed")} value={failed} detail={t("feedbackAutomation.metrics.failedHelp")} />
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          {providerCards.map((provider) => (
            <article key={provider.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black">{t(`feedbackAutomation.providers.${provider.key}`)}</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${provider.configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  {provider.configured ? t("feedbackAutomation.providers.configured") : t("feedbackAutomation.providers.notConfigured")}
                </span>
              </div>
              <p className="mt-4 break-words text-xs font-semibold leading-5 text-slate-500">{provider.variables}</p>
              <p className={`mt-3 text-xs font-bold ${provider.webhook ? "text-emerald-700" : "text-amber-700"}`}>
                {provider.webhook ? t("feedbackAutomation.providers.trackingReady") : t("feedbackAutomation.providers.trackingMissing")}
              </p>
            </article>
          ))}
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[520px_1fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{t("feedbackAutomation.settings.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{t("feedbackAutomation.settings.help")}</p>
            {canConfigure ? (
              <form action={updateFeedbackAutomationSettingsAction} className="mt-6 space-y-5">
                <label className="flex items-start gap-3 rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-950">
                  <input name="autoRequestFeedback" type="checkbox" defaultChecked={settings.auto_request_feedback} className="mt-1" />
                  <span><strong>{t("feedbackAutomation.settings.autoRequest")}</strong><br />{t("feedbackAutomation.settings.autoRequestHelp")}</span>
                </label>
                <label className="block text-sm font-bold">{t("feedbackAutomation.settings.delay")}
                  <input name="autoRequestDelayMinutes" type="number" min="0" max="1440" defaultValue={settings.auto_request_delay_minutes} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
                </label>
                <fieldset>
                  <legend className="text-sm font-black">{t("feedbackAutomation.settings.outcomes")}</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {outcomes.map((outcome) => (
                      <label key={outcome} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold">
                        <input type="checkbox" name="autoRequestOutcomes" value={outcome} defaultChecked={settings.auto_request_outcomes.includes(outcome)} />
                        {t(`crm.outcomes.${outcome}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-black">{t("feedbackAutomation.settings.autoChannels")}</legend>
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"><input name="autoSendEmail" type="checkbox" defaultChecked={settings.auto_send_email} /> Email</label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"><input name="autoSendSms" type="checkbox" defaultChecked={settings.auto_send_sms} /> SMS</label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"><input name="autoSendWhatsapp" type="checkbox" defaultChecked={settings.auto_send_whatsapp} /> WhatsApp</label>
                  </div>
                </fieldset>
                <label className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
                  <input name="remindersEnabled" type="checkbox" defaultChecked={settings.reminders_enabled} className="mt-1" />
                  <span><strong>{t("feedbackAutomation.settings.reminders")}</strong><br />{t("feedbackAutomation.settings.remindersHelp")}</span>
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="text-sm font-bold">{t("feedbackAutomation.settings.firstReminder")}<input name="firstReminderHours" type="number" min="1" max="720" defaultValue={settings.first_reminder_hours} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">{t("feedbackAutomation.settings.interval")}<input name="reminderIntervalHours" type="number" min="1" max="720" defaultValue={settings.reminder_interval_hours} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">{t("feedbackAutomation.settings.maximum")}<input name="maxReminders" type="number" min="0" max="5" defaultValue={settings.max_reminders} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" /></label>
                </div>
                <label className="block text-sm font-bold">{t("feedbackAutomation.settings.fallback")}
                  <select name="fallbackChannel" defaultValue={settings.fallback_channel} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="web">{t("feedbackAutomation.settings.fallbackWeb")}</option><option value="email">Email</option><option value="none">{t("feedbackAutomation.settings.fallbackNone")}</option></select>
                </label>
                <button type="submit" className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("feedbackAutomation.settings.save")}</button>
              </form>
            ) : <p className="mt-5 rounded-xl bg-slate-100 p-4 text-sm font-semibold text-slate-600">{t("feedbackAutomation.settings.readOnly")}</p>}
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><h2 className="text-xl font-black">{t("feedbackAutomation.queue.title")}</h2><p className="mt-1 text-sm text-slate-500">{t("feedbackAutomation.queue.help")}</p></div>
                {canConfigure ? <form action={runFeedbackAutomationNowAction}><button type="submit" className="rounded-xl bg-indigo-700 px-4 py-3 text-sm font-black text-white">{t("feedbackAutomation.queue.runNow")}</button></form> : null}
              </div>
              <div className="mt-5 space-y-3">
                {requests.slice(0, 20).map((request) => {
                  const client = first(request.crm_clients)?.full_name || t("crm.unknownClient");
                  return (
                    <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><p className="font-black">{client}</p><p className="mt-1 text-xs font-semibold text-slate-500">{t(`crm.feedbackChannels.${request.channel}`)} · {new Date(request.created_at).toLocaleString(dateLocale)}</p></div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone[request.status] ?? "bg-slate-100 text-slate-700"}`}>{t(`feedbackAutomation.statuses.${request.status}`)}</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">{t("feedbackAutomation.queue.attempts", {attempts: request.delivery_attempts, reminders: request.reminder_count})}{request.last_provider_status ? ` · ${request.last_provider_status}` : ""}</p>
                    </article>
                  );
                })}
                {!requests.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("feedbackAutomation.queue.empty")}</p> : null}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("feedbackAutomation.events.title")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("feedbackAutomation.events.help")}</p>
              <div className="mt-5 space-y-3">
                {events.map((event) => {
                  const request = first(event.crm_feedback_requests);
                  const client = first(request?.crm_clients ?? null)?.full_name || t("crm.unknownClient");
                  return <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm"><div><strong>{client}</strong><p className="mt-1 text-xs text-slate-500">{event.provider} · {event.event_type}</p></div><div className="text-right"><span className="font-black">{event.event_status || "—"}</span><p className="mt-1 text-xs text-slate-400">{new Date(event.created_at).toLocaleString(dateLocale)}</p></div></div>;
                })}
                {!events.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("feedbackAutomation.events.empty")}</p> : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
