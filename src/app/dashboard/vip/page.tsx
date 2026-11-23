import type {ReactNode} from "react";
import Link from "next/link";
import {CountrySelect} from "@/components/forms/country-select";
import {redirect} from "next/navigation";
import {
  createVipMemberAction,
  createVipNominationAction,
  createVipRenewalRequestAction,
  reviewVipNominationAction,
  reviewVipRenewalAction,
  updateVipMemberDetailsAction,
  updateVipMemberStatusAction,
} from "@/app/actions/vip";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings, getVipRecognitionCategories} from "@/lib/vip/settings";
import {APP_VERSION} from "@/lib/app-version";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
const VIP_REGISTRY_ROLES = ["owner", "admin", "hr"];
const VIP_DECISION_ROLES = ["owner", "admin", "executive"];
const VIEWS = ["overview", "members", "nominations", "approvals", "cards", "renewals"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Profile = {id: string; full_name: string | null; email: string | null};
type InternalMember = {user_id: string; role: string};
type VipMember = {
  id: string;
  member_number: string;
  member_type: string;
  linked_user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  organization_name: string | null;
  job_title: string | null;
  recognition_category: string;
  contribution_summary: string;
  notes: string | null;
  status: string;
  admission_date: string;
  expires_on: string;
  created_at: string;
};
type VipCard = {
  id: string;
  member_id: string;
  card_number: string;
  issue_number: number;
  verification_token: string;
  status: string;
  valid_from: string;
  valid_until: string;
  issued_by: string;
  issued_at: string;
  revocation_reason: string | null;
};
type VipRenewal = {
  id: string;
  member_id: string;
  current_card_id: string | null;
  new_card_id: string | null;
  status: string;
  request_reason: string | null;
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  review_notes: string | null;
  decided_at: string | null;
};
type VipNomination = {
  id: string;
  nominee_type: string;
  linked_user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  organization_name: string | null;
  job_title: string | null;
  recognition_category: string;
  relationship_to_organization: string | null;
  contribution_summary: string;
  evidence_notes: string | null;
  status: string;
  nominated_by: string;
  reviewed_by: string | null;
  review_notes: string | null;
  submitted_at: string;
  decided_at: string | null;
};
type AuditRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Status({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet" | "rose"}) {
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
  if (["active", "approved", "honorary", "assigned", "completed", "confirmed"].includes(status)) return "green";
  if (["submitted", "under_review", "pending_renewal", "replaced", "in_progress", "planned"].includes(status)) return "amber";
  if (["needs_information"].includes(status)) return "blue";
  if (["rejected", "expired", "suspended", "withdrawn", "revoked", "cancelled"].includes(status)) return "red";
  return "slate";
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8" aria-hidden="true">
      <path d="M5 9 8.5 5.5 12 9l3.5-3.5L19 9l-1.5 9h-11L5 9Z" />
      <path d="M7 18h10M8.5 13h.01M12 12h.01M15.5 13h.01" />
    </svg>
  );
}

export default async function VipPage({searchParams}: {searchParams: SearchParams}) {
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
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id,vip_membership_concierge_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_growth_membership_manager_user_id: string | null; vip_membership_concierge_assistant_user_id: string | null}>();
  const isVipManager = managerSettings?.vip_manager_user_id === authData.user.id;
  const isVipAssistantManager = managerSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipGrowthMembershipManager = managerSettings?.vip_growth_membership_manager_user_id === authData.user.id;
  const isVipMembershipConciergeAssistant = managerSettings?.vip_membership_concierge_assistant_user_id === authData.user.id;
  if (!VIP_ROLES.includes(membership.role) && !isVipManager && !isVipAssistantManager && !isVipGrowthMembershipManager && !isVipMembershipConciergeAssistant) redirect("/dashboard/my-day");

  const schemaCheck = await admin.from("vip_members").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-5xl">
          <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION}</p>
            <h1 className="mt-2 text-4xl font-black">Super Leader VIP</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{c.setupTitle}</h2>
            <p className="mt-3 leading-7 text-amber-900">{c.setupText}</p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/042_super_leader_vip_phase1_v3_2_1.sql</code>
          </section>
        </div>
      </main>
    );
  }

  const phaseTwoSchemaCheck = await admin.from("vip_cards").select("id", {head: true, count: "exact"}).limit(1);
  if (phaseTwoSchemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(phaseTwoSchemaCheck.error.code ?? ""));
    if (!missing) throw new Error(phaseTwoSchemaCheck.error.message);
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-5xl">
          <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION}</p>
            <h1 className="mt-2 text-4xl font-black">Super Leader VIP</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{c.setupPhase2Title}</h2>
            <p className="mt-3 leading-7 text-amber-900">{c.setupPhase2Text}</p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/043_super_leader_vip_cards_renewals_v3_2_2.sql</code>
          </section>
        </div>
      </main>
    );
  }

  const [vipMembersResult, nominationsResult, internalMembersResult, profilesResult, auditResult, cardsResult, renewalsResult] = await Promise.all([
    admin
      .from("vip_members")
      .select("id,member_number,member_type,linked_user_id,full_name,email,phone,country,organization_name,job_title,recognition_category,contribution_summary,notes,status,admission_date,expires_on,created_at")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(500),
    admin
      .from("vip_nominations")
      .select("id,nominee_type,linked_user_id,full_name,email,phone,country,organization_name,job_title,recognition_category,relationship_to_organization,contribution_summary,evidence_notes,status,nominated_by,reviewed_by,review_notes,submitted_at,decided_at")
      .eq("organization_id", membership.organization_id)
      .order("submitted_at", {ascending: false})
      .limit(500),
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true),
    admin.from("profiles").select("id, full_name, email"),
    admin
      .from("vip_audit_log")
      .select("id,entity_type,entity_id,actor_id,action,previous_status,new_status,details,created_at")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(16),
    admin
      .from("vip_cards")
      .select("id,member_id,card_number,issue_number,verification_token,status,valid_from,valid_until,issued_by,issued_at,revocation_reason")
      .eq("organization_id", membership.organization_id)
      .order("issued_at", {ascending: false})
      .limit(1000),
    admin
      .from("vip_renewal_requests")
      .select("id,member_id,current_card_id,new_card_id,status,request_reason,requested_by,requested_at,reviewed_by,review_notes,decided_at")
      .eq("organization_id", membership.organization_id)
      .order("requested_at", {ascending: false})
      .limit(500),
  ]);

  for (const result of [vipMembersResult, nominationsResult, internalMembersResult, profilesResult, auditResult, cardsResult, renewalsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const [programSettings, recognitionCategories] = await Promise.all([
    getVipProgramSettings(admin, membership.organization_id),
    getVipRecognitionCategories(admin, membership.organization_id),
  ]);
  const activeRecognitionCategories = recognitionCategories.filter((category) => category.is_active);
  const recognitionCategoryMap = new Map(recognitionCategories.map((category) => [category.code, fr ? category.name_fr : category.name_en]));

  const vipMembers = (vipMembersResult.data ?? []) as VipMember[];
  const nominations = (nominationsResult.data ?? []) as VipNomination[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const internalMembers = ((internalMembersResult.data ?? []) as InternalMember[])
    .map((item) => ({...item, profile: profileMap.get(item.user_id)}))
    .sort((a, b) => (a.profile?.full_name ?? a.profile?.email ?? "").localeCompare(b.profile?.full_name ?? b.profile?.email ?? ""));
  const auditRows = (auditResult.data ?? []) as AuditRow[];
  const cards = (cardsResult.data ?? []) as VipCard[];
  const renewals = (renewalsResult.data ?? []) as VipRenewal[];
  const memberMap = new Map(vipMembers.map((member) => [member.id, member]));
  const today = new Date().toISOString().slice(0, 10);
  const activeCardByMember = new Map<string, VipCard>();
  for (const card of cards) {
    if (card.status === "active" && card.valid_from <= today && card.valid_until >= today && !activeCardByMember.has(card.member_id)) {
      activeCardByMember.set(card.member_id, card);
    }
  }
  const pendingNominations = nominations.filter((item) => ["submitted", "under_review", "needs_information"].includes(item.status));
  const pendingRenewals = renewals.filter((item) => ["submitted", "under_review", "needs_information"].includes(item.status));
  const ninetyDays = new Date();
  ninetyDays.setUTCDate(ninetyDays.getUTCDate() + 90);
  const ninetyDaysValue = ninetyDays.toISOString().slice(0, 10);
  const activeMembers = vipMembers.filter((item) => ["active", "honorary", "pending_renewal"].includes(item.status) && item.expires_on >= today);
  const activeCards = cards.filter((item) => item.status === "active" && item.valid_from <= today && item.valid_until >= today);
  const expiringMembers = vipMembers.filter((item) => item.expires_on >= today && item.expires_on <= ninetyDaysValue && !["withdrawn", "suspended"].includes(item.status));
  const countries = new Set(vipMembers.map((item) => item.country?.trim()).filter(Boolean));
  const canManageRegistry = VIP_REGISTRY_ROLES.includes(membership.role) || isVipManager || isVipAssistantManager || isVipMembershipConciergeAssistant;
  const canDecide = VIP_DECISION_ROLES.includes(membership.role) || (!programSettings.nomination_requires_committee_approval && membership.role === "hr");

  const categoryLabel = (value: string) => recognitionCategoryMap.get(value) ?? c.categories[value as keyof typeof c.categories] ?? value;
  const statusLabel = (value: string) => c.statuses[value as keyof typeof c.statuses] ?? value;
  const personName = (id: string | null) => {
    if (!id) return c.unknown;
    const profile = profileMap.get(id);
    return profile?.full_name || profile?.email || c.unknown;
  };
  const auditChangedFields = (row: AuditRow) => {
    const value = row.details?.changedFields;
    return Array.isArray(value) ? value.filter((field): field is string => typeof field === "string") : [];
  };

  const nav = [
    {id: "overview", label: c.overview, href: "/dashboard/vip"},
    {id: "members", label: c.members, href: "/dashboard/vip?view=members"},
    {id: "nominations", label: c.nominations, href: "/dashboard/vip?view=nominations"},
    {id: "approvals", label: c.approvals, href: "/dashboard/vip?view=approvals"},
    {id: "cards", label: c.cards, href: "/dashboard/vip?view=cards"},
    {id: "renewals", label: c.renewals, href: "/dashboard/vip?view=renewals"},
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-7 text-white shadow-2xl shadow-rose-950/20 sm:p-9">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-rose-500/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="flex items-center gap-3 text-rose-200">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-400/15"><CrownIcon /></span>
                <p className="text-xs font-black uppercase tracking-[0.18em]">{c.eyebrow}</p>
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{programSettings.program_name}</h1>
              <p className="mt-4 max-w-3xl leading-7 text-slate-300">{c.subtitle}</p>
            </div>
            <Status tone="green">{c.phaseActive}</Status>
          </div>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm" aria-label={c.vipNavigation}>
          {nav.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={`shrink-0 rounded-xl px-4 py-3 text-sm font-black transition ${view === item.id ? "bg-rose-700 text-white" : "text-slate-600 hover:bg-rose-50 hover:text-rose-800"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</p> : null}

        {view === "overview" ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              {[
                {label: c.activeMembers, value: activeMembers.length, bar: "bg-rose-200"},
                {label: c.activeCards, value: activeCards.length, bar: "bg-emerald-200"},
                {label: c.pendingNominations, value: pendingNominations.length, bar: "bg-amber-200"},
                {label: c.pendingRenewals, value: pendingRenewals.length, bar: "bg-orange-200"},
                {label: c.expiringSoon, value: expiringMembers.length, bar: "bg-violet-200"},
                {label: c.countriesRepresented, value: countries.size, bar: "bg-blue-200"},
              ].map((metric) => (
                <article key={metric.label} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-bold text-slate-500">{metric.label}</p>
                  <p className="mt-2 text-4xl font-black text-slate-950">{metric.value}</p>
                  <div className={`mt-4 h-1.5 rounded-full ${metric.bar}`} />
                </article>
              ))}
            </section>

            <section className="mt-7 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black">{c.phaseOneTitle}</h2>
                    <p className="mt-2 text-slate-600">{c.phaseOneText}</p>
                  </div>
                  <Status tone="green">{c.active}</Status>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Link href="/dashboard/vip/growth" className="rounded-2xl border border-violet-200 bg-violet-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-violet-950">{fr ? "Croissance & adhésions" : "Growth & memberships"}</p>
                    <p className="mt-2 text-sm leading-6 text-violet-800">{fr ? "Pipeline VIP, campagnes, conversions, objectifs, encaissements et ROI." : "VIP pipeline, campaigns, conversions, targets, collections and ROI."}</p>
                  </Link>
                  <Link href="/dashboard/vip?view=members" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-rose-950">{c.members}</p>
                    <p className="mt-2 text-sm leading-6 text-rose-800">{c.membersHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip?view=nominations" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-amber-950">{c.nominations}</p>
                    <p className="mt-2 text-sm leading-6 text-amber-800">{c.nominationsHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip?view=approvals" className="rounded-2xl border border-violet-200 bg-violet-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-violet-950">{c.approvals}</p>
                    <p className="mt-2 text-sm leading-6 text-violet-800">{c.approvalsHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip?view=cards" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-emerald-950">{c.cards}</p>
                    <p className="mt-2 text-sm leading-6 text-emerald-800">{c.cardsHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip?view=renewals" className="rounded-2xl border border-orange-200 bg-orange-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-orange-950">{c.renewals}</p>
                    <p className="mt-2 text-sm leading-6 text-orange-800">{c.renewalsHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip/travel" className="rounded-2xl border border-sky-200 bg-sky-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-sky-950">{c.internationalTravel}</p>
                    <p className="mt-2 text-sm leading-6 text-sky-800">{c.travelHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip/country-welcome" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-emerald-950">{c.countryWelcome}</p>
                    <p className="mt-2 text-sm leading-6 text-emerald-800">{c.countryWelcomeHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip/annual-meeting" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-amber-950">{c.annualMeeting}</p>
                    <p className="mt-2 text-sm leading-6 text-amber-800">{c.annualMeetingHelp}</p>
                  </Link>
                  <Link href="/dashboard/vip/benefits" className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                    <p className="font-black text-fuchsia-950">{c.partnerNetwork}</p>
                    <p className="mt-2 text-sm leading-6 text-fuchsia-800">{c.partnerNetworkHelp}</p>
                  </Link>
                </div>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <h2 className="text-2xl font-black">{c.recentActivity}</h2>
                <div className="mt-5 space-y-3">
                  {auditRows.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-600">{c.noActivity}</p> : auditRows.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold">{c.actions[row.action as keyof typeof c.actions] ?? row.action}</p>
                        {row.new_status ? <Status tone={statusTone(row.new_status)}>{statusLabel(row.new_status)}</Status> : null}
                      </div>
                      {auditChangedFields(row).length > 0 ? (
                        <p className="mt-2 text-xs font-semibold text-slate-600">{c.fieldsChanged}: {auditChangedFields(row).map((field) => c.memberFieldLabels[field as keyof typeof c.memberFieldLabels] ?? field).join(", ")}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-500">{personName(row.actor_id)} · {new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short"}).format(new Date(row.created_at))}</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="mt-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{c.nextPhases}</h2>
                  <p className="mt-2 text-slate-600">{c.nextPhasesText}</p>
                </div>
                <Status tone="green">{c.twoActive}</Status>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Link href="/dashboard/vip/communications" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                  <p className="font-black text-rose-950">{c.vipCommunications}</p>
                  <p className="mt-2 text-sm leading-6 text-rose-800">{c.vipCommunicationsHelp}</p>
                </Link>
                <Link href="/dashboard/vip/reports" className="rounded-2xl border border-sky-200 bg-sky-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                  <p className="font-black text-sky-950">{c.vipReports}</p>
                  <p className="mt-2 text-sm leading-6 text-sky-800">{c.vipReportsHelp}</p>
                </Link>
                <Link href="/dashboard/vip/settings" className="rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-1 hover:shadow-md">
                  <p className="font-black">{c.vipSettings}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{c.vipSettingsHelp}</p>
                </Link>
              </div>
            </section>
          </>
        ) : null}

        {view === "members" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            {canManageRegistry ? (
              <form action={createVipMemberAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.addExistingMember}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.addExistingMemberHelp}</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label={c.memberType}>
                    <select name="memberType" defaultValue="external" required className={inputClass}>
                      <option value="external">{c.external}</option>
                      <option value="internal">{c.internal}</option>
                    </select>
                  </Field>
                  <Field label={c.internalPerson}>
                    <select name="linkedUserId" defaultValue="" className={inputClass}>
                      <option value="">{c.notApplicable}</option>
                      {internalMembers.map((item) => <option key={item.user_id} value={item.user_id}>{item.profile?.full_name || item.profile?.email || c.unknown}</option>)}
                    </select>
                  </Field>
                  <Field label={c.fullName}><input name="fullName" maxLength={180} className={inputClass} /></Field>
                  <Field label={c.email}><input name="email" type="email" maxLength={254} className={inputClass} /></Field>
                  <Field label={c.phone}><input name="phone" maxLength={60} className={inputClass} /></Field>
                  <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} className={inputClass} /></Field>
                  <Field label={c.organization}><input name="organizationName" maxLength={180} className={inputClass} /></Field>
                  <Field label={c.jobTitle}><input name="jobTitle" maxLength={180} className={inputClass} /></Field>
                  <Field label={c.category}>
                    <select name="recognitionCategory" defaultValue={activeRecognitionCategories[0]?.code ?? "distinguished_contributor"} required className={inputClass}>
                      {activeRecognitionCategories.map((category) => <option key={category.code} value={category.code}>{fr ? category.name_fr : category.name_en}</option>)}
                    </select>
                  </Field>
                  <Field label={c.initialStatus}>
                    <select name="status" defaultValue="active" className={inputClass}>
                      <option value="active">{c.statuses.active}</option>
                      <option value="honorary">{c.statuses.honorary}</option>
                    </select>
                  </Field>
                  <Field label={c.admissionDate}><input name="admissionDate" type="date" className={inputClass} /></Field>
                  <Field label={c.expiryDate}><input name="expiresOn" type="date" className={inputClass} /></Field>
                </div>
                <Field label={c.contribution}><textarea name="contributionSummary" required minLength={10} maxLength={5000} rows={5} className={inputClass} /></Field>
                <Field label={c.internalNotes}><textarea name="notes" maxLength={5000} rows={3} className={inputClass} /></Field>
                <button type="submit" className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white hover:bg-rose-800">{c.addToRegistry}</button>
              </form>
            ) : (
              <article className="rounded-3xl border border-blue-200 bg-blue-50 p-6 text-blue-950">
                <h2 className="text-xl font-black">{c.readOnlyRegistry}</h2>
                <p className="mt-2 leading-7">{c.readOnlyRegistryHelp}</p>
              </article>
            )}

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-2xl font-black">{c.vipRegistry}</h2><p className="mt-1 text-sm text-slate-500">{vipMembers.length} {c.records}</p></div>
                <Status tone="rose">{activeMembers.length} {c.active.toLowerCase()}</Status>
              </div>
              <div className="mt-5 space-y-4">
                {vipMembers.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noMembers}</p> : vipMembers.map((item) => (
                  <article id={`vip-member-${item.id}`} key={item.id} className="scroll-mt-6 rounded-2xl border border-slate-200 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black">{item.full_name}</h3><Status tone={statusTone(item.status)}>{statusLabel(item.status)}</Status></div>
                        <p className="mt-1 font-mono text-xs font-bold text-rose-700">{item.member_number}</p>
                        <p className="mt-3 text-sm text-slate-600">{categoryLabel(item.recognition_category)} · {item.member_type === "internal" ? c.internal : c.external}</p>
                        <p className="mt-1 text-sm text-slate-500">{[item.job_title, item.organization_name, item.country].filter(Boolean).join(" · ") || c.notProvided}</p>
                      </div>
                      <div className="text-sm text-slate-500 sm:text-right">
                        <p>{c.admitted}: {new Date(`${item.admission_date}T00:00:00Z`).toLocaleDateString(dateLocale)}</p>
                        <p>{c.expires}: {new Date(`${item.expires_on}T00:00:00Z`).toLocaleDateString(dateLocale)}</p>
                      </div>
                    </div>
                    <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{item.contribution_summary}</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {activeCardByMember.get(item.id) ? (
                        <Link href={`/dashboard/vip/card/${activeCardByMember.get(item.id)!.id}`} className="rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white">{c.viewCard}</Link>
                      ) : <Status tone="amber">{c.noActiveCard}</Status>}
                      {canManageRegistry && !["suspended", "withdrawn"].includes(item.status) ? (
                        <Link href={`/dashboard/vip?view=renewals&member=${encodeURIComponent(item.id)}`} className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm font-black text-orange-900">{c.requestRenewal}</Link>
                      ) : null}
                    </div>
                    {canManageRegistry ? (
                      <>
                        <form action={updateVipMemberStatusAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
                          <input type="hidden" name="memberId" value={item.id} />
                          <select name="status" defaultValue={item.status} className={`${inputClass} sm:max-w-xs`}>
                            {Object.entries(c.memberStatusOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <button type="submit" className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">{c.updateStatus}</button>
                        </form>

                        <details open={first(params.edit) === item.id} className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
                          <summary className="cursor-pointer font-black text-rose-900">{c.editMemberRecord}</summary>
                          <p className="mt-2 text-sm leading-6 text-rose-900/80">{c.editMemberHelp}</p>
                          <form action={updateVipMemberDetailsAction} className="mt-4">
                            <input type="hidden" name="memberId" value={item.id} />
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field label={c.fullName}><input name="fullName" required minLength={2} maxLength={180} defaultValue={item.full_name} className={inputClass} /></Field>
                              <Field label={c.email}><input name="email" type="email" maxLength={254} defaultValue={item.email ?? ""} className={inputClass} /></Field>
                              <Field label={c.phone}><input name="phone" maxLength={60} defaultValue={item.phone ?? ""} className={inputClass} /></Field>
                              <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} defaultValue={item.country} className={inputClass} /></Field>
                              <Field label={c.organization}><input name="organizationName" maxLength={180} defaultValue={item.organization_name ?? ""} className={inputClass} /></Field>
                              <Field label={c.jobTitle}><input name="jobTitle" maxLength={180} defaultValue={item.job_title ?? ""} className={inputClass} /></Field>
                              <Field label={c.category}>
                                <select name="recognitionCategory" defaultValue={item.recognition_category} required className={inputClass}>
                                  {!activeRecognitionCategories.some((category) => category.code === item.recognition_category) ? <option value={item.recognition_category}>{categoryLabel(item.recognition_category)} ({fr ? "inactive" : "inactive"})</option> : null}
                                  {activeRecognitionCategories.map((category) => <option key={category.code} value={category.code}>{fr ? category.name_fr : category.name_en}</option>)}
                                </select>
                              </Field>
                              <div className="grid grid-cols-2 gap-3">
                                <Field label={c.admissionDate}><input name="admissionDate" type="date" required defaultValue={item.admission_date} className={inputClass} /></Field>
                                <Field label={c.expiryDate}><input name="expiresOn" type="date" required defaultValue={item.expires_on} className={inputClass} /></Field>
                              </div>
                            </div>
                            <Field label={c.contribution}><textarea name="contributionSummary" required minLength={10} maxLength={5000} rows={5} defaultValue={item.contribution_summary} className={inputClass} /></Field>
                            <Field label={c.internalNotes}><textarea name="notes" maxLength={5000} rows={3} defaultValue={item.notes ?? ""} className={inputClass} /></Field>
                            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                              <button type="submit" name="saveMode" value="save" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{c.saveChangesOnly}</button>
                              <button type="submit" name="saveMode" value="save_reissue" className="rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white">{c.saveAndReissue}</button>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-slate-600">{c.reissueExplanation}</p>
                          </form>
                        </details>
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {view === "nominations" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <form action={createVipNominationAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.newNomination}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{c.newNominationHelp}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label={c.nomineeType}><select name="nomineeType" defaultValue="external" required className={inputClass}><option value="external">{c.external}</option><option value="internal">{c.internal}</option></select></Field>
                <Field label={c.internalPerson}><select name="linkedUserId" defaultValue="" className={inputClass}><option value="">{c.notApplicable}</option>{internalMembers.map((item) => <option key={item.user_id} value={item.user_id}>{item.profile?.full_name || item.profile?.email || c.unknown}</option>)}</select></Field>
                <Field label={c.fullName}><input name="fullName" maxLength={180} className={inputClass} /></Field>
                <Field label={c.email}><input name="email" type="email" maxLength={254} className={inputClass} /></Field>
                <Field label={c.phone}><input name="phone" maxLength={60} className={inputClass} /></Field>
                <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} className={inputClass} /></Field>
                <Field label={c.organization}><input name="organizationName" maxLength={180} className={inputClass} /></Field>
                <Field label={c.jobTitle}><input name="jobTitle" maxLength={180} className={inputClass} /></Field>
                <Field label={c.category}><select name="recognitionCategory" defaultValue={activeRecognitionCategories[0]?.code ?? "distinguished_contributor"} required className={inputClass}>{activeRecognitionCategories.map((category) => <option key={category.code} value={category.code}>{fr ? category.name_fr : category.name_en}</option>)}</select></Field>
                <Field label={c.relationship}><input name="relationship" maxLength={500} className={inputClass} /></Field>
              </div>
              <Field label={c.contribution}><textarea name="contributionSummary" required minLength={10} maxLength={5000} rows={5} className={inputClass} /></Field>
              <Field label={c.evidence}><textarea name="evidenceNotes" maxLength={5000} rows={4} className={inputClass} /></Field>
              <button type="submit" className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white hover:bg-rose-800">{c.submitNomination}</button>
            </form>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black">{c.nominationHistory}</h2><Status tone="amber">{pendingNominations.length} {c.pending.toLowerCase()}</Status></div>
              <div className="mt-5 space-y-4">
                {nominations.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noNominations}</p> : nominations.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h3 className="text-lg font-black">{item.full_name}</h3><p className="mt-1 text-sm text-slate-500">{categoryLabel(item.recognition_category)} · {item.nominee_type === "internal" ? c.internal : c.external}</p></div>
                      <Status tone={statusTone(item.status)}>{statusLabel(item.status)}</Status>
                    </div>
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.contribution_summary}</p>
                    <p className="mt-4 text-xs text-slate-500">{c.nominatedBy} {personName(item.nominated_by)} · {new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(item.submitted_at))}</p>
                    {item.review_notes ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><strong>{c.committeeNote}:</strong> {item.review_notes}</p> : null}
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {view === "approvals" ? (
          <section className="mt-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><h2 className="text-2xl font-black">{c.committeeQueue}</h2><p className="mt-2 text-slate-600">{c.committeeQueueHelp}</p></div>
                <Status tone="amber">{pendingNominations.length} {c.toReview}</Status>
              </div>
              <div className="mt-6 space-y-5">
                {pendingNominations.length === 0 ? <p className="rounded-2xl bg-emerald-50 p-5 font-bold text-emerald-800">{c.queueEmpty}</p> : pendingNominations.map((item) => (
                  <article key={item.id} className="rounded-3xl border border-slate-200 p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-black">{item.full_name}</h3><Status tone={statusTone(item.status)}>{statusLabel(item.status)}</Status></div>
                        <p className="mt-2 text-sm text-slate-500">{categoryLabel(item.recognition_category)} · {[item.job_title, item.organization_name, item.country].filter(Boolean).join(" · ") || c.notProvided}</p>
                        <p className="mt-1 text-xs text-slate-500">{c.nominatedBy} {personName(item.nominated_by)}</p>
                      </div>
                      <Status tone="rose">{item.nominee_type === "internal" ? c.internal : c.external}</Status>
                    </div>
                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{c.contribution}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.contribution_summary}</p></div>
                      <div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-amber-800">{c.evidence}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{item.evidence_notes || c.notProvided}</p></div>
                    </div>
                    <form action={reviewVipNominationAction} className="mt-5">
                      <input type="hidden" name="nominationId" value={item.id} />
                      <label className="block font-bold">{c.committeeNote}<textarea name="reviewNotes" defaultValue={item.review_notes ?? ""} maxLength={5000} rows={3} className={inputClass} /></label>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button type="submit" name="decision" value="under_review" className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">{c.startReview}</button>
                        <button type="submit" name="decision" value="needs_information" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">{c.requestInfo}</button>
                        {canDecide ? <button type="submit" name="decision" value="approved" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">{c.approveAndCreate}</button> : null}
                        {canDecide ? <button type="submit" name="decision" value="rejected" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white">{c.reject}</button> : null}
                      </div>
                    </form>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}


        {view === "cards" ? (
          <section className="mt-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{c.cardRegistry}</h2>
                  <p className="mt-2 text-slate-600">{c.cardRegistryHelp}</p>
                </div>
                <Status tone="green">{activeCards.length} {c.active.toLowerCase()}</Status>
              </div>
              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                {cards.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600 lg:col-span-2">{c.noCards}</p> : cards.map((card) => {
                  const member = memberMap.get(card.member_id);
                  const effectiveStatus = card.status === "active" && card.valid_until < today ? "expired" : card.status;
                  return (
                    <article key={card.id} className="rounded-3xl border border-slate-200 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black">{member?.full_name ?? c.unknown}</h3>
                          <p className="mt-1 font-mono text-xs font-bold text-rose-700">{card.card_number}</p>
                          <p className="mt-2 text-sm text-slate-500">{member ? categoryLabel(member.recognition_category) : c.notProvided}</p>
                        </div>
                        <Status tone={statusTone(effectiveStatus)}>{statusLabel(effectiveStatus)}</Status>
                      </div>
                      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">{c.validFrom}</dt><dd className="mt-1 font-black">{new Date(`${card.valid_from}T00:00:00Z`).toLocaleDateString(dateLocale)}</dd></div>
                        <div className="rounded-xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">{c.validUntil}</dt><dd className="mt-1 font-black">{new Date(`${card.valid_until}T00:00:00Z`).toLocaleDateString(dateLocale)}</dd></div>
                      </dl>
                      {card.revocation_reason ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{card.revocation_reason}</p> : null}
                      <Link href={`/dashboard/vip/card/${card.id}`} className="mt-5 inline-flex rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">{c.openCard}</Link>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {view === "renewals" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
            {canManageRegistry ? (
              <form action={createVipRenewalRequestAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.newRenewal}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.newRenewalHelp}</p>
                <Field label={c.vipMember}>
                  <select name="memberId" defaultValue={first(params.member)} required className={inputClass}>
                    <option value="">{c.selectMember}</option>
                    {vipMembers.filter((member) => !["suspended", "withdrawn"].includes(member.status)).map((member) => (
                      <option key={member.id} value={member.id}>{member.full_name} · {member.member_number} · {new Date(`${member.expires_on}T00:00:00Z`).toLocaleDateString(dateLocale)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={c.renewalReason}><textarea name="requestReason" maxLength={2000} rows={5} className={inputClass} /></Field>
                <button type="submit" className="mt-5 w-full rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700">{c.submitRenewal}</button>
              </form>
            ) : (
              <article className="rounded-3xl border border-blue-200 bg-blue-50 p-6 text-blue-950">
                <h2 className="text-xl font-black">{c.renewalsReadOnly}</h2>
                <p className="mt-2 leading-7">{c.renewalsReadOnlyHelp}</p>
              </article>
            )}

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-2xl font-black">{c.renewalQueue}</h2><p className="mt-1 text-sm text-slate-500">{renewals.length} {c.records}</p></div>
                <Status tone="amber">{pendingRenewals.length} {c.pending.toLowerCase()}</Status>
              </div>
              <div className="mt-5 space-y-5">
                {renewals.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">{c.noRenewals}</p> : renewals.map((renewal) => {
                  const member = memberMap.get(renewal.member_id);
                  return (
                    <article key={renewal.id} className="rounded-3xl border border-slate-200 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black">{member?.full_name ?? c.unknown}</h3>
                          <p className="mt-1 text-sm text-slate-500">{member?.member_number ?? "—"} · {c.expires}: {member ? new Date(`${member.expires_on}T00:00:00Z`).toLocaleDateString(dateLocale) : "—"}</p>
                          <p className="mt-2 text-xs text-slate-500">{c.requestedBy} {personName(renewal.requested_by)} · {new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(renewal.requested_at))}</p>
                        </div>
                        <Status tone={statusTone(renewal.status)}>{statusLabel(renewal.status)}</Status>
                      </div>
                      <p className="mt-4 whitespace-pre-wrap rounded-xl bg-orange-50 p-4 text-sm leading-6 text-orange-950">{renewal.request_reason || c.noRenewalReason}</p>
                      {renewal.review_notes ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><strong>{c.committeeNote}:</strong> {renewal.review_notes}</p> : null}
                      {renewal.new_card_id ? <Link href={`/dashboard/vip/card/${renewal.new_card_id}`} className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">{c.openNewCard}</Link> : null}
                      {["submitted", "under_review", "needs_information"].includes(renewal.status) ? (
                        <form action={reviewVipRenewalAction} className="mt-5">
                          <input type="hidden" name="renewalId" value={renewal.id} />
                          <label className="block font-bold">{c.committeeNote}<textarea name="reviewNotes" defaultValue={renewal.review_notes ?? ""} maxLength={5000} rows={3} className={inputClass} /></label>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button type="submit" name="decision" value="under_review" className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">{c.startReview}</button>
                            <button type="submit" name="decision" value="needs_information" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">{c.requestInfo}</button>
                            {canDecide ? <button type="submit" name="decision" value="approved" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">{c.approveRenewal}</button> : null}
                            {canDecide ? <button type="submit" name="decision" value="rejected" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white">{c.reject}</button> : null}
                          </div>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return <label className="mt-4 block font-bold text-slate-800">{label}{children}</label>;
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100";

const copy = {
  fr: {
    setupTitle: "Migration Supabase requise",
    setupText: "Exécute la migration VIP Phase 1 dans Supabase avant d’utiliser le registre et les approbations.",
    setupPhase2Title: "Migration Cartes & renouvellements requise",
    setupPhase2Text: "Exécute la migration VIP V3.2.2 dans Supabase pour activer les cartes numériques, le QR public et les renouvellements annuels.",
    eyebrow: "Reconnaissance internationale",
    subtitle: "Gère les contributeurs distinctifs, les cartes, la mobilité internationale et l’accueil VIP dans un programme sécurisé et auditable.",
    phaseActive: "Phase 4 active",
    vipNavigation: "Navigation Super Leader VIP",
    overview: "Vue d’ensemble",
    members: "Membres VIP",
    nominations: "Nominations",
    approvals: "Comité & approbations",
    cards: "Cartes VIP",
    renewals: "Renouvellements",
    activeMembers: "Membres actifs",
    activeCards: "Cartes actives",
    pendingNominations: "Nominations en attente",
    pendingRenewals: "Renouvellements en attente",
    expiringSoon: "Échéances à 90 jours",
    countriesRepresented: "Pays représentés",
    phaseOneTitle: "Programme VIP international pleinement opérationnel",
    phaseOneText: "Les dossiers, cartes, renouvellements, déplacements, accueils par pays et rencontre annuelle sont maintenant actifs et auditables.",
    active: "Actif",
    membersHelp: "Créer et suivre les dossiers des membres internes et externes.",
    nominationsHelp: "Proposer une contribution distinctive au comité VIP.",
    approvalsHelp: "Étudier, demander des précisions, approuver ou refuser.",
    cardsHelp: "Consulter, imprimer, vérifier, réémettre ou révoquer les cartes annuelles.",
    renewalsHelp: "Soumettre et décider les renouvellements avec émission automatique d’une nouvelle carte.",
    travelHelp: "Enregistre les voyages, approuve les demandes et affecte un responsable local.",
    countryWelcome: "Accueil par pays",
    countryWelcomeHelp: "Coordonne les responsables, prestataires et services promis au membre.",
    annualMeetingHelp: "Choisis le pays hôte, invite les membres et organise le programme annuel.",
    recentActivity: "Activité récente",
    noActivity: "Aucune activité VIP n’a encore été enregistrée.",
    fieldsChanged: "Champs modifiés",
    memberFieldLabels: {
      full_name: "Nom complet",
      email: "Adresse e-mail",
      phone: "Téléphone",
      country: "Pays",
      organization_name: "Organisation",
      job_title: "Fonction",
      recognition_category: "Catégorie",
      contribution_summary: "Contribution distinctive",
      admission_date: "Date d’admission",
      expires_on: "Date d’expiration",
      notes: "Notes internes",
    },
    nextPhases: "Pilotage et communications",
    nextPhasesText: "Toutes les rubriques VIP principales sont maintenant actives, y compris les paramètres de gouvernance.",
    twoActive: "3 modules actifs",
    soon: "Bientôt",
    cardsRenewals: "Cartes & renouvellements",
    internationalTravel: "Déplacements internationaux",
    annualMeeting: "Rencontre annuelle",
    partnerNetwork: "Avantages & partenaires",
    partnerNetworkHelp: "Gère les privilèges, les partenaires par pays et le suivi de chaque utilisation.",
    vipCommunications: "Communications VIP",
    vipCommunicationsHelp: "Prépare les messages, cible les audiences et suit chaque diffusion.",
    vipReports: "Rapports VIP",
    vipReportsHelp: "Consolide les indicateurs, alertes et résultats du programme.",
    vipSettings: "Paramètres VIP",
    vipSettingsHelp: "Règles, cartes, renouvellements, catégories et options opérationnelles du programme.",
    addExistingMember: "Ajouter un membre existant",
    addExistingMemberHelp: "Utilise ce formulaire pour reprendre les membres VIP déjà reconnus avant la mise en place du circuit de nomination.",
    memberType: "Type de membre",
    nomineeType: "Type de personne",
    external: "Externe",
    internal: "Interne",
    internalPerson: "Collaborateur interne lié",
    notApplicable: "Non applicable / personne externe",
    fullName: "Nom complet",
    email: "Adresse e-mail",
    phone: "Téléphone",
    country: "Pays de résidence",
    organization: "Organisation",
    jobTitle: "Fonction",
    category: "Catégorie de reconnaissance",
    initialStatus: "Statut initial",
    admissionDate: "Date d’admission",
    expiryDate: "Date d’expiration annuelle",
    contribution: "Contribution distinctive",
    internalNotes: "Notes internes",
    addToRegistry: "Ajouter au registre VIP",
    readOnlyRegistry: "Registre en lecture seule",
    readOnlyRegistryHelp: "Tu peux consulter le registre et prendre part aux décisions selon ton rôle. La saisie directe est réservée aux Administrateurs et aux RH.",
    vipRegistry: "Registre officiel",
    records: "dossier(s)",
    noMembers: "Aucun membre VIP n’est encore enregistré.",
    admitted: "Admis",
    expires: "Expire",
    updateStatus: "Mettre à jour le statut",
    editMemberRecord: "Modifier le dossier du membre",
    editMemberHelp: "Corrige les informations affichées dans le registre et sur la carte numérique. Toutes les modifications sont enregistrées dans le journal d’audit.",
    saveChangesOnly: "Enregistrer seulement",
    saveAndReissue: "Enregistrer et réémettre la carte",
    reissueExplanation: "Enregistrer seulement conserve la carte et son QR actuel. La réémission remplace la carte active, crée un nouveau numéro de carte et un nouveau QR, tout en conservant le numéro permanent du membre.",
    viewCard: "Voir la carte",
    noActiveCard: "Aucune carte active",
    requestRenewal: "Demander le renouvellement",
    cardRegistry: "Registre des cartes VIP",
    cardRegistryHelp: "Chaque émission conserve son historique. Le QR public ne révèle que les informations nécessaires à la vérification.",
    noCards: "Aucune carte VIP n’est encore enregistrée.",
    validFrom: "Valide du",
    validUntil: "Valide jusqu’au",
    openCard: "Ouvrir et imprimer la carte",
    newRenewal: "Nouvelle demande de renouvellement",
    newRenewalHelp: "Sélectionne le membre. Après approbation, Super Leader prolonge l’adhésion et émet automatiquement une nouvelle carte.",
    vipMember: "Membre VIP",
    selectMember: "Sélectionner un membre",
    renewalReason: "Motif ou observations",
    submitRenewal: "Transmettre la demande",
    renewalsReadOnly: "Renouvellements en lecture seule",
    renewalsReadOnlyHelp: "Tu peux examiner les demandes selon ton rôle. La création est réservée aux Administrateurs et aux RH.",
    renewalQueue: "Demandes et historique",
    noRenewals: "Aucune demande de renouvellement n’a encore été créée.",
    requestedBy: "Demandé par",
    noRenewalReason: "Aucune observation particulière.",
    openNewCard: "Ouvrir la nouvelle carte",
    approveRenewal: "Approuver et émettre la carte",
    newNomination: "Nouvelle nomination",
    newNominationHelp: "Présente une personne interne ou externe et explique précisément la contribution qui justifie sa reconnaissance.",
    relationship: "Lien avec l’organisation",
    evidence: "Preuves, références ou observations",
    submitNomination: "Transmettre au comité VIP",
    nominationHistory: "Historique des nominations",
    pending: "En attente",
    noNominations: "Aucune nomination n’a encore été soumise.",
    nominatedBy: "Proposé par",
    committeeNote: "Note du comité",
    committeeQueue: "Dossiers à examiner",
    committeeQueueHelp: "Les décisions finales créent automatiquement le dossier officiel du membre et une adhésion annuelle.",
    toReview: "à examiner",
    queueEmpty: "Le comité n’a aucun dossier en attente.",
    startReview: "Mettre en étude",
    requestInfo: "Demander des informations",
    approveAndCreate: "Approuver et créer le membre",
    reject: "Refuser",
    notProvided: "Non renseigné",
    unknown: "Utilisateur",
    categories: {
      distinguished_contributor: "Contributeur distinctif",
      partner: "Partenaire stratégique",
      ambassador: "Ambassadeur",
      investor: "Investisseur",
      honorary: "Membre honoraire",
      other: "Autre distinction",
    },
    statuses: {
      draft: "Brouillon",
      submitted: "Soumise",
      under_review: "En étude",
      needs_information: "Informations requises",
      approved: "Approuvée",
      rejected: "Refusée",
      withdrawn: "Retiré",
      active: "Actif",
      pending_renewal: "À renouveler",
      expired: "Expiré",
      suspended: "Suspendu",
      honorary: "Honoraire",
      replaced: "Remplacée",
      revoked: "Révoquée",
      cancelled: "Annulée",
      assigned: "Affecté",
      in_progress: "En cours",
      completed: "Terminé",
      confirmed: "Confirmé",
      planned: "Planifié",
    },
    memberStatusOptions: {
      active: "Actif",
      pending_renewal: "À renouveler",
      expired: "Expiré",
      suspended: "Suspendu",
      withdrawn: "Retiré",
      honorary: "Honoraire",
    },
    actions: {
      nomination_created: "Nomination créée",
      nomination_status_changed: "Statut de nomination modifié",
      nomination_approved: "Nomination approuvée",
      nomination_rejected: "Nomination refusée",
      member_created: "Membre VIP créé",
      member_status_changed: "Statut du membre modifié",
      member_updated: "Dossier du membre mis à jour",
      card_issued: "Carte VIP émise",
      card_reissued: "Carte VIP réémise",
      card_revoked: "Carte VIP révoquée",
      renewal_requested: "Renouvellement demandé",
      renewal_status_changed: "Statut du renouvellement modifié",
      renewal_approved: "Renouvellement approuvé",
      renewal_rejected: "Renouvellement refusé",
      travel_requested: "Déplacement VIP enregistré",
      travel_status_changed: "Statut du déplacement modifié",
      travel_approved: "Déplacement approuvé",
      travel_rejected: "Déplacement refusé",
      travel_assigned: "Responsable local affecté",
      travel_completed: "Accueil VIP terminé",
      travel_service_created: "Service d’accueil créé",
      travel_service_updated: "Service d’accueil mis à jour",
      travel_service_completed: "Service d’accueil terminé",
      country_representative_created: "Responsable pays créé",
      country_representative_updated: "Responsable pays mis à jour",
      annual_meeting_created: "Rencontre annuelle créée",
      annual_meeting_updated: "Rencontre annuelle mise à jour",
      annual_meeting_status_changed: "Statut de la rencontre annuelle modifié",
      annual_meeting_invitation_created: "Invitation à la rencontre créée",
      annual_meeting_invitation_status_changed: "Invitation à la rencontre mise à jour",
      annual_meeting_bulk_invited: "Invitations générales créées",
      annual_meeting_agenda_created: "Session du programme créée",
      annual_meeting_agenda_updated: "Session du programme mise à jour",
      partner_created: "Partenaire VIP créé",
      partner_updated: "Partenaire VIP mis à jour",
      partner_status_changed: "Statut du partenaire modifié",
      benefit_created: "Avantage VIP créé",
      benefit_updated: "Avantage VIP mis à jour",
      benefit_status_changed: "Statut de l’avantage modifié",
      benefit_redemption_requested: "Utilisation d’avantage demandée",
      benefit_redemption_approved: "Utilisation d’avantage approuvée",
      benefit_redemption_rejected: "Utilisation d’avantage refusée",
      benefit_redeemed: "Avantage utilisé",
      benefit_redemption_cancelled: "Utilisation d’avantage annulée",
    },
  },
  en: {
    setupTitle: "Supabase migration required",
    setupText: "Run the VIP Phase 1 migration in Supabase before using the registry and approvals.",
    setupPhase2Title: "Cards & renewals migration required",
    setupPhase2Text: "Run the VIP V3.2.2 migration in Supabase to activate digital cards, public QR verification and annual renewals.",
    eyebrow: "International recognition",
    subtitle: "Manage distinctive contributors, cards, international mobility and VIP welcome in a secure, auditable programme.",
    phaseActive: "Phase 4 active",
    vipNavigation: "Super Leader VIP navigation",
    overview: "Overview",
    members: "VIP members",
    nominations: "Nominations",
    approvals: "Committee & approvals",
    cards: "VIP cards",
    renewals: "Renewals",
    activeMembers: "Active members",
    activeCards: "Active cards",
    pendingNominations: "Pending nominations",
    pendingRenewals: "Pending renewals",
    expiringSoon: "Expiring within 90 days",
    countriesRepresented: "Countries represented",
    phaseOneTitle: "The international VIP programme is fully operational",
    phaseOneText: "Records, cards, renewals, travel, country welcome and the annual gathering are now active and auditable.",
    active: "Active",
    membersHelp: "Create and monitor internal and external member records.",
    nominationsHelp: "Submit a distinctive contribution to the VIP committee.",
    approvalsHelp: "Review, request details, approve or reject.",
    cardsHelp: "View, print, verify, reissue or revoke annual cards.",
    renewalsHelp: "Submit and decide renewals with automatic issue of a new card.",
    travelHelp: "Record trips, approve requests and assign a local representative.",
    countryWelcome: "Country welcome",
    countryWelcomeHelp: "Coordinate representatives, providers and services promised to the member.",
    annualMeetingHelp: "Choose the host country, invite members and organise the annual programme.",
    recentActivity: "Recent activity",
    noActivity: "No VIP activity has been recorded yet.",
    fieldsChanged: "Changed fields",
    memberFieldLabels: {
      full_name: "Full name",
      email: "Email address",
      phone: "Phone",
      country: "Country",
      organization_name: "Organisation",
      job_title: "Position",
      recognition_category: "Category",
      contribution_summary: "Distinctive contribution",
      admission_date: "Admission date",
      expires_on: "Expiry date",
      notes: "Internal notes",
    },
    nextPhases: "Governance and communications",
    nextPhasesText: "All core VIP modules are now active, including governance settings.",
    twoActive: "3 active modules",
    soon: "Coming soon",
    cardsRenewals: "Cards & renewals",
    internationalTravel: "International travel",
    annualMeeting: "Annual gathering",
    partnerNetwork: "Benefits & partners",
    partnerNetworkHelp: "Manage privileges, partners by country and the tracking of every redemption.",
    vipCommunications: "VIP communications",
    vipCommunicationsHelp: "Prepare messages, target audiences and track each delivery.",
    vipReports: "VIP reports",
    vipReportsHelp: "Consolidate programme indicators, alerts and outcomes.",
    vipSettings: "VIP settings",
    vipSettingsHelp: "Programme rules, cards, renewals, categories and operating options.",
    addExistingMember: "Add an existing member",
    addExistingMemberHelp: "Use this form to import VIP members recognised before the nomination workflow was introduced.",
    memberType: "Member type",
    nomineeType: "Person type",
    external: "External",
    internal: "Internal",
    internalPerson: "Linked internal employee",
    notApplicable: "Not applicable / external person",
    fullName: "Full name",
    email: "Email address",
    phone: "Phone",
    country: "Country of residence",
    organization: "Organisation",
    jobTitle: "Position",
    category: "Recognition category",
    initialStatus: "Initial status",
    admissionDate: "Admission date",
    expiryDate: "Annual expiry date",
    contribution: "Distinctive contribution",
    internalNotes: "Internal notes",
    addToRegistry: "Add to VIP registry",
    readOnlyRegistry: "Read-only registry",
    readOnlyRegistryHelp: "You may view the registry and participate in decisions according to your role. Direct entry is reserved for Administrators and HR.",
    vipRegistry: "Official registry",
    records: "record(s)",
    noMembers: "No VIP member has been registered yet.",
    admitted: "Admitted",
    expires: "Expires",
    updateStatus: "Update status",
    editMemberRecord: "Edit member record",
    editMemberHelp: "Correct the information shown in the registry and on the digital card. Every change is recorded in the audit log.",
    saveChangesOnly: "Save changes only",
    saveAndReissue: "Save and reissue card",
    reissueExplanation: "Saving only keeps the current card and QR. Reissuing replaces the active card, creates a new card number and QR, while preserving the member’s permanent number.",
    viewCard: "View card",
    noActiveCard: "No active card",
    requestRenewal: "Request renewal",
    cardRegistry: "VIP card registry",
    cardRegistryHelp: "Every issue remains in history. The public QR only reveals the information required for verification.",
    noCards: "No VIP card has been registered yet.",
    validFrom: "Valid from",
    validUntil: "Valid until",
    openCard: "Open and print card",
    newRenewal: "New renewal request",
    newRenewalHelp: "Select the member. Once approved, Super Leader extends the membership and automatically issues a new card.",
    vipMember: "VIP member",
    selectMember: "Select a member",
    renewalReason: "Reason or observations",
    submitRenewal: "Submit request",
    renewalsReadOnly: "Read-only renewals",
    renewalsReadOnlyHelp: "You may review requests according to your role. Creation is reserved for Administrators and HR.",
    renewalQueue: "Requests and history",
    noRenewals: "No renewal request has been created yet.",
    requestedBy: "Requested by",
    noRenewalReason: "No particular observation.",
    openNewCard: "Open new card",
    approveRenewal: "Approve and issue card",
    newNomination: "New nomination",
    newNominationHelp: "Present an internal or external person and explain precisely the contribution that justifies recognition.",
    relationship: "Relationship to the organisation",
    evidence: "Evidence, references or observations",
    submitNomination: "Send to VIP committee",
    nominationHistory: "Nomination history",
    pending: "Pending",
    noNominations: "No nomination has been submitted yet.",
    nominatedBy: "Nominated by",
    committeeNote: "Committee note",
    committeeQueue: "Cases to review",
    committeeQueueHelp: "Final approval automatically creates the official member record and a one-year membership.",
    toReview: "to review",
    queueEmpty: "The committee has no pending cases.",
    startReview: "Start review",
    requestInfo: "Request information",
    approveAndCreate: "Approve and create member",
    reject: "Reject",
    notProvided: "Not provided",
    unknown: "User",
    categories: {
      distinguished_contributor: "Distinctive contributor",
      partner: "Strategic partner",
      ambassador: "Ambassador",
      investor: "Investor",
      honorary: "Honorary member",
      other: "Other distinction",
    },
    statuses: {
      draft: "Draft",
      submitted: "Submitted",
      under_review: "Under review",
      needs_information: "Information required",
      approved: "Approved",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
      active: "Active",
      pending_renewal: "Renewal due",
      expired: "Expired",
      suspended: "Suspended",
      honorary: "Honorary",
      replaced: "Replaced",
      revoked: "Revoked",
      cancelled: "Cancelled",
      assigned: "Assigned",
      in_progress: "In progress",
      completed: "Completed",
      confirmed: "Confirmed",
      planned: "Planned",
    },
    memberStatusOptions: {
      active: "Active",
      pending_renewal: "Renewal due",
      expired: "Expired",
      suspended: "Suspended",
      withdrawn: "Withdrawn",
      honorary: "Honorary",
    },
    actions: {
      nomination_created: "Nomination created",
      nomination_status_changed: "Nomination status changed",
      nomination_approved: "Nomination approved",
      nomination_rejected: "Nomination rejected",
      member_created: "VIP member created",
      member_status_changed: "Member status changed",
      member_updated: "Member record updated",
      card_issued: "VIP card issued",
      card_reissued: "VIP card reissued",
      card_revoked: "VIP card revoked",
      renewal_requested: "Renewal requested",
      renewal_status_changed: "Renewal status changed",
      renewal_approved: "Renewal approved",
      renewal_rejected: "Renewal rejected",
      travel_requested: "VIP trip recorded",
      travel_status_changed: "Travel status changed",
      travel_approved: "Trip approved",
      travel_rejected: "Trip rejected",
      travel_assigned: "Local representative assigned",
      travel_completed: "VIP welcome completed",
      travel_service_created: "Welcome service created",
      travel_service_updated: "Welcome service updated",
      travel_service_completed: "Welcome service completed",
      country_representative_created: "Country representative created",
      country_representative_updated: "Country representative updated",
      annual_meeting_created: "Annual gathering created",
      annual_meeting_updated: "Annual gathering updated",
      annual_meeting_status_changed: "Annual gathering status changed",
      annual_meeting_invitation_created: "Gathering invitation created",
      annual_meeting_invitation_status_changed: "Gathering invitation updated",
      annual_meeting_bulk_invited: "Bulk gathering invitations created",
      annual_meeting_agenda_created: "Programme session created",
      annual_meeting_agenda_updated: "Programme session updated",
      partner_created: "VIP partner created",
      partner_updated: "VIP partner updated",
      partner_status_changed: "Partner status changed",
      benefit_created: "VIP benefit created",
      benefit_updated: "VIP benefit updated",
      benefit_status_changed: "Benefit status changed",
      benefit_redemption_requested: "Benefit redemption requested",
      benefit_redemption_approved: "Benefit redemption approved",
      benefit_redemption_rejected: "Benefit redemption rejected",
      benefit_redeemed: "Benefit redeemed",
      benefit_redemption_cancelled: "Benefit redemption cancelled",
    },
  },
} as const;
