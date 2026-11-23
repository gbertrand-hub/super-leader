import {redirect} from "next/navigation";
import {decideSaleCommissionAction, paySaleCommissionAction} from "@/app/actions/finance-commissions";
import {canManageCommissions} from "@/lib/auth/sensitive-finance-access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<{success?: string; error?: string}>};
type Sale = {
  id: string;
  seller_id: string;
  customer_name: string;
  product_name: string;
  sale_date: string;
  currency: string;
  total_amount: number | string;
  paid_amount: number | string;
  proof_storage_path: string | null;
  proof_url: string | null;
  workflow_status: string;
  commission_review_status: string;
  commission_beneficiary_id: string | null;
  commission_amount: number | string;
  commission_policy_reference: string | null;
  commission_justification: string | null;
  commission_payment_reference: string | null;
};
type Profile = {id: string; full_name: string | null; email: string | null};

function money(value: number | string, currency: string) {
  try {
    return new Intl.NumberFormat("fr-FR", {style: "currency", currency}).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
}

function MyCommissions({rows}: {rows: Sale[]}) {
  const approved = rows.filter((row) => row.commission_review_status === "eligible");
  const paid = rows.filter((row) => row.commission_review_status === "paid");
  const total = rows.reduce((sum, row) => sum + Number(row.commission_amount), 0);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[.18em] text-amber-300">MON ESPACE · LECTURE SEULE</p>
          <h1 className="mt-2 text-3xl font-black">Mes commissions validées</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Seules les commissions qui te sont personnellement attribuées et validées par Finance apparaissent ici.
            Les calculs, décisions et paiements restent sous la responsabilité exclusive de Finance.
          </p>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          {[["Validées", approved.length], ["Payées", paid.length], ["Montant total", rows.length ? money(total, rows[0].currency) : "—"]].map(([label, value]) => (
            <article key={String(label)} className="rounded-2xl border bg-white p-5">
              <p className="text-sm font-bold text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-3xl border bg-white p-6">
          <h2 className="text-2xl font-black">Historique de mes commissions</h2>
          <div className="mt-5 space-y-3">
            {rows.map((row) => (
              <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
                <div>
                  <p className="font-black">{row.product_name}</p>
                  <p className="text-sm text-slate-500">Vente du {row.sale_date}</p>
                  <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-black ${row.commission_review_status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                    {row.commission_review_status === "paid" ? "Payée" : "Validée par Finance"}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-emerald-700">{money(row.commission_amount, row.currency)}</p>
                  {row.commission_review_status === "paid" && row.commission_payment_reference ? (
                    <p className="text-xs font-bold text-slate-500">Réf. {row.commission_payment_reference}</p>
                  ) : null}
                </div>
              </article>
            ))}
            {!rows.length ? <p className="rounded-xl bg-slate-50 p-5 font-bold text-slate-500">Aucune commission validée pour le moment.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

export default async function CommissionsPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");

  const managesCommissions = await canManageCommissions(
    admin,
    membership.organization_id,
    auth.user.id,
    membership.role,
  );

  let query = admin
    .from("sales_records")
    .select("id,seller_id,customer_name,product_name,sale_date,currency,total_amount,paid_amount,proof_storage_path,proof_url,workflow_status,commission_review_status,commission_beneficiary_id,commission_amount,commission_policy_reference,commission_justification,commission_payment_reference")
    .eq("organization_id", membership.organization_id)
    .eq("workflow_status", "approved")
    .order("sale_date", {ascending: false})
    .limit(managesCommissions ? 500 : 100);

  if (!managesCommissions) {
    query = query
      .eq("commission_beneficiary_id", auth.user.id)
      .in("commission_review_status", ["eligible", "paid"]);
  }

  const {data: sales, error} = await query;
  if (error) {
    const missing = ["42703", "PGRST204"].includes(String(error.code ?? ""));
    if (missing) {
      return <main className="p-8"><div className="mx-auto max-w-3xl rounded-3xl bg-amber-50 p-8"><h1 className="text-2xl font-black">Migration V4.6.8 révisée requise</h1><code className="mt-4 block rounded-xl bg-slate-950 p-4 text-white">supabase/067_finance_commission_decisions_v4_6_8.sql</code></div></main>;
    }
    throw new Error(error.message);
  }

  const rows = (sales ?? []) as Sale[];
  if (!managesCommissions) return <MyCommissions rows={rows} />;

  const profileIds = [...new Set(rows.flatMap((row) => [row.seller_id, row.commission_beneficiary_id].filter(Boolean) as string[]))];
  const {data: profiles} = profileIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", profileIds)
    : {data: []};
  const names = new Map(((profiles ?? []) as Profile[]).map((profile) => [profile.id, profile.full_name || profile.email || "Membre"]));
  const unreviewed = rows.filter((row) => row.commission_review_status === "not_reviewed");
  const eligible = rows.filter((row) => row.commission_review_status === "eligible");
  const paid = rows.filter((row) => row.commission_review_status === "paid");

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-7xl">
      <header className="rounded-3xl bg-gradient-to-r from-slate-950 via-violet-950 to-slate-900 p-7 text-white"><p className="text-sm font-black uppercase tracking-[.18em] text-amber-300">FINANCE · CONFIDENTIEL</p><h1 className="mt-2 text-3xl font-black">Décisions de commission</h1><p className="mt-3 max-w-3xl text-slate-300">Finance examine chaque vente approuvée et décide de son éligibilité selon la politique définie par le PDG. Le département Vente ne participe ni au calcul, ni à la décision, ni au paiement.</p></header>
      {params.success ? <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-bold text-emerald-900">{params.success}</p> : null}{params.error ? <p className="mt-5 rounded-2xl bg-red-50 p-4 font-bold text-red-800">{params.error}</p> : null}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">{[["À examiner", unreviewed.length], ["À payer", eligible.length], ["Payées", paid.length]].map(([label, value]) => <article key={String(label)} className="rounded-2xl border bg-white p-5"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>)}</section>
      <section className="mt-6 rounded-3xl border bg-white p-6"><h2 className="text-2xl font-black">Ventes à examiner pour commission</h2><div className="mt-5 space-y-4">{unreviewed.map((sale) => <form action={decideSaleCommissionAction} key={sale.id} className="rounded-2xl border p-5"><input type="hidden" name="saleId" value={sale.id}/><div><p className="font-black">{sale.customer_name} · {sale.product_name}</p><p className="text-sm text-slate-500">Vendeur : {names.get(sale.seller_id)} · {sale.sale_date}</p><p className="mt-1 font-bold">Vente {money(sale.total_amount, sale.currency)} · encaissé {money(sale.paid_amount, sale.currency)}</p>{sale.proof_storage_path ? <a className="text-sm font-bold text-indigo-700 underline" href={`/api/attachments/sale/${sale.id}`}>Ouvrir le reçu</a> : sale.proof_url ? <a className="text-sm font-bold text-indigo-700 underline" href={sale.proof_url} target="_blank" rel="noreferrer">Ouvrir le reçu</a> : <p className="text-sm font-bold text-red-700">Aucun reçu joint</p>}</div><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="font-bold">Bénéficiaire<select name="beneficiaryId" className="mt-1 w-full rounded-xl border px-3 py-2"><option value="">— Choisir si éligible —</option>{((profiles ?? []) as Profile[]).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email}</option>)}</select></label><label className="font-bold">Montant<input name="amount" type="number" min="0.01" step="0.01" className="mt-1 w-full rounded-xl border px-3 py-2"/></label><label className="font-bold md:col-span-2">Politique du PDG appliquée<input name="policyReference" maxLength={300} placeholder="Ex. Politique commerciale 2026, article 4" className="mt-1 w-full rounded-xl border px-3 py-2"/></label><label className="font-bold md:col-span-2">Justification obligatoire<textarea required name="justification" maxLength={1500} rows={2} className="mt-1 w-full rounded-xl border px-3 py-2"/></label></div><div className="mt-4 flex gap-3"><button name="decision" value="eligible" className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white">Déclarer éligible</button><button name="decision" value="ineligible" className="rounded-xl bg-red-700 px-4 py-2 font-black text-white">Déclarer non éligible</button></div></form>)}{!unreviewed.length ? <p className="rounded-xl bg-slate-50 p-5 font-bold text-slate-500">Aucune vente en attente d’examen.</p> : null}</div></section>
      <section className="mt-6 rounded-3xl border bg-white p-6"><h2 className="text-2xl font-black">Commissions décidées par Finance</h2><div className="mt-5 space-y-3">{rows.filter((row) => row.commission_review_status !== "not_reviewed").map((sale) => <article key={sale.id} className="rounded-2xl border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-black">{sale.customer_name} · {sale.product_name}</p><p className="text-sm text-slate-500">{sale.commission_review_status} · {sale.commission_justification}</p>{sale.commission_policy_reference ? <p className="text-sm font-bold text-violet-800">Politique : {sale.commission_policy_reference}</p> : null}</div>{sale.commission_review_status !== "ineligible" ? <div className="text-right"><p className="text-xl font-black text-emerald-700">{money(sale.commission_amount, sale.currency)}</p><p className="text-sm">{names.get(sale.commission_beneficiary_id ?? "")}</p></div> : null}</div>{sale.commission_review_status === "eligible" ? <form action={paySaleCommissionAction} className="mt-4 flex flex-wrap gap-2"><input type="hidden" name="saleId" value={sale.id}/><input required name="paymentReference" placeholder="Référence de paiement" className="rounded-xl border px-3 py-2"/><button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">Marquer payée</button></form> : null}{sale.commission_payment_reference ? <p className="mt-2 text-sm font-bold">Référence : {sale.commission_payment_reference}</p> : null}</article>)}</div></section>
    </div></main>
  );
}
