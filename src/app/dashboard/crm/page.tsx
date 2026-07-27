import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createCrmClientAction,
  createCrmInteractionAction,
  createCrmTaskAction,
  createCustomerFeedbackRequestAction,
  importApprovedSalesToCrmAction,
  resolveCustomerFeedbackAction,
  sendCustomerFeedbackRequestAction,
  updateCrmSettingsAction,
  updateCrmTaskStatusAction,
} from "@/app/actions/crm";
import {FeedbackShareLinks} from "@/components/crm/feedback-share-links";
import {getI18n} from "@/i18n/server";
import {COMMERCIAL_MANAGER_ROLES, canUseCommercialModules, type OrganizationRole} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {buildFeedbackMessage} from "@/lib/crm/feedback-delivery";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type SearchParams = {
  success?: string | string[];
  error?: string | string[];
  view?: string | string[];
  client?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type ClientRow = {
  id: string;
  reference: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  preferred_language: "fr" | "en";
  preferred_feedback_channel: string;
  feedback_opt_in: boolean;
  do_not_contact: boolean;
  owner_id: string | null;
  follow_up_owner_id: string | null;
  source: string;
  status: string;
  city: string | null;
  country: string | null;
  created_at: string;
};
type ContractRow = {
  id: string;
  client_id: string;
  contract_number: string;
  title: string;
  total_amount: number | string;
  currency: string;
  status: string;
  seller_id: string | null;
  collection_owner_id: string | null;
  expected_end_date: string | null;
  created_by: string;
};
type InteractionRow = {
  id: string;
  client_id: string;
  contract_id: string | null;
  employee_id: string;
  channel: string;
  interaction_type: string;
  outcome: string;
  summary: string;
  occurred_at: string;
  next_follow_up_at: string | null;
  feedback_requested: boolean;
};
type TaskRow = {
  id: string;
  client_id: string;
  contract_id: string | null;
  assigned_to: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  created_by: string;
};
type RequestRow = {
  id: string;
  client_id: string;
  contract_id: string | null;
  interaction_id: string | null;
  employee_id: string;
  public_token: string;
  channel: string;
  locale: "fr" | "en";
  recipient: string | null;
  message: string;
  status: string;
  sent_at: string | null;
  expires_at: string;
  delivery_error: string | null;
  created_at: string;
};
type ResponseRow = {
  id: string;
  request_id: string;
  client_id: string;
  employee_id: string;
  rating: number;
  comment: string | null;
  resolution_status: string;
  resolution_assigned_to: string | null;
  resolution_notes: string | null;
  submitted_at: string;
};
type SettingsRow = {
  default_feedback_channel: string;
  feedback_cooldown_days: number;
  feedback_expiry_days: number;
  low_score_threshold: number;
  auto_send_email: boolean;
  feedback_message_fr: string;
  feedback_message_en: string;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Metric({label, value, detail}: {label: string; value: string | number; detail?: string}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      {detail ? <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p> : null}
    </article>
  );
}

const statusTone: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  prospect: "bg-blue-100 text-blue-800",
  inactive: "bg-slate-100 text-slate-700",
  closed: "bg-slate-200 text-slate-700",
  ready: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-indigo-100 text-indigo-800",
  opened: "bg-violet-100 text-violet-800",
  completed: "bg-emerald-100 text-emerald-800",
  expired: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
  todo: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-700",
  open: "bg-red-100 text-red-800",
  resolved: "bg-emerald-100 text-emerald-800",
  not_required: "bg-slate-100 text-slate-700",
};

export default async function CrmPage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const params = (await searchParams) ?? {};
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const view = ["clients", "interactions", "feedback", "tasks"].includes(firstValue(params.view)) ? firstValue(params.view) : "clients";
  const selectedClientFilter = firstValue(params.client);

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
  if (!membership) redirect("/dashboard/company");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  const isLeader = COMMERCIAL_MANAGER_ROLES.has(membership.role as OrganizationRole);
  const canConfigure = ["owner", "admin"].includes(membership.role);

  const [schemaCheck, membersResult, organizationResult, settingsResult] = await Promise.all([
    admin.from("crm_clients").select("id", {head: true, count: "exact"}).limit(1),
    admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleUserIds).order("created_at"),
    admin.from("organizations").select("name").eq("id", membership.organization_id).maybeSingle<{name: string}>(),
    admin.from("crm_settings").select("default_feedback_channel, feedback_cooldown_days, feedback_expiry_days, low_score_threshold, auto_send_email, feedback_message_fr, feedback_message_en").eq("organization_id", membership.organization_id).maybeSingle<SettingsRow>(),
  ]);

  if (schemaCheck.error) {
    const missingTable = schemaCheck.error.code === "42P01" || schemaCheck.error.code === "PGRST205";
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("crm.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black">{t("crm.title")}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{missingTable ? t("crm.databaseSetupTitle") : t("crm.loadFailedTitle")}</h2>
            <p className="mt-3 leading-7 text-amber-900">{missingTable ? t("crm.databaseSetupDescription") : t("crm.messages.loadFailed", {message: schemaCheck.error.message})}</p>
            {missingTable ? <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/010_crm_clients_feedback.sql</code> : null}
          </section>
        </div>
      </main>
    );
  }
  if (membersResult.error) throw new Error(membersResult.error.message);

  const members = (membersResult.data ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.user_id);
  const {data: profilesData, error: profilesError} = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : {data: [] as ProfileRow[], error: null};
  if (profilesError) throw new Error(profilesError.message);
  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const membersById = new Map(members.map((member) => [member.user_id, member]));
  const memberOptions = memberIds
    .map((id) => ({id, name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || t("common.member"), role: membersById.get(id)?.role ?? "employee"}))
    .sort((a, b) => a.name.localeCompare(b.name));
  const memberName = (id: string | null) => id ? memberOptions.find((item) => item.id === id)?.name || t("common.member") : t("crm.unassigned");

  let clientsQuery = admin
    .from("crm_clients")
    .select("id, reference, full_name, email, phone, whatsapp_phone, preferred_language, preferred_feedback_channel, feedback_opt_in, do_not_contact, owner_id, follow_up_owner_id, source, status, city, country, created_at")
    .eq("organization_id", membership.organization_id)
    .order("created_at", {ascending: false})
    .limit(300);
  if (membership.role === "manager") {
    const scopedIds = visibleUserIds.join(",");
    clientsQuery = clientsQuery.or(
      `owner_id.in.(${scopedIds}),follow_up_owner_id.in.(${scopedIds})`,
    );
  } else if (!isLeader) {
    clientsQuery = clientsQuery.or(
      `owner_id.eq.${authData.user.id},follow_up_owner_id.eq.${authData.user.id}`,
    );
  }
  const {data: clientsData, error: clientsError} = await clientsQuery;
  if (clientsError) throw new Error(t("crm.messages.loadFailed", {message: clientsError.message}));
  const clients = (clientsData ?? []) as ClientRow[];
  const clientIds = clients.map((client) => client.id);
  const clientById = new Map(clients.map((client) => [client.id, client]));

  let contractsQuery = admin
    .from("crm_contracts")
    .select("id, client_id, contract_number, title, total_amount, currency, status, seller_id, collection_owner_id, expected_end_date, created_by")
    .eq("organization_id", membership.organization_id)
    .in("client_id", clientIds)
    .order("created_at", {ascending: false});
  let interactionsQuery = admin
    .from("crm_interactions")
    .select("id, client_id, contract_id, employee_id, channel, interaction_type, outcome, summary, occurred_at, next_follow_up_at, feedback_requested")
    .eq("organization_id", membership.organization_id)
    .in("client_id", clientIds)
    .order("occurred_at", {ascending: false})
    .limit(150);
  let tasksQuery = admin
    .from("crm_follow_up_tasks")
    .select("id, client_id, contract_id, assigned_to, title, description, due_at, priority, status, created_by")
    .eq("organization_id", membership.organization_id)
    .in("client_id", clientIds)
    .order("due_at", {ascending: true, nullsFirst: false})
    .limit(200);
  let requestsQuery = admin
    .from("crm_feedback_requests")
    .select("id, client_id, contract_id, interaction_id, employee_id, public_token, channel, locale, recipient, message, status, sent_at, expires_at, delivery_error, created_at")
    .eq("organization_id", membership.organization_id)
    .in("client_id", clientIds)
    .order("created_at", {ascending: false})
    .limit(150);

  if (!["owner", "admin"].includes(membership.role)) {
    const scopedIds = visibleUserIds.join(",");
    contractsQuery = contractsQuery.or(
      `seller_id.in.(${scopedIds}),collection_owner_id.in.(${scopedIds}),created_by.in.(${scopedIds})`,
    );
    interactionsQuery = interactionsQuery.in("employee_id", visibleUserIds);
    tasksQuery = tasksQuery.or(
      `assigned_to.in.(${scopedIds}),created_by.in.(${scopedIds})`,
    );
    requestsQuery = requestsQuery.in("employee_id", visibleUserIds);
  }

  const [contractsResult, interactionsResult, tasksResult, requestsResult] = clientIds.length
    ? await Promise.all([contractsQuery, interactionsQuery, tasksQuery, requestsQuery])
    : [
        {data: [] as ContractRow[], error: null},
        {data: [] as InteractionRow[], error: null},
        {data: [] as TaskRow[], error: null},
        {data: [] as RequestRow[], error: null},
      ];
  if (contractsResult.error || interactionsResult.error || tasksResult.error || requestsResult.error) {
    throw new Error(t("crm.messages.loadFailed", {message: contractsResult.error?.message || interactionsResult.error?.message || tasksResult.error?.message || requestsResult.error?.message || t("common.unknownError")}));
  }

  const contracts = (contractsResult.data ?? []) as ContractRow[];
  const interactions = (interactionsResult.data ?? []) as InteractionRow[];
  const tasks = (tasksResult.data ?? []) as TaskRow[];
  const requests = (requestsResult.data ?? []) as RequestRow[];
  const requestIds = requests.map((request) => request.id);
  const {data: responsesData, error: responsesError} = requestIds.length
    ? await admin.from("crm_feedback_responses").select("id, request_id, client_id, employee_id, rating, comment, resolution_status, resolution_assigned_to, resolution_notes, submitted_at").in("request_id", requestIds).order("submitted_at", {ascending: false})
    : {data: [] as ResponseRow[], error: null};
  if (responsesError) throw new Error(t("crm.messages.loadFailed", {message: responsesError.message}));
  const responses = (responsesData ?? []) as ResponseRow[];

  const contractsByClient = new Map<string, ContractRow[]>();
  contracts.forEach((contract) => contractsByClient.set(contract.client_id, [...(contractsByClient.get(contract.client_id) ?? []), contract]));

  const today = new Date();
  const openTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const overdueTasks = openTasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < today.getTime());
  const activeContracts = contracts.filter((contract) => !["paid", "cancelled", "terminated"].includes(contract.status));
  const averageRating = responses.length ? (responses.reduce((sum, response) => sum + response.rating, 0) / responses.length).toFixed(1) : "—";
  const openAlerts = responses.filter((response) => ["open", "in_progress"].includes(response.resolution_status));
  const organizationName = organizationResult.data?.name || "Super Leader";
  const settings: SettingsRow = settingsResult.data ?? {
    default_feedback_channel: "email",
    feedback_cooldown_days: 7,
    feedback_expiry_days: 14,
    low_score_threshold: 2,
    auto_send_email: false,
    feedback_message_fr: "Merci pour votre échange avec notre équipe. Votre avis nous aide à mieux vous servir.",
    feedback_message_en: "Thank you for speaking with our team. Your feedback helps us serve you better.",
  };

  const selectedClient = clients.find((client) => client.id === selectedClientFilter) ?? null;
  const visibleInteractions = selectedClient ? interactions.filter((item) => item.client_id === selectedClient.id) : interactions;
  const visibleTasks = selectedClient ? tasks.filter((item) => item.client_id === selectedClient.id) : tasks;
  const visibleRequests = selectedClient ? requests.filter((item) => item.client_id === selectedClient.id) : requests;
  const visibleResponses = selectedClient ? responses.filter((item) => item.client_id === selectedClient.id) : responses;
  const currentTimestamp = new Date().getTime();

  const tabs = [
    {id: "clients", label: t("crm.tabs.clients")},
    {id: "interactions", label: t("crm.tabs.interactions")},
    {id: "feedback", label: t("crm.tabs.feedback")},
    {id: "tasks", label: t("crm.tabs.tasks")},
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-gradient-to-br from-indigo-800 via-slate-950 to-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("crm.eyebrow")}</p>
          <h1 className="mt-2 text-3xl font-black">{t("crm.title")}</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-300">{t("crm.subtitle")}</p>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label={t("crm.metrics.clients")} value={clients.length} detail={t("crm.metrics.activeClients", {count: clients.filter((client) => client.status === "active").length})} />
          <Metric label={t("crm.metrics.activeContracts")} value={activeContracts.length} detail={t("crm.metrics.totalContracts", {count: contracts.length})} />
          <Metric label={t("crm.metrics.openTasks")} value={openTasks.length} detail={t("crm.metrics.overdueTasks", {count: overdueTasks.length})} />
          <Metric label={t("crm.metrics.customerSatisfaction")} value={averageRating === "—" ? averageRating : `${averageRating}/5`} detail={t("crm.metrics.responses", {count: responses.length})} />
          <Metric label={t("crm.metrics.alerts")} value={openAlerts.length} detail={t("crm.metrics.lowScores")}/>
        </section>

        <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map((tab) => (
            <Link key={tab.id} href={`/dashboard/crm?view=${tab.id}`} className={`rounded-xl px-4 py-3 text-sm font-black ${view === tab.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {tab.label}
            </Link>
          ))}
        </nav>

        {view === "clients" ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
            <section className="space-y-6">
              <form action={createCrmClientAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <input type="hidden" name="returnTo" value="/dashboard/crm?view=clients" />
                <h2 className="text-xl font-black">{t("crm.clients.newClient")}</h2>
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-bold">{t("crm.fields.fullName")}<input name="fullName" required maxLength={200} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-bold">{t("common.email")}<input name="email" type="email" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                    <label className="text-sm font-bold">{t("crm.fields.phone")}<input name="phone" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  </div>
                  <label className="text-sm font-bold">{t("crm.fields.whatsappPhone")}<input name="whatsappPhone" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-bold">{t("crm.fields.country")}<input name="country" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                    <label className="text-sm font-bold">{t("crm.fields.city")}<input name="city" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  </div>
                  <label className="text-sm font-bold">{t("crm.fields.companyName")}<input name="companyName" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-bold">{t("crm.fields.language")}<select name="preferredLanguage" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="fr">Français</option><option value="en">English</option></select></label>
                    <label className="text-sm font-bold">{t("crm.fields.feedbackChannel")}<select name="preferredFeedbackChannel" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="web">Web</option></select></label>
                  </div>
                  <label className="text-sm font-bold">{t("crm.fields.salesOwner")}<select name="ownerId" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.followUpOwner")}<select name="followUpOwnerId" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  <label className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm"><input name="feedbackOptIn" type="checkbox" defaultChecked className="mt-1" /><span><strong>{t("crm.fields.feedbackConsent")}</strong><br />{t("crm.fields.feedbackConsentHelp")}</span></label>
                  <label className="flex items-center gap-3 text-sm"><input name="marketingOptIn" type="checkbox" />{t("crm.fields.marketingConsent")}</label>
                  <label className="text-sm font-bold">{t("crm.fields.notes")}<textarea name="notes" maxLength={5000} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white" type="submit">{t("crm.clients.create")}</button>
                </div>
              </form>

              {isLeader ? (
                <form action={importApprovedSalesToCrmAction} className="rounded-3xl border border-cyan-200 bg-cyan-50 p-6">
                  <input type="hidden" name="returnTo" value="/dashboard/crm?view=clients" />
                  <h2 className="text-xl font-black text-cyan-950">{t("crm.clients.importTitle")}</h2>
                  <p className="mt-2 text-sm leading-6 text-cyan-800">{t("crm.clients.importDescription")}</p>
                  <button type="submit" className="mt-4 rounded-xl bg-cyan-900 px-5 py-3 font-black text-white">{t("crm.clients.importButton")}</button>
                </form>
              ) : null}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">{t("crm.clients.listTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("crm.clients.listCount", {count: clients.length})}</p></div></div>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {clients.map((client) => {
                  const clientContracts = contractsByClient.get(client.id) ?? [];
                  return (
                    <Link href={`/dashboard/crm/${client.id}`} key={client.id} className="rounded-2xl border border-slate-200 p-5 hover:border-indigo-400 hover:bg-indigo-50/40">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black">{client.full_name}</p><p className="mt-1 text-xs font-bold text-slate-400">{client.reference}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone[client.status] ?? "bg-slate-100"}`}>{t(`crm.clientStatuses.${client.status}`)}</span></div>
                      <p className="mt-4 text-sm text-slate-600">{client.email || client.phone || t("crm.noContact")}</p>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-400">{t("crm.fields.salesOwner")}</p><p className="mt-1 font-black">{memberName(client.owner_id)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-400">{t("crm.fields.followUpOwner")}</p><p className="mt-1 font-black">{memberName(client.follow_up_owner_id)}</p></div></div>
                      <p className="mt-4 text-sm font-bold text-indigo-700">{t("crm.clients.contractCount", {count: clientContracts.length})}</p>
                    </Link>
                  );
                })}
                {!clients.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 lg:col-span-2">{t("crm.clients.empty")}</p> : null}
              </div>
            </section>
          </div>
        ) : null}

        {view === "interactions" ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[430px_1fr]">
            <form action={createCrmInteractionAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <input type="hidden" name="returnTo" value="/dashboard/crm?view=interactions" />
              <h2 className="text-xl font-black">{t("crm.interactions.new")}</h2>
              <div className="mt-5 grid gap-4">
                <label className="text-sm font-bold">{t("crm.fields.client")}<select name="clientId" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">—</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
                <label className="text-sm font-bold">{t("crm.fields.employee")}<select name="employeeId" defaultValue={authData.user.id} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-bold">{t("crm.fields.channel")}<select name="channel" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["phone","whatsapp","email","sms","meeting","video","web_chat","other"].map((item) => <option key={item} value={item}>{t(`crm.channels.${item}`)}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.direction")}<select name="direction" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="outbound">{t("crm.directions.outbound")}</option><option value="inbound">{t("crm.directions.inbound")}</option></select></label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-bold">{t("crm.fields.interactionType")}<select name="interactionType" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["sales","support","collection","training","complaint","information","other"].map((item) => <option key={item} value={item}>{t(`crm.interactionTypes.${item}`)}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.outcome")}<select name="outcome" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["resolved","follow_up","payment_promise","no_answer","escalated","other"].map((item) => <option key={item} value={item}>{t(`crm.outcomes.${item}`)}</option>)}</select></label>
                </div>
                <label className="text-sm font-bold">{t("crm.fields.occurredAt")}<input name="occurredAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold">{t("crm.fields.summary")}<textarea name="summary" required maxLength={5000} className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold">{t("crm.fields.nextFollowUp")}<input name="nextFollowUpAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input name="requestFeedback" type="checkbox" defaultChecked className="mt-1" /><span><strong>{t("crm.interactions.requestFeedback")}</strong><br />{t("crm.interactions.requestFeedbackHelp")}</span></label>
                <label className="text-sm font-bold">{t("crm.fields.feedbackChannel")}<select name="feedbackChannel" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.useClientPreference")}</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="web">Web</option></select></label>
                <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("crm.interactions.save")}</button>
              </div>
            </form>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.interactions.recent")}</h2>
              <div className="mt-5 space-y-4">
                {visibleInteractions.map((interaction) => {
                  const client = clientById.get(interaction.client_id);
                  return (
                    <article key={interaction.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link className="font-black text-indigo-700" href={`/dashboard/crm/${interaction.client_id}`}>{client?.full_name || t("crm.unknownClient")}</Link><p className="mt-1 text-xs font-semibold text-slate-400">{new Date(interaction.occurred_at).toLocaleString(dateLocale)} · {memberName(interaction.employee_id)}</p></div><span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">{t(`crm.channels.${interaction.channel}`)}</span></div>
                      <p className="mt-4 leading-7 text-slate-700">{interaction.summary}</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500"><span>{t(`crm.interactionTypes.${interaction.interaction_type}`)}</span><span>·</span><span>{t(`crm.outcomes.${interaction.outcome}`)}</span>{interaction.feedback_requested ? <><span>·</span><span className="text-amber-700">{t("crm.interactions.feedbackRequested")}</span></> : null}</div>
                    </article>
                  );
                })}
                {!visibleInteractions.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("crm.interactions.empty")}</p> : null}
              </div>
            </section>
          </div>
        ) : null}

        {view === "feedback" ? (
          <div className="mt-6 space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <form action={createCustomerFeedbackRequestAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <input type="hidden" name="returnTo" value="/dashboard/crm?view=feedback" />
                <h2 className="text-xl font-black">{t("crm.feedback.newRequest")}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{t("crm.feedback.newRequestHelp")}</p>
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-bold">{t("crm.fields.client")}<select name="clientId" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">—</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.employeeRated")}<select name="employeeId" defaultValue={authData.user.id} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                  <label className="text-sm font-bold">{t("crm.fields.feedbackChannel")}<select name="feedbackChannel" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.useClientPreference")}</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="web">Web</option></select></label>
                  {isLeader ? <label className="flex items-center gap-3 text-sm"><input name="force" type="checkbox" />{t("crm.feedback.ignoreCooldown")}</label> : null}
                  <button type="submit" className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("crm.feedback.createRequest")}</button>
                </div>
              </form>

              {canConfigure ? (
                <form action={updateCrmSettingsAction} className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
                  <input type="hidden" name="returnTo" value="/dashboard/crm?view=feedback" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-black text-indigo-950">{t("crm.settings.title")}</h2>
                    <Link href="/dashboard/feedback-automation" className="rounded-lg bg-indigo-900 px-4 py-2 text-xs font-black text-white">{t("crm.settings.manageAutomation")}</Link>
                  </div>
                  <div className="mt-5 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="text-sm font-bold text-indigo-950">{t("crm.settings.defaultChannel")}<select name="defaultFeedbackChannel" defaultValue={settings.default_feedback_channel} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-3 font-normal"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="web">Web</option></select></label>
                      <label className="text-sm font-bold text-indigo-950">{t("crm.settings.cooldownDays")}<input name="feedbackCooldownDays" type="number" min="0" max="365" defaultValue={settings.feedback_cooldown_days} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-3 font-normal" /></label>
                      <label className="text-sm font-bold text-indigo-950">{t("crm.settings.expiryDays")}<input name="feedbackExpiryDays" type="number" min="1" max="90" defaultValue={settings.feedback_expiry_days} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-3 font-normal" /></label>
                    </div>
                    <label className="text-sm font-bold text-indigo-950">{t("crm.settings.lowScoreThreshold")}<input name="lowScoreThreshold" type="number" min="1" max="5" defaultValue={settings.low_score_threshold} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-3 font-normal" /></label>
                    <label className="flex items-start gap-3 rounded-xl bg-white p-4 text-sm text-indigo-950"><input name="autoSendEmail" type="checkbox" defaultChecked={settings.auto_send_email} className="mt-1" /><span><strong>{t("crm.settings.autoEmail")}</strong><br />{t("crm.settings.autoEmailHelp")}</span></label>
                    <label className="text-sm font-bold text-indigo-950">{t("crm.settings.messageFr")}<textarea name="feedbackMessageFr" defaultValue={settings.feedback_message_fr} maxLength={2000} className="mt-2 min-h-20 w-full rounded-xl border border-indigo-200 bg-white px-3 py-3 font-normal" /></label>
                    <label className="text-sm font-bold text-indigo-950">{t("crm.settings.messageEn")}<textarea name="feedbackMessageEn" defaultValue={settings.feedback_message_en} maxLength={2000} className="mt-2 min-h-20 w-full rounded-xl border border-indigo-200 bg-white px-3 py-3 font-normal" /></label>
                    <button type="submit" className="rounded-xl bg-indigo-900 px-5 py-3 font-black text-white">{t("crm.settings.save")}</button>
                  </div>
                </form>
              ) : null}
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.feedback.requests")}</h2>
              <div className="mt-5 space-y-4">
                {visibleRequests.map((request) => {
                  const client = clientById.get(request.client_id);
                  const employeeName = memberName(request.employee_id);
                  const content = buildFeedbackMessage({token: request.public_token, locale: request.locale, clientName: client?.full_name || t("crm.unknownClient"), organizationName, employeeName, message: request.message});
                  return (
                    <article key={request.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link className="font-black text-indigo-700" href={`/dashboard/crm/${request.client_id}`}>{client?.full_name || t("crm.unknownClient")}</Link><p className="mt-1 text-xs text-slate-400">{t("crm.feedback.aboutEmployee", {name: employeeName})} · {new Date(request.created_at).toLocaleString(dateLocale)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone[request.status] ?? "bg-slate-100"}`}>{t(`crm.feedbackStatuses.${request.status}`)}</span></div>
                      <p className="mt-3 text-sm text-slate-600">{t("crm.feedback.channelAndExpiry", {channel: t(`crm.feedbackChannels.${request.channel}`), date: new Date(request.expires_at).toLocaleDateString(dateLocale)})}</p>
                      {request.delivery_error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{request.delivery_error}</p> : null}
                      <div className="mt-4"><FeedbackShareLinks url={content.url} message={content.text.split("\n").slice(0, 3).join("\n")} subject={content.subject} email={client?.email} phone={request.channel === "whatsapp" ? client?.whatsapp_phone || client?.phone : client?.phone} labels={{copy: t("crm.feedback.copyLink"), copied: t("crm.feedback.copied"), email: "Email", whatsapp: "WhatsApp", sms: "SMS", open: t("crm.feedback.openForm")}} /></div>
                      {!(["completed", "cancelled", "expired"].includes(request.status)) ? (
                        <form action={sendCustomerFeedbackRequestAction} className="mt-4"><input type="hidden" name="returnTo" value="/dashboard/crm?view=feedback" /><input type="hidden" name="requestId" value={request.id} /><button className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white" type="submit">{request.channel === "email" ? t("crm.feedback.sendNow") : t("crm.feedback.markSent")}</button></form>
                      ) : null}
                    </article>
                  );
                })}
                {!visibleRequests.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("crm.feedback.noRequests")}</p> : null}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.feedback.responses")}</h2>
              <div className="mt-5 space-y-4">
                {visibleResponses.map((response) => {
                  const client = clientById.get(response.client_id);
                  return (
                    <article key={response.id} className={`rounded-2xl border p-5 ${response.rating <= settings.low_score_threshold ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link className="font-black text-indigo-700" href={`/dashboard/crm/${response.client_id}`}>{client?.full_name || t("crm.unknownClient")}</Link><p className="mt-1 text-xs text-slate-400">{new Date(response.submitted_at).toLocaleString(dateLocale)} · {t("crm.feedback.aboutEmployee", {name: memberName(response.employee_id)})}</p></div><div className="text-right"><p className="text-2xl font-black">{response.rating}/5</p><span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-black ${statusTone[response.resolution_status] ?? "bg-slate-100"}`}>{t(`crm.resolutionStatuses.${response.resolution_status}`)}</span></div></div>
                      {response.comment ? <p className="mt-4 rounded-xl bg-white/80 p-4 leading-7 text-slate-700">{response.comment}</p> : null}
                      {isLeader ? (
                        <form action={resolveCustomerFeedbackAction} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
                          <input type="hidden" name="returnTo" value="/dashboard/crm?view=feedback" /><input type="hidden" name="responseId" value={response.id} />
                          <select name="resolutionStatus" defaultValue={response.resolution_status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="open">{t("crm.resolutionStatuses.open")}</option><option value="in_progress">{t("crm.resolutionStatuses.in_progress")}</option><option value="resolved">{t("crm.resolutionStatuses.resolved")}</option><option value="not_required">{t("crm.resolutionStatuses.not_required")}</option></select>
                          <select name="assignedTo" defaultValue={response.resolution_assigned_to ?? ""} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
                          <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white" type="submit">{t("crm.feedback.updateResolution")}</button>
                          <textarea name="resolutionNotes" defaultValue={response.resolution_notes ?? ""} placeholder={t("crm.feedback.resolutionNotes")} className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-3" />
                        </form>
                      ) : null}
                    </article>
                  );
                })}
                {!visibleResponses.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("crm.feedback.noResponses")}</p> : null}
              </div>
            </section>
          </div>
        ) : null}

        {view === "tasks" ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
            <form action={createCrmTaskAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <input type="hidden" name="returnTo" value="/dashboard/crm?view=tasks" />
              <h2 className="text-xl font-black">{t("crm.tasks.new")}</h2>
              <div className="mt-5 grid gap-4">
                <label className="text-sm font-bold">{t("crm.fields.client")}<select name="clientId" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">—</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
                <label className="text-sm font-bold">{t("crm.fields.taskTitle")}<input name="title" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="text-sm font-bold">{t("crm.fields.assignedTo")}<select name="assignedTo" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{t("crm.unassigned")}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">{t("crm.fields.dueAt")}<input name="dueAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-bold">{t("crm.fields.priority")}<select name="priority" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{["low","normal","high","urgent"].map((item) => <option key={item} value={item}>{t(`crm.priorities.${item}`)}</option>)}</select></label></div>
                <label className="text-sm font-bold">{t("crm.fields.description")}<textarea name="description" maxLength={5000} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("crm.tasks.create")}</button>
              </div>
            </form>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("crm.tasks.list")}</h2>
              <div className="mt-5 space-y-4">
                {visibleTasks.map((task) => {
                  const client = clientById.get(task.client_id);
                  const isOverdue = task.due_at && !["completed", "cancelled"].includes(task.status) && new Date(task.due_at).getTime() < currentTimestamp;
                  return (
                    <article key={task.id} className={`rounded-2xl border p-5 ${isOverdue ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{task.title}</p><Link className="mt-1 block text-sm font-bold text-indigo-700" href={`/dashboard/crm/${task.client_id}`}>{client?.full_name || t("crm.unknownClient")}</Link></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone[isOverdue ? "overdue" : task.status] ?? "bg-slate-100"}`}>{t(`crm.taskStatuses.${isOverdue ? "overdue" : task.status}`)}</span></div>
                      {task.description ? <p className="mt-3 text-sm leading-6 text-slate-600">{task.description}</p> : null}
                      <p className="mt-4 text-xs font-bold text-slate-500">{t("crm.tasks.assignee", {name: memberName(task.assigned_to)})}{task.due_at ? ` · ${new Date(task.due_at).toLocaleString(dateLocale)}` : ""} · {t(`crm.priorities.${task.priority}`)}</p>
                      {!(["completed", "cancelled"].includes(task.status)) ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {["in_progress", "completed", "cancelled"].map((status) => <form action={updateCrmTaskStatusAction} key={status}><input type="hidden" name="returnTo" value="/dashboard/crm?view=tasks" /><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="status" value={status} /><button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black">{t(`crm.taskActions.${status}`)}</button></form>)}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {!visibleTasks.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{t("crm.tasks.empty")}</p> : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
