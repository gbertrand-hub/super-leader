import {cantonLocalQaWriteEnabled} from "@/lib/canton/feature-gate";
import Link from "next/link";
import {redirect} from "next/navigation";
import {signOutAction} from "@/app/actions/auth";
import {getI18n} from "@/i18n/server";
import {
  REPORT_ROLES,
  canUseCommercialModules,
  isPeopleAdmin,
  isTeamManager,
  normalizeOrganizationRole,
} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {getOrganizationEntitlements, hasSubscriptionFeature} from "@/lib/billing/entitlements";
import {
  academyStaffRoleToResponsibilityCode,
  buildEffectiveAcademyResponsibilityProfiles,
  getAcademyResponsibilityProfileFrom,
  type AcademyResponsibilityProfileOverrideRow,
} from "@/lib/academy/responsibilities";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export default async function DashboardPage() {
  // Local Canton QA uses a minimal schema and should open the targeted module.
  if (cantonLocalQaWriteEnabled()) redirect("/dashboard/canton-visitors");
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const {locale, t} = await getI18n();
  const fullName = data.user.user_metadata?.full_name ?? "Leader";
  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, sector)")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    const {count: studentEnrollmentCount} = await admin
      .from("academy_school_enrollments")
      .select("id", {count: "exact", head: true})
      .eq("user_id", data.user.id)
      .in("academic_status", ["admitted", "enrolled", "active"]);
    if ((studentEnrollmentCount ?? 0) > 0) {
    redirect("/dashboard/academy/student");
    }
  }

  const rawOrganization = membership?.organizations;
  const organization = Array.isArray(rawOrganization)
    ? rawOrganization[0]
    : rawOrganization;

  let receivedCount = 0;
  let averageScore = "0.0";
  let recognitionCount = 0;
  let actionPlanCount = 0;
  let salesThisMonthCount = 0;
  let crmClientCount = 0;
  let unreadNotificationCount = 0;
  let academyAssignedCount = 0;
  let academyCompletedCount = 0;
  let academyResponsibilityCount = 0;
  let academyResponsibilityLabels: string[] = [];
  let hasAcademySchoolDirection = false;
  let missingDailyPriorityCount = 0;
  let isVipGrowthMembershipManager = false;
  let demoRequest: {
    organization_name: string;
    status: string;
    scheduled_demo_at: string | null;
    preferred_demo_date: string | null;
    sales_notes: string | null;
  } | null = null;
  const role = normalizeOrganizationRole(membership?.role);
  const dailyReportsManagementHref = ["owner", "admin", "hr"].includes(role)
    ? "/dashboard/hr/daily-reports"
    : "/dashboard/performance?view=reports#report-governance";
  const dailyReportsTileCopy = locale === "fr"
    ? {
        title: ["manager", "executive"].includes(role) ? "Rapports de mon équipe" : "Rapports de la journée",
        description: "Un collaborateur a raté l’heure limite ? Réouvrez sa date pour qu’il soumette lui-même son rapport, ou complétez-le à sa place. Toutes les actions sont journalisées.",
        action: "Gérer les rapports →",
        badge: "Accès rapide",
      }
    : {
        title: ["manager", "executive"].includes(role) ? "My team reports" : "Daily reports",
        description: "Did an employee miss the deadline? Reopen that date so they can submit the report, or complete it on their behalf. Every action is audited.",
        action: "Manage reports →",
        badge: "Quick access",
      };  const canManagePeople = isPeopleAdmin(role);
  let canManageTeams = isTeamManager(role);
  let canUseCommercial = canUseCommercialModules(role);
  let canUseFeedbackAutomation = ["owner", "admin", "manager"].includes(role);
  let isReportLeader = REPORT_ROLES.has(role);
  let canUseAcademy = true;
  let canUseFeedback = true;
  let canUseRecognition = true;
  let canUsePerformance = true;
  let canUseGrowth = true;
  let visibleUserIds = [data.user.id];

  if (!organization) {
    const {data: request} = await admin
      .from("demo_requests")
      .select("organization_name,status,scheduled_demo_at,preferred_demo_date,sales_notes")
      .or(`requester_user_id.eq.${data.user.id},email.eq.${data.user.email ?? ""}`)
      .order("created_at", {ascending: false})
      .limit(1)
      .maybeSingle();
    demoRequest = request ?? null;
  }

  if (organization && membership?.organization_id) {
    const {data: vipGrowthSettings, error: vipGrowthSettingsError} = await admin
      .from("vip_program_settings")
      .select("vip_growth_membership_manager_user_id")
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{vip_growth_membership_manager_user_id: string | null}>();
    if (!vipGrowthSettingsError) {
      isVipGrowthMembershipManager = vipGrowthSettings?.vip_growth_membership_manager_user_id === data.user.id;
    }

    const entitlements = await getOrganizationEntitlements(String(membership.organization_id));
    canManageTeams = canManageTeams && hasSubscriptionFeature(entitlements, "teams");
    canUseCommercial = canUseCommercial && hasSubscriptionFeature(entitlements, "crm_sales");
    canUseFeedbackAutomation = canUseFeedbackAutomation && hasSubscriptionFeature(entitlements, "feedback_automation");
    isReportLeader = isReportLeader && hasSubscriptionFeature(entitlements, "reports_advanced");
    canUseAcademy = hasSubscriptionFeature(entitlements, "academy");
    canUseFeedback = hasSubscriptionFeature(entitlements, "core_feedback");
    canUseRecognition = hasSubscriptionFeature(entitlements, "recognition");
    canUsePerformance = hasSubscriptionFeature(entitlements, "performance");
    canUseGrowth = hasSubscriptionFeature(entitlements, "growth");

    visibleUserIds = await getVisibleUserIds({
      admin,
      organizationId: membership.organization_id,
      actorId: data.user.id,
      role,
    });
    const [{data: received}, {count: recognitions}, {count: actionPlans}] =
      await Promise.all([
        admin
          .from("peer_feedback")
          .select("score")
          .eq("organization_id", membership.organization_id)
          .eq("recipient_id", data.user.id)
          .eq("status", "published"),
        admin
          .from("recognitions")
          .select("id", {count: "exact", head: true})
          .eq("organization_id", membership.organization_id)
          .eq("recipient_id", data.user.id),
        admin
          .from("action_plans")
          .select("id", {count: "exact", head: true})
          .eq("organization_id", membership.organization_id)
          .eq("owner_id", data.user.id)
          .not("status", "in", "(completed,cancelled)"),
      ]);

    receivedCount = received?.length ?? 0;
    recognitionCount = recognitions ?? 0;
    actionPlanCount = actionPlans ?? 0;

    if (receivedCount) {
      averageScore = (
        received!.reduce((sum, item) => sum + item.score, 0) / receivedCount
      ).toFixed(1);
    }

    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
    if (canUseCommercial) {
      let salesCountQuery = admin
        .from("sales_records")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .gte("sale_date", monthStart)
        .not("workflow_status", "in", "(rejected,cancelled,refunded)");

      if (role === "manager") {
        salesCountQuery = salesCountQuery.in("seller_id", visibleUserIds);
      } else if (role === "employee") {
        salesCountQuery = salesCountQuery.eq("seller_id", data.user.id);
      }

      const {count: salesCount, error: salesError} = await salesCountQuery;
      if (!salesError) salesThisMonthCount = salesCount ?? 0;

      let crmCountQuery = admin
        .from("crm_clients")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id);

      if (role === "manager") {
        const scopedIds = visibleUserIds.join(",");
        crmCountQuery = crmCountQuery.or(
          `owner_id.in.(${scopedIds}),follow_up_owner_id.in.(${scopedIds})`,
        );
      } else if (role === "employee") {
        crmCountQuery = crmCountQuery.or(
          `owner_id.eq.${data.user.id},follow_up_owner_id.eq.${data.user.id}`,
        );
      }

      const {count: clientsCount, error: crmError} = await crmCountQuery;
      if (!crmError) crmClientCount = clientsCount ?? 0;
    }

    const {count: notificationCount, error: notificationError} = await admin
      .from("notifications")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", membership.organization_id)
      .eq("user_id", data.user.id)
      .eq("status", "unread");
    if (!notificationError) unreadNotificationCount = notificationCount ?? 0;

    if (canUsePerformance && ["owner", "admin", "executive", "hr", "manager"].includes(role) && visibleUserIds.length) {
      const workDate = new Date().toISOString().slice(0, 10);
      const [{data: attendanceRows, error: attendanceRowsError}, {data: planRows, error: planRowsError}] = await Promise.all([
        admin.from("attendance_records")
          .select("user_id")
          .eq("organization_id", membership.organization_id)
          .eq("work_date", workDate)
          .in("user_id", visibleUserIds)
          .not("clock_in_at", "is", null),
        admin.from("daily_work_plans")
          .select("user_id")
          .eq("organization_id", membership.organization_id)
          .eq("work_date", workDate)
          .in("user_id", visibleUserIds),
      ]);
      if (!attendanceRowsError && !planRowsError) {
        const submitted = new Set((planRows ?? []).map((row) => String(row.user_id)));
        missingDailyPriorityCount = new Set((attendanceRows ?? []).map((row) => String(row.user_id)).filter((id) => !submitted.has(id))).size;
      }
    }

    if (canUseAcademy) {
      const [
        {count: academyAssigned, error: academyAssignedError},
        {count: academyCompleted, error: academyCompletedError},
        {data: staffAssignments, error: staffAssignmentsError},
        {data: manualAssignments, error: manualAssignmentsError},
        {data: responsibilityOverrides, error: responsibilityOverridesError},
      ] = await Promise.all([
        admin
          .from("academy_enrollments")
          .select("id", {count: "exact", head: true})
          .eq("organization_id", membership.organization_id)
          .eq("user_id", data.user.id),
        admin
          .from("academy_enrollments")
          .select("id", {count: "exact", head: true})
          .eq("organization_id", membership.organization_id)
          .eq("user_id", data.user.id)
          .eq("status", "completed"),
        admin
          .from("academy_staff_assignments")
          .select("id, assignment_role")
          .eq("organization_id", membership.organization_id)
          .eq("user_id", data.user.id)
          .eq("is_active", true),
        admin
          .from("academy_responsibility_assignments")
          .select("id, role_code")
          .eq("organization_id", membership.organization_id)
          .eq("user_id", data.user.id)
          .eq("is_active", true),
        admin
          .from("academy_responsibility_profile_overrides")
          .select("role_code, profile_json, revision, is_customized")
          .eq("organization_id", membership.organization_id),
      ]);

      if (!academyAssignedError) academyAssignedCount = academyAssigned ?? 0;
      if (!academyCompletedError) academyCompletedCount = academyCompleted ?? 0;

      if (!staffAssignmentsError && !manualAssignmentsError) {
        const staffRows = staffAssignments ?? [];
        const manualRows = manualAssignments ?? [];
        academyResponsibilityCount = staffRows.length + manualRows.length;

        const roleCodes = new Set<string>();
        for (const row of staffRows) {
          const code = academyStaffRoleToResponsibilityCode(String(row.assignment_role ?? ""));
          if (code) roleCodes.add(code);
          if (String(row.assignment_role) === "director") hasAcademySchoolDirection = true;
        }
        for (const row of manualRows) {
          const code = String(row.role_code ?? "");
          if (code) roleCodes.add(code);
          if (code === "school_direction") hasAcademySchoolDirection = true;
        }

        const effectiveProfiles = buildEffectiveAcademyResponsibilityProfiles(
          responsibilityOverridesError
            ? []
            : ((responsibilityOverrides ?? []) as AcademyResponsibilityProfileOverrideRow[]),
        );
        academyResponsibilityLabels = [...roleCodes]
          .map((code) => getAcademyResponsibilityProfileFrom(effectiveProfiles, code))
          .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
          .map((profile) => profile.title[locale === "fr" ? "fr" : "en"]);
      }
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-amber-400">★ {t("brand.name")}</p>
            <h1 className="mt-2 text-3xl font-extrabold">
              {t("dashboard.greeting", {name: fullName})}
            </h1>
            <p className="mt-1 text-slate-300">
              {organization
                ? `${organization.name} · ${t(`roles.${membership?.role ?? "employee"}`)}`
                : t("dashboard.createCompanyPrompt")}
            </p>
          </div>
          <form action={signOutAction}>
            <button
              className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 hover:bg-slate-100"
              type="submit"
            >
              {t("navigation.logout")}
            </button>
          </form>
        </header>

        {!organization ? (
          <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-7">
            <p className="text-sm font-bold uppercase tracking-wide text-indigo-700">
              Demande de démonstration
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {demoRequest
                ? `${demoRequest.organization_name} · ${demoRequest.status}`
                : "Compte en attente d’activation"}
            </h2>
            <p className="mt-2 max-w-3xl text-slate-700">
              {demoRequest
                ? "Votre compte est créé, mais aucun espace organisationnel n’est activé automatiquement. L’équipe Super Leader vous contactera pour la démonstration, l’essai et la configuration de votre organisation."
                : "Aucune organisation active n’est associée à ce compte. Si vous êtes collaborateur iLEAD, utilisez la demande d’accès interne. Pour une organisation externe, contactez l’équipe Super Leader."}
            </p>
            {demoRequest?.scheduled_demo_at ? (
              <p className="mt-4 rounded-xl bg-white px-4 py-3 font-bold text-indigo-800">
                Démonstration programmée : {new Date(demoRequest.scheduled_demo_at).toLocaleString("fr-FR")}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Link className="inline-flex rounded-xl bg-slate-950 px-5 py-3 font-bold text-white" href="/ilead-access">
                Demander l’accès iLEAD Global
              </Link>
              <Link className="inline-flex rounded-xl border border-indigo-300 bg-white px-5 py-3 font-bold text-indigo-800" href="/">
                Retour au site
              </Link>
            </div>
          </section>
        ) : (
          <nav className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Link href="/dashboard/notifications" className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm hover:border-red-400">
              <p className="text-lg font-black text-red-950">{t("dashboard.notificationsTitle")}</p>
              <p className="mt-2 text-sm text-red-800">{t("dashboard.notificationsDescription")}</p>
              {unreadNotificationCount > 0 ? <span className="mt-4 inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white">{unreadNotificationCount} {t("dashboard.unreadNotifications")}</span> : null}
            </Link>
            {canManagePeople ? (
              <Link href="/dashboard/company" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
                <p className="text-lg font-black">{t("dashboard.companyTitle")}</p>
                <p className="mt-2 text-sm text-slate-600">{t("dashboard.companyDescription")}</p>
              </Link>
            ) : null}
            {["owner", "admin", "executive", "hr"].includes(role) ? (
              <Link href="/dashboard/executive" className="rounded-2xl border border-violet-200 bg-violet-50 p-6 shadow-sm hover:border-violet-400">
                <p className="text-lg font-black text-violet-950">{t("dashboard.executiveTitle")}</p>
                <p className="mt-2 text-sm text-violet-800">{t("dashboard.executiveDescription")}</p>
              </Link>
            ) : null}
            {canManageTeams ? (
              <Link href="/dashboard/team" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
                <p className="text-lg font-black">{t("dashboard.teamsTitle")}</p>
                <p className="mt-2 text-sm text-slate-600">{t("dashboard.teamsDescription")}</p>
              </Link>
            ) : null}
            {canManageTeams ? (
              <Link href="/dashboard/members" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
                <p className="text-lg font-black">{t("dashboard.membersTitle")}</p>
                <p className="mt-2 text-sm text-slate-600">{t("dashboard.membersDescription")}</p>
              </Link>
            ) : null}
            {canUseAcademy ? <Link href="/dashboard/academy" className="rounded-2xl border border-blue-200 bg-blue-50 p-6 shadow-sm hover:border-blue-400">
              <p className="text-lg font-black text-blue-950">{t("dashboard.academyTitle")}</p>
              <p className="mt-2 text-sm text-blue-800">{t("dashboard.academyDescription")}</p>
            </Link> : null}
            {canUseAcademy && academyResponsibilityCount > 0 ? (
              <Link
                href="/dashboard/academy/responsibilities"
                className="rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-indigo-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-500 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">
                      {locale === "fr" ? "Académie · Responsabilités" : "Academy · Responsibilities"}
                    </p>
                    <p className="mt-2 text-lg font-black text-violet-950">
                      {hasAcademySchoolDirection
                        ? (locale === "fr" ? "Pilotage des responsabilités" : "Responsibility leadership")
                        : (locale === "fr" ? "Mes responsabilités Académie" : "My Academy responsibilities")}
                    </p>
                  </div>
                  <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-black text-white">
                    {academyResponsibilityCount}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-violet-900">
                  {academyResponsibilityLabels.length
                    ? academyResponsibilityLabels.slice(0, 3).join(" · ")
                    : (locale === "fr" ? "Responsabilité Académie active" : "Active Academy responsibility")}
                </p>
                <p className="mt-4 text-sm font-black text-violet-950">
                  {hasAcademySchoolDirection
                    ? (locale === "fr" ? "Voir ma fiche et le pilotage de mon école →" : "Open my role and school responsibility view →")
                    : (locale === "fr" ? "Voir ma mission, mes tâches et mes KPI →" : "View my mission, tasks and KPIs →")}
                </p>
              </Link>
            ) : null}
            {canUseFeedback ? <Link href="/dashboard/feedback" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm hover:border-indigo-400">
              <p className="text-lg font-black text-indigo-950">{t("dashboard.feedbackTitle")}</p>
              <p className="mt-2 text-sm text-indigo-700">{t("dashboard.feedbackDescription")}</p>
            </Link> : null}
            {canUseRecognition ? <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm hover:border-amber-400">
              <p className="text-lg font-black text-amber-950">{t("dashboard.recognitionTitle")}</p>
              <p className="mt-2 text-sm text-amber-800">{t("dashboard.recognitionDescription")}</p>
            </Link> : null}
            {canUseCommercial ? (
              <Link href="/dashboard/sales" className="rounded-2xl border border-cyan-200 bg-cyan-50 p-6 shadow-sm hover:border-cyan-400">
                <p className="text-lg font-black text-cyan-950">{t("dashboard.salesTitle")}</p>
                <p className="mt-2 text-sm text-cyan-800">{t("dashboard.salesDescription")}</p>
              </Link>
            ) : null}
            {canUseCommercial ? (
              <Link href="/dashboard/crm" className="rounded-2xl border border-violet-200 bg-violet-50 p-6 shadow-sm hover:border-violet-400">
                <p className="text-lg font-black text-violet-950">{t("dashboard.crmTitle")}</p>
                <p className="mt-2 text-sm text-violet-800">{t("dashboard.crmDescription")}</p>
              </Link>
            ) : null}
            {isVipGrowthMembershipManager ? (
              <Link href="/dashboard/vip/growth" className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-500 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-rose-700">SUPER LEADER VIP</p>
                    <p className="mt-2 text-lg font-black text-rose-950">{locale === "fr" ? "Pilotage commercial & marketing VIP" : "VIP Commercial & Marketing Command Center"}</p>
                  </div>
                  <span className="rounded-full bg-rose-600 px-3 py-1 text-xs font-black text-white">VIP</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-rose-900">{locale === "fr" ? "Pilote les campagnes, prospects, conversions, adhésions, sources d’acquisition et performances VIP." : "Manage VIP campaigns, prospects, conversions, memberships, acquisition sources and performance."}</p>
                <p className="mt-4 text-sm font-black text-rose-950">{locale === "fr" ? "Ouvrir mon cockpit VIP →" : "Open my VIP cockpit →"}</p>
              </Link>
            ) : null}
            {canUseFeedbackAutomation ? (
              <Link href="/dashboard/feedback-automation" className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-6 shadow-sm hover:border-fuchsia-400">
                <p className="text-lg font-black text-fuchsia-950">{t("dashboard.feedbackAutomationTitle")}</p>
                <p className="mt-2 text-sm text-fuchsia-800">{t("dashboard.feedbackAutomationDescription")}</p>
              </Link>
            ) : null}
            {canUsePerformance ? <Link href="/dashboard/performance" className="rounded-2xl border border-orange-200 bg-orange-50 p-6 shadow-sm hover:border-orange-400">
              <p className="text-lg font-black text-orange-950">{t("dashboard.performanceTitle")}</p>
              <p className="mt-2 text-sm text-orange-800">{t("dashboard.performanceDescription")}</p>
            </Link> : null}
            {canUseGrowth ? (
              <Link href="/dashboard/growth" className="rounded-2xl border border-lime-200 bg-lime-50 p-6 shadow-sm hover:border-lime-400">
                <p className="text-lg font-black text-lime-950">Plan de croissance</p>
                <p className="mt-2 text-sm text-lime-800">Objectifs, développement et contributions d’impact.</p>
              </Link>
            ) : null}
            {["owner", "admin"].includes(role) ? (
              <Link href="/dashboard/subscription" className="rounded-2xl border border-slate-300 bg-slate-100 p-6 shadow-sm hover:border-indigo-400">
                <p className="text-lg font-black text-slate-950">Abonnement & plans</p>
                <p className="mt-2 text-sm text-slate-700">Consulte le plan, les limites et les fonctionnalités actives.</p>
              </Link>
            ) : null}
            {isReportLeader ? (
              <Link href="/dashboard/reports" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm hover:border-emerald-400">
                <p className="text-lg font-black text-emerald-950">{t("dashboard.reportsTitle")}</p>
                <p className="mt-2 text-sm text-emerald-800">{t("dashboard.reportsDescription")}</p>
              </Link>
            ) : null}
          </nav>
        )}

        {organization ? (
        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {canUsePerformance && ["owner", "admin", "executive", "hr", "manager"].includes(role) ? (
            <Link
              href="/dashboard/hr/daily-priorities"
              className="rounded-2xl border-2 border-yellow-300 bg-yellow-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-yellow-500 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-yellow-700">{locale === "fr" ? "Accès rapide" : "Quick access"}</p>
                  <p className="mt-2 text-xl font-black text-yellow-950">🎯 {locale === "fr" ? (["manager", "executive"].includes(role) ? "Priorités de mon équipe" : "Priorités des équipes") : (["manager", "executive"].includes(role) ? "My team priorities" : "Team priorities")}</p>
                </div>
                <span className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-black text-slate-950">{missingDailyPriorityCount}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-yellow-900">{locale === "fr" ? "Après 10h, vois immédiatement qui n’a pas soumis ses priorités et réouvre uniquement sa saisie avec motif, durée et audit." : "After 10am, immediately see who has not submitted priorities and reopen only that employee’s submission with a reason, duration and audit trail."}</p>
              <p className="mt-4 text-sm font-black text-yellow-950">{locale === "fr" ? "Gérer les priorités →" : "Manage priorities →"}</p>
            </Link>
          ) : null}
          {isReportLeader ? (
            <Link
              href={dailyReportsManagementHref}
              className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-md"
            >
              {/* MANAGER_DAILY_REPORT_TILE_V4_8_62 */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">
                    {dailyReportsTileCopy.badge}
                  </p>
                  <p className="mt-2 text-xl font-black text-amber-950">
                    📝 {dailyReportsTileCopy.title}
                  </p>
                </div>
                <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-950">
                  RAPPORTS
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-amber-900">
                {dailyReportsTileCopy.description}
              </p>
              <p className="mt-4 text-sm font-black text-amber-950">
                {dailyReportsTileCopy.action}
              </p>
            </Link>
          ) : null}
          <Link href="/dashboard/notifications" className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm hover:bg-red-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.notificationsTitle")}</p>
            <p className="mt-3 text-4xl font-black">{unreadNotificationCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.notificationsDescription")}</p>
          </Link>
          {canUseAcademy ? <Link href="/dashboard/academy" className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm hover:bg-blue-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.academyProgress")}</p>
            <p className="mt-3 text-4xl font-black">{academyCompletedCount}/{academyAssignedCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.academyProgressDescription")}</p>
          </Link> : null}
          {canUseFeedback ? <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.feedbackReceived")}</p>
            <p className="mt-3 text-4xl font-black">{receivedCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.averageScore", {score: averageScore})}</p>
          </article> : null}
          {canUseRecognition ? <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm hover:bg-amber-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.recognitions")}</p>
            <p className="mt-3 text-4xl font-black">{recognitionCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.recognitionsDescription")}</p>
          </Link> : null}
          <Link href="/dashboard/actions" className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm hover:bg-indigo-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.actionPlans")}</p>
            <p className="mt-3 text-4xl font-black">{actionPlanCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.actionPlansDescription")}</p>
          </Link>
          {canUseCommercial ? (
            <Link href="/dashboard/sales" className="rounded-2xl border border-cyan-200 bg-white p-6 shadow-sm hover:bg-cyan-50">
              <p className="text-sm font-semibold text-slate-500">{t("sales.salesThisMonth")}</p>
              <p className="mt-3 text-4xl font-black">{salesThisMonthCount}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{role === "employee"
                ? t("sales.scopePersonal")
                : role === "manager"
                  ? t("sales.scopeTeam")
                  : t("sales.scopeOrganisation")}</p>
            </Link>
          ) : null}
          {canUseCommercial ? (
            <Link href="/dashboard/crm" className="rounded-2xl border border-violet-200 bg-white p-6 shadow-sm hover:bg-violet-50">
              <p className="text-sm font-semibold text-slate-500">{t("dashboard.crmClients")}</p>
              <p className="mt-3 text-4xl font-black">{crmClientCount}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.crmClientsDescription")}</p>
            </Link>
          ) : null}
        </section>
        ) : null}
      </div>
    </main>
  );
}
