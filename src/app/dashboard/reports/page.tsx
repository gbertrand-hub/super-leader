import Link from "next/link";
import {redirect} from "next/navigation";
import {ReportExportButtons} from "@/components/reports/report-export-buttons";
import {getI18n} from "@/i18n/server";
import {
  loadReportAnalytics,
  type ReportFilterInput,
} from "@/lib/reports/analytics";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const reportRoles = new Set(["owner", "admin", "hr", "manager"]);

type SearchParams = {
  period?: string | string[];
  team?: string | string[];
  member?: string | string[];
};

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

type OrganizationRelation =
  | {name?: string | null}
  | {name?: string | null}[]
  | null;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function firstOrganization(value: OrganizationRelation) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "slate" | "indigo" | "amber" | "emerald" | "red";
}) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-950",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    red: "border-red-200 bg-red-50 text-red-950",
  };

  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-sm font-bold opacity-65">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      {detail ? <p className="mt-2 text-xs font-semibold opacity-65">{detail}</p> : null}
    </article>
  );
}

export default async function ReportsPage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const params = (await searchParams) ?? {};
  const filterInput: ReportFilterInput = {
    period: firstValue(params.period),
    team: firstValue(params.team),
    member: firstValue(params.member),
  };

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      t("reports.loadError", {message: membershipError.message}),
    );
  }
  if (!membership) redirect("/dashboard/company");
  if (!reportRoles.has(membership.role)) redirect("/dashboard");

  const analytics = await loadReportAnalytics({
    organizationId: membership.organization_id,
    filters: filterInput,
    locale,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : t("common.unknownError");
    throw new Error(t("reports.loadError", {message}));
  });

  const organizationName =
    firstOrganization(membership.organizations as OrganizationRelation)?.name ??
    t("reports.organizationFallback");
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const generatedAt = new Intl.DateTimeFormat(dateLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(analytics.generatedAt));

  const csvParams = new URLSearchParams({period: analytics.filters.period});
  if (analytics.filters.teamId) csvParams.set("team", analytics.filters.teamId);
  if (analytics.filters.memberId) csvParams.set("member", analytics.filters.memberId);
  const csvHref = `/api/reports/export?${csvParams.toString()}`;

  const categoryMax = Math.max(
    ...analytics.categories.map((category) => category.count),
    1,
  );
  const monthlyMax = Math.max(
    ...analytics.monthly.flatMap((month) => [
      month.feedbackCount,
      month.recognitionCount,
      month.completedPlans,
    ]),
    1,
  );
  const statusTotal = analytics.actionStatuses.reduce(
    (sum, status) => sum + status.count,
    0,
  );

  const scopeParts = [
    analytics.selectedTeamName,
    analytics.selectedMemberName,
  ].filter(Boolean);
  const scopeLabel = scopeParts.length
    ? scopeParts.join(" · ")
    : t("reports.allOrganization");

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-7xl print:max-w-none">
        <header className="rounded-3xl bg-slate-950 p-7 text-white print:rounded-none print:bg-white print:p-0 print:text-slate-950">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400 print:text-slate-500">
                {t("reports.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black">{t("reports.title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300 print:text-slate-600">
                {t("reports.subtitle")}
              </p>
              <p className="mt-3 text-sm font-semibold text-slate-400 print:text-slate-500">
                {organizationName} · {scopeLabel} · {t(`reports.periods.${analytics.filters.period}`)}
              </p>
            </div>
            <ReportExportButtons
              csvHref={csvHref}
              csvLabel={t("reports.exportCsv")}
              pdfLabel={t("reports.printPdf")}
            />
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
          <form method="get" className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto_auto] lg:items-end">
            <label className="block">
              <span className="text-sm font-black text-slate-700">{t("reports.period")}</span>
              <select
                name="period"
                defaultValue={analytics.filters.period}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                {(["30", "90", "180", "365", "all"] as const).map((period) => (
                  <option key={period} value={period}>
                    {t(`reports.periods.${period}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-black text-slate-700">{t("reports.teamFilter")}</span>
              <select
                name="team"
                defaultValue={analytics.filters.teamId}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                <option value="">{t("reports.allTeams")}</option>
                {analytics.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.department ? `${team.department} · ` : ""}{team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-black text-slate-700">{t("reports.memberFilter")}</span>
              <select
                name="member"
                defaultValue={analytics.filters.memberId}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                <option value="">{t("reports.allMembers")}</option>
                {analytics.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {t(`roles.${member.role}`)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white hover:bg-indigo-800"
            >
              {t("reports.applyFilters")}
            </button>
            <Link
              href="/dashboard/reports"
              className="rounded-xl border border-slate-300 px-5 py-3 text-center font-black text-slate-700 hover:bg-slate-50"
            >
              {t("reports.reset")}
            </Link>
          </form>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t("reports.participationRate")}
            value={`${analytics.metrics.participationRate}%`}
            detail={t("reports.membersInScope", {count: analytics.metrics.memberCount})}
            tone="indigo"
          />
          <MetricCard
            label={t("reports.feedbackAverage")}
            value={`${analytics.metrics.feedbackAverage.toFixed(1)} / 5`}
            detail={t("reports.feedbackCount", {count: analytics.metrics.feedbackCount})}
          />
          <MetricCard
            label={t("reports.recognitionCount")}
            value={analytics.metrics.recognitionCount}
            detail={t("reports.periodActivity")}
            tone="amber"
          />
          <MetricCard
            label={t("reports.activePlans")}
            value={analytics.metrics.activePlans}
            detail={t("reports.averageProgress", {value: analytics.metrics.averageProgress})}
            tone="emerald"
          />
          <MetricCard
            label={t("reports.completedPlans")}
            value={analytics.metrics.completedPlans}
            detail={t("reports.periodActivity")}
            tone="emerald"
          />
          <MetricCard
            label={t("reports.overduePlans")}
            value={analytics.metrics.overduePlans}
            detail={t("reports.requiresAttention")}
            tone={analytics.metrics.overduePlans ? "red" : "slate"}
          />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">{t("reports.monthlyEvolution")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("reports.monthlyEvolutionHelp")}</p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs font-bold text-slate-600">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-indigo-600" />{t("reports.feedback")}</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />{t("reports.recognitions")}</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />{t("reports.completed")}</span>
              </div>
            </div>

            <div className="mt-7 grid min-h-64 grid-cols-[repeat(auto-fit,minmax(66px,1fr))] items-end gap-3 border-b border-slate-200 pb-3">
              {analytics.monthly.map((month) => (
                <div key={month.key} className="flex h-56 min-w-0 flex-col justify-end">
                  <div className="flex h-44 items-end justify-center gap-1.5">
                    <div
                      className="w-3 rounded-t bg-indigo-600"
                      style={{height: month.feedbackCount ? `${Math.max(4, (month.feedbackCount / monthlyMax) * 100)}%` : "0%"}}
                      title={`${t("reports.feedback")}: ${month.feedbackCount}`}
                    />
                    <div
                      className="w-3 rounded-t bg-amber-400"
                      style={{height: month.recognitionCount ? `${Math.max(4, (month.recognitionCount / monthlyMax) * 100)}%` : "0%"}}
                      title={`${t("reports.recognitions")}: ${month.recognitionCount}`}
                    />
                    <div
                      className="w-3 rounded-t bg-emerald-500"
                      style={{height: month.completedPlans ? `${Math.max(4, (month.completedPlans / monthlyMax) * 100)}%` : "0%"}}
                      title={`${t("reports.completed")}: ${month.completedPlans}`}
                    />
                  </div>
                  <p className="mt-3 truncate text-center text-[11px] font-bold text-slate-500">
                    {month.label}
                  </p>
                  <p className="mt-1 text-center text-[11px] font-black text-indigo-700">
                    {month.feedbackAverage.toFixed(1)}/5
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{t("reports.actionPlanHealth")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("reports.actionPlanHealthHelp")}</p>
            <div className="mt-6 space-y-4">
              {analytics.actionStatuses.map((status) => {
                const width = statusTotal ? (status.count / statusTotal) * 100 : 0;
                return (
                  <div key={status.status}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-bold">{t(`actionPlans.statuses.${status.status}`)}</span>
                      <span className="font-black">{status.count}</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-600"
                        style={{width: `${width}%`}}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{t("reports.feedbackByCategory")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("reports.feedbackByCategoryHelp")}</p>
            <div className="mt-6 space-y-4">
              {analytics.categories.map((category) => (
                <div key={category.category}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-bold">{t(`feedback.categories.${category.category}`)}</span>
                    <span className="font-black">
                      {category.average.toFixed(1)}/5 · {category.count}
                    </span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-600"
                      style={{width: `${(category.count / categoryMax) * 100}%`}}
                    />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{t("reports.recognitionByBadge")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("reports.recognitionByBadgeHelp")}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {analytics.badges.map((badge) => (
                <div key={badge.badge} className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-950">{t(`recognition.badges.${badge.badge}`)}</p>
                  <p className="mt-2 text-2xl font-black text-amber-800">{badge.count}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">{t("reports.teamResults")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("reports.teamResultsHelp")}</p>
            </div>
          </div>

          {analytics.teamMetrics.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.team")}</th>
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.members")}</th>
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.feedbackAverage")}</th>
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.feedback")}</th>
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.recognitions")}</th>
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.activePlans")}</th>
                    <th className="border-b border-slate-200 px-4 py-3">{t("reports.completionRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.teamMetrics.map((team) => (
                    <tr key={team.id} className="odd:bg-slate-50/70">
                      <td className="border-b border-slate-100 px-4 py-4">
                        <p className="font-black">{team.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{team.department || t("teams.noDepartment")}</p>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-4 font-bold">{team.memberCount}</td>
                      <td className="border-b border-slate-100 px-4 py-4 font-black text-indigo-700">{team.feedbackAverage.toFixed(1)} / 5</td>
                      <td className="border-b border-slate-100 px-4 py-4 font-bold">{team.feedbackCount}</td>
                      <td className="border-b border-slate-100 px-4 py-4 font-bold">{team.recognitionCount}</td>
                      <td className="border-b border-slate-100 px-4 py-4 font-bold">{team.activePlans}</td>
                      <td className="border-b border-slate-100 px-4 py-4 font-black text-emerald-700">{team.completionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 rounded-2xl bg-slate-50 p-5 text-slate-600">{t("reports.noTeamData")}</p>
          )}
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <p>{t("reports.generatedAt", {date: generatedAt})}</p>
          <p>{t("reports.confidential")}</p>
        </footer>
      </div>
    </main>
  );
}
