import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);
const validStatuses = new Set(["submitted", "verified", "approved", "rejected", "cancelled", "refunded"]);

type Membership = {organization_id: string; role: string};
type SaleRow = {
  seller_id: string;
  product_name: string;
  customer_name: string;
  customer_email: string | null;
  sale_date: string;
  quantity: number;
  unit_price: number | string;
  total_amount: number | string;
  currency: string;
  payment_method: string;
  payment_status: string;
  workflow_status: string;
  transaction_reference: string | null;
  commission_amount: number | string;
  commission_status: string;
};
type ProfileRow = {id: string; full_name: string | null; email: string | null};

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(values: Array<string | number>) {
  return values.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) return new Response("Unauthorized", {status: 401});

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError || !membership) return new Response("Forbidden", {status: 403});

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const seller = url.searchParams.get("seller") ?? "";
  const isLeader = leaderRoles.has(membership.role);

  let query = admin
    .from("sales_records")
    .select("seller_id, product_name, customer_name, customer_email, sale_date, quantity, unit_price, total_amount, currency, payment_method, payment_status, workflow_status, transaction_reference, commission_amount, commission_status")
    .eq("organization_id", membership.organization_id)
    .order("sale_date", {ascending: false})
    .limit(5000);

  if (!isLeader) query = query.eq("seller_id", authData.user.id);
  if (isLeader && seller) query = query.eq("seller_id", seller);
  if (validStatuses.has(status)) query = query.eq("workflow_status", status);

  const {data, error} = await query;
  if (error) return new Response(error.message, {status: 500});
  const sales = (data ?? []) as SaleRow[];
  const sellerIds = [...new Set(sales.map((sale) => sale.seller_id))];
  const {data: profilesData} = sellerIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", sellerIds)
    : {data: [] as ProfileRow[]};
  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const {t} = await getI18n();

  const rows = [
    csvRow([
      t("sales.csv.date"),
      t("sales.csv.seller"),
      t("sales.csv.product"),
      t("sales.csv.customer"),
      t("sales.csv.customerEmail"),
      t("sales.csv.quantity"),
      t("sales.csv.unitPrice"),
      t("sales.csv.total"),
      t("sales.csv.currency"),
      t("sales.csv.paymentMethod"),
      t("sales.csv.paymentStatus"),
      t("sales.csv.workflowStatus"),
      t("sales.csv.transactionReference"),
      t("sales.csv.commission"),
      t("sales.csv.commissionStatus"),
    ]),
  ];

  sales.forEach((sale) => {
    const profile = profileById.get(sale.seller_id);
    rows.push(csvRow([
      sale.sale_date,
      profile?.full_name || profile?.email || sale.seller_id,
      sale.product_name,
      sale.customer_name,
      sale.customer_email ?? "",
      sale.quantity,
      Number(sale.unit_price).toFixed(2),
      Number(sale.total_amount).toFixed(2),
      sale.currency,
      t(`sales.paymentMethods.${sale.payment_method}`),
      t(`sales.paymentStatuses.${sale.payment_status}`),
      t(`sales.workflowStatuses.${sale.workflow_status}`),
      sale.transaction_reference ?? "",
      Number(sale.commission_amount).toFixed(2),
      t(`sales.commissionStatuses.${sale.commission_status}`),
    ]));
  });

  const filename = `super-leader-sales-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`\uFEFF${rows.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
