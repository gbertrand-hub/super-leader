import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Payslip = {
  id: string;
  payroll_entry_id: string;
  password_protected: boolean;
  password_mode: string;
  password_hint: string | null;
  published_at: string;
  file_name: string;
};

type Entry = {
  id: string;
  payroll_period_id: string;
  gross_amount: number | string;
  deduction_amount: number | string;
  tax_amount: number | string;
  net_amount: number | string;
  status: string;
};

type Period = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  pay_date: string | null;
  currency: string;
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(locale: string, currency: string, value: number | string | null | undefined) {
  return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: 2}).format(number(value));
}

function date(locale: string, value: string | null | undefined, includeTime = false) {
  if (!value) return "—";
  const parsed = includeTime ? new Date(value) : new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, includeTime ? {dateStyle: "medium", timeStyle: "short"} : {dateStyle: "medium"}).format(parsed);
}

export default async function MyPayslipsPage() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const dateLocale = fr ? "fr-FR" : "en-US";

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");

  const schemaCheck = await admin.from("payslips").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{fr ? "Espace personnel" : "Personal space"}</p>
            <h1 className="mt-2 text-4xl font-black">{fr ? "Mes bulletins de paie" : "My payslips"}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{fr ? "Activation du module requise" : "Module setup required"}</h2>
            <p className="mt-3 leading-7 text-amber-900">{fr ? "L’administrateur doit exécuter la migration Finance & Paie V3.0." : "The administrator must run the Finance & Payroll V3.0 migration."}</p>
          </section>
        </div>
      </main>
    );
  }

  const {data: payslipRows, error: payslipError} = await admin
    .from("payslips")
    .select("id, payroll_entry_id, password_protected, password_mode, password_hint, published_at, file_name")
    .eq("organization_id", membership.organization_id)
    .eq("employee_user_id", authData.user.id)
    .order("published_at", {ascending: false});
  if (payslipError) throw new Error(payslipError.message);
  const payslips = (payslipRows ?? []) as Payslip[];

  const entryIds = payslips.map((payslip) => payslip.payroll_entry_id);
  const {data: entryRows, error: entryError} = entryIds.length
    ? await admin
      .from("payroll_entries")
      .select("id, payroll_period_id, gross_amount, deduction_amount, tax_amount, net_amount, status")
      .in("id", entryIds)
      .eq("employee_user_id", authData.user.id)
    : {data: [] as Entry[], error: null};
  if (entryError) throw new Error(entryError.message);
  const entries = (entryRows ?? []) as Entry[];
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

  const periodIds = Array.from(new Set(entries.map((entry) => entry.payroll_period_id)));
  const {data: periodRows, error: periodError} = periodIds.length
    ? await admin
      .from("payroll_periods")
      .select("id, name, period_start, period_end, pay_date, currency")
      .in("id", periodIds)
    : {data: [] as Period[], error: null};
  if (periodError) throw new Error(periodError.message);
  const periods = (periodRows ?? []) as Period[];
  const periodMap = new Map(periods.map((period) => [period.id, period]));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <header className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl">
          <div className="grid gap-6 p-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{fr ? "Espace personnel confidentiel" : "Confidential personal space"}</p>
              <h1 className="mt-2 text-4xl font-black">{fr ? "Mes bulletins de paie" : "My payslips"}</h1>
              <p className="mt-3 max-w-2xl text-slate-300">{fr ? "Consulte et télécharge uniquement les bulletins publiés pour ton propre compte." : "View and download only the payslips published for your own account."}</p>
            </div>
            {[
              "owner",
              "admin",
            ].includes(membership.role) ? <Link href="/dashboard/finance?view=payroll" className="rounded-xl bg-white px-5 py-3 text-center text-sm font-black text-slate-950">{fr ? "Gérer la paie" : "Manage payroll"}</Link> : null}
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-blue-200 bg-blue-50 p-6">
          <h2 className="text-lg font-black text-blue-950">{fr ? "Protection de tes documents" : "Protection of your documents"}</h2>
          <p className="mt-2 leading-7 text-blue-900">{fr ? "Super Leader utilise un stockage privé et un lien de téléchargement temporaire. Chaque accès est enregistré. Un bulletin protégé demandera également son mot de passe dans ton lecteur PDF." : "Super Leader uses private storage and a temporary download link. Every access is logged. A protected payslip will also request its password in your PDF reader."}</p>
        </section>

        <section className="mt-6 space-y-4">
          {payslips.length ? payslips.map((payslip) => {
            const entry = entryMap.get(payslip.payroll_entry_id);
            const period = entry ? periodMap.get(entry.payroll_period_id) : undefined;
            const currency = period?.currency || "USD";
            return (
              <article key={payslip.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black uppercase tracking-wide text-violet-700">{period?.name || (fr ? "Période de paie" : "Payroll period")}</p>
                    <h2 className="mt-1 text-2xl font-black">{date(dateLocale, period?.period_start)} - {date(dateLocale, period?.period_end)}</h2>
                    <p className="mt-1 text-sm text-slate-500">{fr ? "Publié le" : "Published on"} {date(dateLocale, payslip.published_at, true)}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${payslip.password_protected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                    {payslip.password_protected ? (fr ? "PDF protégé" : "Protected PDF") : (fr ? "Sans mot de passe" : "No password")}
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{fr ? "Salaire brut" : "Gross pay"}</p><p className="mt-1 text-xl font-black">{money(dateLocale, currency, entry?.gross_amount)}</p></div>
                  <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{fr ? "Déductions et taxes" : "Deductions and tax"}</p><p className="mt-1 text-xl font-black">{money(dateLocale, currency, number(entry?.deduction_amount) + number(entry?.tax_amount))}</p></div>
                  <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">{fr ? "Salaire net" : "Net pay"}</p><p className="mt-1 text-xl font-black text-emerald-900">{money(dateLocale, currency, entry?.net_amount)}</p></div>
                </div>

                {payslip.password_hint ? <p className="mt-4 rounded-xl bg-violet-50 p-4 text-sm text-violet-900"><strong>{fr ? "Indice :" : "Hint:"}</strong> {payslip.password_hint}</p> : null}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link href={`/api/attachments/payslip/${payslip.id}`} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{fr ? "Télécharger le bulletin" : "Download payslip"}</Link>
                  <span className="text-xs font-bold text-slate-500">{payslip.file_name}</span>
                </div>
              </article>
            );
          }) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <h2 className="text-2xl font-black">{fr ? "Aucun bulletin disponible" : "No payslip available"}</h2>
              <p className="mt-3 text-slate-500">{fr ? "Tu recevras une notification dès qu’un bulletin sera publié pour ton compte." : "You will receive a notification as soon as a payslip is published for your account."}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
