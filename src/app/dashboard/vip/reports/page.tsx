import Link from "next/link";
import {redirect} from "next/navigation";
import {CountrySelect} from "@/components/forms/country-select";
import {ReportExportButtons} from "@/components/reports/report-export-buttons";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {loadVipReportAnalytics} from "@/lib/vip/reports";

const VIP_ROLES = ["owner", "admin", "executive", "hr"];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Metric({label, value, help, tone = "slate"}: {label: string; value: string | number; help?: string; tone?: "slate" | "rose" | "emerald" | "amber" | "sky"}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    rose: "border-rose-200 bg-rose-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    sky: "border-sky-200 bg-sky-50",
  };
  return <article className={`rounded-3xl border p-5 shadow-sm ${tones[tone]}`}><p className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-4xl font-black text-slate-950">{value}</p>{help ? <p className="mt-2 text-sm text-slate-600">{help}</p> : null}</article>;
}

function Distribution({title, items, label}: {title: string; items: Array<{label: string; count: number}>; label: (value: string) => string}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-5 space-y-4">
        {items.map((item) => <div key={item.label}><div className="flex justify-between gap-3 text-sm font-bold"><span>{label(item.label)}</span><span>{item.count}</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-rose-600" style={{width: `${Math.max(4, Math.round((item.count / max) * 100))}%`}} /></div></div>)}
        {items.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-500">—</p> : null}
      </div>
    </article>
  );
}

export default async function VipReportsPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const params = await searchParams;
  const period = first(params.period) || "90";
  const country = first(params.country);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  if (!VIP_ROLES.includes(membership.role)) {
    const {data: growthSettings} = await admin
      .from("vip_program_settings")
      .select("vip_growth_membership_manager_user_id")
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{vip_growth_membership_manager_user_id: string | null}>();
    if (growthSettings?.vip_growth_membership_manager_user_id !== authData.user.id) redirect("/dashboard/my-day");
  }

  const schemaCheck = await admin.from("vip_communications").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return <MigrationRequired fr={fr} />;
  }

  const analytics = await loadVipReportAnalytics({organizationId: membership.organization_id, filters: {period, country}});
  const csv = new URLSearchParams({period: analytics.filters.period});
  if (analytics.filters.country) csv.set("country", analytics.filters.country);
  const label = (value: string) => c.labels[value as keyof typeof c.labels] ?? value.replace(/_/g, " ");
  const generatedAt = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(analytics.generatedAt));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-7xl print:max-w-none">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl print:rounded-none print:bg-white print:p-0 print:text-slate-950">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300 print:text-slate-500">Super Leader VIP · V3.2.8</p><h1 className="mt-2 text-3xl font-black">{c.title}</h1><p className="mt-2 max-w-3xl text-slate-300 print:text-slate-600">{c.subtitle}</p><p className="mt-3 text-xs font-semibold text-slate-400 print:text-slate-500">{c.generated} {generatedAt}</p></div>
            <div className="flex flex-wrap gap-3"><ReportExportButtons csvHref={`/api/vip/reports/export?${csv.toString()}`} csvLabel={c.exportCsv} pdfLabel={c.printPdf} /><Link href="/dashboard/vip" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black text-white hover:bg-white/10 print:hidden">← {c.back}</Link></div>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
          <form method="get" className="grid gap-4 md:grid-cols-[1fr_1.4fr_auto_auto] md:items-end">
            <label className="block"><span className="text-sm font-black text-slate-700">{c.period}</span><select name="period" defaultValue={analytics.filters.period} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">{Object.entries(c.periods).map(([value, labelText]) => <option key={value} value={value}>{labelText}</option>)}</select></label>
            <label className="block"><span className="text-sm font-black text-slate-700">{c.country}</span><CountrySelect name="country" locale={fr ? "fr" : "en"} defaultValue={analytics.filters.country} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" emptyLabel={c.allCountries} /></label>
            <button className="rounded-xl bg-rose-700 px-5 py-3 font-black text-white hover:bg-rose-800">{c.apply}</button><Link href="/dashboard/vip/reports" className="rounded-xl border border-slate-300 px-5 py-3 text-center font-black text-slate-700">{c.reset}</Link>
          </form>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={c.activeMembers} value={analytics.metrics.activeMemberCount} help={`${analytics.metrics.memberCount} ${c.totalRecords}`} tone="rose" />
          <Metric label={c.expiringSoon} value={analytics.metrics.expiringSoonCount} help={c.next90Days} tone="amber" />
          <Metric label={c.openTravel} value={analytics.metrics.openTravelCount} help={`${analytics.metrics.openServiceCount} ${c.openServices}`} tone="sky" />
          <Metric label={c.deliveryRate} value={`${analytics.metrics.deliveryRate}%`} help={`${analytics.metrics.publishedCommunicationCount} ${c.publishedCommunications}`} tone="emerald" />
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={c.pendingNominations} value={analytics.metrics.pendingNominationCount} />
          <Metric label={c.pendingRenewals} value={analytics.metrics.pendingRenewalCount} />
          <Metric label={c.activePartners} value={analytics.metrics.activePartnerCount} />
          <Metric label={c.activeBenefits} value={analytics.metrics.activeBenefitCount} help={`${analytics.metrics.realizedBenefitValue.toFixed(2)} ${c.realizedValue}`} />
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">{c.periodActivity}</h2><p className="mt-2 text-slate-600">{c.periodActivityHelp}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              [c.nominations, analytics.activity.nominations], [c.renewals, analytics.activity.renewals], [c.travelRequests, analytics.activity.travelRequests], [c.benefitRequests, analytics.activity.benefitRequests], [c.communications, analytics.activity.communications], [c.deliveryItems, analytics.activity.deliveries],
            ].map(([name, value]) => <div key={String(name)} className="rounded-2xl bg-slate-50 p-4 text-center"><p className="text-3xl font-black">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{name}</p></div>)}
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <Distribution title={c.memberStatuses} items={analytics.memberStatuses} label={label} />
          <Distribution title={c.topCountries} items={analytics.memberCountries} label={label} />
          <Distribution title={c.recognitionCategories} items={analytics.recognitionCategories} label={label} />
          <Distribution title={c.travelStatuses} items={analytics.travelStatuses} label={label} />
          <Distribution title={c.benefitStatuses} items={analytics.redemptionStatuses} label={label} />
          <Distribution title={c.communicationDelivery} items={analytics.deliveryStatuses} label={label} />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-3">
          <AlertList title={c.expiringMembers} empty={c.noAlerts} items={analytics.alerts.expiringMembers.map((item) => `${item.expires_on} · ${item.full_name} (${item.member_number}) · ${item.country || c.noCountry}`)} />
          <AlertList title={c.upcomingTravel} empty={c.noAlerts} items={analytics.alerts.upcomingTravel.map((item) => `${item.arrival_date} · ${item.destination_country} · ${label(item.status)}`)} />
          <AlertList title={c.upcomingMeetings} empty={c.noAlerts} items={analytics.alerts.upcomingMeetings.map((item) => `${item.start_date} · ${item.host_country} · ${label(item.status)}`)} />
        </section>
      </div>
    </main>
  );
}

function AlertList({title, items, empty}: {title: string; items: string[]; empty: string}) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{title}</h2><div className="mt-4 space-y-2">{items.map((item, index) => <p key={`${item}-${index}`} className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">{item}</p>)}{items.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{empty}</p> : null}</div></article>;
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-5xl"><header className="rounded-3xl bg-slate-950 p-8 text-white"><p className="text-sm font-black uppercase tracking-[0.18em] text-rose-300">Super Leader V3.2.8</p><h1 className="mt-2 text-4xl font-black">Super Leader VIP</h1></header><section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7"><h2 className="text-2xl font-black text-amber-950">{fr ? "Migration Rapports requise" : "Reports migration required"}</h2><p className="mt-3 text-amber-900">{fr ? "Exécute la migration suivante dans Supabase." : "Run the following migration in Supabase."}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/047_super_leader_vip_communications_reports_v3_2_7.sql</code></section></div></main>;
}

const copy = {
  fr: {
    title: "Rapports VIP", subtitle: "Pilote le programme avec des indicateurs consolidés sur les membres, cartes, voyages, rencontres, avantages et communications.", generated: "Généré le", exportCsv: "Exporter CSV", printPdf: "Imprimer / PDF", back: "Retour au VIP", period: "Période d’activité", country: "Pays", allCountries: "Tous les pays", apply: "Appliquer", reset: "Réinitialiser", periods: {"30": "30 derniers jours", "90": "90 derniers jours", "180": "180 derniers jours", "365": "12 derniers mois", all: "Toute la période"}, activeMembers: "Membres actifs", totalRecords: "dossiers au total", expiringSoon: "Échéances proches", next90Days: "Dans les 90 prochains jours", openTravel: "Voyages ouverts", openServices: "services encore ouverts", deliveryRate: "Diffusions suivies", publishedCommunications: "communications publiées", pendingNominations: "Nominations en attente", pendingRenewals: "Renouvellements en attente", activePartners: "Partenaires actifs", activeBenefits: "Avantages actifs", realizedValue: "de valeur enregistrée", periodActivity: "Activité de la période", periodActivityHelp: "Volumes créés ou demandés pendant la période choisie.", nominations: "Nominations", renewals: "Renouvellements", travelRequests: "Demandes de voyage", benefitRequests: "Demandes d’avantage", communications: "Communications", deliveryItems: "Envois suivis", memberStatuses: "Statuts des membres", topCountries: "Pays les plus représentés", recognitionCategories: "Catégories de reconnaissance", travelStatuses: "Statuts des voyages", benefitStatuses: "Utilisation des avantages", communicationDelivery: "Diffusion des communications", expiringMembers: "Membres à renouveler", upcomingTravel: "Voyages à venir", upcomingMeetings: "Rencontres à venir", noAlerts: "Aucune alerte.", noCountry: "Pays non renseigné", labels: {active: "Actif", pending_renewal: "À renouveler", expired: "Expiré", suspended: "Suspendu", withdrawn: "Retiré", honorary: "Honoraire", internal: "Interne", external: "Externe", submitted: "Soumis", under_review: "En étude", needs_information: "Informations requises", approved: "Approuvé", rejected: "Refusé", assigned: "Affecté", in_progress: "En cours", completed: "Terminé", cancelled: "Annulé", planning: "Planification", announced: "Annoncé", registration_open: "Inscriptions ouvertes", confirmed: "Confirmé", invited: "Invité", attended: "Présent", absent: "Absent", requested: "Demandé", redeemed: "Utilisé", draft: "Brouillon", published: "Publié", archived: "Archivé", planned: "Planifié", sent: "Envoyé", delivered: "Livré", read: "Lu", acknowledged: "Confirmé", failed: "Échec", skipped: "Ignoré", distinguished_contributor: "Contributeur distinctif", strategic_partner: "Partenaire stratégique", honorary_member: "Membre honoraire", ambassador: "Ambassadeur", benefactor: "Bienfaiteur", other: "Autre"},
  },
  en: {
    title: "VIP reports", subtitle: "Run the programme with consolidated indicators for members, cards, travel, gatherings, benefits and communications.", generated: "Generated", exportCsv: "Export CSV", printPdf: "Print / PDF", back: "Back to VIP", period: "Activity period", country: "Country", allCountries: "All countries", apply: "Apply", reset: "Reset", periods: {"30": "Last 30 days", "90": "Last 90 days", "180": "Last 180 days", "365": "Last 12 months", all: "All time"}, activeMembers: "Active members", totalRecords: "records total", expiringSoon: "Upcoming expiries", next90Days: "Within the next 90 days", openTravel: "Open travel", openServices: "services still open", deliveryRate: "Tracked deliveries", publishedCommunications: "published communications", pendingNominations: "Pending nominations", pendingRenewals: "Pending renewals", activePartners: "Active partners", activeBenefits: "Active benefits", realizedValue: "recorded value", periodActivity: "Period activity", periodActivityHelp: "Volumes created or requested during the selected period.", nominations: "Nominations", renewals: "Renewals", travelRequests: "Travel requests", benefitRequests: "Benefit requests", communications: "Communications", deliveryItems: "Tracked deliveries", memberStatuses: "Member statuses", topCountries: "Most represented countries", recognitionCategories: "Recognition categories", travelStatuses: "Travel statuses", benefitStatuses: "Benefit usage", communicationDelivery: "Communication delivery", expiringMembers: "Members due for renewal", upcomingTravel: "Upcoming travel", upcomingMeetings: "Upcoming gatherings", noAlerts: "No alerts.", noCountry: "Country not provided", labels: {active: "Active", pending_renewal: "Pending renewal", expired: "Expired", suspended: "Suspended", withdrawn: "Withdrawn", honorary: "Honorary", internal: "Internal", external: "External", submitted: "Submitted", under_review: "Under review", needs_information: "Needs information", approved: "Approved", rejected: "Rejected", assigned: "Assigned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", planning: "Planning", announced: "Announced", registration_open: "Registration open", confirmed: "Confirmed", invited: "Invited", attended: "Attended", absent: "Absent", requested: "Requested", redeemed: "Redeemed", draft: "Draft", published: "Published", archived: "Archived", planned: "Planned", sent: "Sent", delivered: "Delivered", read: "Read", acknowledged: "Acknowledged", failed: "Failed", skipped: "Skipped", distinguished_contributor: "Distinguished contributor", strategic_partner: "Strategic partner", honorary_member: "Honorary member", ambassador: "Ambassador", benefactor: "Benefactor", other: "Other"},
  },
} as const;
