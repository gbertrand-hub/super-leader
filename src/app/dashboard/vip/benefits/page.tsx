import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createVipBenefitRedemptionAction,
  duplicateVipBenefitAction,
  saveVipBenefitAction,
  saveVipPartnerAction,
  setVipBenefitStatusAction,
  updateVipBenefitRedemptionAction,
} from "@/app/actions/vip-benefits";
import {CountrySelect} from "@/components/forms/country-select";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings} from "@/lib/vip/settings";
import {APP_VERSION} from "@/lib/app-version";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const VIP_SETTINGS_ROLES = ["owner", "admin"];
const VIP_BENEFIT_ROLES = ["owner", "admin", "executive"];
const VIP_OPERATIONS_ROLES = ["owner", "admin", "hr"];
const VIP_DECISION_ROLES = ["owner", "admin", "executive"];
const VIEWS = ["overview", "benefits", "partners", "redemptions"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Partner = {
  id: string;
  name: string;
  partner_type: string;
  country: string;
  city: string | null;
  website_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  agreement_start: string | null;
  agreement_end: string | null;
  status: string;
  notes: string | null;
};
type Benefit = {
  id: string;
  partner_id: string | null;
  title: string;
  description: string;
  benefit_type: string;
  value_label: string | null;
  country: string | null;
  city: string | null;
  eligibility_scope: string;
  eligible_categories: string[];
  redemption_instructions: string;
  terms_and_conditions: string | null;
  valid_from: string | null;
  valid_until: string | null;
  status: string;
  requires_approval: boolean;
  usage_limit_per_member: number | null;
  total_usage_limit: number | null;
  guest_allowed: boolean;
  transferable: boolean;
  seed_code: string | null;
};
type VipMember = {
  id: string;
  member_number: string;
  full_name: string;
  member_type: string;
  recognition_category: string;
  status: string;
  country: string | null;
};
type Redemption = {
  id: string;
  benefit_id: string;
  member_id: string;
  reference_number: string;
  status: string;
  request_notes: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  redeemed_at: string | null;
  partner_reference: string | null;
  value_realized: number | null;
  decision_notes: string | null;
};
type Profile = {id: string; full_name: string | null; email: string | null};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Field({label, children, hint}: {label: string; children: ReactNode; hint?: string}) {
  return (
    <label className="mt-4 block font-bold text-slate-800">
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

function tone(status: string): "slate" | "blue" | "green" | "amber" | "red" | "violet" | "rose" {
  if (["active", "approved", "redeemed"].includes(status)) return "green";
  if (["requested", "draft"].includes(status)) return "amber";
  if (["suspended", "cancelled"].includes(status)) return "violet";
  if (["expired", "archived", "rejected"].includes(status)) return "red";
  return "slate";
}

function Metric({label, value, help}: {label: string; value: number; help?: string}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-4xl font-black text-slate-950">{value}</p>
      {help ? <p className="mt-2 text-sm text-slate-500">{help}</p> : null}
    </article>
  );
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100";

export default async function VipBenefitsPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const params = await searchParams;
  const selectedView = first(params.view);
  const view = VIEWS.includes(selectedView) ? selectedView : "overview";
  const success = first(params.success);
  const errorMessage = first(params.error);

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

  const {data: managerSettings} = await admin
    .from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_benefits_partners_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_benefits_partners_assistant_user_id: string | null}>();
  const isVipManager = managerSettings?.vip_manager_user_id === authData.user.id;
  const isVipAssistantManager = managerSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipBenefitsPartnersAssistant = managerSettings?.vip_benefits_partners_assistant_user_id === authData.user.id;
  const hasVipOperationalRole = isVipManager || isVipAssistantManager || isVipBenefitsPartnersAssistant;
  if (!VIP_ROLES.includes(membership.role) && !hasVipOperationalRole) redirect("/dashboard/my-day");

  const schemaCheck = await admin.from("vip_benefits").select("id,guest_allowed,transferable,seed_code", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <MigrationRequired fr={fr} />;
  }

  const [partnersResult, benefitsResult, membersResult, redemptionsResult, profilesResult] = await Promise.all([
    admin
      .from("vip_partners")
      .select("id,name,partner_type,country,city,website_url,contact_name,contact_email,contact_phone,agreement_start,agreement_end,status,notes")
      .eq("organization_id", membership.organization_id)
      .order("name")
      .limit(1000),
    admin
      .from("vip_benefits")
      .select("id,partner_id,title,description,benefit_type,value_label,country,city,eligibility_scope,eligible_categories,redemption_instructions,terms_and_conditions,valid_from,valid_until,status,requires_approval,usage_limit_per_member,total_usage_limit,guest_allowed,transferable,seed_code")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(1000),
    admin
      .from("vip_members")
      .select("id,member_number,full_name,member_type,recognition_category,status,country")
      .eq("organization_id", membership.organization_id)
      .order("full_name")
      .limit(1000),
    admin
      .from("vip_benefit_redemptions")
      .select("id,benefit_id,member_id,reference_number,status,request_notes,requested_by,requested_at,approved_by,approved_at,redeemed_at,partner_reference,value_realized,decision_notes")
      .eq("organization_id", membership.organization_id)
      .order("requested_at", {ascending: false})
      .limit(2000),
    admin.from("profiles").select("id,full_name,email"),
  ]);

  for (const result of [partnersResult, benefitsResult, membersResult, redemptionsResult, profilesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const programSettings = await getVipProgramSettings(admin, membership.organization_id);

  const partners = (partnersResult.data ?? []) as Partner[];
  const benefits = (benefitsResult.data ?? []) as Benefit[];
  const members = (membersResult.data ?? []) as VipMember[];
  const redemptions = (redemptionsResult.data ?? []) as Redemption[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const partnerMap = new Map(partners.map((partner) => [partner.id, partner]));
  const benefitMap = new Map(benefits.map((benefit) => [benefit.id, benefit]));
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const today = new Date().toISOString().slice(0, 10);
  const activePartners = partners.filter((partner) => partner.status === "active" && (!partner.agreement_end || partner.agreement_end >= today));
  const activeBenefits = benefits.filter((benefit) => benefit.status === "active" && (!benefit.valid_from || benefit.valid_from <= today) && (!benefit.valid_until || benefit.valid_until >= today));
  const pendingRedemptions = redemptions.filter((redemption) => redemption.status === "requested");
  const redeemed = redemptions.filter((redemption) => redemption.status === "redeemed");
  const representedCountries = new Set(activePartners.map((partner) => partner.country)).size;
  const canManagePartners = VIP_SETTINGS_ROLES.includes(membership.role) || hasVipOperationalRole;
  const canManageBenefits = VIP_BENEFIT_ROLES.includes(membership.role) || hasVipOperationalRole;
  const canCreateRedemptions = VIP_OPERATIONS_ROLES.includes(membership.role) || hasVipOperationalRole;
  const canDecide = VIP_DECISION_ROLES.includes(membership.role) || hasVipOperationalRole;
  const vipManagerName = managerSettings?.vip_manager_user_id ? (profileMap.get(managerSettings.vip_manager_user_id)?.full_name || profileMap.get(managerSettings.vip_manager_user_id)?.email || c.unknown) : c.notAssigned;
  const vipAssistantManagerName = managerSettings?.vip_assistant_manager_user_id ? (profileMap.get(managerSettings.vip_assistant_manager_user_id)?.full_name || profileMap.get(managerSettings.vip_assistant_manager_user_id)?.email || c.unknown) : c.notAssigned;
  const personName = (id: string | null) => id ? (profileMap.get(id)?.full_name || profileMap.get(id)?.email || c.unknown) : c.unknown;
  const statusLabel = (status: string) => c.statuses[status as keyof typeof c.statuses] ?? status;
  const partnerTypeLabel = (value: string) => c.partnerTypes[value as keyof typeof c.partnerTypes] ?? value;
  const benefitTypeLabel = (value: string) => c.benefitTypes[value as keyof typeof c.benefitTypes] ?? value;
  const eligibilityLabel = (value: string) => c.eligibilityScopes[value as keyof typeof c.eligibilityScopes] ?? value;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 p-7 text-white shadow-2xl sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">Super Leader VIP · V{APP_VERSION}</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight">{c.title}</h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-300">{c.subtitle}</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold text-rose-200"><p>{c.vipManager}: {vipManagerName}{isVipManager ? ` · ${c.youAreManager}` : ""}</p><p>{c.vipAssistantManager}: {vipAssistantManagerName}{isVipAssistantManager ? ` · ${c.youAreAssistantManager}` : ""}</p></div>
            </div>
            <Link href="/dashboard/vip" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950">{c.backToVip}</Link>
          </div>
        </header>

        <nav className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {VIEWS.map((item) => (
            <Link key={item} href={`/dashboard/vip/benefits?view=${item}`} className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${view === item ? "bg-rose-700 text-white" : "text-slate-600 hover:bg-rose-50 hover:text-rose-800"}`}>
              {c.views[item as keyof typeof c.views]}
            </Link>
          ))}
        </nav>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label={c.activePartners} value={activePartners.length} />
          <Metric label={c.activeBenefits} value={activeBenefits.length} />
          <Metric label={c.pendingRequests} value={pendingRedemptions.length} />
          <Metric label={c.benefitsUsed} value={redeemed.length} />
          <Metric label={c.countriesCovered} value={representedCountries} />
        </section>

        {view === "overview" ? (
          <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-2xl font-black">{c.availableBenefits}</h2><p className="mt-1 text-sm text-slate-600">{c.availableBenefitsHelp}</p></div>
                <Link href="/dashboard/vip/benefits?view=benefits" className="rounded-xl bg-rose-50 px-4 py-2 text-sm font-black text-rose-800">{c.manage}</Link>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {activeBenefits.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600 md:col-span-2">{c.noActiveBenefits}</p> : activeBenefits.slice(0, 8).map((benefit) => {
                  const partner = benefit.partner_id ? partnerMap.get(benefit.partner_id) : null;
                  return (
                    <div key={benefit.id} className="rounded-2xl border border-rose-100 bg-gradient-to-br from-white to-rose-50 p-5">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-rose-700">{benefitTypeLabel(benefit.benefit_type)}</p><h3 className="mt-1 text-lg font-black">{benefit.title}</h3></div><Badge tone="green">{benefit.value_label || c.vipBenefit}</Badge></div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{benefit.description}</p>
                      <p className="mt-3 text-xs font-bold text-slate-500">{partner?.name || c.internalBenefit} · {benefit.country || c.allCountries}</p>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.pendingRequests}</h2>
              <p className="mt-1 text-sm text-slate-600">{c.pendingRequestsHelp}</p>
              <div className="mt-5 space-y-3">
                {pendingRedemptions.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noPendingRequests}</p> : pendingRedemptions.slice(0, 8).map((redemption) => (
                  <Link key={redemption.id} href="/dashboard/vip/benefits?view=redemptions" className="block rounded-2xl border border-slate-200 p-4 transition hover:border-rose-300 hover:bg-rose-50">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-black">{memberMap.get(redemption.member_id)?.full_name || c.unknown}</p><p className="mt-1 text-sm text-slate-600">{benefitMap.get(redemption.benefit_id)?.title || c.unknown}</p></div><Badge tone="amber">{statusLabel(redemption.status)}</Badge></div>
                    <p className="mt-2 text-xs font-bold text-rose-700">{redemption.reference_number}</p>
                  </Link>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {view === "partners" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            {canManagePartners ? (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.addPartner}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.addPartnerHelp}</p>
                <PartnerForm c={c} fr={fr} />
              </article>
            ) : null}
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{c.partnerDirectory}</h2><p className="mt-1 text-sm text-slate-600">{c.partnerDirectoryHelp}</p></div><Badge tone="rose">{partners.length}</Badge></div>
              <div className="mt-5 space-y-4">
                {partners.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noPartners}</p> : partners.map((partner) => (
                  <details key={partner.id} className="rounded-2xl border border-slate-200 p-5">
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{partner.name}</h3><p className="mt-1 text-sm font-bold text-rose-700">{partnerTypeLabel(partner.partner_type)} · {partner.city ? `${partner.city}, ` : ""}{partner.country}</p></div><Badge tone={tone(partner.status)}>{statusLabel(partner.status)}</Badge></div>
                      <p className="mt-2 text-sm text-slate-500">{partner.contact_name || c.noContact} {partner.contact_email ? `· ${partner.contact_email}` : ""}</p>
                    </summary>
                    {canManagePartners ? <div className="mt-5 border-t border-slate-200 pt-4"><PartnerForm c={c} fr={fr} partner={partner} /></div> : null}
                  </details>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {view === "benefits" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            {canManageBenefits ? (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.createBenefit}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.createBenefitHelp}</p>
                <BenefitForm c={c} fr={fr} partners={partners} programSettings={programSettings} />
              </article>
            ) : null}
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{c.benefitCatalogue}</h2><p className="mt-1 text-sm text-slate-600">{c.benefitCatalogueHelp}</p></div><Badge tone="rose">{benefits.length}</Badge></div>
              <div className="mt-5 space-y-4">
                {benefits.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noBenefits}</p> : benefits.map((benefit) => {
                  const partner = benefit.partner_id ? partnerMap.get(benefit.partner_id) : null;
                  return (
                    <details id={`benefit-${benefit.id}`} key={benefit.id} className="scroll-mt-6 rounded-2xl border border-slate-200 p-5">
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-rose-700">{benefitTypeLabel(benefit.benefit_type)}</p><h3 className="mt-1 text-lg font-black">{benefit.title}</h3><p className="mt-1 text-sm text-slate-500">{partner?.name || c.internalBenefit} · {benefit.country || c.allCountries}</p></div><div className="flex flex-wrap gap-2"><Badge tone={tone(benefit.status)}>{statusLabel(benefit.status)}</Badge>{benefit.value_label ? <Badge tone="rose">{benefit.value_label}</Badge> : null}{benefit.guest_allowed ? <Badge tone="violet">{c.guestAllowed}</Badge> : null}</div></div>
                        <p className="mt-3 text-sm leading-6 text-slate-600">{benefit.description}</p>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-bold text-slate-500">{eligibilityLabel(benefit.eligibility_scope)} · {benefit.requires_approval ? c.approvalRequired : c.autoApproval} · {benefit.transferable ? c.transferable : c.nonTransferable}</p>{canManageBenefits ? <span className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-black text-rose-800">✏️ {c.edit}</span> : null}</div>
                      </summary>
                      {canManageBenefits ? <div className="mt-5 border-t border-slate-200 pt-4">
                        <div className="flex flex-wrap gap-2">
                          <form action={duplicateVipBenefitAction}><input type="hidden" name="benefitId" value={benefit.id} /><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black">{c.duplicate}</button></form>
                          {benefit.status !== "active" ? <form action={setVipBenefitStatusAction}><input type="hidden" name="benefitId" value={benefit.id} /><input type="hidden" name="status" value="active" /><button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white">{c.activate}</button></form> : <form action={setVipBenefitStatusAction}><input type="hidden" name="benefitId" value={benefit.id} /><input type="hidden" name="status" value="suspended" /><button className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-black text-amber-900">{c.suspend}</button></form>}
                          {benefit.status !== "archived" ? <form action={setVipBenefitStatusAction}><input type="hidden" name="benefitId" value={benefit.id} /><input type="hidden" name="status" value="archived" /><button className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">{c.archive}</button></form> : null}
                        </div>
                        <BenefitForm c={c} fr={fr} partners={partners} benefit={benefit} programSettings={programSettings} />
                      </div> : null}
                    </details>
                  );
                })}
              </div>
            </article>
          </section>
        ) : null}

        {view === "redemptions" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            {canCreateRedemptions ? (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.recordRequest}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.recordRequestHelp}</p>
                <form action={createVipBenefitRedemptionAction} className="mt-4">
                  <Field label={c.member}><select name="memberId" required defaultValue="" className={inputClass}><option value="">{c.selectMember}</option>{members.filter((member) => ["active", "honorary", "pending_renewal"].includes(member.status)).map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.member_number}</option>)}</select></Field>
                  <Field label={c.benefit}><select name="benefitId" required defaultValue="" className={inputClass}><option value="">{c.selectBenefit}</option>{activeBenefits.map((benefit) => <option key={benefit.id} value={benefit.id}>{benefit.title}{benefit.value_label ? ` · ${benefit.value_label}` : ""}</option>)}</select></Field>
                  <Field label={c.requestNotes}><textarea name="requestNotes" rows={4} maxLength={3000} className={inputClass} /></Field>
                  <button type="submit" className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{c.submitRequest}</button>
                </form>
              </article>
            ) : null}
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{c.usageHistory}</h2><p className="mt-1 text-sm text-slate-600">{c.usageHistoryHelp}</p></div><Badge tone="rose">{redemptions.length}</Badge></div>
              <div className="mt-5 space-y-4">
                {redemptions.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noRedemptions}</p> : redemptions.map((redemption) => {
                  const member = memberMap.get(redemption.member_id);
                  const benefit = benefitMap.get(redemption.benefit_id);
                  const partner = benefit?.partner_id ? partnerMap.get(benefit.partner_id) : null;
                  const canUpdate = (redemption.status === "requested" && canDecide) || redemption.status === "approved";
                  return (
                    <div key={redemption.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-rose-700">{redemption.reference_number}</p><h3 className="mt-1 text-lg font-black">{member?.full_name || c.unknown}</h3><p className="mt-1 text-sm text-slate-600">{benefit?.title || c.unknown} · {partner?.name || c.internalBenefit}</p></div><Badge tone={tone(redemption.status)}>{statusLabel(redemption.status)}</Badge></div>
                      <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <p><strong>{c.requestedBy}:</strong> {personName(redemption.requested_by)}</p>
                        <p><strong>{c.requestedOn}:</strong> {new Date(redemption.requested_at).toLocaleDateString(dateLocale)}</p>
                        {redemption.partner_reference ? <p><strong>{c.partnerReference}:</strong> {redemption.partner_reference}</p> : null}
                        {redemption.value_realized !== null ? <p><strong>{c.valueRealized}:</strong> {redemption.value_realized.toLocaleString(dateLocale)}</p> : null}
                      </div>
                      {redemption.request_notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{redemption.request_notes}</p> : null}
                      {redemption.decision_notes ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>{c.decisionNotes}:</strong> {redemption.decision_notes}</p> : null}
                      {canUpdate ? (
                        <form action={updateVipBenefitRedemptionAction} className="mt-4 rounded-xl border border-rose-100 bg-rose-50/60 p-4">
                          <input type="hidden" name="redemptionId" value={redemption.id} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label={c.nextStatus}><select name="nextStatus" required defaultValue="" className={inputClass}><option value="">{c.selectStatus}</option>{redemption.status === "requested" && canDecide ? <><option value="approved">{statusLabel("approved")}</option><option value="rejected">{statusLabel("rejected")}</option></> : null}{redemption.status === "requested" ? <option value="cancelled">{statusLabel("cancelled")}</option> : null}{redemption.status === "approved" ? <><option value="redeemed">{statusLabel("redeemed")}</option><option value="cancelled">{statusLabel("cancelled")}</option></> : null}</select></Field>
                            <Field label={c.partnerReference}><input name="partnerReference" maxLength={220} defaultValue={redemption.partner_reference ?? ""} className={inputClass} /></Field>
                            <Field label={c.valueRealized}><input name="valueRealized" type="number" min="0" step="0.01" defaultValue={redemption.value_realized ?? ""} className={inputClass} /></Field>
                            <Field label={c.decisionNotes}><textarea name="decisionNotes" rows={3} maxLength={4000} defaultValue={redemption.decision_notes ?? ""} className={inputClass} /></Field>
                          </div>
                          <button type="submit" className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{c.updateRequest}</button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        ) : null}
      </div>
    </main>
  );
}

type BenefitsCopy = typeof copy.fr | typeof copy.en;

function PartnerForm({c, fr, partner}: {c: BenefitsCopy; fr: boolean; partner?: Partner}) {
  return (
    <form action={saveVipPartnerAction} className="mt-4">
      {partner ? <input type="hidden" name="partnerId" value={partner.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={c.partnerName}><input name="name" required minLength={2} maxLength={220} defaultValue={partner?.name ?? ""} className={inputClass} /></Field>
        <Field label={c.partnerType}><select name="partnerType" required defaultValue={partner?.partner_type ?? ""} className={inputClass}><option value="">{c.selectType}</option>{Object.entries(c.partnerTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} required defaultValue={partner?.country} className={inputClass} /></Field>
        <Field label={c.city}><input name="city" maxLength={120} defaultValue={partner?.city ?? ""} className={inputClass} /></Field>
        <Field label={c.website}><input name="websiteUrl" type="url" maxLength={500} placeholder="https://" defaultValue={partner?.website_url ?? ""} className={inputClass} /></Field>
        <Field label={c.status}><select name="status" required defaultValue={partner?.status ?? "active"} className={inputClass}>{["active", "suspended", "expired", "archived"].map((value) => <option key={value} value={value}>{c.statuses[value as keyof typeof c.statuses]}</option>)}</select></Field>
        <Field label={c.contactName}><input name="contactName" maxLength={220} defaultValue={partner?.contact_name ?? ""} className={inputClass} /></Field>
        <Field label={c.contactEmail}><input name="contactEmail" type="email" maxLength={320} defaultValue={partner?.contact_email ?? ""} className={inputClass} /></Field>
        <Field label={c.contactPhone}><input name="contactPhone" maxLength={80} defaultValue={partner?.contact_phone ?? ""} className={inputClass} /></Field>
        <Field label={c.agreementStart}><input name="agreementStart" type="date" defaultValue={partner?.agreement_start ?? ""} className={inputClass} /></Field>
        <Field label={c.agreementEnd}><input name="agreementEnd" type="date" defaultValue={partner?.agreement_end ?? ""} className={inputClass} /></Field>
      </div>
      <Field label={c.notes}><textarea name="notes" rows={4} maxLength={4000} defaultValue={partner?.notes ?? ""} className={inputClass} /></Field>
      <button type="submit" className="mt-5 rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{partner ? c.savePartner : c.addPartnerButton}</button>
    </form>
  );
}

function BenefitForm({c, fr, partners, benefit, programSettings}: {c: BenefitsCopy; fr: boolean; partners: Partner[]; benefit?: Benefit; programSettings: {benefit_default_approval_mode: "manual" | "automatic"}}) {
  return (
    <form action={saveVipBenefitAction} className="mt-4">
      {benefit ? <input type="hidden" name="benefitId" value={benefit.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={c.benefitTitle}><input name="title" required minLength={3} maxLength={220} defaultValue={benefit?.title ?? ""} className={inputClass} /></Field>
        <Field label={c.partner}><select name="partnerId" defaultValue={benefit?.partner_id ?? ""} className={inputClass}><option value="">{c.internalBenefit}</option>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} · {partner.country}</option>)}</select></Field>
        <Field label={c.benefitType}><select name="benefitType" required defaultValue={benefit?.benefit_type ?? ""} className={inputClass}><option value="">{c.selectType}</option>{Object.entries(c.benefitTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label={c.valueLabel}><input name="valueLabel" maxLength={180} placeholder={c.valueExample} defaultValue={benefit?.value_label ?? ""} className={inputClass} /></Field>
        <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} defaultValue={benefit?.country} emptyLabel={c.allCountries} className={inputClass} /></Field>
        <Field label={c.city}><input name="city" maxLength={120} defaultValue={benefit?.city ?? ""} className={inputClass} /></Field>
        <Field label={c.eligibility}><select name="eligibilityScope" required defaultValue={benefit?.eligibility_scope ?? "active_members"} className={inputClass}>{Object.entries(c.eligibilityScopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label={c.status}><select name="status" required defaultValue={benefit?.status ?? "draft"} className={inputClass}>{["draft", "active", "suspended", "expired", "archived"].map((value) => <option key={value} value={value}>{c.statuses[value as keyof typeof c.statuses]}</option>)}</select></Field>
        <Field label={c.validFrom}><input name="validFrom" type="date" defaultValue={benefit?.valid_from ?? ""} className={inputClass} /></Field>
        <Field label={c.validUntil}><input name="validUntil" type="date" defaultValue={benefit?.valid_until ?? ""} className={inputClass} /></Field>
        <Field label={c.limitPerMember}><input name="usageLimitPerMember" type="number" min="1" defaultValue={benefit?.usage_limit_per_member ?? ""} className={inputClass} /></Field>
        <Field label={c.totalLimit}><input name="totalUsageLimit" type="number" min="1" defaultValue={benefit?.total_usage_limit ?? ""} className={inputClass} /></Field>
      </div>
      <Field label={c.eligibleCategories} hint={c.categoriesHint}><textarea name="eligibleCategories" rows={2} maxLength={3000} defaultValue={benefit?.eligible_categories.join(", ") ?? ""} className={inputClass} /></Field>
      <Field label={c.description}><textarea name="description" required minLength={5} rows={4} maxLength={5000} defaultValue={benefit?.description ?? ""} className={inputClass} /></Field>
      <Field label={c.redemptionInstructions}><textarea name="redemptionInstructions" required minLength={3} rows={4} maxLength={5000} defaultValue={benefit?.redemption_instructions ?? ""} className={inputClass} /></Field>
      <Field label={c.terms}><textarea name="termsAndConditions" rows={4} maxLength={8000} defaultValue={benefit?.terms_and_conditions ?? ""} className={inputClass} /></Field>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-950"><input type="checkbox" name="requiresApproval" value="yes" defaultChecked={benefit?.requires_approval ?? (programSettings.benefit_default_approval_mode === "manual")} />{c.requiresApproval}</label>
        <label className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 font-bold text-violet-950"><input type="checkbox" name="guestAllowed" defaultChecked={benefit?.guest_allowed ?? false} />{c.guestAllowed}</label>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 font-bold text-slate-950"><input type="checkbox" name="transferable" defaultChecked={benefit?.transferable ?? false} />{c.transferable}</label>
      </div>
      <button type="submit" className="mt-5 rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{benefit ? c.saveBenefit : c.createBenefitButton}</button>
    </form>
  );
}

function MigrationRequired({fr}: {fr: boolean}) {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl"><p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION}</p><h1 className="mt-2 text-4xl font-black">Super Leader VIP</h1></header>
        <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7"><h2 className="text-2xl font-black text-amber-950">{fr ? "Migration requise" : "Migration required"}</h2><p className="mt-3 leading-7 text-amber-900">{fr ? "Exécute la migration suivante dans Supabase Cloud avant d’ouvrir les avantages VIP." : "Run the following migration in Supabase Cloud before opening VIP benefits."}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/109_vip_benefits_catalog_manager_v4_8_71.sql</code></section>
      </div>
    </main>
  );
}

const copy = {
  fr: {
    title: "Avantages & partenaires VIP",
    subtitle: "Structure les privilèges du Cercle rapproché d’iLEAD Global, les partenaires par pays et le suivi sécurisé de chaque utilisation.",
    backToVip: "Retour à Super Leader VIP",
    views: {overview: "Vue d’ensemble", benefits: "Avantages", partners: "Partenaires", redemptions: "Utilisations"},
    activePartners: "Partenaires actifs", activeBenefits: "Avantages actifs", pendingRequests: "Demandes en attente", benefitsUsed: "Avantages utilisés", countriesCovered: "Pays couverts",
    availableBenefits: "Avantages actuellement disponibles", availableBenefitsHelp: "Catalogue actif pour les membres admissibles.", manage: "Gérer", noActiveBenefits: "Aucun avantage actif pour le moment.",
    pendingRequestsHelp: "Demandes qui nécessitent une décision du comité VIP.", noPendingRequests: "Aucune demande en attente.", unknown: "Inconnu", vipBenefit: "Avantage VIP", internalBenefit: "Avantage iLEAD", allCountries: "Tous les pays",
    addPartner: "Ajouter un partenaire", addPartnerHelp: "Enregistre les hôtels, transports, restaurants et autres organisations qui accordent un traitement VIP.", partnerDirectory: "Répertoire des partenaires", partnerDirectoryHelp: "Partenaires reconnus, contacts, pays et période d’accord.", noPartners: "Aucun partenaire enregistré.",
    partnerName: "Nom du partenaire", partnerType: "Type de partenaire", selectType: "Sélectionner un type", country: "Pays", city: "Ville", website: "Site web", status: "Statut", contactName: "Personne de contact", contactEmail: "E-mail du contact", contactPhone: "Téléphone du contact", agreementStart: "Début de l’accord", agreementEnd: "Fin de l’accord", notes: "Notes internes", savePartner: "Enregistrer les modifications", addPartnerButton: "Ajouter le partenaire", noContact: "Aucun contact principal",
    createBenefit: "Créer un avantage VIP", createBenefitHelp: "Définis la valeur, les membres admissibles, les limites et la méthode d’utilisation.", benefitCatalogue: "Catalogue des avantages", benefitCatalogueHelp: "Avantages internes et privilèges négociés avec les partenaires.", noBenefits: "Aucun avantage enregistré.", vipManager: "VIP Manager", vipAssistantManager: "VIP Assistant Manager", youAreManager: "vous êtes le responsable actuel", youAreAssistantManager: "vous êtes l’adjoint actuel", notAssigned: "Non attribué", edit: "Modifier", duplicate: "Dupliquer", activate: "Activer", suspend: "Suspendre", archive: "Archiver", guestAllowed: "Invité autorisé", transferable: "Transférable", nonTransferable: "Non transférable",
    benefitTitle: "Titre de l’avantage", partner: "Partenaire", benefitType: "Type d’avantage", valueLabel: "Valeur affichée", valueExample: "Ex. 20 % de réduction", eligibility: "Éligibilité", validFrom: "Valide à partir du", validUntil: "Valide jusqu’au", limitPerMember: "Limite par membre", totalLimit: "Limite globale", eligibleCategories: "Catégories de reconnaissance admissibles", categoriesHint: "Séparer par des virgules. Laisser vide pour toutes.", description: "Description", redemptionInstructions: "Instructions d’utilisation", terms: "Conditions générales", requiresApproval: "Une approbation interne est requise avant utilisation", saveBenefit: "Enregistrer l’avantage", createBenefitButton: "Créer l’avantage", approvalRequired: "Approbation requise", autoApproval: "Approbation automatique",
    recordRequest: "Enregistrer une demande", recordRequestHelp: "Crée une demande d’utilisation pour un membre VIP admissible.", member: "Membre VIP", selectMember: "Sélectionner un membre", benefit: "Avantage", selectBenefit: "Sélectionner un avantage", requestNotes: "Motif ou précisions", submitRequest: "Enregistrer la demande",
    usageHistory: "Demandes et utilisations", usageHistoryHelp: "Suivi de l’approbation jusqu’à l’utilisation chez le partenaire.", noRedemptions: "Aucune utilisation enregistrée.", requestedBy: "Enregistrée par", requestedOn: "Date", partnerReference: "Référence partenaire", valueRealized: "Valeur obtenue", decisionNotes: "Notes de décision", nextStatus: "Prochaine étape", selectStatus: "Sélectionner un statut", updateRequest: "Mettre à jour",
    statuses: {active: "Actif", suspended: "Suspendu", expired: "Expiré", archived: "Archivé", draft: "Brouillon", requested: "Demandé", approved: "Approuvé", redeemed: "Utilisé", rejected: "Refusé", cancelled: "Annulé"},
    partnerTypes: {hotel: "Hôtel", transport: "Transport", restaurant: "Restaurant", healthcare: "Santé", coworking: "Espace de travail", retail: "Commerce", professional_services: "Services professionnels", education: "Éducation", other: "Autre"},
    benefitTypes: {discount: "Réduction", complimentary: "Service offert", priority: "Traitement prioritaire", upgrade: "Surclassement", exclusive_access: "Accès exclusif", assistance: "Assistance", gift: "Cadeau", other: "Autre"},
    eligibilityScopes: {all_members: "Tous les membres", active_members: "Membres actifs", honorary_only: "Membres honoraires", internal_only: "Membres internes", external_only: "Membres externes", custom: "Critères personnalisés"},
  },
  en: {
    title: "VIP benefits & partners",
    subtitle: "Structure the privileges of iLEAD Global's Inner Circle, partners by country and secure tracking of every redemption.",
    backToVip: "Back to Super Leader VIP",
    views: {overview: "Overview", benefits: "Benefits", partners: "Partners", redemptions: "Redemptions"},
    activePartners: "Active partners", activeBenefits: "Active benefits", pendingRequests: "Pending requests", benefitsUsed: "Benefits redeemed", countriesCovered: "Countries covered",
    availableBenefits: "Currently available benefits", availableBenefitsHelp: "Active catalogue for eligible members.", manage: "Manage", noActiveBenefits: "No active benefits yet.",
    pendingRequestsHelp: "Requests requiring a VIP committee decision.", noPendingRequests: "No pending requests.", unknown: "Unknown", vipBenefit: "VIP benefit", internalBenefit: "iLEAD benefit", allCountries: "All countries",
    addPartner: "Add a partner", addPartnerHelp: "Register hotels, transport providers, restaurants and other organisations that provide VIP treatment.", partnerDirectory: "Partner directory", partnerDirectoryHelp: "Approved partners, contacts, countries and agreement periods.", noPartners: "No partners registered.",
    partnerName: "Partner name", partnerType: "Partner type", selectType: "Select a type", country: "Country", city: "City", website: "Website", status: "Status", contactName: "Contact person", contactEmail: "Contact email", contactPhone: "Contact phone", agreementStart: "Agreement start", agreementEnd: "Agreement end", notes: "Internal notes", savePartner: "Save changes", addPartnerButton: "Add partner", noContact: "No main contact",
    createBenefit: "Create a VIP benefit", createBenefitHelp: "Define the value, eligible members, limits and redemption method.", benefitCatalogue: "Benefit catalogue", benefitCatalogueHelp: "Internal benefits and privileges negotiated with partners.", noBenefits: "No benefits registered.", vipManager: "VIP Manager", vipAssistantManager: "VIP Assistant Manager", youAreManager: "you are the current manager", youAreAssistantManager: "you are the current assistant manager", notAssigned: "Not assigned", edit: "Edit", duplicate: "Duplicate", activate: "Activate", suspend: "Suspend", archive: "Archive", guestAllowed: "Guest allowed", transferable: "Transferable", nonTransferable: "Non-transferable",
    benefitTitle: "Benefit title", partner: "Partner", benefitType: "Benefit type", valueLabel: "Displayed value", valueExample: "E.g. 20% discount", eligibility: "Eligibility", validFrom: "Valid from", validUntil: "Valid until", limitPerMember: "Limit per member", totalLimit: "Total limit", eligibleCategories: "Eligible recognition categories", categoriesHint: "Separate with commas. Leave blank for all.", description: "Description", redemptionInstructions: "Redemption instructions", terms: "Terms and conditions", requiresApproval: "Internal approval is required before redemption", saveBenefit: "Save benefit", createBenefitButton: "Create benefit", approvalRequired: "Approval required", autoApproval: "Automatic approval",
    recordRequest: "Record a request", recordRequestHelp: "Create a benefit redemption request for an eligible VIP member.", member: "VIP member", selectMember: "Select a member", benefit: "Benefit", selectBenefit: "Select a benefit", requestNotes: "Reason or details", submitRequest: "Record request",
    usageHistory: "Requests and redemptions", usageHistoryHelp: "Track approval through to redemption with the partner.", noRedemptions: "No redemptions recorded.", requestedBy: "Recorded by", requestedOn: "Date", partnerReference: "Partner reference", valueRealized: "Value received", decisionNotes: "Decision notes", nextStatus: "Next step", selectStatus: "Select a status", updateRequest: "Update",
    statuses: {active: "Active", suspended: "Suspended", expired: "Expired", archived: "Archived", draft: "Draft", requested: "Requested", approved: "Approved", redeemed: "Redeemed", rejected: "Rejected", cancelled: "Cancelled"},
    partnerTypes: {hotel: "Hotel", transport: "Transport", restaurant: "Restaurant", healthcare: "Healthcare", coworking: "Workspace", retail: "Retail", professional_services: "Professional services", education: "Education", other: "Other"},
    benefitTypes: {discount: "Discount", complimentary: "Complimentary service", priority: "Priority treatment", upgrade: "Upgrade", exclusive_access: "Exclusive access", assistance: "Assistance", gift: "Gift", other: "Other"},
    eligibilityScopes: {all_members: "All members", active_members: "Active members", honorary_only: "Honorary members", internal_only: "Internal members", external_only: "External members", custom: "Custom criteria"},
  },
} as const;
