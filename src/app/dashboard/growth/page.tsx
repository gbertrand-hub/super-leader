import Link from "next/link";
import {redirect} from "next/navigation";
import {
  cancelDevelopmentActivityAction,
  cancelImpactContributionAction,
  createDevelopmentActivityAction,
  createImpactContributionAction,
  reviewDevelopmentActivityAction,
  reviewImpactContributionAction,
  updateGrowthSettingsAction,
  upsertGrowthPlanAction,
} from "@/app/actions/growth";
import {SecureAttachmentUpload} from "@/components/forms/secure-attachment-upload";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {month?: string | string[]; member?: string | string[]; success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type MemberRow = {user_id: string; role: string};
type SettingsRow = {
  default_monthly_target_hours: number | string;
  target_credits: number | string;
  bonus_weight: number | string;
  max_monthly_credits: number | string;
  night_start_time: string;
  night_end_time: string;
  wellbeing_warning_hours: number | string;
  default_development_target_hours: number | string;
  default_reading_target_hours: number | string;
  development_credit_per_hour: number | string;
  reading_credit_per_hour: number | string;
  max_development_credits: number | string;
};
type PlanRow = {
  user_id: string;
  plan_month: string;
  target_hours: number | string;
  target_credits: number | string;
  target_development_hours: number | string;
  target_reading_hours: number | string;
  focus_skill: string;
  objective: string;
  status: string;
};
type ContributionRow = {
  id: string;
  user_id: string;
  contribution_date: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  timezone: string;
  duration_minutes: number;
  night_minutes: number;
  weekend_minutes: number;
  category: string;
  title: string;
  description: string;
  skill_developed: string;
  beneficiary: string | null;
  result_summary: string;
  claimed_impact: string;
  validated_impact: string | null;
  status: string;
  approved_minutes: number | null;
  growth_credits: number | string;
  payroll_treatment: string;
  evidence_url: string | null;
  proof_storage_path: string | null;
  proof_file_name: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type DevelopmentActivityRow = {
  id: string;
  user_id: string;
  activity_date: string;
  source: string;
  program_code: string;
  title: string;
  author: string | null;
  start_time: string | null;
  end_time: string | null;
  crosses_midnight: boolean;
  timezone: string;
  duration_minutes: number;
  night_minutes: number;
  weekend_minutes: number;
  status: string;
  approved_minutes: number | null;
  growth_credits: number | string;
  learning_summary: string;
  application_commitment: string;
  evidence_url: string | null;
  academy_course_id: string | null;
  academy_session_id: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const reviewRoles = new Set(["owner", "admin", "hr", "manager"]);
const settingsRoles = new Set(["owner", "admin", "hr"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function monthValue(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 7);
}

function number(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

function Badge({children, tone = "slate"}: {children: React.ReactNode; tone?: "slate" | "indigo" | "emerald" | "amber" | "red" | "violet"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    indigo: "bg-indigo-100 text-indigo-800",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    violet: "bg-violet-100 text-violet-800",
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function Metric({label, value, detail, tone = "slate"}: {label: string; value: string; detail: string; tone?: "slate" | "indigo" | "emerald" | "amber"}) {
  const tones = {slate: "border-slate-200", indigo: "border-indigo-200 bg-indigo-50", emerald: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50"};
  return <article className={`rounded-3xl border p-5 shadow-sm ${tones[tone]}`}><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></article>;
}

function statusTone(status: string): "slate" | "emerald" | "amber" | "red" | "indigo" {
  if (["approved", "partially_approved"].includes(status)) return "emerald";
  if (status === "submitted") return "amber";
  if (status === "rejected") return "red";
  if (status === "cancelled") return "slate";
  if (status === "auto_validated") return "emerald";
  return "indigo";
}

export default async function GrowthPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const month = monthValue(first(params.month));
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {t, locale} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");

  const visibleUserIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role});
  const requestedMember = first(params.member);
  const selectedUserId = requestedMember && visibleUserIds.includes(requestedMember) ? requestedMember : authData.user.id;
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);

  const [settingsResult, membersResult, profilesResult, planResult, contributionsResult, developmentResult] = await Promise.all([
    admin.from("growth_settings").select("default_monthly_target_hours,target_credits,bonus_weight,max_monthly_credits,night_start_time,night_end_time,wellbeing_warning_hours,default_development_target_hours,default_reading_target_hours,development_credit_per_hour,reading_credit_per_hour,max_development_credits").eq("organization_id", membership.organization_id).maybeSingle<SettingsRow>(),
    admin.from("organization_members").select("user_id,role").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleUserIds),
    admin.from("profiles").select("id,full_name,email").in("id", visibleUserIds),
    admin.from("growth_plans").select("user_id,plan_month,target_hours,target_credits,target_development_hours,target_reading_hours,focus_skill,objective,status").eq("organization_id", membership.organization_id).eq("user_id", selectedUserId).eq("plan_month", monthStart).maybeSingle<PlanRow>(),
    admin.from("impact_contributions").select("id,user_id,contribution_date,start_time,end_time,crosses_midnight,timezone,duration_minutes,night_minutes,weekend_minutes,category,title,description,skill_developed,beneficiary,result_summary,claimed_impact,validated_impact,status,approved_minutes,growth_credits,payroll_treatment,evidence_url,proof_storage_path,proof_file_name,review_note,reviewed_at,created_at").eq("organization_id", membership.organization_id).eq("user_id", selectedUserId).gte("contribution_date", monthStart).lte("contribution_date", monthEnd).order("contribution_date", {ascending: false}).order("created_at", {ascending: false}),
    admin.from("development_activities").select("id,user_id,activity_date,source,program_code,title,author,start_time,end_time,crosses_midnight,timezone,duration_minutes,night_minutes,weekend_minutes,status,approved_minutes,growth_credits,learning_summary,application_commitment,evidence_url,academy_course_id,academy_session_id,review_note,reviewed_at,created_at").eq("organization_id", membership.organization_id).eq("user_id", selectedUserId).gte("activity_date", monthStart).lte("activity_date", monthEnd).order("activity_date", {ascending: false}).order("created_at", {ascending: false}),
  ]);

  const migrationMissing = [settingsResult.error?.code, planResult.error?.code, developmentResult.error?.code].some((code) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(code)));
  if (migrationMissing) {
    return <main className="p-6 lg:p-10"><section className="mx-auto max-w-5xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><p className="text-sm font-black uppercase tracking-[0.2em] text-amber-700">Super Leader V2.3.1</p><h1 className="mt-3 text-3xl font-black text-amber-950">{t("growth.setupTitle")}</h1><p className="mt-3 text-amber-900">{t("growth.setupHelp")}</p><code className="mt-5 block rounded-2xl bg-slate-950 p-4 text-sm text-white">supabase/028_development_learning_hours_v2_3_1.sql</code></section></main>;
  }

  const loadError = [settingsResult.error, membersResult.error, profilesResult.error, planResult.error, contributionsResult.error, developmentResult.error].find(Boolean);
  if (loadError || !settingsResult.data) {
    return <main className="p-6 lg:p-10"><section className="mx-auto max-w-5xl rounded-3xl border border-red-200 bg-red-50 p-8"><h1 className="text-3xl font-black text-red-900">{t("growth.loadFailed")}</h1><p className="mt-3 text-red-800">{loadError?.message ?? t("common.unknownError")}</p></section></main>;
  }

  const settings = settingsResult.data;
  const members = (membersResult.data ?? []) as MemberRow[];
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(members.map((member) => [member.user_id, member.role]));
  const memberOptions = visibleUserIds.map((id) => {
    const profile = profileById.get(id);
    return {id, name: profile?.full_name?.trim() || profile?.email || t("common.member"), role: roleById.get(id) || "employee"};
  }).sort((a, b) => a.name.localeCompare(b.name));
  const selectedProfile = profileById.get(selectedUserId);
  const selectedName = selectedProfile?.full_name?.trim() || selectedProfile?.email || t("common.member");
  const plan = planResult.data;
  const contributions = (contributionsResult.data ?? []) as ContributionRow[];
  const approved = contributions.filter((row) => ["approved", "partially_approved"].includes(row.status));
  const pending = contributions.filter((row) => row.status === "submitted");
  const approvedMinutes = approved.reduce((sum, row) => sum + Number(row.approved_minutes ?? 0), 0);
  const declaredMinutes = contributions.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.duration_minutes, 0);
  const credits = approved.reduce((sum, row) => sum + number(row.growth_credits), 0);
  const nightMinutes = contributions.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.night_minutes, 0);
  const weekendMinutes = contributions.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.weekend_minutes, 0);
  const targetHours = number(plan?.target_hours, number(settings.default_monthly_target_hours));
  const targetCredits = number(plan?.target_credits, number(settings.target_credits));
  const hourProgress = targetHours > 0 ? Math.min(100, Math.round((approvedMinutes / 60 / targetHours) * 100)) : 0;
  const creditProgress = targetCredits > 0 ? Math.min(100, Math.round((credits / targetCredits) * 100)) : 0;
  const developmentActivities = (developmentResult.data ?? []) as DevelopmentActivityRow[];
  const validatedDevelopment = developmentActivities.filter((row) => ["approved", "partially_approved", "auto_validated"].includes(row.status));
  const pendingDevelopment = developmentActivities.filter((row) => row.status === "submitted");
  const developmentMinutes = validatedDevelopment.filter((row) => row.program_code !== "book_reading").reduce((sum, row) => sum + Number(row.approved_minutes ?? row.duration_minutes), 0);
  const readingMinutes = validatedDevelopment.filter((row) => row.program_code === "book_reading").reduce((sum, row) => sum + Number(row.approved_minutes ?? row.duration_minutes), 0);
  const developmentCredits = validatedDevelopment.reduce((sum, row) => sum + number(row.growth_credits), 0);
  const totalCredits = credits + developmentCredits;
  const targetDevelopmentHours = number(plan?.target_development_hours, number(settings.default_development_target_hours, 12));
  const targetReadingHours = number(plan?.target_reading_hours, number(settings.default_reading_target_hours, 2));
  const developmentProgress = targetDevelopmentHours > 0 ? Math.min(100, Math.round((developmentMinutes / 60 / targetDevelopmentHours) * 100)) : 0;
  const readingProgress = targetReadingHours > 0 ? Math.min(100, Math.round((readingMinutes / 60 / targetReadingHours) * 100)) : 0;
  const developmentNightMinutes = developmentActivities.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.night_minutes, 0);
  const developmentWeekendMinutes = developmentActivities.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.weekend_minutes, 0);
  const wellbeingWarning = hours(nightMinutes + weekendMinutes + developmentNightMinutes + developmentWeekendMinutes) >= number(settings.wellbeing_warning_hours) && number(settings.wellbeing_warning_hours) > 0;
  const canReview = reviewRoles.has(membership.role) && selectedUserId !== authData.user.id;
  const canConfigure = settingsRoles.has(membership.role);
  const canSubmit = selectedUserId === authData.user.id;
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const formatDate = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
  const statusLabel = (status: string) => t(`growth.statuses.${status}`);
  const impactLabel = (impact: string) => t(`growth.impacts.${impact}`);
  const categoryLabel = (category: string) => t(`growth.categories.${category}`);
  const programLabel = (program: string) => t(`growth.development.programs.${program}`);

  return (
    <main className="p-5 sm:p-7 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-800 p-7 text-white shadow-xl sm:p-10">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-violet-200">{t("growth.eyebrow")}</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-5"><div><h1 className="text-3xl font-black sm:text-5xl">{t("growth.title")}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200 sm:text-base">{t("growth.subtitle")}</p></div><Badge tone="violet">{t("growth.nonPayrollBadge")}</Badge></div>
        </header>

        {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5 text-sm leading-6 text-indigo-950">
          <p className="font-black">{t("growth.separationTitle")}</p><p className="mt-1">{t("growth.separationHelp")}</p>
        </section>

        <form method="get" className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[220px_1fr_auto] sm:items-end">
          <label className="text-sm font-black">{t("growth.month")}<input type="month" name="month" defaultValue={month} className={fieldClass()} /></label>
          {reviewRoles.has(membership.role) ? <label className="text-sm font-black">{t("growth.employee")}<select name="member" defaultValue={selectedUserId} className={fieldClass()}>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name} · {t(`roles.${member.role}`)}</option>)}</select></label> : <input type="hidden" name="member" value={selectedUserId} />}
          <button className="rounded-xl bg-slate-950 px-6 py-3 font-black text-white">{t("growth.display")}</button>
        </form>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label={t("growth.metrics.approvedHours")} value={`${hours(approvedMinutes)} h`} detail={t("growth.metrics.approvedHoursHelp", {target: targetHours})} tone="emerald" />
          <Metric label={t("growth.metrics.developmentHours")} value={`${hours(developmentMinutes)} h`} detail={t("growth.metrics.developmentHoursHelp", {target: targetDevelopmentHours})} tone="indigo" />
          <Metric label={t("growth.metrics.readingHours")} value={`${hours(readingMinutes)} h`} detail={t("growth.metrics.readingHoursHelp", {target: targetReadingHours})} />
          <Metric label={t("growth.metrics.credits")} value={totalCredits.toFixed(1)} detail={t("growth.metrics.creditsHelp", {target: targetCredits})} tone="indigo" />
          <Metric label={t("growth.metrics.pending")} value={String(pending.length + pendingDevelopment.length)} detail={t("growth.metrics.pendingCombinedHelp")} tone="amber" />
          <Metric label={t("growth.metrics.outsideHours")} value={`${hours(nightMinutes + weekendMinutes + developmentNightMinutes + developmentWeekendMinutes)} h`} detail={t("growth.metrics.outsideHoursHelp")} />
        </div>

        {wellbeingWarning ? <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950"><p className="font-black">{t("growth.wellbeingTitle")}</p><p className="mt-1 text-sm leading-6">{t("growth.wellbeingHelp")}</p></section> : null}

        <section className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">{selectedName}</p><h2 className="mt-2 text-2xl font-black">{t("growth.planTitle")}</h2></div><Badge tone={plan ? "emerald" : "amber"}>{plan ? t("growth.planActive") : t("growth.planMissing")}</Badge></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("growth.hoursProgress")}</p><p className="mt-2 text-2xl font-black">{hourProgress}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{width: `${hourProgress}%`}} /></div></div>
              <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-black uppercase text-indigo-600">{t("growth.development.progress")}</p><p className="mt-2 text-2xl font-black">{developmentProgress}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100"><div className="h-full rounded-full bg-indigo-600" style={{width: `${developmentProgress}%`}} /></div></div>
              <div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-black uppercase text-amber-700">{t("growth.development.readingProgress")}</p><p className="mt-2 text-2xl font-black">{readingProgress}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100"><div className="h-full rounded-full bg-amber-500" style={{width: `${readingProgress}%`}} /></div></div>
              <div className="rounded-2xl bg-violet-50 p-4"><p className="text-xs font-black uppercase text-violet-600">{t("growth.creditProgress")}</p><p className="mt-2 text-2xl font-black">{Math.min(100, targetCredits > 0 ? Math.round((totalCredits / targetCredits) * 100) : 0)}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600" style={{width: `${Math.min(100, targetCredits > 0 ? Math.round((totalCredits / targetCredits) * 100) : 0)}%`}} /></div></div>
            </div>
            <form action={upsertGrowthPlanAction} className="mt-6 space-y-4"><input type="hidden" name="month" value={month} /><input type="hidden" name="userId" value={selectedUserId} /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-black">{t("growth.targetHours")}<input name="targetHours" type="number" min="0" max="200" step="0.5" defaultValue={targetHours} required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.development.targetHours")}<input name="targetDevelopmentHours" type="number" min="0" max="300" step="0.5" defaultValue={targetDevelopmentHours} required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.development.targetReadingHours")}<input name="targetReadingHours" type="number" min="0" max="100" step="0.5" defaultValue={targetReadingHours} required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.targetCredits")}<input name="targetCredits" type="number" min="1" max="500" step="0.5" defaultValue={targetCredits} required className={fieldClass()} /></label></div><label className="block text-sm font-black">{t("growth.focusSkill")}<input name="focusSkill" defaultValue={plan?.focus_skill ?? ""} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("growth.objective")}<textarea name="objective" rows={4} defaultValue={plan?.objective ?? ""} required className={fieldClass()} /></label><button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("growth.savePlan")}</button></form>
          </article>

          {canSubmit ? <article className="rounded-3xl border border-violet-200 bg-violet-50 p-6 shadow-sm"><h2 className="text-2xl font-black text-violet-950">{t("growth.declareTitle")}</h2><p className="mt-2 text-sm leading-6 text-violet-800">{t("growth.declareHelp")}</p><form action={createImpactContributionAction} className="mt-5 space-y-4"><input type="hidden" name="month" value={month} /><input type="hidden" name="timezone" value="Europe/Dublin" /><div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-black">{t("growth.date")}<input name="contributionDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.startTime")}<input name="startTime" type="time" required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.endTime")}<input name="endTime" type="time" required className={fieldClass()} /></label></div><label className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold"><input type="checkbox" name="crossesMidnight" />{t("growth.crossesMidnight")}</label><label className="block text-sm font-black">{t("growth.category")}<select name="category" defaultValue="learning" className={fieldClass()}>{["learning","mentoring","innovation","documentation","cross_team_support","community","process_improvement","special_project","representation","other"].map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label><label className="block text-sm font-black">{t("growth.contributionTitle")}<input name="title" required minLength={3} className={fieldClass()} /></label><label className="block text-sm font-black">{t("growth.description")}<textarea name="description" rows={4} required minLength={10} className={fieldClass()} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-black">{t("growth.skillDeveloped")}<input name="skillDeveloped" required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.beneficiary")}<input name="beneficiary" className={fieldClass()} /></label></div><label className="block text-sm font-black">{t("growth.resultSummary")}<textarea name="resultSummary" rows={3} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("growth.claimedImpact")}<select name="claimedImpact" defaultValue="medium" className={fieldClass()}>{["low","medium","high","strategic"].map((value) => <option key={value} value={value}>{impactLabel(value)}</option>)}</select></label><label className="block text-sm font-black">{t("growth.evidenceUrl")}<input name="evidenceUrl" type="url" placeholder="https://" className={fieldClass()} /></label><SecureAttachmentUpload purpose="impact" prefix="impactProof" label={t("growth.proofFile")} help={t("attachments.help")} chooseLabel={t("attachments.chooseFile")} uploadingLabel={t("attachments.uploading")} uploadedLabel={t("attachments.uploaded")} removeLabel={t("attachments.remove")} errorLabel={t("attachments.invalidFile")} /><button className="w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white">{t("growth.submitContribution")}</button></form></article> : <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{t("growth.reviewContextTitle")}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t("growth.reviewContextHelp", {name: selectedName})}</p><div className="mt-5 rounded-2xl bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{t("growth.declaredHours")}</p><p className="mt-2 text-3xl font-black">{hours(declaredMinutes)} h</p></div></article>}
        </section>

        {canSubmit ? (
          <section className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
            <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Super Leader V2.3.1</p>
              <h2 className="mt-2 text-2xl font-black text-indigo-950">{t("growth.development.declareTitle")}</h2>
              <p className="mt-2 text-sm leading-6 text-indigo-800">{t("growth.development.declareHelp")}</p>
              <form action={createDevelopmentActivityAction} className="mt-5 space-y-4">
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="timezone" value="Europe/Dublin" />
                <label className="block text-sm font-black">{t("growth.development.program")}<select name="programCode" defaultValue="school_coaches" className={fieldClass()}>{["school_coaches","school_business","school_experts","school_breeders","vision_monday","book_reading","other_training"].map((value) => <option key={value} value={value}>{programLabel(value)}</option>)}</select></label>
                <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-black">{t("growth.date")}<input name="activityDate" type="date" defaultValue={new Date().toISOString().slice(0,10)} required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.startTime")}<input name="startTime" type="time" required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.endTime")}<input name="endTime" type="time" required className={fieldClass()} /></label></div>
                <label className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold"><input type="checkbox" name="crossesMidnight" />{t("growth.crossesMidnight")}</label>
                <label className="block text-sm font-black">{t("growth.development.activityTitle")}<input name="title" required minLength={2} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("growth.development.author")}<input name="author" className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("growth.development.learningSummary")}<textarea name="learningSummary" rows={4} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("growth.development.applicationCommitment")}<textarea name="applicationCommitment" rows={3} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("growth.evidenceUrl")}<input name="evidenceUrl" type="url" placeholder="https://" className={fieldClass()} /></label>
                <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("growth.development.submit")}</button>
              </form>
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("growth.development.automaticTitle")}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t("growth.development.automaticHelp")}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {["school_coaches","school_business","school_experts","school_breeders","vision_monday"].map((value) => <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="font-black">{programLabel(value)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{t("growth.development.academySyncHelp")}</p></div>)}
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-black text-amber-950">{programLabel("book_reading")}</p><p className="mt-1 text-xs leading-5 text-amber-800">{t("growth.development.bookHelp")}</p></div>
              </div>
            </article>
          </section>
        ) : null}

        <section className="rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">{t("growth.development.activitiesTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("growth.development.activitiesHelp")}</p></div><Badge tone="indigo">{developmentActivities.length}</Badge></div>
          <div className="mt-6 space-y-4">
            {developmentActivities.map((row) => (
              <article key={row.id} className="rounded-2xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge><Badge tone="indigo">{programLabel(row.program_code)}</Badge><Badge tone={row.source === "academy" ? "emerald" : "slate"}>{row.source === "academy" ? t("growth.development.academySource") : t("growth.development.manualSource")}</Badge>{row.night_minutes > 0 ? <Badge tone="violet">{t("growth.nightContribution")}</Badge> : null}{row.weekend_minutes > 0 ? <Badge tone="amber">{t("growth.weekendContribution")}</Badge> : null}</div><h3 className="mt-3 text-xl font-black">{row.title}</h3><p className="mt-1 text-sm text-slate-500">{formatDate(row.activity_date)}{row.start_time && row.end_time ? ` · ${row.start_time.slice(0,5)}–${row.end_time.slice(0,5)}` : ""} · {hours(row.duration_minutes)} h</p>{row.author ? <p className="mt-1 text-sm text-slate-500">{t("growth.development.author")}: {row.author}</p> : null}</div><div className="text-right"><p className="text-xs font-black uppercase text-slate-500">{t("growth.credits")}</p><p className="mt-1 text-2xl font-black text-indigo-700">{number(row.growth_credits).toFixed(1)}</p></div></div>
                {(row.learning_summary || row.application_commitment) ? <div className="mt-4 grid gap-4 md:grid-cols-2">{row.learning_summary ? <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("growth.development.learningSummary")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{row.learning_summary}</p></div> : null}{row.application_commitment ? <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("growth.development.applicationCommitment")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{row.application_commitment}</p></div> : null}</div> : null}
                {row.evidence_url ? <a href={row.evidence_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">{t("growth.openEvidence")}</a> : null}
                {row.review_note ? <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-950"><strong>{t("growth.reviewNote")}:</strong> {row.review_note}</div> : null}
                {row.status === "submitted" && row.user_id === authData.user.id ? <form action={cancelDevelopmentActivityAction} className="mt-4"><input type="hidden" name="activityId" value={row.id} /><input type="hidden" name="month" value={month} /><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700">{t("growth.cancelContribution")}</button></form> : null}
                {canReview && row.status === "submitted" ? <form action={reviewDevelopmentActivityAction} className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><input type="hidden" name="activityId" value={row.id} /><input type="hidden" name="month" value={month} /><p className="font-black text-emerald-950">{t("growth.development.reviewTitle")}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black">{t("growth.decision")}<select name="decision" defaultValue="approved" className={fieldClass()}><option value="approved">{t("growth.statuses.approved")}</option><option value="partially_approved">{t("growth.statuses.partially_approved")}</option><option value="rejected">{t("growth.statuses.rejected")}</option></select></label><label className="text-sm font-black">{t("growth.approvedMinutes")}<input name="approvedMinutes" type="number" min="0" max={row.duration_minutes} defaultValue={row.duration_minutes} required className={fieldClass()} /></label></div><label className="mt-4 block text-sm font-black">{t("growth.reviewNote")}<textarea name="reviewNote" rows={3} required minLength={3} className={fieldClass()} /></label><button className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{t("growth.saveReview")}</button></form> : null}
              </article>
            ))}
            {!developmentActivities.length ? <div className="rounded-2xl bg-slate-50 py-14 text-center text-slate-500">{t("growth.development.noActivities")}</div> : null}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">{t("growth.contributionsTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("growth.contributionsHelp")}</p></div><Badge tone="indigo">{contributions.length}</Badge></div>
          <div className="mt-6 space-y-4">
            {contributions.map((row) => (
              <article key={row.id} className="rounded-2xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge><Badge tone="violet">{categoryLabel(row.category)}</Badge>{row.night_minutes > 0 ? <Badge tone="indigo">{t("growth.nightContribution")}</Badge> : null}{row.weekend_minutes > 0 ? <Badge tone="amber">{t("growth.weekendContribution")}</Badge> : null}</div><h3 className="mt-3 text-xl font-black">{row.title}</h3><p className="mt-1 text-sm text-slate-500">{formatDate(row.contribution_date)} · {row.start_time.slice(0,5)}–{row.end_time.slice(0,5)}{row.crosses_midnight ? ` (${t("growth.nextDay")})` : ""} · {hours(row.duration_minutes)} h</p></div><div className="text-right"><p className="text-xs font-black uppercase text-slate-500">{t("growth.credits")}</p><p className="mt-1 text-2xl font-black text-indigo-700">{number(row.growth_credits).toFixed(1)}</p></div></div>
                <div className="mt-4 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("growth.description")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{row.description}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{t("growth.resultSummary")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{row.result_summary}</p></div></div>
                <div className="mt-4 flex flex-wrap gap-4 text-sm"><span><strong>{t("growth.skillDeveloped")}:</strong> {row.skill_developed}</span><span><strong>{t("growth.claimedImpact")}:</strong> {impactLabel(row.claimed_impact)}</span>{row.validated_impact ? <span><strong>{t("growth.validatedImpact")}:</strong> {impactLabel(row.validated_impact)}</span> : null}{row.beneficiary ? <span><strong>{t("growth.beneficiary")}:</strong> {row.beneficiary}</span> : null}</div>
                {(row.evidence_url || row.proof_storage_path) ? <div className="mt-4 flex flex-wrap gap-3">{row.evidence_url ? <a href={row.evidence_url} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">{t("growth.openEvidence")}</a> : null}{row.proof_storage_path ? <Link href={`/api/attachments/impact/${row.id}`} target="_blank" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black">{row.proof_file_name || t("growth.openProof")}</Link> : null}</div> : null}
                {row.review_note ? <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-950"><strong>{t("growth.reviewNote")}:</strong> {row.review_note}</div> : null}
                {row.status === "submitted" && row.user_id === authData.user.id ? <form action={cancelImpactContributionAction} className="mt-4"><input type="hidden" name="contributionId" value={row.id} /><input type="hidden" name="month" value={month} /><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700">{t("growth.cancelContribution")}</button></form> : null}
                {canReview && row.status === "submitted" ? <form action={reviewImpactContributionAction} className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><input type="hidden" name="contributionId" value={row.id} /><input type="hidden" name="month" value={month} /><p className="font-black text-emerald-950">{t("growth.reviewTitle")}</p><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-black">{t("growth.decision")}<select name="decision" defaultValue="approved" className={fieldClass()}><option value="approved">{t("growth.statuses.approved")}</option><option value="partially_approved">{t("growth.statuses.partially_approved")}</option><option value="rejected">{t("growth.statuses.rejected")}</option></select></label><label className="text-sm font-black">{t("growth.approvedMinutes")}<input name="approvedMinutes" type="number" min="0" max={row.duration_minutes} defaultValue={row.duration_minutes} required className={fieldClass()} /></label><label className="text-sm font-black">{t("growth.validatedImpact")}<select name="validatedImpact" defaultValue={row.claimed_impact} className={fieldClass()}>{["low","medium","high","strategic"].map((value) => <option key={value} value={value}>{impactLabel(value)}</option>)}</select></label><label className="text-sm font-black">{t("growth.payrollTreatment")}<select name="payrollTreatment" defaultValue="growth_only" className={fieldClass()}><option value="growth_only">{t("growth.payroll.growth_only")}</option><option value="requires_hr_review">{t("growth.payroll.requires_hr_review")}</option></select></label></div><label className="mt-4 block text-sm font-black">{t("growth.reviewNote")}<textarea name="reviewNote" rows={3} required minLength={3} className={fieldClass()} /></label><button className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{t("growth.saveReview")}</button></form> : null}
              </article>
            ))}
            {!contributions.length ? <div className="rounded-2xl bg-slate-50 py-14 text-center text-slate-500">{t("growth.noContributions")}</div> : null}
          </div>
        </section>

        {canConfigure ? (
          <section className="rounded-3xl border border-slate-300 bg-slate-50 p-6">
            <h2 className="text-2xl font-black">{t("growth.settingsTitle")}</h2>
            <p className="mt-2 text-sm text-slate-600">{t("growth.settingsHelp")}</p>
            <form action={updateGrowthSettingsAction} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="month" value={month} />
              <label className="text-sm font-black">{t("growth.defaultTargetHours")}<input name="defaultMonthlyTargetHours" type="number" min="0" max="200" step="0.5" defaultValue={number(settings.default_monthly_target_hours)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.development.defaultTargetHours")}<input name="defaultDevelopmentTargetHours" type="number" min="0" max="300" step="0.5" defaultValue={number(settings.default_development_target_hours, 12)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.development.defaultReadingTargetHours")}<input name="defaultReadingTargetHours" type="number" min="0" max="100" step="0.5" defaultValue={number(settings.default_reading_target_hours, 2)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.defaultTargetCredits")}<input name="targetCredits" type="number" min="1" max="500" step="0.5" defaultValue={number(settings.target_credits)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.development.trainingCreditRate")}<input name="developmentCreditPerHour" type="number" min="0" max="20" step="0.1" defaultValue={number(settings.development_credit_per_hour, 1)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.development.readingCreditRate")}<input name="readingCreditPerHour" type="number" min="0" max="20" step="0.1" defaultValue={number(settings.reading_credit_per_hour, 1.5)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.development.maxCredits")}<input name="maxDevelopmentCredits" type="number" min="0" max="500" step="0.5" defaultValue={number(settings.max_development_credits, 20)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.bonusWeight")}<input name="bonusWeight" type="number" min="0" max="20" step="0.5" defaultValue={number(settings.bonus_weight)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.maxMonthlyCredits")}<input name="maxMonthlyCredits" type="number" min="1" max="1000" step="0.5" defaultValue={number(settings.max_monthly_credits)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.nightStart")}<input name="nightStartTime" type="time" defaultValue={settings.night_start_time.slice(0,5)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.nightEnd")}<input name="nightEndTime" type="time" defaultValue={settings.night_end_time.slice(0,5)} className={fieldClass()} /></label>
              <label className="text-sm font-black">{t("growth.wellbeingWarningHours")}<input name="wellbeingWarningHours" type="number" min="0" max="200" step="0.5" defaultValue={number(settings.wellbeing_warning_hours)} className={fieldClass()} /></label>
              <div className="flex items-end"><button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("growth.saveSettings")}</button></div>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}
