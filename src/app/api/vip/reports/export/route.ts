import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {loadVipReportAnalytics} from "@/lib/vip/reports";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);

function cell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
function row(values: Array<string | number>) {
  return values.map(cell).join(",");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) return new Response("Unauthorized", {status: 401});

  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) return new Response("Forbidden", {status: 403});
  if (!VIP_ROLES.has(membership.role)) {
    const {data: growthSettings} = await admin
      .from("vip_program_settings")
      .select("vip_growth_membership_manager_user_id")
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{vip_growth_membership_manager_user_id: string | null}>();
    if (growthSettings?.vip_growth_membership_manager_user_id !== authData.user.id) {
      return new Response("Forbidden", {status: 403});
    }
  }

  const url = new URL(request.url);
  const analytics = await loadVipReportAnalytics({organizationId: membership.organization_id, filters: {period: url.searchParams.get("period"), country: url.searchParams.get("country")}});
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const lines: string[] = [];
  lines.push(row([fr ? "Rapport Super Leader VIP" : "Super Leader VIP Report", analytics.generatedAt]));
  lines.push(row([fr ? "Période" : "Period", analytics.filters.period]));
  lines.push(row([fr ? "Pays" : "Country", analytics.filters.country || (fr ? "Tous" : "All")]));
  lines.push("");
  lines.push(row([fr ? "Indicateur" : "Indicator", fr ? "Valeur" : "Value"]));
  Object.entries(analytics.metrics).forEach(([key, value]) => lines.push(row([key, Number(value)])));
  lines.push("");
  lines.push(row([fr ? "Activité" : "Activity", fr ? "Volume" : "Volume"]));
  Object.entries(analytics.activity).forEach(([key, value]) => lines.push(row([key, Number(value)])));
  lines.push("");
  lines.push(row([fr ? "Statuts membres" : "Member statuses"]));
  analytics.memberStatuses.forEach((item) => lines.push(row([item.label, item.count])));
  lines.push("");
  lines.push(row([fr ? "Pays représentés" : "Represented countries"]));
  analytics.memberCountries.forEach((item) => lines.push(row([item.label, item.count])));
  lines.push("");
  lines.push(row([fr ? "Statuts voyages" : "Travel statuses"]));
  analytics.travelStatuses.forEach((item) => lines.push(row([item.label, item.count])));
  lines.push("");
  lines.push(row([fr ? "Diffusion communications" : "Communication delivery"]));
  analytics.deliveryStatuses.forEach((item) => lines.push(row([item.label, item.count])));

  const filename = `super-leader-vip-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`\uFEFF${lines.join("\r\n")}`, {headers: {"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store"}});
}
