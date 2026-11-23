import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  duplicateVipCommunicationAction,
  publishVipCommunicationAction,
  saveVipCommunicationAction,
  updateVipCommunicationDeliveryAction,
  updateVipCommunicationStatusAction,
} from "@/app/actions/vip-communications";
import {CountrySelect} from "@/components/forms/country-select";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings, getVipRecognitionCategories} from "@/lib/vip/settings";
import {APP_VERSION} from "@/lib/app-version";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const CONTENT_ROLES = ["owner", "admin", "executive"];
const OPERATIONS_ROLES = ["owner", "admin", "hr"];
const VIEWS = ["overview", "campaigns", "deliveries"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type VipMember = {
  id: string;
  member_number: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  member_type: string;
  recognition_category: string;
  status: string;
};
type Communication = {
  id: string;
  title: string;
  body: string;
  communication_type: string;
  priority: string;
  status: string;
  audience_scope: string;
  audience_country: string | null;
  audience_category: string | null;
  selected_member_ids: string[];
  channel_plan: string[];
  response_required: boolean;
  publish_at: string | null;
  expires_at: string | null;
  created_by: string;
  published_at: string | null;
  created_at: string;
};
type Delivery = {
  id: string;
  communication_id: string;
  member_id: string;
  channel: string;
  status: string;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  external_reference: string | null;
  delivery_notes: string | null;
  failure_reason: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
};
type Profile = {id: string; full_name: string | null; email: string | null};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Field({label, children, hint}: {label: string; children: ReactNode; hint?: string}) {
  return (
    <label className="block font-bold text-slate-800">
      {label}
      {hint ? <span className="ml-2 text-xs font-medium text-slate-500">{hint}</span> : null}
      {children}
    </label>
  );
}

function Badge({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet" | "rose"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    violet: "bg-violet-100 text-violet-800",
    rose: "bg-rose-100 text-rose-800",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function statusTone(status: string): "slate" | "blue" | "green" | "amber" | "red" | "violet" | "rose" {
  if (["published", "delivered", "read", "acknowledged"].includes(status)) return "green";
  if (["draft", "planned"].includes(status)) return "amber";
  if (["sent"].includes(status)) return "blue";
  if (["archived", "skipped"].includes(status)) return "violet";
  if (["cancelled", "failed"].includes(status)) return "red";
  return "slate";
}

function Metric({label, value, help}: {label: string; value: number | string; help?: string}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-4xl font-black text-slate-950">{value}</p>
      {help ? <p className="mt-2 text-sm text-slate-500">{help}</p> : null}
    </article>
  );
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100";

export default async function VipCommunicationsPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const params = await searchParams;
  const selectedView = first(params.view);
  const view = VIEWS.includes(selectedView) ? selectedView : "overview";
  const editId = first(params.edit);
  const selectedCommunicationId = first(params.communication);
  const success = first(params.success);
  const errorMessage = first(params.error);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  const {data: governanceSettings} = await admin.from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_communications_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_communications_assistant_user_id: string | null}>();
  const hasVipCommunicationsRole = governanceSettings?.vip_manager_user_id === authData.user.id || governanceSettings?.vip_assistant_manager_user_id === authData.user.id || governanceSettings?.vip_communications_assistant_user_id === authData.user.id;
  if (!VIP_ROLES.includes(membership.role) && !hasVipCommunicationsRole) redirect("/dashboard/my-day");

  const schemaCheck = await admin.from("vip_communications").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <MigrationRequired fr={fr} />;
  }

  const [communicationsResult, deliveriesResult, membersResult, profilesResult] = await Promise.all([
    admin.from("vip_communications")
      .select("id,title,body,communication_type,priority,status,audience_scope,audience_country,audience_category,selected_member_ids,channel_plan,response_required,publish_at,expires_at,created_by,published_at,created_at")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(1000),
    admin.from("vip_communication_deliveries")
      .select("id,communication_id,member_id,channel,status,recipient_name,recipient_email,recipient_phone,external_reference,delivery_notes,failure_reason,sent_at,delivered_at,read_at,acknowledged_at,created_at")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(5000),
    admin.from("vip_members")
      .select("id,member_number,full_name,email,phone,country,member_type,recognition_category,status")
      .eq("organization_id", membership.organization_id)
      .order("full_name")
      .limit(5000),
    admin.from("profiles").select("id,full_name,email"),
  ]);
  for (const result of [communicationsResult, deliveriesResult, membersResult, profilesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const [programSettings, recognitionCategories] = await Promise.all([
    getVipProgramSettings(admin, membership.organization_id),
    getVipRecognitionCategories(admin, membership.organization_id, true),
  ]);

  const communications = (communicationsResult.data ?? []) as Communication[];
  const deliveries = (deliveriesResult.data ?? []) as Delivery[];
  const members = (membersResult.data ?? []) as VipMember[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const communicationMap = new Map(communications.map((communication) => [communication.id, communication]));
  const editCommunication = communications.find((communication) => communication.id === editId && communication.status === "draft") ?? null;
  const filteredDeliveries = selectedCommunicationId ? deliveries.filter((delivery) => delivery.communication_id === selectedCommunicationId) : deliveries;
  const published = communications.filter((item) => item.status === "published");
  const planned = deliveries.filter((item) => item.status === "planned");
  const successful = deliveries.filter((item) => ["sent", "delivered", "read", "acknowledged"].includes(item.status));
  const actionable = deliveries.filter((item) => item.status !== "skipped");
  const deliveryRate = actionable.length ? Math.round((successful.length / actionable.length) * 100) : 0;
  const canManageContent = CONTENT_ROLES.includes(membership.role) || hasVipCommunicationsRole;
  const canManageDeliveries = OPERATIONS_ROLES.includes(membership.role) || hasVipCommunicationsRole;
  const personName = (id: string) => profileMap.get(id)?.full_name || profileMap.get(id)?.email || c.unknown;
  const statusLabel = (value: string) => c.statuses[value as keyof typeof c.statuses] ?? value;
  const typeLabel = (value: string) => c.types[value as keyof typeof c.types] ?? value;
  const priorityLabel = (value: string) => c.priorities[value as keyof typeof c.priorities] ?? value;
  const audienceLabel = (value: string) => c.audiences[value as keyof typeof c.audiences] ?? value;
  const channelLabel = (value: string) => c.channels[value as keyof typeof c.channels] ?? value;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">Super Leader VIP · V{APP_VERSION}</p>
              <h1 className="mt-2 text-3xl font-black">{c.title}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{c.subtitle}</p>
            </div>
            <Link href="/dashboard/vip" className="rounded-xl border border-white/20 px-4 py-2.5 text-center text-sm font-black text-white hover:bg-white/10">← {c.back}</Link>
          </div>
        </header>

        <nav className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {["overview", "campaigns", "deliveries"].map((item) => (
            <Link key={item} href={`/dashboard/vip/communications?view=${item}`} className={`rounded-xl px-4 py-2.5 text-sm font-black ${view === item ? "bg-rose-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              {c.views[item as keyof typeof c.views]}
            </Link>
          ))}
        </nav>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-900">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-900">{errorMessage}</p> : null}

        {view === "overview" ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label={c.totalCampaigns} value={communications.length} />
              <Metric label={c.publishedCampaigns} value={published.length} />
              <Metric label={c.plannedDeliveries} value={planned.length} />
              <Metric label={c.deliveryRate} value={`${deliveryRate}%`} help={c.manualTrackingHelp} />
            </section>
            <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.recentCampaigns}</h2>
                <div className="mt-5 space-y-3">
                  {communications.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><p className="font-black">{item.title}</p><p className="mt-1 text-sm text-slate-500">{typeLabel(item.communication_type)} · {audienceLabel(item.audience_scope)}</p></div>
                        <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{item.body}</p>
                      {canManageContent ? <div className="mt-4 flex flex-wrap gap-2">
                        {item.status === "draft" ? <Link href={`/dashboard/vip/communications?view=campaigns&edit=${item.id}`} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black hover:bg-slate-50">✏️ {c.edit}</Link> : null}
                        <form action={duplicateVipCommunicationAction}><input type="hidden" name="communicationId" value={item.id} /><button className="rounded-lg border border-violet-300 px-3 py-2 text-xs font-black text-violet-800">{c.duplicate}</button></form>
                        <Link href="/dashboard/vip/operations" className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">{c.operations}</Link>
                      </div> : null}
                    </div>
                  ))}
                  {communications.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-600">{c.noCampaigns}</p> : null}
                </div>
              </article>
              <article className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
                <h2 className="text-2xl font-black text-rose-950">{c.operatingRule}</h2>
                <p className="mt-3 leading-7 text-rose-900">{c.operatingRuleText}</p>
                <ul className="mt-5 space-y-3 text-sm font-semibold text-rose-950">
                  <li>• {c.ruleOne}</li><li>• {c.ruleTwo}</li><li>• {c.ruleThree}</li>
                </ul>
              </article>
            </section>
          </>
        ) : null}

        {view === "campaigns" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            {canManageContent ? (
              <form action={saveVipCommunicationAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <input type="hidden" name="communicationId" value={editCommunication?.id ?? ""} />
                <h2 className="text-2xl font-black">{editCommunication ? c.editDraft : c.newCampaign}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.campaignFormHelp}</p>
                <div className="mt-5 space-y-4">
                  <Field label={c.titleLabel}><input name="title" required maxLength={220} defaultValue={editCommunication?.title ?? ""} className={inputClass} /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={c.typeLabel}><select name="communicationType" defaultValue={editCommunication?.communication_type ?? "announcement"} className={inputClass}>{Object.entries(c.types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                    <Field label={c.priorityLabel}><select name="priority" defaultValue={editCommunication?.priority ?? "normal"} className={inputClass}>{Object.entries(c.priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  </div>
                  <Field label={c.message}><textarea name="body" required minLength={10} maxLength={12000} rows={8} defaultValue={editCommunication?.body ?? ""} className={inputClass} /></Field>
                  <Field label={c.audience}><select name="audienceScope" defaultValue={editCommunication?.audience_scope ?? "active_members"} className={inputClass}>{Object.entries(c.audiences).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={c.audienceCountry} hint={c.onlyCountry}><CountrySelect name="audienceCountry" locale={fr ? "fr" : "en"} defaultValue={editCommunication?.audience_country ?? ""} className={inputClass} /></Field>
                    <Field label={c.audienceCategory} hint={c.onlyCategory}><select name="audienceCategory" defaultValue={editCommunication?.audience_category ?? ""} className={inputClass}><option value="">{c.select}</option>{recognitionCategories.map((category) => <option key={category.code} value={category.code}>{fr ? category.name_fr : category.name_en}</option>)}</select></Field>
                  </div>
                  <Field label={c.selectedMembers} hint={c.onlySelected}>
                    <select name="selectedMemberIds" multiple size={7} defaultValue={editCommunication?.selected_member_ids ?? []} className={inputClass}>
                      {members.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.member_number}</option>)}
                    </select>
                  </Field>
                  <fieldset className="rounded-2xl border border-slate-200 p-4">
                    <legend className="px-2 font-black">{c.channelsLabel}</legend>
                    <p className="mb-3 text-xs text-slate-500">{c.channelsHelp}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(c.channels).map(([value, label]) => <label key={value} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold"><input type="checkbox" name="channels" value={value} defaultChecked={(editCommunication?.channel_plan ?? programSettings.communication_default_channels).includes(value)} />{label}</label>)}
                    </div>
                  </fieldset>
                  <label className="flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950"><input type="checkbox" name="responseRequired" defaultChecked={editCommunication?.response_required ?? false} />{c.responseRequired}</label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={c.plannedPublication}><input name="publishAt" type="datetime-local" defaultValue={editCommunication?.publish_at?.slice(0, 16) ?? ""} className={inputClass} /></Field>
                    <Field label={c.expiresAt}><input name="expiresAt" type="datetime-local" defaultValue={editCommunication?.expires_at?.slice(0, 16) ?? ""} className={inputClass} /></Field>
                  </div>
                  <button type="submit" className="w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white hover:bg-rose-800">{editCommunication ? c.saveChanges : c.saveDraft}</button>
                </div>
              </form>
            ) : (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{c.readOnly}</h2><p className="mt-3 text-slate-600">{c.readOnlyHelp}</p></article>
            )}

            <div className="space-y-4">
              {communications.map((item) => {
                const itemDeliveries = deliveries.filter((delivery) => delivery.communication_id === item.id);
                return (
                  <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div><div className="flex flex-wrap gap-2"><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge><Badge tone={item.priority === "urgent" ? "red" : item.priority === "important" ? "amber" : "slate"}>{priorityLabel(item.priority)}</Badge></div><h2 className="mt-3 text-xl font-black">{item.title}</h2><p className="mt-1 text-sm text-slate-500">{typeLabel(item.communication_type)} · {audienceLabel(item.audience_scope)} · {item.channel_plan.map(channelLabel).join(", ")}</p></div>
                      <p className="text-xs font-semibold text-slate-500">{new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short"}).format(new Date(item.created_at))}</p>
                    </div>
                    <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700">{item.body}</p>
                    <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-slate-500"><span>{c.createdBy}: {personName(item.created_by)}</span><span>{c.deliveries}: {itemDeliveries.length}</span>{item.response_required ? <span>{c.responseRequiredShort}</span> : null}</div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {item.status === "draft" && canManageContent ? <><Link href={`/dashboard/vip/communications?view=campaigns&edit=${item.id}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black hover:bg-slate-50">{c.edit}</Link><form action={publishVipCommunicationAction}><input type="hidden" name="communicationId" value={item.id} /><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800">{c.publish}</button></form></> : null}
                      {canManageContent ? <form action={duplicateVipCommunicationAction}><input type="hidden" name="communicationId" value={item.id} /><button className="rounded-xl border border-violet-300 px-4 py-2 text-sm font-black text-violet-800">{c.duplicate}</button></form> : null}
                      {itemDeliveries.length > 0 ? <Link href={`/dashboard/vip/communications?view=deliveries&communication=${item.id}`} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{c.trackDeliveries}</Link> : null}
                      {["published", "cancelled"].includes(item.status) && canManageContent ? <form action={updateVipCommunicationStatusAction}><input type="hidden" name="communicationId" value={item.id} /><input type="hidden" name="nextStatus" value="archived" /><button className="rounded-xl border border-violet-300 px-4 py-2 text-sm font-black text-violet-800">{c.archive}</button></form> : null}
                      {item.status === "draft" && canManageContent ? <form action={updateVipCommunicationStatusAction}><input type="hidden" name="communicationId" value={item.id} /><input type="hidden" name="nextStatus" value="cancelled" /><button className="rounded-xl border border-red-300 px-4 py-2 text-sm font-black text-red-800">{c.cancel}</button></form> : null}
                    </div>
                  </article>
                );
              })}
              {communications.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600">{c.noCampaigns}</p> : null}
            </div>
          </section>
        ) : null}

        {view === "deliveries" ? (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-black">{c.deliveryTracking}</h2><p className="mt-2 text-slate-600">{c.deliveryTrackingHelp}</p></div>{selectedCommunicationId ? <Link href="/dashboard/vip/communications?view=deliveries" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">{c.showAll}</Link> : null}</div>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-3">{c.campaign}</th><th className="px-3 py-3">{c.recipient}</th><th className="px-3 py-3">{c.channel}</th><th className="px-3 py-3">{c.status}</th><th className="px-3 py-3">{c.contact}</th><th className="px-3 py-3">{c.action}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDeliveries.map((delivery) => (
                    <tr key={delivery.id} className="align-top">
                      <td className="px-3 py-4 font-bold">{communicationMap.get(delivery.communication_id)?.title ?? c.unknown}</td>
                      <td className="px-3 py-4"><p className="font-bold">{delivery.recipient_name}</p></td>
                      <td className="px-3 py-4">{channelLabel(delivery.channel)}</td>
                      <td className="px-3 py-4"><Badge tone={statusTone(delivery.status)}>{statusLabel(delivery.status)}</Badge>{delivery.failure_reason ? <p className="mt-2 max-w-48 text-xs text-red-700">{delivery.failure_reason}</p> : null}</td>
                      <td className="px-3 py-4 text-xs text-slate-600">{delivery.channel === "email" ? delivery.recipient_email : delivery.channel === "whatsapp" ? delivery.recipient_phone : delivery.external_reference || "—"}</td>
                      <td className="px-3 py-4">
                        {canManageDeliveries ? <form action={updateVipCommunicationDeliveryAction} className="min-w-56 space-y-2"><input type="hidden" name="deliveryId" value={delivery.id} /><select name="nextStatus" defaultValue={delivery.status} className="w-full rounded-lg border border-slate-300 px-3 py-2">{Object.entries(c.statuses).filter(([value]) => ["planned", "sent", "delivered", "read", "acknowledged", "failed", "skipped"].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input name="externalReference" defaultValue={delivery.external_reference ?? ""} placeholder={c.reference} className="w-full rounded-lg border border-slate-300 px-3 py-2" /><input name="deliveryNotes" defaultValue={delivery.delivery_notes ?? ""} placeholder={c.notes} className="w-full rounded-lg border border-slate-300 px-3 py-2" /><input name="failureReason" defaultValue={delivery.failure_reason ?? ""} placeholder={c.failureReason} className="w-full rounded-lg border border-slate-300 px-3 py-2" /><button className="w-full rounded-lg bg-slate-950 px-3 py-2 font-black text-white">{c.update}</button></form> : <span className="text-xs text-slate-500">{c.readOnly}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredDeliveries.length === 0 ? <p className="py-10 text-center text-slate-500">{c.noDeliveries}</p> : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function MigrationRequired({fr}: {fr: boolean}) {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-5xl"><header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl"><p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION}</p><h1 className="mt-2 text-4xl font-black">Super Leader VIP</h1></header><section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7"><h2 className="text-2xl font-black text-amber-950">{fr ? "Migration Communications requise" : "Communications migration required"}</h2><p className="mt-3 leading-7 text-amber-900">{fr ? "Exécute la migration suivante dans Supabase avant d’ouvrir cette rubrique." : "Run the following migration in Supabase before opening this module."}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/047_super_leader_vip_communications_reports_v3_2_7.sql</code></section></div></main>
  );
}

const copy = {
  fr: {
    title: "Communications VIP", subtitle: "Prépare les messages, cible les membres concernés et conserve une preuve de chaque diffusion.", back: "Retour au VIP",
    views: {overview: "Vue d’ensemble", campaigns: "Campagnes", deliveries: "Suivi des envois"}, totalCampaigns: "Campagnes", publishedCampaigns: "Publiées", plannedDeliveries: "Envois à traiter", deliveryRate: "Taux suivi", manualTrackingHelp: "Calculé sur les statuts enregistrés", recentCampaigns: "Communications récentes", noCampaigns: "Aucune communication VIP n’a encore été créée.", operatingRule: "Règle de fonctionnement", operatingRuleText: "Super Leader prépare l’audience et le suivi. Les envois e-mail et WhatsApp restent manuels tant que leurs intégrations de production ne sont pas activées.", ruleOne: "Aucun secret ou jeton n’est exposé dans le navigateur.", ruleTwo: "Les destinataires sans e-mail ou téléphone sont marqués comme ignorés.", ruleThree: "Chaque statut d’envoi est conservé dans l’audit.",
    editDraft: "Modifier le brouillon", newCampaign: "Nouvelle communication", campaignFormHelp: "Enregistre le contenu et l’audience, puis publie lorsque tout est prêt.", titleLabel: "Titre", typeLabel: "Type", priorityLabel: "Priorité", message: "Message", audience: "Audience", audienceCountry: "Pays ciblé", onlyCountry: "Seulement si l’audience est par pays", audienceCategory: "Catégorie ciblée", onlyCategory: "Seulement si l’audience est par catégorie", selectedMembers: "Membres sélectionnés", onlySelected: "Ctrl/Cmd pour plusieurs choix", select: "Sélectionner", channelsLabel: "Canaux prévus", channelsHelp: "Ces canaux servent au plan et au suivi. Ils ne déclenchent pas encore un envoi automatique.", responseRequired: "Une confirmation ou réponse du membre est attendue", plannedPublication: "Date prévue (indicative)", expiresAt: "Expiration", saveChanges: "Enregistrer les modifications", saveDraft: "Enregistrer le brouillon", readOnly: "Consultation seulement", readOnlyHelp: "La création et la publication sont réservées au Propriétaire, aux Administrateurs et aux Exécutifs.", createdBy: "Créé par", deliveries: "envoi(s)", responseRequiredShort: "Réponse attendue", edit: "Modifier", duplicate: "Dupliquer", operations: "Centre opérationnel", publish: "Publier", trackDeliveries: "Suivre les envois", archive: "Archiver", cancel: "Annuler", deliveryTracking: "Suivi des diffusions", deliveryTrackingHelp: "Mets à jour les statuts à partir des preuves reçues des équipes ou des partenaires.", showAll: "Afficher tout", campaign: "Communication", recipient: "Destinataire", channel: "Canal", status: "Statut", contact: "Contact / référence", action: "Mise à jour", reference: "Référence externe", notes: "Notes", failureReason: "Motif d’échec", update: "Mettre à jour", noDeliveries: "Aucun envoi à afficher.", unknown: "Inconnu",
    types: {announcement: "Annonce", invitation: "Invitation", alert: "Alerte", newsletter: "Bulletin", recognition: "Reconnaissance", operational_update: "Mise à jour opérationnelle", other: "Autre"}, priorities: {normal: "Normale", important: "Importante", urgent: "Urgente"}, audiences: {all_members: "Tous les membres", active_members: "Membres actifs", internal_only: "Membres internes", external_only: "Membres externes", honorary_only: "Membres honoraires", country: "Un pays", category: "Une catégorie", selected_members: "Membres sélectionnés"}, channels: {manual: "Suivi manuel", email: "E-mail", whatsapp: "WhatsApp", in_person: "Remise en personne"}, categories: {distinguished_contributor: "Contributeur distinctif", strategic_partner: "Partenaire stratégique", honorary_member: "Membre honoraire", ambassador: "Ambassadeur", benefactor: "Bienfaiteur", other: "Autre"}, statuses: {draft: "Brouillon", published: "Publiée", archived: "Archivée", cancelled: "Annulée", planned: "Planifié", sent: "Envoyé", delivered: "Livré", read: "Lu", acknowledged: "Confirmé", failed: "Échec", skipped: "Ignoré"},
  },
  en: {
    title: "VIP communications", subtitle: "Prepare messages, target the right members and retain evidence of every delivery.", back: "Back to VIP",
    views: {overview: "Overview", campaigns: "Campaigns", deliveries: "Delivery tracking"}, totalCampaigns: "Campaigns", publishedCampaigns: "Published", plannedDeliveries: "Deliveries to process", deliveryRate: "Tracked rate", manualTrackingHelp: "Based on recorded statuses", recentCampaigns: "Recent communications", noCampaigns: "No VIP communication has been created yet.", operatingRule: "Operating rule", operatingRuleText: "Super Leader prepares the audience and tracking. Email and WhatsApp delivery remain manual until their production integrations are enabled.", ruleOne: "No secret or token is exposed in the browser.", ruleTwo: "Recipients without email or phone are marked as skipped.", ruleThree: "Every delivery status is retained in the audit log.",
    editDraft: "Edit draft", newCampaign: "New communication", campaignFormHelp: "Save the content and audience, then publish when everything is ready.", titleLabel: "Title", typeLabel: "Type", priorityLabel: "Priority", message: "Message", audience: "Audience", audienceCountry: "Target country", onlyCountry: "Only for country audiences", audienceCategory: "Target category", onlyCategory: "Only for category audiences", selectedMembers: "Selected members", onlySelected: "Ctrl/Cmd for multiple choices", select: "Select", channelsLabel: "Planned channels", channelsHelp: "These channels are used for planning and tracking. They do not trigger automatic delivery yet.", responseRequired: "A confirmation or response is expected from the member", plannedPublication: "Planned date (informational)", expiresAt: "Expiry", saveChanges: "Save changes", saveDraft: "Save draft", readOnly: "Read only", readOnlyHelp: "Creation and publication are reserved for the Owner, Administrators and Executives.", createdBy: "Created by", deliveries: "delivery item(s)", responseRequiredShort: "Response expected", edit: "Edit", duplicate: "Duplicate", operations: "Operations center", publish: "Publish", trackDeliveries: "Track deliveries", archive: "Archive", cancel: "Cancel", deliveryTracking: "Delivery tracking", deliveryTrackingHelp: "Update statuses using evidence received from teams or partners.", showAll: "Show all", campaign: "Communication", recipient: "Recipient", channel: "Channel", status: "Status", contact: "Contact / reference", action: "Update", reference: "External reference", notes: "Notes", failureReason: "Failure reason", update: "Update", noDeliveries: "No deliveries to display.", unknown: "Unknown",
    types: {announcement: "Announcement", invitation: "Invitation", alert: "Alert", newsletter: "Newsletter", recognition: "Recognition", operational_update: "Operational update", other: "Other"}, priorities: {normal: "Normal", important: "Important", urgent: "Urgent"}, audiences: {all_members: "All members", active_members: "Active members", internal_only: "Internal members", external_only: "External members", honorary_only: "Honorary members", country: "One country", category: "One category", selected_members: "Selected members"}, channels: {manual: "Manual tracking", email: "Email", whatsapp: "WhatsApp", in_person: "In-person delivery"}, categories: {distinguished_contributor: "Distinguished contributor", strategic_partner: "Strategic partner", honorary_member: "Honorary member", ambassador: "Ambassador", benefactor: "Benefactor", other: "Other"}, statuses: {draft: "Draft", published: "Published", archived: "Archived", cancelled: "Cancelled", planned: "Planned", sent: "Sent", delivered: "Delivered", read: "Read", acknowledged: "Acknowledged", failed: "Failed", skipped: "Skipped"},
  },
} as const;
