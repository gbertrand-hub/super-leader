import {getI18n} from "@/i18n/server";
import {REPORT_ROLES} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {loadReportAnalytics} from "@/lib/reports/analytics";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type OrganizationRelation =
  | {name?: string | null}
  | {name?: string | null}[]
  | null;

function firstOrganization(value: OrganizationRelation) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function csvCell(value: string | number) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function csvRow(values: Array<string | number>) {
  return values.map(csvCell).join(",");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "organisation";
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return new Response("Unauthorized", {status: 401});
  }

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership || !REPORT_ROLES.has(membership.role)) {
    return new Response("Forbidden", {status: 403});
  }

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  const {t, locale} = await getI18n();
  const url = new URL(request.url);
  const analytics = await loadReportAnalytics({
    organizationId: membership.organization_id,
    filters: {
      period: url.searchParams.get("period"),
      team: url.searchParams.get("team"),
      member: url.searchParams.get("member"),
    },
    locale,
    allowedMemberIds: membership.role === "manager" ? visibleUserIds : undefined,
  });

  const organizationName =
    firstOrganization(membership.organizations as OrganizationRelation)?.name ??
    t("reports.organizationFallback");
  const rows: string[] = [];

  rows.push(csvRow([t("reports.csvTitle"), organizationName]));
  rows.push(csvRow([t("reports.period"), t(`reports.periods.${analytics.filters.period}`)]));
  rows.push(csvRow([t("reports.scope"), analytics.selectedTeamName || analytics.selectedMemberName || t("reports.allOrganization")]));
  rows.push("");

  rows.push(csvRow([t("reports.indicator"), t("reports.value")]));
  rows.push(csvRow([t("reports.members"), analytics.metrics.memberCount]));
  rows.push(csvRow([t("reports.participationRate"), `${analytics.metrics.participationRate}%`]));
  rows.push(csvRow([t("reports.feedbackCountLabel"), analytics.metrics.feedbackCount]));
  rows.push(csvRow([t("reports.feedbackAverage"), analytics.metrics.feedbackAverage.toFixed(1)]));
  rows.push(csvRow([t("reports.recognitionCount"), analytics.metrics.recognitionCount]));
  rows.push(csvRow([t("reports.activePlans"), analytics.metrics.activePlans]));
  rows.push(csvRow([t("reports.completedPlans"), analytics.metrics.completedPlans]));
  rows.push(csvRow([t("reports.overduePlans"), analytics.metrics.overduePlans]));
  rows.push(csvRow([t("reports.averageProgressLabel"), `${analytics.metrics.averageProgress}%`]));
  rows.push("");

  rows.push(csvRow([t("reports.feedbackByCategory")]));
  rows.push(csvRow([t("reports.category"), t("reports.feedback"), t("reports.feedbackAverage")]));
  analytics.categories.forEach((category) => {
    rows.push(csvRow([
      t(`feedback.categories.${category.category}`),
      category.count,
      category.average.toFixed(1),
    ]));
  });
  rows.push("");

  rows.push(csvRow([t("reports.teamResults")]));
  rows.push(csvRow([
    t("reports.team"),
    t("reports.members"),
    t("reports.feedbackAverage"),
    t("reports.feedback"),
    t("reports.recognitions"),
    t("reports.activePlans"),
    t("reports.completionRate"),
  ]));
  analytics.teamMetrics.forEach((team) => {
    rows.push(csvRow([
      team.name,
      team.memberCount,
      team.feedbackAverage.toFixed(1),
      team.feedbackCount,
      team.recognitionCount,
      team.activePlans,
      `${team.completionRate}%`,
    ]));
  });

  const filename = `super-leader-${slugify(organizationName)}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`\uFEFF${rows.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
