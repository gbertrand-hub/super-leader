import {NextResponse} from "next/server";
import {COMMERCIAL_MANAGER_ROLES, canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type RecoveryRow = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  product_name: string;
  currency: string;
  total_amount: number | string;
  paid_amount: number | string;
  balance_amount: number | string;
  collection_owner_id: string | null;
  collection_status: string;
  next_payment_due_date: string | null;
  next_payment_amount: number | string | null;
  collection_promise_date: string | null;
  collection_next_action_at: string | null;
  collection_last_contact_at: string | null;
};

function safeCsv(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"));

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError || !membership || !canUseCommercialModules(membership.role)) {
    return new NextResponse("Accès refusé", {status: 403});
  }

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  const isLeader = COMMERCIAL_MANAGER_ROLES.has(membership.role);
  let query = admin
    .from("sales_records")
    .select("id,customer_name,customer_email,customer_phone,product_name,currency,total_amount,paid_amount,balance_amount,collection_owner_id,collection_status,next_payment_due_date,next_payment_amount,collection_promise_date,collection_next_action_at,collection_last_contact_at")
    .eq("organization_id", membership.organization_id)
    .gt("balance_amount", 0)
    .not("workflow_status", "in", "(rejected,cancelled,refunded)")
    .order("next_payment_due_date", {ascending: true, nullsFirst: false});

  if (membership.role === "manager") query = query.in("collection_owner_id", visibleUserIds);
  else if (!isLeader) query = query.eq("collection_owner_id", authData.user.id);

  const {data, error} = await query;
  if (error) return new NextResponse(`Export impossible : ${error.message}`, {status: 500});

  const rows = (data ?? []) as RecoveryRow[];
  const ownerIds = [...new Set(rows.map((row) => row.collection_owner_id).filter((id): id is string => Boolean(id)))];
  const {data: profiles} = ownerIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", ownerIds)
    : {data: []};
  const ownerById = new Map((profiles ?? []).map((profile) => [String(profile.id), String(profile.full_name || profile.email || "")]));

  const headings = ["Client", "E-mail", "Téléphone", "Produit", "Montant", "Payé", "Solde", "Devise", "Responsable", "Statut", "Prochaine échéance", "Montant échéance", "Promesse de paiement", "Prochaine action", "Dernier contact"];
  const csvRows = rows.map((row) => [
    row.customer_name,
    row.customer_email,
    row.customer_phone,
    row.product_name,
    row.total_amount,
    row.paid_amount,
    row.balance_amount,
    row.currency,
    row.collection_owner_id ? ownerById.get(row.collection_owner_id) ?? "" : "Non affecté",
    row.collection_status,
    row.next_payment_due_date,
    row.next_payment_amount,
    row.collection_promise_date,
    row.collection_next_action_at,
    row.collection_last_contact_at,
  ]);
  const csv = `\uFEFF${[headings, ...csvRows].map((row) => row.map(safeCsv).join(";")).join("\r\n")}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recouvrement-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
