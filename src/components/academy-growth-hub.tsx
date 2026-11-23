import Link from "next/link";
import {redirect} from "next/navigation";
import {
  activateMonthlyStaffTrainingAction,
  createStaffGrowthPlanAction,
  createStaffReadingPlanAction,
  updateStaffGrowthProgressAction,
  updateStaffReadingProgressAction,
} from "@/app/actions/academy-growth";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type Profile = {id: string; full_name: string | null; email: string | null};
type Course = {id: string; title: string; deadline: string; status: string};
type Cycle = {id: string; training_month: string; academy_course_id: string | null; title: string; starts_on: string; due_on: string; status: string};
type Enrollment = {user_id: string; status: string; progress_percent: number | string};
type GrowthPlan = {
  id: string; user_id: string; manager_id: string | null; period_start: string; period_end: string; focus_area: string; objective: string;
  action_plan: string; target_measure: string; status: string; progress_percent: number | string; review_frequency: string; next_review_on: string | null;
};
type ReadingPlan = {
  id: string; user_id: string; growth_plan_id: string | null; book_title: string; author: string; start_date: string; target_date: string;
  total_units: number; completed_units: number; unit_label: string; summary_required: boolean; summary_status: string; summary_text: string; status: string;
};

function dateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function percent(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function profileName(profile: Profile | undefined, fallback: string) {
  return profile?.full_name || profile?.email || fallback;
}

function field() {
  return "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

export async function AcademyGrowthHub() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id, role").eq("user_id", auth.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership) return null;

  // V4_8_73_R2_ACADEMY_PRICING_TILE
  const {data: activePricingCommission} = await admin
    .from("academy_pricing_commissions")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("status", "active")
    .maybeSingle<{id: string}>();
  const {data: myPricingCommissionMembership} = activePricingCommission
    ? await admin
        .from("academy_pricing_commission_members")
        .select("member_role")
        .eq("commission_id", activePricingCommission.id)
        .eq("user_id", auth.user.id)
        .eq("is_active", true)
        .maybeSingle<{member_role: string}>()
    : {data: null};
  const canManageAcademyPricing =
    ["owner", "admin"].includes(membership.role) ||
    ["chair", "secretary"].includes(myPricingCommissionMembership?.member_role ?? "");

  const schemaCheck = await admin.from("academy_staff_growth_plans").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205", "42703"].includes(schemaCheck.error.code);
    return (
      <section id="academy-growth-hub" className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Academy Growth V4.8.68</p>
        <h2 className="mt-1 text-2xl font-black text-amber-950">{fr ? "Formation staff & plans de croissance" : "Staff training & growth plans"}</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          {missing
            ? (fr ? "La fonctionnalité est installée côté application. Exécutez d’abord la migration Supabase 108 pour l’activer." : "The application feature is installed. Run Supabase migration 108 first to activate it.")
            : schemaCheck.error.message}
        </p>
        {missing ? <code className="mt-4 block rounded-xl bg-slate-950 px-4 py-3 text-xs font-bold text-white">supabase/108_academy_growth_staff_development_v4_8_68.sql</code> : null}
      </section>
    );
  }

  const canManage = ["owner", "admin", "hr", "manager"].includes(membership.role);
  const canManageMonthly = ["owner", "admin", "hr"].includes(membership.role);
  const visible = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: auth.user.id, role: membership.role});
  const visibleUserIds = visible.length ? visible : [auth.user.id];
  const month = new Date().toISOString().slice(0, 7);
  const monthDate = `${month}-01`;
  const today = new Date().toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const [profilesResult, coursesResult, cycleResult, growthResult, readingResult] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", visibleUserIds),
    admin.from("academy_courses").select("id, title, deadline, status").eq("organization_id", membership.organization_id).eq("status", "published").order("created_at", {ascending: false}),
    admin.from("academy_staff_monthly_training_cycles").select("id, training_month, academy_course_id, title, starts_on, due_on, status").eq("organization_id", membership.organization_id).eq("training_month", monthDate).maybeSingle<Cycle>(),
    admin.from("academy_staff_growth_plans").select("id, user_id, manager_id, period_start, period_end, focus_area, objective, action_plan, target_measure, status, progress_percent, review_frequency, next_review_on").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).order("period_end", {ascending: false}),
    admin.from("academy_staff_reading_plans").select("id, user_id, growth_plan_id, book_title, author, start_date, target_date, total_units, completed_units, unit_label, summary_required, summary_status, summary_text, status").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).order("target_date", {ascending: true}),
  ]);

  const profiles = (profilesResult.data ?? []) as Profile[];
  const courses = (coursesResult.data ?? []) as Course[];
  const cycle = (cycleResult.data ?? null) as Cycle | null;
  const growthPlans = (growthResult.data ?? []) as GrowthPlan[];
  const readingPlans = (readingResult.data ?? []) as ReadingPlan[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  const cycleEnrollmentsResult = cycle?.academy_course_id
    ? await admin.from("academy_enrollments").select("user_id, status, progress_percent").eq("organization_id", membership.organization_id).eq("course_id", cycle.academy_course_id).in("user_id", visibleUserIds)
    : {data: [], error: null};
  const cycleEnrollments = (cycleEnrollmentsResult.data ?? []) as Enrollment[];
  const monthlyCompleted = cycleEnrollments.filter((row) => row.status === "completed").length;
  const monthlyInProgress = cycleEnrollments.filter((row) => row.status === "in_progress").length;
  const monthlyNotStarted = cycleEnrollments.filter((row) => !["completed", "in_progress", "exempted"].includes(row.status)).length;
  const activeGrowthPlans = growthPlans.filter((plan) => ["active", "paused"].includes(plan.status));
  const usersWithGrowth = new Set(activeGrowthPlans.map((plan) => plan.user_id));
  const withoutGrowth = canManage ? visibleUserIds.filter((id) => !usersWithGrowth.has(id)).length : Number(!usersWithGrowth.has(auth.user.id));
  const activeReading = readingPlans.filter((plan) => !["completed", "cancelled"].includes(plan.status));
  const overdueReading = activeReading.filter((plan) => plan.target_date < today).length;
  const usersWithReading = new Set(activeReading.map((plan) => plan.user_id));
  const withoutReading = canManage ? visibleUserIds.filter((id) => !usersWithReading.has(id)).length : Number(!usersWithReading.has(auth.user.id));
  const ownMonthly = cycleEnrollments.find((row) => row.user_id === auth.user.id);
  const ownGrowth = growthPlans.filter((plan) => plan.user_id === auth.user.id);
  const ownReading = readingPlans.filter((plan) => plan.user_id === auth.user.id);
  const defaultPeriodEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 2, 0)).toISOString().slice(0, 10);

  return (
    <section id="academy-growth-hub" className="mt-6 space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "Bureau Academy" : "Academy office"}</p>
            <h2 className="mt-1 text-2xl font-black">{fr ? "Actions Academy & croissance" : "Academy & growth actions"}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{fr ? "Formation mensuelle du staff, développement individuel et lecture restent visibles dès l’entrée dans Academy." : "Monthly staff training, individual development and reading stay visible as soon as you enter Academy."}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">{fr ? "Accès selon votre rôle" : "Access follows your role"}</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Link href="#staff-monthly-training" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <p className="text-lg font-black">🎓 {fr ? "Formation staff du mois" : "Monthly staff training"}</p>
            <p className="mt-1 text-sm text-slate-600">{cycle ? `${monthlyCompleted}/${cycleEnrollments.length || visibleUserIds.length} ${fr ? "terminé(s)" : "completed"}` : (fr ? "À configurer pour ce mois" : "Set up this month")}</p>
            <p className="mt-2 text-xs font-black text-indigo-700">{fr ? "Piloter →" : "Manage →"}</p>
          </Link>
          <Link href="#growth-plans" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <p className="text-lg font-black">🌱 {fr ? "Plans de croissance" : "Growth plans"}</p>
            <p className="mt-1 text-sm text-slate-600">{canManage ? `${activeGrowthPlans.length} ${fr ? "actif(s) ·" : "active ·"} ${withoutGrowth} ${fr ? "sans plan" : "without plan"}` : `${ownGrowth.length} ${fr ? "plan(s)" : "plan(s)"}`}</p>
            <p className="mt-2 text-xs font-black text-emerald-700">{fr ? "Développer →" : "Develop →"}</p>
          </Link>
          <Link href="#reading-plans" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <p className="text-lg font-black">📚 {fr ? "Plans de lecture" : "Reading plans"}</p>
            <p className="mt-1 text-sm text-slate-600">{canManage ? `${activeReading.length} ${fr ? "actif(s) ·" : "active ·"} ${overdueReading} ${fr ? "en retard" : "overdue"}` : `${ownReading.length} ${fr ? "livre(s) assigné(s)" : "assigned book(s)"}`}</p>
            <p className="mt-2 text-xs font-black text-amber-700">{fr ? "Lire & suivre →" : "Read & track →"}</p>
          </Link>
          {canManageAcademyPricing ? (
            <Link href={`/dashboard/academy/pricing?organization=${membership.organization_id}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-sm">
              <p className="text-lg font-black">💰 {fr ? "Tarification & homologation" : "Pricing & approval"}</p>
              <p className="mt-1 text-sm text-slate-600">{fr ? "Tarifs programmes et cohortes, promotions, exceptions et Commission tarifaire." : "Program and cohort pricing, promotions, exceptions and pricing commission."}</p>
              <p className="mt-2 text-xs font-black text-amber-700">{fr ? "Gérer les tarifs →" : "Manage pricing →"}</p>
            </Link>
          ) : null}
          <Link href="#academy-course-wizard" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm">
            <p className="text-lg font-black">🏫 {fr ? "Programmes & formations" : "Programs & courses"}</p><p className="mt-1 text-sm text-slate-600">{fr ? "Créer ou préparer une formation Academy." : "Create or prepare an Academy course."}</p><p className="mt-2 text-xs font-black text-indigo-700">{fr ? "Ouvrir →" : "Open →"}</p>
          </Link>
          <Link href="#academy-course-catalogue" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm">
            <p className="text-lg font-black">👥 {fr ? "Parcours & participants" : "Programs & participants"}</p><p className="mt-1 text-sm text-slate-600">{fr ? "Retrouver les formations, affectations et progression." : "Find courses, assignments and progress."}</p><p className="mt-2 text-xs font-black text-indigo-700">{fr ? "Ouvrir →" : "Open →"}</p>
          </Link>
          <Link href="#academy-course-detail" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm">
            <p className="text-lg font-black">🏆 {fr ? "Sessions, quiz & certificats" : "Sessions, quiz & certificates"}</p><p className="mt-1 text-sm text-slate-600">{fr ? "Suivre les séances, évaluations et validations." : "Track sessions, assessments and validations."}</p><p className="mt-2 text-xs font-black text-indigo-700">{fr ? "Ouvrir →" : "Open →"}</p>
          </Link>
        </div>

        {canManage ? (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4">
            <p className="text-sm font-black text-red-900">⚠️ {fr ? "À traiter dans Academy" : "Academy attention queue"}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-red-800">
              <span className="rounded-full bg-white px-3 py-1.5">{withoutGrowth} {fr ? "sans plan de croissance" : "without growth plan"}</span>
              <span className="rounded-full bg-white px-3 py-1.5">{withoutReading} {fr ? "sans plan de lecture" : "without reading plan"}</span>
              <span className="rounded-full bg-white px-3 py-1.5">{overdueReading} {fr ? "lecture(s) en retard" : "overdue reading plan(s)"}</span>
              {!cycle ? <span className="rounded-full bg-white px-3 py-1.5">{fr ? "Formation staff du mois non configurée" : "Monthly staff training not configured"}</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      <article id="staff-monthly-training" className="scroll-mt-24 rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "Début de chaque mois" : "Beginning of each month"}</p><h3 className="mt-1 text-2xl font-black">🎓 {fr ? "Formation mensuelle obligatoire du staff" : "Required monthly staff training"}</h3></div>
          {cycle?.academy_course_id ? <Link href={`/dashboard/academy/staff-training?course=${cycle.academy_course_id}`} className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white">{fr ? "Ouvrir la formation" : "Open course"}</Link> : null}
        </div>
        {cycle ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl bg-slate-50 p-4 xl:col-span-2"><p className="text-xs font-bold text-slate-500">{fr ? "Formation" : "Course"}</p><p className="mt-1 font-black">{cycle.title}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(cycle.starts_on, locale)} → {dateLabel(cycle.due_on, locale)}</p></div>
            <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">{fr ? "Terminés" : "Completed"}</p><p className="mt-1 text-2xl font-black">{monthlyCompleted}</p></div>
            <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-bold text-indigo-700">{fr ? "En cours" : "In progress"}</p><p className="mt-1 text-2xl font-black">{monthlyInProgress}</p></div>
            <div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-bold text-amber-700">{fr ? "Non commencés" : "Not started"}</p><p className="mt-1 text-2xl font-black">{monthlyNotStarted}</p></div>
          </div>
        ) : <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-900">{fr ? "Aucune formation staff n’est encore activée pour ce mois." : "No monthly staff training has been activated for this month yet."}</p>}
        {!canManageMonthly && cycle ? <p className="mt-4 text-sm text-slate-600">{fr ? `Votre statut: ${ownMonthly?.status ?? "non affecté"}.` : `Your status: ${ownMonthly?.status ?? "not assigned"}.`}</p> : null}
        {canManageMonthly ? (
          <form action={activateMonthlyStaffTrainingAction} className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 lg:grid-cols-5 lg:items-end">
            <input type="hidden" name="trainingMonth" value={month} />
            <label className="text-xs font-black lg:col-span-2">{fr ? "Formation Academy publiée" : "Published Academy course"}<select name="courseId" defaultValue={cycle?.academy_course_id ?? courses[0]?.id ?? ""} className={field()} required><option value="">{fr ? "Sélectionner..." : "Select..."}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
            <label className="text-xs font-black">{fr ? "Début" : "Start"}<input type="date" name="startsOn" defaultValue={cycle?.starts_on ?? monthDate} className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Échéance" : "Due date"}<input type="date" name="dueOn" defaultValue={cycle?.due_on ?? monthEnd} className={field()} required /></label>
            <button className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">{cycle ? (fr ? "Synchroniser le staff" : "Sync staff") : (fr ? "Activer pour le staff" : "Activate for staff")}</button>
          </form>
        ) : null}
      </article>

      <article id="growth-plans" className="scroll-mt-24 rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "Développement individuel" : "Individual development"}</p><h3 className="mt-1 text-2xl font-black">🌱 {fr ? "Plans de croissance du staff" : "Staff growth plans"}</h3></div>
        {canManage ? (
          <form action={createStaffGrowthPlanAction} className="mt-5 grid gap-3 rounded-2xl bg-emerald-50/50 p-4 lg:grid-cols-2">
            <label className="text-xs font-black">{fr ? "Collaborateur" : "Employee"}<select name="userId" className={field()} required><option value="">{fr ? "Sélectionner..." : "Select..."}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profileName(profile, profile.id)}</option>)}</select></label>
            <label className="text-xs font-black">{fr ? "Compétence / axe" : "Skill / focus area"}<input name="focusArea" className={field()} placeholder={fr ? "Leadership, communication..." : "Leadership, communication..."} required /></label>
            <label className="text-xs font-black lg:col-span-2">{fr ? "Objectif de croissance" : "Growth objective"}<textarea name="objective" className={field()} rows={2} required /></label>
            <label className="text-xs font-black lg:col-span-2">{fr ? "Plan d’action" : "Action plan"}<textarea name="actionPlan" className={field()} rows={2} /></label>
            <label className="text-xs font-black">{fr ? "Mesure cible" : "Target measure"}<input name="targetMeasure" className={field()} /></label>
            <label className="text-xs font-black">{fr ? "Fréquence de revue" : "Review frequency"}<select name="reviewFrequency" className={field()}><option value="monthly">{fr ? "Mensuelle" : "Monthly"}</option><option value="quarterly">{fr ? "Trimestrielle" : "Quarterly"}</option></select></label>
            <label className="text-xs font-black">{fr ? "Début" : "Start"}<input type="date" name="periodStart" defaultValue={today} className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Fin" : "End"}<input type="date" name="periodEnd" defaultValue={defaultPeriodEnd} className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Prochaine revue" : "Next review"}<input type="date" name="nextReviewOn" className={field()} /></label>
            <div className="flex items-end"><button className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">{fr ? "Créer le plan" : "Create plan"}</button></div>
          </form>
        ) : null}
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {(canManage ? growthPlans : ownGrowth).slice(0, 10).map((plan) => (
            <div key={plan.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-black">{profileName(profileMap.get(plan.user_id), plan.user_id)}</p><p className="text-sm font-bold text-emerald-700">{plan.focus_area}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black">{percent(plan.progress_percent)}%</span></div>
              <p className="mt-3 text-sm text-slate-700">{plan.objective}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width: `${percent(plan.progress_percent)}%`}} /></div>
              <p className="mt-2 text-xs text-slate-500">{dateLabel(plan.period_start, locale)} → {dateLabel(plan.period_end, locale)}{plan.next_review_on ? ` · ${fr ? "Revue" : "Review"}: ${dateLabel(plan.next_review_on, locale)}` : ""}</p>
              <form action={updateStaffGrowthProgressAction} className="mt-3 grid gap-2 sm:grid-cols-[100px_1fr_1fr_auto] sm:items-end"><input type="hidden" name="planId" value={plan.id} /><label className="text-[11px] font-black">%<input type="number" min="0" max="100" name="progressPercent" defaultValue={percent(plan.progress_percent)} className={field()} /></label><label className="text-[11px] font-black">{fr ? "Statut" : "Status"}<select name="status" defaultValue={plan.status} className={field()}><option value="active">{fr ? "Actif" : "Active"}</option><option value="paused">{fr ? "Pause" : "Paused"}</option><option value="completed">{fr ? "Terminé" : "Completed"}</option></select></label><label className="text-[11px] font-black">{fr ? "Prochaine revue" : "Next review"}<input type="date" name="nextReviewOn" defaultValue={plan.next_review_on ?? ""} className={field()} /></label><button className="rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white">{fr ? "Mettre à jour" : "Update"}</button></form>
            </div>
          ))}
          {!(canManage ? growthPlans : ownGrowth).length ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{fr ? "Aucun plan de croissance pour le moment." : "No growth plan yet."}</p> : null}
        </div>
      </article>

      <article id="reading-plans" className="scroll-mt-24 rounded-3xl border border-amber-200 bg-white p-6 shadow-sm">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "Lecture & réflexion" : "Reading & reflection"}</p><h3 className="mt-1 text-2xl font-black">📚 {fr ? "Plans de lecture" : "Reading plans"}</h3></div>
        {canManage ? (
          <form action={createStaffReadingPlanAction} className="mt-5 grid gap-3 rounded-2xl bg-amber-50/60 p-4 lg:grid-cols-2">
            <label className="text-xs font-black">{fr ? "Collaborateur" : "Employee"}<select name="userId" className={field()} required><option value="">{fr ? "Sélectionner..." : "Select..."}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profileName(profile, profile.id)}</option>)}</select></label>
            <label className="text-xs font-black">{fr ? "Livre" : "Book"}<input name="bookTitle" className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Auteur" : "Author"}<input name="author" className={field()} /></label>
            <label className="text-xs font-black">{fr ? "Plan de croissance lié (optionnel)" : "Linked growth plan (optional)"}<select name="growthPlanId" className={field()}><option value="">{fr ? "Aucun" : "None"}</option>{activeGrowthPlans.map((plan) => <option key={plan.id} value={plan.id}>{profileName(profileMap.get(plan.user_id), plan.user_id)} · {plan.focus_area}</option>)}</select></label>
            <label className="text-xs font-black">{fr ? "Début" : "Start"}<input type="date" name="startDate" defaultValue={today} className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Date cible" : "Target date"}<input type="date" name="targetDate" defaultValue={monthEnd} className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Nombre total" : "Total units"}<input type="number" min="1" name="totalUnits" defaultValue="10" className={field()} required /></label>
            <label className="text-xs font-black">{fr ? "Unité" : "Unit"}<select name="unitLabel" className={field()}><option value="chapters">{fr ? "Chapitres" : "Chapters"}</option><option value="pages">{fr ? "Pages" : "Pages"}</option><option value="sections">{fr ? "Sections" : "Sections"}</option></select></label>
            <label className="flex items-center gap-2 text-xs font-black"><input type="checkbox" name="summaryRequired" defaultChecked /> {fr ? "Compte rendu requis" : "Summary required"}</label>
            <div className="flex items-end"><button className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white">{fr ? "Assigner le livre" : "Assign book"}</button></div>
          </form>
        ) : null}
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {(canManage ? readingPlans : ownReading).slice(0, 10).map((plan) => {
            const readingPercent = plan.total_units ? Math.round((plan.completed_units / plan.total_units) * 100) : 0;
            return (
              <div key={plan.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-black">{plan.book_title}</p><p className="text-xs text-slate-500">{plan.author || (fr ? "Auteur non indiqué" : "Author not provided")} · {profileName(profileMap.get(plan.user_id), plan.user_id)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${plan.status === "overdue" ? "bg-red-100 text-red-800" : plan.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{readingPercent}%</span></div>
                <p className="mt-2 text-xs text-slate-500">{plan.completed_units}/{plan.total_units} {plan.unit_label} · {fr ? "Cible" : "Target"}: {dateLabel(plan.target_date, locale)}{plan.summary_required ? ` · ${fr ? "Compte rendu" : "Summary"}: ${plan.summary_status}` : ""}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-500" style={{width: `${Math.max(0, Math.min(100, readingPercent))}%`}} /></div>
                <form action={updateStaffReadingProgressAction} className="mt-3 space-y-2"><input type="hidden" name="readingPlanId" value={plan.id} /><div className="grid gap-2 sm:grid-cols-[150px_1fr]"><label className="text-[11px] font-black">{fr ? "Progression" : "Progress"}<input type="number" min="0" max={plan.total_units} name="completedUnits" defaultValue={plan.completed_units} className={field()} /></label><label className="text-[11px] font-black">{fr ? "Compte rendu / notes de lecture" : "Reading summary / notes"}<textarea name="summaryText" defaultValue={plan.summary_text} rows={2} className={field()} /></label></div><div className="flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" name="submitSummary" /> {fr ? "Soumettre le compte rendu" : "Submit summary"}</label><button className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">{fr ? "Enregistrer" : "Save"}</button></div></form>
              </div>
            );
          })}
          {!(canManage ? readingPlans : ownReading).length ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{fr ? "Aucun plan de lecture pour le moment." : "No reading plan yet."}</p> : null}
        </div>
      </article>
    </section>
  );
}
