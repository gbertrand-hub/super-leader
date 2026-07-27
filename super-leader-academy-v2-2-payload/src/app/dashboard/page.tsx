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
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const {t} = await getI18n();
  const fullName = data.user.user_metadata?.full_name ?? "Leader";
  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, sector)")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

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
  const role = normalizeOrganizationRole(membership?.role);
  const canManagePeople = isPeopleAdmin(role);
  const canManageTeams = isTeamManager(role);
  const canUseCommercial = canUseCommercialModules(role);
  const canUseFeedbackAutomation = ["owner", "admin", "manager"].includes(role);
  const isReportLeader = REPORT_ROLES.has(role);
  let visibleUserIds = [data.user.id];

  if (organization && membership?.organization_id) {
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

    const [{count: notificationCount, error: notificationError}, {count: academyAssigned, error: academyAssignedError}, {count: academyCompleted, error: academyCompletedError}] = await Promise.all([
      admin
        .from("notifications")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .eq("user_id", data.user.id)
        .eq("status", "unread"),
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
    ]);
    if (!notificationError) unreadNotificationCount = notificationCount ?? 0;
    if (!academyAssignedError) academyAssignedCount = academyAssigned ?? 0;
    if (!academyCompletedError) academyCompletedCount = academyCompleted ?? 0;
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
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <p className="text-sm font-bold uppercase tracking-wide text-amber-700">
              {t("dashboard.initialSetup")}
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {t("dashboard.createWorkspace")}
            </h2>
            <p className="mt-2 max-w-2xl text-slate-600">
              {t("dashboard.createWorkspaceDescription")}
            </p>
            <Link
              className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-bold text-white"
              href="/dashboard/company"
            >
              {t("dashboard.configureCompany")}
            </Link>
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
            <Link href="/dashboard/academy" className="rounded-2xl border border-blue-200 bg-blue-50 p-6 shadow-sm hover:border-blue-400">
              <p className="text-lg font-black text-blue-950">{t("dashboard.academyTitle")}</p>
              <p className="mt-2 text-sm text-blue-800">{t("dashboard.academyDescription")}</p>
            </Link>
            <Link href="/dashboard/feedback" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm hover:border-indigo-400">
              <p className="text-lg font-black text-indigo-950">{t("dashboard.feedbackTitle")}</p>
              <p className="mt-2 text-sm text-indigo-700">{t("dashboard.feedbackDescription")}</p>
            </Link>
            <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm hover:border-amber-400">
              <p className="text-lg font-black text-amber-950">{t("dashboard.recognitionTitle")}</p>
              <p className="mt-2 text-sm text-amber-800">{t("dashboard.recognitionDescription")}</p>
            </Link>
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
            {canUseFeedbackAutomation ? (
              <Link href="/dashboard/feedback-automation" className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-6 shadow-sm hover:border-fuchsia-400">
                <p className="text-lg font-black text-fuchsia-950">{t("dashboard.feedbackAutomationTitle")}</p>
                <p className="mt-2 text-sm text-fuchsia-800">{t("dashboard.feedbackAutomationDescription")}</p>
              </Link>
            ) : null}
            <Link href="/dashboard/performance" className="rounded-2xl border border-orange-200 bg-orange-50 p-6 shadow-sm hover:border-orange-400">
              <p className="text-lg font-black text-orange-950">{t("dashboard.performanceTitle")}</p>
              <p className="mt-2 text-sm text-orange-800">{t("dashboard.performanceDescription")}</p>
            </Link>
            {isReportLeader ? (
              <Link href="/dashboard/reports" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm hover:border-emerald-400">
                <p className="text-lg font-black text-emerald-950">{t("dashboard.reportsTitle")}</p>
                <p className="mt-2 text-sm text-emerald-800">{t("dashboard.reportsDescription")}</p>
              </Link>
            ) : null}
          </nav>
        )}

        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <Link href="/dashboard/notifications" className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm hover:bg-red-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.notificationsTitle")}</p>
            <p className="mt-3 text-4xl font-black">{unreadNotificationCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.notificationsDescription")}</p>
          </Link>
          <Link href="/dashboard/academy" className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm hover:bg-blue-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.academyProgress")}</p>
            <p className="mt-3 text-4xl font-black">{academyCompletedCount}/{academyAssignedCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.academyProgressDescription")}</p>
          </Link>
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.feedbackReceived")}</p>
            <p className="mt-3 text-4xl font-black">{receivedCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.averageScore", {score: averageScore})}</p>
          </article>
          <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm hover:bg-amber-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.recognitions")}</p>
            <p className="mt-3 text-4xl font-black">{recognitionCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.recognitionsDescription")}</p>
          </Link>
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
      </div>
    </main>
  );
}
