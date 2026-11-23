import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {saveVipProgramSettingsAction, saveVipRecognitionCategoryAction} from "@/app/actions/vip-settings";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings, getVipRecognitionCategories, VIP_COMMUNICATION_CHANNELS, VIP_SERVICE_TYPES} from "@/lib/vip/settings";
import {APP_VERSION} from "@/lib/app-version";

const SETTINGS_ROLES = ["owner", "admin"];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Field({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return <label className="block"><span className="text-sm font-black text-slate-800">{label}</span>{hint ? <span className="ml-2 text-xs text-slate-500">{hint}</span> : null}<div className="mt-2">{children}</div></label>;
}

const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-rose-500 focus:ring-4 focus:ring-rose-100";
const checkClass = "h-4 w-4 rounded border-slate-300 text-rose-700 focus:ring-rose-500";

export default async function VipSettingsPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const params = await searchParams;
  const view = first(params.view) === "categories" ? "categories" : "program";
  const success = first(params.success);
  const errorMessage = first(params.error);

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
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  if (!SETTINGS_ROLES.includes(membership.role)) redirect("/dashboard/vip");

  const schemaCheck = await admin.from("vip_program_settings").select("organization_id,vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-5xl"><header className="rounded-3xl bg-slate-950 p-8 text-white"><p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION}</p><h1 className="mt-2 text-4xl font-black">{c.title}</h1></header><section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7"><h2 className="text-2xl font-black text-amber-950">{c.migrationRequired}</h2><p className="mt-3 text-amber-900">{c.migrationHelp}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/119_vip_growth_membership_manager_v4_8_77.sql</code></section></div></main>;
  }

  const [settings, categories, managerSettingsResult, orgMembersResult, profilesResult] = await Promise.all([
    getVipProgramSettings(admin, membership.organization_id),
    getVipRecognitionCategories(admin, membership.organization_id),
    admin.from("vip_program_settings").select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id,vip_communications_assistant_user_id,vip_events_travel_assistant_user_id,vip_benefits_partners_assistant_user_id,vip_membership_concierge_assistant_user_id,vip_operations_require_backup_for_critical,vip_operations_escalation_hours").eq("organization_id", membership.organization_id).maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_growth_membership_manager_user_id: string | null; vip_communications_assistant_user_id: string | null; vip_events_travel_assistant_user_id: string | null; vip_benefits_partners_assistant_user_id: string | null; vip_membership_concierge_assistant_user_id: string | null; vip_operations_require_backup_for_critical: boolean | null; vip_operations_escalation_hours: number | null}>(),
    admin.from("organization_members").select("user_id,role").eq("organization_id", membership.organization_id).eq("is_active", true).order("role"),
    admin.from("profiles").select("id,full_name,email"),
  ]);
  if (managerSettingsResult.error) throw new Error(managerSettingsResult.error.message);
  if (orgMembersResult.error) throw new Error(orgMembersResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const managerProfiles = (profilesResult.data ?? []) as Array<{id: string; full_name: string | null; email: string | null}>;
  const activeOrgMembers = (orgMembersResult.data ?? []) as Array<{user_id: string; role: string}>;
  const profileMap = new Map(managerProfiles.map((profile) => [profile.id, profile]));
  const managerCandidates = activeOrgMembers.map((member) => ({
    userId: member.user_id,
    role: member.role,
    name: profileMap.get(member.user_id)?.full_name || profileMap.get(member.user_id)?.email || member.user_id,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const selectedVipManagerId = managerSettingsResult.data?.vip_manager_user_id ?? "";
  const selectedVipAssistantManagerId = managerSettingsResult.data?.vip_assistant_manager_user_id ?? "";
  const selectedVipGrowthMembershipManagerId = managerSettingsResult.data?.vip_growth_membership_manager_user_id ?? "";
  const selectedVipCommunicationsAssistantId = managerSettingsResult.data?.vip_communications_assistant_user_id ?? "";
  const selectedVipEventsTravelAssistantId = managerSettingsResult.data?.vip_events_travel_assistant_user_id ?? "";
  const selectedVipBenefitsPartnersAssistantId = managerSettingsResult.data?.vip_benefits_partners_assistant_user_id ?? "";
  const selectedVipMembershipConciergeAssistantId = managerSettingsResult.data?.vip_membership_concierge_assistant_user_id ?? "";
  const vipOperationsRequireBackupForCritical = managerSettingsResult.data?.vip_operations_require_backup_for_critical ?? true;
  const vipOperationsEscalationHours = managerSettingsResult.data?.vip_operations_escalation_hours ?? 24;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V{APP_VERSION}</p>
          <h1 className="mt-2 text-4xl font-black">{c.title}</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-300">{c.subtitle}</p>
        </header>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-900">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-900">{errorMessage}</p> : null}

        <nav className="mt-6 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <Link href="/dashboard/vip/settings?view=program" className={`rounded-xl px-5 py-3 font-black ${view === "program" ? "bg-rose-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{c.programTab}</Link>
          <Link href="/dashboard/vip/settings?view=categories" className={`rounded-xl px-5 py-3 font-black ${view === "categories" ? "bg-rose-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{c.categoriesTab}</Link>
        </nav>

        {view === "program" ? (
          <form action={saveVipProgramSettingsAction} className="mt-6 space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.identity}</h2>
              <p className="mt-2 text-sm text-slate-600">{c.identityHelp}</p>
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5">
                <h3 className="text-lg font-black text-rose-950">{c.vipGovernance}</h3>
                <p className="mt-1 text-sm text-rose-800">{c.vipGovernanceHelp}</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label={c.vipManager} hint={c.vipManagerHint}>
                    <select name="vipManagerUserId" defaultValue={selectedVipManagerId} className={inputClass}>
                      <option value="">{c.noVipManager}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                  <Field label={c.vipAssistantManager} hint={c.vipAssistantManagerHint}>
                    <select name="vipAssistantManagerUserId" defaultValue={selectedVipAssistantManagerId} className={inputClass}>
                      <option value="">{c.noVipAssistantManager}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                  <Field label={c.vipGrowthMembershipManager} hint={c.vipGrowthMembershipManagerHint}>
                    <select name="vipGrowthMembershipManagerUserId" defaultValue={selectedVipGrowthMembershipManagerId} className={inputClass}>
                      <option value="">{c.noVipGrowthMembershipManager}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                  <Field label={c.vipCommunicationsAssistant} hint={c.specializedAssistantHint}>
                    <select name="vipCommunicationsAssistantUserId" defaultValue={selectedVipCommunicationsAssistantId} className={inputClass}>
                      <option value="">{c.noSpecializedAssistant}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                  <Field label={c.vipEventsTravelAssistant} hint={c.specializedAssistantHint}>
                    <select name="vipEventsTravelAssistantUserId" defaultValue={selectedVipEventsTravelAssistantId} className={inputClass}>
                      <option value="">{c.noSpecializedAssistant}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                  <Field label={c.vipBenefitsPartnersAssistant} hint={c.specializedAssistantHint}>
                    <select name="vipBenefitsPartnersAssistantUserId" defaultValue={selectedVipBenefitsPartnersAssistantId} className={inputClass}>
                      <option value="">{c.noSpecializedAssistant}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                  <Field label={c.vipMembershipConciergeAssistant} hint={c.specializedAssistantHint}>
                    <select name="vipMembershipConciergeAssistantUserId" defaultValue={selectedVipMembershipConciergeAssistantId} className={inputClass}>
                      <option value="">{c.noSpecializedAssistant}</option>
                      {managerCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="mt-5 grid gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-[1fr_220px_auto] md:items-end">
                  <div>
                    <p className="font-black text-amber-950">{c.continuityTitle}</p>
                    <p className="mt-1 text-sm text-amber-800">{c.continuityHelp}</p>
                  </div>
                  <Field label={c.escalationHours}>
                    <input name="vipOperationsEscalationHours" type="number" min={1} max={168} defaultValue={vipOperationsEscalationHours} className={inputClass} />
                  </Field>
                  <label className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-amber-950"><input type="checkbox" name="vipOperationsRequireBackupForCritical" defaultChecked={vipOperationsRequireBackupForCritical} />{c.backupCritical}</label>
                </div>
                <div className="mt-4"><Link href="/dashboard/vip/operations" className="inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{c.openOperations}</Link></div>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label={c.programName}><input name="programName" required minLength={3} maxLength={120} defaultValue={settings.program_name} className={inputClass} /></Field>
                <div />
                <Field label={c.circleTitleFr}><input name="circleTitleFr" required maxLength={180} defaultValue={settings.circle_title_fr} className={inputClass} /></Field>
                <Field label={c.circleTitleEn}><input name="circleTitleEn" required maxLength={180} defaultValue={settings.circle_title_en} className={inputClass} /></Field>
                <Field label={c.cardSubtitleFr}><input name="cardSubtitleFr" required maxLength={180} defaultValue={settings.card_subtitle_fr} className={inputClass} /></Field>
                <Field label={c.cardSubtitleEn}><input name="cardSubtitleEn" required maxLength={180} defaultValue={settings.card_subtitle_en} className={inputClass} /></Field>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.membershipRules}</h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label={c.cardValidity}><input name="cardValidityMonths" type="number" min={1} max={60} defaultValue={settings.card_validity_months} className={inputClass} /></Field>
                  <Field label={c.renewalGrace}><input name="renewalGraceDays" type="number" min={0} max={365} defaultValue={settings.renewal_grace_days} className={inputClass} /></Field>
                </div>
                <fieldset className="mt-5"><legend className="text-sm font-black">{c.renewalNotices}</legend><div className="mt-3 flex flex-wrap gap-3">{[365,180,120,90,60,45,30,21,14,7,3,1].map((day) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"><input type="checkbox" name="renewalNoticeDays" value={day} defaultChecked={settings.renewal_notice_days.includes(day)} className={checkClass} />{day} {c.days}</label>)}</div></fieldset>
                <div className="mt-5 space-y-3">
                  <label className="flex items-start gap-3"><input type="checkbox" name="nominationRequiresEvidence" defaultChecked={settings.nomination_requires_evidence} className={`${checkClass} mt-1`} /><span><strong>{c.requireEvidence}</strong><span className="block text-sm text-slate-500">{c.requireEvidenceHelp}</span></span></label>
                  <label className="flex items-start gap-3"><input type="checkbox" name="nominationRequiresCommitteeApproval" defaultChecked={settings.nomination_requires_committee_approval} className={`${checkClass} mt-1`} /><span><strong>{c.requireCommittee}</strong><span className="block text-sm text-slate-500">{c.requireCommitteeHelp}</span></span></label>
                  <label className="flex items-start gap-3"><input type="checkbox" name="publicCardVerificationEnabled" defaultChecked={settings.public_card_verification_enabled} className={`${checkClass} mt-1`} /><span><strong>{c.publicVerification}</strong><span className="block text-sm text-slate-500">{c.publicVerificationHelp}</span></span></label>
                  <label className="flex items-start gap-3"><input type="checkbox" name="memberPortalEnabled" defaultChecked={settings.member_portal_enabled} className={`${checkClass} mt-1`} /><span><strong>{c.memberPortal}</strong><span className="block text-sm text-slate-500">{c.memberPortalHelp}</span></span></label>
                </div>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{c.operations}</h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label={c.travelNotice}><input name="travelMinNoticeDays" type="number" min={0} max={365} defaultValue={settings.travel_min_notice_days} className={inputClass} /></Field>
                  <Field label={c.meetingDuration}><input name="annualMeetingDefaultDurationDays" type="number" min={1} max={60} defaultValue={settings.annual_meeting_default_duration_days} className={inputClass} /></Field>
                  <Field label={c.benefitApproval}><select name="benefitDefaultApprovalMode" defaultValue={settings.benefit_default_approval_mode} className={inputClass}><option value="manual">{c.manual}</option><option value="automatic">{c.automatic}</option></select></Field>
                </div>
                <div className="mt-5 space-y-3">
                  <label className="flex items-start gap-3"><input type="checkbox" name="requireTravelConsent" defaultChecked={settings.require_travel_consent} className={`${checkClass} mt-1`} /><span><strong>{c.travelConsent}</strong><span className="block text-sm text-slate-500">{c.travelConsentHelp}</span></span></label>
                  <label className="flex items-start gap-3"><input type="checkbox" name="autoAssignCountryRepresentative" defaultChecked={settings.auto_assign_country_representative} className={`${checkClass} mt-1`} /><span><strong>{c.autoAssign}</strong><span className="block text-sm text-slate-500">{c.autoAssignHelp}</span></span></label>
                </div>

                <fieldset className="mt-6"><legend className="text-sm font-black">{c.enabledServices}</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{VIP_SERVICE_TYPES.map((service) => <label key={service} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"><input type="checkbox" name="enabledTravelServices" value={service} defaultChecked={settings.enabled_travel_services.includes(service)} className={checkClass} />{c.services[service]}</label>)}</div></fieldset>
                <fieldset className="mt-6"><legend className="text-sm font-black">{c.defaultChannels}</legend><div className="mt-3 flex flex-wrap gap-3">{VIP_COMMUNICATION_CHANNELS.map((channel) => <label key={channel} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"><input type="checkbox" name="communicationDefaultChannels" value={channel} defaultChecked={settings.communication_default_channels.includes(channel)} className={checkClass} />{c.channels[channel]}</label>)}</div></fieldset>
              </article>
            </section>

            <button type="submit" className="w-full rounded-2xl bg-rose-700 px-6 py-4 text-lg font-black text-white shadow-lg hover:bg-rose-800">{c.saveProgram}</button>
          </form>
        ) : (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <form action={saveVipRecognitionCategoryAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{c.newCategory}</h2>
              <p className="mt-2 text-sm text-slate-600">{c.newCategoryHelp}</p>
              <div className="mt-5 space-y-4">
                <Field label={c.code} hint={c.codeHint}><input name="code" required pattern="[a-z][a-z0-9_]{1,49}" maxLength={50} className={inputClass} /></Field>
                <Field label={c.nameFr}><input name="nameFr" required maxLength={140} className={inputClass} /></Field>
                <Field label={c.nameEn}><input name="nameEn" required maxLength={140} className={inputClass} /></Field>
                <Field label={c.descriptionFr}><textarea name="descriptionFr" rows={3} maxLength={1000} className={inputClass} /></Field>
                <Field label={c.descriptionEn}><textarea name="descriptionEn" rows={3} maxLength={1000} className={inputClass} /></Field>
                <Field label={c.sortOrder}><input name="sortOrder" type="number" min={0} max={9999} defaultValue={100} className={inputClass} /></Field>
                <label className="flex items-center gap-3"><input type="checkbox" name="isHonorary" className={checkClass} /><span className="font-bold">{c.honoraryCategory}</span></label>
                <label className="flex items-center gap-3"><input type="checkbox" name="isActive" defaultChecked className={checkClass} /><span className="font-bold">{c.activeCategory}</span></label>
              </div>
              <button type="submit" className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{c.createCategory}</button>
            </form>

            <div className="space-y-4">
              {categories.map((category) => (
                <form key={category.id || category.code} action={saveVipRecognitionCategoryAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <input type="hidden" name="categoryId" value={category.id} />
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xl font-black">{fr ? category.name_fr : category.name_en}</h3><p className="font-mono text-xs font-bold text-rose-700">{category.code}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${category.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{category.is_active ? c.active : c.inactive}</span></div>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <Field label={c.code} hint={c.codeImmutable}><input name="code" required readOnly maxLength={50} defaultValue={category.code} className={`${inputClass} bg-slate-100 text-slate-600`} /></Field>
                    <Field label={c.sortOrder}><input name="sortOrder" type="number" min={0} max={9999} defaultValue={category.sort_order} className={inputClass} /></Field>
                    <Field label={c.nameFr}><input name="nameFr" required maxLength={140} defaultValue={category.name_fr} className={inputClass} /></Field>
                    <Field label={c.nameEn}><input name="nameEn" required maxLength={140} defaultValue={category.name_en} className={inputClass} /></Field>
                    <Field label={c.descriptionFr}><textarea name="descriptionFr" rows={2} maxLength={1000} defaultValue={category.description_fr ?? ""} className={inputClass} /></Field>
                    <Field label={c.descriptionEn}><textarea name="descriptionEn" rows={2} maxLength={1000} defaultValue={category.description_en ?? ""} className={inputClass} /></Field>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-5"><label className="flex items-center gap-2"><input type="checkbox" name="isHonorary" defaultChecked={category.is_honorary} className={checkClass} /><span className="font-bold">{c.honoraryCategory}</span></label><label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={category.is_active} className={checkClass} /><span className="font-bold">{c.activeCategory}</span></label></div>
                  <button type="submit" className="mt-5 rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{c.saveCategory}</button>
                </form>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

const copy = {
  fr: {
    title: "Paramètres VIP", subtitle: "Centralise les règles, l’identité et les options opérationnelles du programme Super Leader VIP.", migrationRequired: "Migration Paramètres VIP requise", migrationHelp: "Exécute la migration suivante dans Supabase avant d’ouvrir cette rubrique.", programTab: "Programme et règles", categoriesTab: "Catégories de reconnaissance", identity: "Identité du programme", identityHelp: "Ces textes apparaissent sur les cartes et dans les interfaces VIP.", vipGovernance: "Gouvernance VIP", vipGovernanceHelp: "Attribue les responsabilités de gouvernance, de croissance commerciale et d’opérations VIP sans modifier les rôles organisationnels.", vipManager: "VIP Manager", vipManagerHint: "Membre actif de l’organisation", noVipManager: "Aucun VIP Manager attribué", vipAssistantManager: "VIP Assistant Manager", vipAssistantManagerHint: "Adjoint opérationnel du VIP Manager", noVipAssistantManager: "Aucun VIP Assistant Manager attribué", vipGrowthMembershipManager: "Responsable Croissance & Adhésions VIP", vipGrowthMembershipManagerHint: "Acquisition, conversion, renouvellement et développement de la communauté payante", noVipGrowthMembershipManager: "Aucun responsable Croissance & Adhésions attribué", vipCommunicationsAssistant: "Assistant Communications VIP", vipEventsTravelAssistant: "Assistant Events & Travel VIP", vipBenefitsPartnersAssistant: "Assistant Benefits & Partners VIP", vipMembershipConciergeAssistant: "Assistant Membership & Concierge VIP", specializedAssistantHint: "Responsabilité VIP spécialisée, sans modifier le rôle organisationnel", noSpecializedAssistant: "Aucun assistant spécialisé attribué", continuityTitle: "Continuité opérationnelle", continuityHelp: "Les tâches critiques peuvent exiger un remplaçant et remonter automatiquement dans le centre opérationnel lorsqu’elles dépassent leur échéance.", escalationHours: "Délai d’escalade (heures)", backupCritical: "Backup obligatoire pour les tâches critiques", openOperations: "Ouvrir le centre opérationnel VIP", programName: "Nom du programme", circleTitleFr: "Titre du cercle — français", circleTitleEn: "Titre du cercle — anglais", cardSubtitleFr: "Sous-titre de la carte — français", cardSubtitleEn: "Sous-titre de la carte — anglais", membershipRules: "Adhésion, cartes et renouvellements", cardValidity: "Durée de validité de la carte (mois)", renewalGrace: "Délai de grâce après expiration (jours)", renewalNotices: "Alertes avant expiration", days: "jours", requireEvidence: "Preuve obligatoire pour une nomination", requireEvidenceHelp: "Le dossier doit contenir une justification ou une preuve de contribution.", requireCommittee: "Approbation du comité obligatoire", requireCommitteeHelp: "Empêche une admission directe sans décision formelle.", publicVerification: "Vérification publique des cartes active", publicVerificationHelp: "Autorise le QR code à ouvrir la page publique de validation.", memberPortal: "Portail personnel VIP actif", memberPortalHelp: "Prépare l’accès direct des membres à leur carte et à leurs services.", operations: "Voyages, avantages et communications", travelNotice: "Préavis minimal de voyage (jours)", meetingDuration: "Durée par défaut de la rencontre annuelle (jours)", benefitApproval: "Approbation par défaut des avantages", manual: "Manuelle", automatic: "Automatique", travelConsent: "Consentement au partage obligatoire", travelConsentHelp: "Le membre doit autoriser le partage de son déplacement avec l’équipe locale.", autoAssign: "Affectation automatique du responsable pays", autoAssignHelp: "Le responsable principal du pays est affecté dès l’approbation.", enabledServices: "Services d’accueil disponibles", defaultChannels: "Canaux par défaut des communications", saveProgram: "Enregistrer les paramètres VIP", newCategory: "Nouvelle catégorie", newCategoryHelp: "Ajoute une catégorie utilisable dans les membres, nominations et communications.", code: "Code technique", codeHint: "minuscules et underscores", codeImmutable: "immuable après création", nameFr: "Nom français", nameEn: "Nom anglais", descriptionFr: "Description française", descriptionEn: "Description anglaise", sortOrder: "Ordre d’affichage", honoraryCategory: "Catégorie honoraire", activeCategory: "Catégorie active", createCategory: "Créer la catégorie", saveCategory: "Enregistrer", active: "Active", inactive: "Inactive",
    services: {airport_welcome: "Accueil à l’aéroport ou à la gare", local_transport: "Transport local", accommodation_guidance: "Assistance hébergement", office_visit: "Visite d’un bureau iLEAD", leadership_meeting: "Rencontre avec les responsables", event_invitation: "Invitation à une activité", local_assistance: "Assistance locale", other: "Autre service"},
    channels: {manual: "Suivi manuel", email: "E-mail", whatsapp: "WhatsApp", in_person: "Remise en personne"},
  },
  en: {
    title: "VIP settings", subtitle: "Centralise the identity, governance rules and operating options of the Super Leader VIP programme.", migrationRequired: "VIP settings migration required", migrationHelp: "Run the following migration in Supabase before opening this module.", programTab: "Programme and rules", categoriesTab: "Recognition categories", identity: "Programme identity", identityHelp: "These texts appear on VIP cards and interfaces.", vipGovernance: "VIP governance", vipGovernanceHelp: "Assign VIP governance, commercial growth and operating responsibilities without changing organization roles.", vipManager: "VIP Manager", vipManagerHint: "Active organization member", noVipManager: "No VIP Manager assigned", vipAssistantManager: "VIP Assistant Manager", vipAssistantManagerHint: "Operational deputy to the VIP Manager", noVipAssistantManager: "No VIP Assistant Manager assigned", vipGrowthMembershipManager: "VIP Growth & Membership Manager", vipGrowthMembershipManagerHint: "Acquisition, conversion, renewals and growth of the paying VIP community", noVipGrowthMembershipManager: "No VIP Growth & Membership Manager assigned", vipCommunicationsAssistant: "VIP Communications Assistant", vipEventsTravelAssistant: "VIP Events & Travel Assistant", vipBenefitsPartnersAssistant: "VIP Benefits & Partners Assistant", vipMembershipConciergeAssistant: "VIP Membership & Concierge Assistant", specializedAssistantHint: "Specialized VIP responsibility without changing the organization role", noSpecializedAssistant: "No specialized assistant assigned", continuityTitle: "Operational continuity", continuityHelp: "Critical tasks can require a backup and surface automatically in the operations center when overdue.", escalationHours: "Escalation delay (hours)", backupCritical: "Backup required for critical tasks", openOperations: "Open VIP operations center", programName: "Programme name", circleTitleFr: "Circle title — French", circleTitleEn: "Circle title — English", cardSubtitleFr: "Card subtitle — French", cardSubtitleEn: "Card subtitle — English", membershipRules: "Membership, cards and renewals", cardValidity: "Card validity (months)", renewalGrace: "Grace period after expiry (days)", renewalNotices: "Expiry reminders", days: "days", requireEvidence: "Evidence required for nominations", requireEvidenceHelp: "The file must include a contribution justification or evidence.", requireCommittee: "Committee approval required", requireCommitteeHelp: "Prevents admission without a formal decision.", publicVerification: "Public card verification enabled", publicVerificationHelp: "Allows the QR code to open the public verification page.", memberPortal: "VIP member portal enabled", memberPortalHelp: "Prepares direct member access to cards and services.", operations: "Travel, benefits and communications", travelNotice: "Minimum travel notice (days)", meetingDuration: "Default annual meeting duration (days)", benefitApproval: "Default benefit approval", manual: "Manual", automatic: "Automatic", travelConsent: "Travel sharing consent required", travelConsentHelp: "The member must authorise sharing trip information with the local team.", autoAssign: "Automatically assign country representative", autoAssignHelp: "Assigns the country’s primary representative upon approval.", enabledServices: "Available welcome services", defaultChannels: "Default communication channels", saveProgram: "Save VIP settings", newCategory: "New category", newCategoryHelp: "Add a category for members, nominations and communications.", code: "Technical code", codeHint: "lowercase and underscores", codeImmutable: "locked after creation", nameFr: "French name", nameEn: "English name", descriptionFr: "French description", descriptionEn: "English description", sortOrder: "Display order", honoraryCategory: "Honorary category", activeCategory: "Active category", createCategory: "Create category", saveCategory: "Save", active: "Active", inactive: "Inactive",
    services: {airport_welcome: "Airport or station welcome", local_transport: "Local transport", accommodation_guidance: "Accommodation assistance", office_visit: "iLEAD office visit", leadership_meeting: "Leadership meeting", event_invitation: "Event invitation", local_assistance: "Local assistance", other: "Other service"},
    channels: {manual: "Manual tracking", email: "Email", whatsapp: "WhatsApp", in_person: "In-person delivery"},
  },
} as const;
