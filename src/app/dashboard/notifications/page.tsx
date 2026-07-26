import Link from "next/link";
import {redirect} from "next/navigation";
import {
  archiveNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  updateNotificationPreferencesAction,
} from "@/app/actions/notifications";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type NotificationFilter = "unread" | "all" | "urgent" | "tasks" | "preferences";

type SearchParams = {
  filter?: string | string[];
  success?: string | string[];
  error?: string | string[];
};

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

type NotificationRow = {
  id: string;
  category: string;
  event_type: string;
  priority: "info" | "success" | "warning" | "urgent";
  title_fr: string;
  title_en: string;
  body_fr: string;
  body_en: string;
  action_url: string | null;
  requires_action: boolean;
  status: "unread" | "read" | "archived";
  email_status: string;
  created_at: string;
  read_at: string | null;
};

type PreferenceRow = {
  email_enabled: boolean;
  email_frequency: "instant" | "daily" | "off";
  locale: "fr" | "en";
  report_reminders: boolean;
  absence_updates: boolean;
  meeting_reminders: boolean;
  sales_updates: boolean;
  collection_updates: boolean;
  feedback_alerts: boolean;
  performance_updates: boolean;
  crm_updates: boolean;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeFilter(value: string): NotificationFilter {
  return ["unread", "all", "urgent", "tasks", "preferences"].includes(value)
    ? (value as NotificationFilter)
    : "unread";
}

function priorityClasses(priority: NotificationRow["priority"]) {
  return {
    info: "border-indigo-200 bg-indigo-50 text-indigo-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    urgent: "border-red-200 bg-red-50 text-red-800",
  }[priority];
}

function categoryClasses(category: string) {
  if (category === "reports") return "bg-orange-100 text-orange-800";
  if (category === "absences") return "bg-sky-100 text-sky-800";
  if (category === "meetings") return "bg-purple-100 text-purple-800";
  if (category === "sales") return "bg-cyan-100 text-cyan-800";
  if (category === "collections") return "bg-teal-100 text-teal-800";
  if (category === "feedback") return "bg-pink-100 text-pink-800";
  if (category === "performance") return "bg-amber-100 text-amber-900";
  if (category === "crm") return "bg-violet-100 text-violet-800";
  return "bg-slate-100 text-slate-700";
}

function Toggle({name, label, description, defaultChecked}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 h-5 w-5 rounded border-slate-300"
      />
      <span>
        <span className="block font-black text-slate-900">{label}</span>
        <span className="mt-1 block text-sm leading-5 text-slate-500">{description}</span>
      </span>
    </label>
  );
}

export default async function NotificationsPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const filter = normalizeFilter(firstValue(params.filter));
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const {t, locale} = await getI18n();

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();

  if (membershipError) throw new Error(t("notifications.messages.loadFailed", {message: membershipError.message}));
  if (!membership) redirect("/dashboard/company");

  const [{data: allRows, error: notificationError}, {data: preferenceData, error: preferenceError}] = await Promise.all([
    admin
      .from("notifications")
      .select("id,category,event_type,priority,title_fr,title_en,body_fr,body_en,action_url,requires_action,status,email_status,created_at,read_at")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", authData.user.id)
      .neq("status", "archived")
      .order("created_at", {ascending: false})
      .limit(200),
    admin
      .from("notification_preferences")
      .select("email_enabled,email_frequency,locale,report_reminders,absence_updates,meeting_reminders,sales_updates,collection_updates,feedback_alerts,performance_updates,crm_updates")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", authData.user.id)
      .maybeSingle<PreferenceRow>(),
  ]);

  if (notificationError || preferenceError) {
    const message = notificationError?.message ?? preferenceError?.message ?? t("common.unknownError");
    throw new Error(t("notifications.messages.databaseSetupRequired", {message}));
  }

  const rows = (allRows ?? []) as NotificationRow[];
  const preferences: PreferenceRow = preferenceData ?? {
    email_enabled: true,
    email_frequency: "daily",
    locale,
    report_reminders: true,
    absence_updates: true,
    meeting_reminders: true,
    sales_updates: true,
    collection_updates: true,
    feedback_alerts: true,
    performance_updates: true,
    crm_updates: true,
  };

  const counts = {
    unread: rows.filter((row) => row.status === "unread").length,
    all: rows.length,
    urgent: rows.filter((row) => row.priority === "urgent").length,
    tasks: rows.filter((row) => row.requires_action).length,
  };

  const visibleRows = rows.filter((row) => {
    if (filter === "unread") return row.status === "unread";
    if (filter === "urgent") return row.priority === "urgent";
    if (filter === "tasks") return row.requires_action;
    return true;
  });

  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const returnTo = `/dashboard/notifications?filter=${filter}`;
  const tabs: Array<{key: NotificationFilter; count?: number}> = [
    {key: "unread", count: counts.unread},
    {key: "all", count: counts.all},
    {key: "urgent", count: counts.urgent},
    {key: "tasks", count: counts.tasks},
    {key: "preferences"},
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
                {t("notifications.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black">{t("notifications.title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{t("notifications.subtitle")}</p>
            </div>
            {counts.unread > 0 && filter !== "preferences" ? (
              <form action={markAllNotificationsReadAction}>
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-slate-100">
                  {t("notifications.markAllRead")}
                </button>
              </form>
            ) : null}
          </div>
        </header>

        {success ? (
          <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</p>
        ) : null}
        {errorMessage ? (
          <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</p>
        ) : null}

        <nav className="mt-6 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map((tab) => {
            const active = tab.key === filter;
            return (
              <Link
                key={tab.key}
                href={`/dashboard/notifications?filter=${tab.key}`}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${active ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t(`notifications.tabs.${tab.key}`)}
                {typeof tab.count === "number" ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{tab.count}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {filter === "preferences" ? (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{t("notifications.preferences.title")}</h2>
            <p className="mt-2 text-slate-500">{t("notifications.preferences.subtitle")}</p>
            <form action={updateNotificationPreferencesAction} className="mt-6 space-y-6">
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="grid gap-4 md:grid-cols-2">
                <Toggle name="emailEnabled" label={t("notifications.preferences.emailEnabled")} description={t("notifications.preferences.emailEnabledHelp")} defaultChecked={preferences.email_enabled} />
                <label className="rounded-2xl border border-slate-200 bg-white p-4">
                  <span className="block font-black text-slate-900">{t("notifications.preferences.frequency")}</span>
                  <span className="mt-1 block text-sm text-slate-500">{t("notifications.preferences.frequencyHelp")}</span>
                  <select name="emailFrequency" defaultValue={preferences.email_frequency} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                    <option value="instant">{t("notifications.preferences.frequencies.instant")}</option>
                    <option value="daily">{t("notifications.preferences.frequencies.daily")}</option>
                    <option value="off">{t("notifications.preferences.frequencies.off")}</option>
                  </select>
                </label>
                <label className="rounded-2xl border border-slate-200 bg-white p-4 md:col-span-2">
                  <span className="block font-black text-slate-900">{t("notifications.preferences.emailLanguage")}</span>
                  <select name="locale" defaultValue={preferences.locale} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 md:max-w-sm">
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>

              <div>
                <h3 className="text-lg font-black">{t("notifications.preferences.categories")}</h3>
                <p className="mt-1 text-sm text-slate-500">{t("notifications.preferences.categoriesHelp")}</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Toggle name="reportReminders" label={t("notifications.categories.reports")} description={t("notifications.preferences.reportHelp")} defaultChecked={preferences.report_reminders} />
                  <Toggle name="absenceUpdates" label={t("notifications.categories.absences")} description={t("notifications.preferences.absenceHelp")} defaultChecked={preferences.absence_updates} />
                  <Toggle name="meetingReminders" label={t("notifications.categories.meetings")} description={t("notifications.preferences.meetingHelp")} defaultChecked={preferences.meeting_reminders} />
                  <Toggle name="salesUpdates" label={t("notifications.categories.sales")} description={t("notifications.preferences.salesHelp")} defaultChecked={preferences.sales_updates} />
                  <Toggle name="collectionUpdates" label={t("notifications.categories.collections")} description={t("notifications.preferences.collectionHelp")} defaultChecked={preferences.collection_updates} />
                  <Toggle name="feedbackAlerts" label={t("notifications.categories.feedback")} description={t("notifications.preferences.feedbackHelp")} defaultChecked={preferences.feedback_alerts} />
                  <Toggle name="performanceUpdates" label={t("notifications.categories.performance")} description={t("notifications.preferences.performanceHelp")} defaultChecked={preferences.performance_updates} />
                  <Toggle name="crmUpdates" label={t("notifications.categories.crm")} description={t("notifications.preferences.crmHelp")} defaultChecked={preferences.crm_updates} />
                </div>
              </div>

              <button className="rounded-xl bg-indigo-700 px-6 py-3 font-black text-white hover:bg-indigo-800">
                {t("notifications.preferences.save")}
              </button>
            </form>
          </section>
        ) : (
          <section className="mt-6 space-y-4">
            {visibleRows.length ? visibleRows.map((notification) => {
              const title = locale === "fr" ? notification.title_fr : notification.title_en;
              const body = locale === "fr" ? notification.body_fr : notification.body_en;
              const createdAt = new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short"}).format(new Date(notification.created_at));
              return (
                <article key={notification.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${notification.status === "unread" ? "border-indigo-300 ring-1 ring-indigo-100" : "border-slate-200"}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-black ${categoryClasses(notification.category)}`}>
                          {t(`notifications.categories.${notification.category}`)}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${priorityClasses(notification.priority)}`}>
                          {t(`notifications.priorities.${notification.priority}`)}
                        </span>
                        {notification.requires_action ? (
                          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-800">{t("notifications.actionRequired")}</span>
                        ) : null}
                        {notification.status === "unread" ? (
                          <span className="rounded-full bg-indigo-700 px-2.5 py-1 text-xs font-black text-white">{t("notifications.new")}</span>
                        ) : null}
                      </div>
                      <h2 className="mt-3 text-xl font-black text-slate-950">{title}</h2>
                      <p className="mt-2 leading-7 text-slate-600">{body}</p>
                      <p className="mt-3 text-xs font-bold text-slate-400">{createdAt} · {t(`notifications.emailStatuses.${notification.email_status}`)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {notification.action_url ? (
                        <Link href={notification.action_url} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">
                          {t("notifications.open")}
                        </Link>
                      ) : null}
                      {notification.status === "unread" ? (
                        <form action={markNotificationReadAction}>
                          <input type="hidden" name="notificationId" value={notification.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button className="rounded-xl border border-indigo-200 px-4 py-2.5 text-sm font-black text-indigo-700 hover:bg-indigo-50">{t("notifications.markRead")}</button>
                        </form>
                      ) : null}
                      <form action={archiveNotificationAction}>
                        <input type="hidden" name="notificationId" value={notification.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50">{t("notifications.archive")}</button>
                      </form>
                    </div>
                  </div>
                </article>
              );
            }) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
                <p className="text-4xl">✓</p>
                <h2 className="mt-4 text-xl font-black">{t("notifications.emptyTitle")}</h2>
                <p className="mt-2 text-slate-500">{t("notifications.emptyDescription")}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
