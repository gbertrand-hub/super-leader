import Link from "next/link";
import {redirect} from "next/navigation";
import {signOutAction} from "@/app/actions/auth";
import {getI18n} from "@/i18n/server";
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

  if (organization && membership?.organization_id) {
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
    const {count: salesCount, error: salesError} = await admin
      .from("sales_records")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", membership.organization_id)
      .eq("seller_id", data.user.id)
      .gte("sale_date", monthStart)
      .not("workflow_status", "in", "(rejected,cancelled,refunded)");
    if (!salesError) salesThisMonthCount = salesCount ?? 0;
    const {count: clientsCount, error: crmError} = await admin
      .from("crm_clients")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", membership.organization_id);
    if (!crmError) crmClientCount = clientsCount ?? 0;
  }

  const isReportLeader = ["owner", "admin", "hr", "manager"].includes(
    membership?.role ?? "",
  );

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
            <Link href="/dashboard/company" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
              <p className="text-lg font-black">{t("dashboard.companyTitle")}</p>
              <p className="mt-2 text-sm text-slate-600">{t("dashboard.companyDescription")}</p>
            </Link>
            <Link href="/dashboard/team" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
              <p className="text-lg font-black">{t("dashboard.teamsTitle")}</p>
              <p className="mt-2 text-sm text-slate-600">{t("dashboard.teamsDescription")}</p>
            </Link>
            <Link href="/dashboard/members" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-indigo-300">
              <p className="text-lg font-black">{t("dashboard.membersTitle")}</p>
              <p className="mt-2 text-sm text-slate-600">{t("dashboard.membersDescription")}</p>
            </Link>
            <Link href="/dashboard/feedback" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm hover:border-indigo-400">
              <p className="text-lg font-black text-indigo-950">{t("dashboard.feedbackTitle")}</p>
              <p className="mt-2 text-sm text-indigo-700">{t("dashboard.feedbackDescription")}</p>
            </Link>
            <Link href="/dashboard/recognition" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm hover:border-amber-400">
              <p className="text-lg font-black text-amber-950">{t("dashboard.recognitionTitle")}</p>
              <p className="mt-2 text-sm text-amber-800">{t("dashboard.recognitionDescription")}</p>
            </Link>
            <Link href="/dashboard/sales" className="rounded-2xl border border-cyan-200 bg-cyan-50 p-6 shadow-sm hover:border-cyan-400">
              <p className="text-lg font-black text-cyan-950">{t("dashboard.salesTitle")}</p>
              <p className="mt-2 text-sm text-cyan-800">{t("dashboard.salesDescription")}</p>
            </Link>
            <Link href="/dashboard/crm" className="rounded-2xl border border-violet-200 bg-violet-50 p-6 shadow-sm hover:border-violet-400">
              <p className="text-lg font-black text-violet-950">{t("dashboard.crmTitle")}</p>
              <p className="mt-2 text-sm text-violet-800">{t("dashboard.crmDescription")}</p>
            </Link>
            {isReportLeader ? (
              <Link href="/dashboard/feedback-automation" className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-6 shadow-sm hover:border-fuchsia-400">
                <p className="text-lg font-black text-fuchsia-950">{t("dashboard.feedbackAutomationTitle")}</p>
                <p className="mt-2 text-sm text-fuchsia-800">{t("dashboard.feedbackAutomationDescription")}</p>
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

        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
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
          <Link href="/dashboard/sales" className="rounded-2xl border border-cyan-200 bg-white p-6 shadow-sm hover:bg-cyan-50">
            <p className="text-sm font-semibold text-slate-500">{t("sales.salesThisMonth")}</p>
            <p className="mt-3 text-4xl font-black">{salesThisMonthCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("sales.scopePersonal")}</p>
          </Link>
          <Link href="/dashboard/crm" className="rounded-2xl border border-violet-200 bg-white p-6 shadow-sm hover:bg-violet-50">
            <p className="text-sm font-semibold text-slate-500">{t("dashboard.crmClients")}</p>
            <p className="mt-3 text-4xl font-black">{crmClientCount}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("dashboard.crmClientsDescription")}</p>
          </Link>
        </section>
      </div>
    </main>
  );
}
