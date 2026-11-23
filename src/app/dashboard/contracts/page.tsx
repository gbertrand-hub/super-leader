import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createServiceContractAction,
  createServiceProviderAction,
  updateServiceProviderDetailsAction,
  updateServiceProviderStatusAction,
} from "@/app/actions/service-contracts";
import {getI18n} from "@/i18n/server";
import {SecureAttachmentUpload} from "@/components/forms/secure-attachment-upload";
import {requireAccessContext} from "@/lib/auth/access-control";

type ProviderRow = {
  id: string;
  legal_name: string;
  trading_name: string | null;
  service_category: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string | null;
  status: string;
  notes: string;
};

type ContractRow = {
  id: string;
  provider_id: string;
  contract_number: string;
  title: string;
  department: string | null;
  internal_owner_user_id: string;
  start_date: string;
  end_date: string;
  value_amount: number | string;
  currency: string;
  status: string;
  renewal_notice_days: number;
  performance_target: number | string;
  source_mode: string;
  contract_clarity_status: string;
};

type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type RenewalStageRow = {contract_id: string; review_stage: string; is_final: boolean; decided_at: string | null};
type DeliverableSignalRow = {id: string; contract_id: string; title: string; due_date: string; status: string};
type ReportSignalRow = {id: string; contract_id: string; period_end: string; status: string; submitted_at: string};
type IncidentSignalRow = {id: string; contract_id: string; title: string; severity: string; status: string; created_at: string};
type FinancialSignalRow = {id: string; contract_id: string; due_date: string | null; calculated_amount: number | string; currency: string; gate_status: string; status: string; created_at: string};
type ContractIdRow = {contract_id: string};
type DocumentSignalRow = {id: string; contract_id: string; title: string; created_at: string};

const ADMIN_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const ALLOWED_ROLES = new Set(["owner", "admin", "executive", "hr", "manager"]);
const CLOSED = new Set(["completed", "terminated"]);
const CLOSED_DELIVERABLES = new Set(["accepted", "cancelled"]);
const CLOSED_INCIDENTS = new Set(["resolved", "closed"]);

function money(value: number | string, currency: string, locale: string) {
  const amount = Number(value || 0);
  try { return new Intl.NumberFormat(locale, {style: "currency", currency}).format(amount); }
  catch { return `${amount.toLocaleString(locale)} ${currency}`; }
}

function daysUntil(date: string) {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((target - start) / 86400000);
}

function statusTone(status: string) {
  if (["active", "renewed"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["suspended", "terminated"].includes(status)) return "bg-red-100 text-red-800";
  if (status === "under_review") return "bg-amber-100 text-amber-900";
  if (status === "completed") return "bg-slate-200 text-slate-700";
  return "bg-indigo-100 text-indigo-800";
}

function statusLabel(status: string, fr: boolean) {
  const map: Record<string, [string,string]> = {
    draft: ["Brouillon", "Draft"], active: ["Actif", "Active"], under_review: ["En revue", "Under review"],
    renewed: ["Renouvelé", "Renewed"], suspended: ["Suspendu", "Suspended"], completed: ["Terminé", "Completed"], terminated: ["Résilié", "Terminated"],
  };
  return (map[status] ?? [status,status])[fr ? 0 : 1];
}

function fieldClass() {
  return "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500";
}

type ContractSearchParams = {
  success?: string;
  error?: string;
  q?: string;
  status?: string;
  provider?: string;
  owner?: string;
  expiry?: string;
  sort?: string;
  origin?: string;
  page?: string;
  providerQ?: string;
  providerStatus?: string;
  providerPage?: string;
  editProvider?: string;
};

export default async function ServiceContractsPage({searchParams}: {searchParams: Promise<ContractSearchParams>}) {
  const query = await searchParams;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const context = await requireAccessContext();
  if (!ALLOWED_ROLES.has(context.role)) redirect("/dashboard/my-day");
  const canManage = ADMIN_ROLES.has(context.role);

  const providerQuery = context.admin.from("service_providers").select("id,legal_name,trading_name,service_category,contact_name,contact_email,contact_phone,country,status,notes")
    .eq("organization_id", context.organizationId).order("legal_name", {ascending: true});
  const contractBase = context.admin.from("service_contracts").select("id,provider_id,contract_number,title,department,internal_owner_user_id,start_date,end_date,value_amount,currency,status,renewal_notice_days,performance_target,source_mode,contract_clarity_status")
    .eq("organization_id", context.organizationId).order("end_date", {ascending: true});
  const contractQuery = context.role === "manager" ? contractBase.eq("internal_owner_user_id", context.user.id) : contractBase;

  const [{data: providersData, error: providersError}, {data: contractsData, error: contractsError}, {data: membershipsData}] = await Promise.all([
    providerQuery,
    contractQuery,
    context.admin.from("organization_members").select("user_id,role").eq("organization_id", context.organizationId).eq("is_active", true).order("role"),
  ]);
  if (providersError || contractsError) throw new Error(providersError?.message || contractsError?.message || "Service contract data unavailable");

  const contracts = (contractsData ?? []) as ContractRow[];
  const providerScope = new Set(contracts.map((row) => row.provider_id));
  const providers = ((providersData ?? []) as ProviderRow[]).filter((row) => context.role !== "manager" || providerScope.has(row.id));
  const memberships = ((membershipsData ?? []) as MemberRow[]).filter((row) => ["owner","admin","executive","hr","manager"].includes(row.role));
  const userIds = [...new Set(memberships.map((row) => row.user_id))];
  const {data: profilesData} = userIds.length
    ? await context.admin.from("profiles").select("id,full_name,email").in("id", userIds)
    : {data: [] as ProfileRow[]};
  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const providerById = new Map(providers.map((row) => [row.id, row]));

  const normalize = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase(fr ? "fr" : "en");
  const contractSearch = normalize(query.q);
  const contractStatus = query.status ?? "all";
  const contractProvider = query.provider ?? "all";
  const contractOwner = query.owner ?? "all";
  const expiryFilter = query.expiry ?? "all";
  const sortMode = query.sort ?? "expiry_asc";
  const originFilter = query.origin ?? "all";
  const pageSize = 25;
  const requestedPage = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);

  const filteredContracts = contracts.filter((contract) => {
    const provider = providerById.get(contract.provider_id);
    const owner = profileById.get(contract.internal_owner_user_id);
    const days = daysUntil(contract.end_date);
    const matchesSearch = !contractSearch || [
      contract.title,
      contract.contract_number,
      contract.department,
      provider?.legal_name,
      provider?.trading_name,
      provider?.service_category,
      owner?.full_name,
      owner?.email,
    ].some((value) => normalize(value).includes(contractSearch));
    const matchesStatus = contractStatus === "all" || contract.status === contractStatus;
    const matchesProvider = contractProvider === "all" || contract.provider_id === contractProvider;
    const matchesOwner = contractOwner === "all" || contract.internal_owner_user_id === contractOwner;
    const matchesOrigin = originFilter === "all" || contract.source_mode === originFilter;
    const matchesExpiry = expiryFilter === "all"
      || (expiryFilter === "expired" && days < 0)
      || (expiryFilter === "30" && days >= 0 && days <= 30)
      || (expiryFilter === "60" && days >= 0 && days <= 60)
      || (expiryFilter === "90" && days >= 0 && days <= 90);
    return matchesSearch && matchesStatus && matchesProvider && matchesOwner && matchesOrigin && matchesExpiry;
  }).sort((a, b) => {
    if (sortMode === "expiry_desc") return b.end_date.localeCompare(a.end_date);
    if (sortMode === "title") return a.title.localeCompare(b.title, fr ? "fr" : "en");
    if (sortMode === "provider") return (providerById.get(a.provider_id)?.legal_name ?? "").localeCompare(providerById.get(b.provider_id)?.legal_name ?? "", fr ? "fr" : "en");
    if (sortMode === "value_desc") return Number(b.value_amount || 0) - Number(a.value_amount || 0);
    return a.end_date.localeCompare(b.end_date);
  });
  const totalContractPages = Math.max(1, Math.ceil(filteredContracts.length / pageSize));
  const currentContractPage = Math.min(requestedPage, totalContractPages);
  const paginatedContracts = filteredContracts.slice((currentContractPage - 1) * pageSize, currentContractPage * pageSize);

  const providerSearch = normalize(query.providerQ);
  const providerStatusFilter = query.providerStatus ?? "all";
  const providerPageSize = 18;
  const requestedProviderPage = Math.max(1, Number.parseInt(query.providerPage ?? "1", 10) || 1);
  const filteredProviders = providers.filter((provider) => {
    const matchesSearch = !providerSearch || [provider.legal_name, provider.trading_name, provider.service_category, provider.contact_name, provider.contact_email, provider.contact_phone, provider.country]
      .some((value) => normalize(value).includes(providerSearch));
    return matchesSearch && (providerStatusFilter === "all" || provider.status === providerStatusFilter);
  });
  const totalProviderPages = Math.max(1, Math.ceil(filteredProviders.length / providerPageSize));
  const currentProviderPage = Math.min(requestedProviderPage, totalProviderPages);
  const paginatedProviders = filteredProviders.slice((currentProviderPage - 1) * providerPageSize, currentProviderPage * providerPageSize);
  const editingProvider = canManage && query.editProvider ? providers.find((provider) => provider.id === query.editProvider) : undefined;

  function hrefWith(overrides: Partial<ContractSearchParams>, hash?: string) {
    const params = new URLSearchParams();
    const values: ContractSearchParams = {...query, ...overrides};
    for (const [key, value] of Object.entries(values)) {
      if (value && !["success", "error", "editProvider"].includes(key)) params.set(key, value);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return `/dashboard/contracts${suffix}${hash ? `#${hash}` : ""}`;
  }

  const contractIds = contracts.map((row) => row.id);
  const [renewalResult, deliverableResult, reportResult, incidentResult, financialResult, documentResult, obligationResult, kpiResult] = contractIds.length
    ? await Promise.all([
      context.admin.from("service_contract_renewal_reviews").select("contract_id,review_stage,is_final,decided_at").eq("organization_id", context.organizationId).in("contract_id", contractIds),
      context.admin.from("service_contract_deliverables").select("id,contract_id,title,due_date,status").eq("organization_id", context.organizationId).in("contract_id", contractIds),
      context.admin.from("service_contract_reports").select("id,contract_id,period_end,status,submitted_at").eq("organization_id", context.organizationId).in("contract_id", contractIds).order("submitted_at", {ascending: false}),
      context.admin.from("service_contract_incidents").select("id,contract_id,title,severity,status,created_at").eq("organization_id", context.organizationId).in("contract_id", contractIds).order("created_at", {ascending: false}),
      context.admin.from("service_contract_financial_items").select("id,contract_id,due_date,calculated_amount,currency,gate_status,status,created_at").eq("organization_id", context.organizationId).in("contract_id", contractIds).order("created_at", {ascending: false}),
      context.admin.from("service_contract_documents").select("id,contract_id,title,created_at").eq("organization_id", context.organizationId).in("contract_id", contractIds).order("created_at", {ascending: false}),
      context.admin.from("service_contract_obligations").select("contract_id").eq("organization_id", context.organizationId).in("contract_id", contractIds).eq("status", "active"),
      context.admin.from("service_contract_kpis").select("contract_id").eq("organization_id", context.organizationId).in("contract_id", contractIds).eq("is_active", true),
    ])
    : Array.from({length: 8}, () => ({data: [], error: null}));
  const {data: renewalStageData, error: renewalStageError} = renewalResult;
  if (renewalStageError && !["42P01", "PGRST205"].includes(renewalStageError.code)) throw new Error(renewalStageError.message);
  const renewalStages = (renewalStageData ?? []) as RenewalStageRow[];
  const stagesByContract = new Map<string, Set<string>>();
  const finalByContract = new Set<string>();
  for (const row of renewalStages) {
    const set = stagesByContract.get(row.contract_id) ?? new Set<string>();
    set.add(row.review_stage || "orientation");
    stagesByContract.set(row.contract_id, set);
    if (row.is_final || row.review_stage === "final") finalByContract.add(row.contract_id);
  }

  const signalError = [deliverableResult, reportResult, incidentResult, financialResult, documentResult, obligationResult, kpiResult].find((result) => result.error)?.error;
  if (signalError) throw new Error(signalError.message);
  const today = new Date().toISOString().slice(0, 10);
  const deliverables = (deliverableResult.data ?? []) as DeliverableSignalRow[];
  const reports = (reportResult.data ?? []) as ReportSignalRow[];
  const incidents = (incidentResult.data ?? []) as IncidentSignalRow[];
  const financialItems = (financialResult.data ?? []) as FinancialSignalRow[];
  const documents = (documentResult.data ?? []) as DocumentSignalRow[];
  const obligationContractIds = new Set(((obligationResult.data ?? []) as ContractIdRow[]).map((row) => row.contract_id));
  const kpiContractIds = new Set(((kpiResult.data ?? []) as ContractIdRow[]).map((row) => row.contract_id));
  const documentContractIds = new Set(documents.map((row) => row.contract_id));
  const activeMembershipIds = new Set(memberships.map((row) => row.user_id));

  const overdueDeliverables = deliverables.filter((row) => row.due_date < today && !CLOSED_DELIVERABLES.has(row.status));
  const pendingReports = reports.filter((row) => row.status === "submitted");
  const openIncidents = incidents.filter((row) => !CLOSED_INCIDENTS.has(row.status));
  const criticalIncidents = openIncidents.filter((row) => ["critical", "high"].includes(row.severity));
  const blockedPayments = financialItems.filter((row) => row.gate_status === "blocked" || row.status === "held");
  const myContracts = contracts.filter((row) => row.internal_owner_user_id === context.user.id && !CLOSED.has(row.status));
  const qualityIssues = contracts.filter((contract) => !CLOSED.has(contract.status)).map((contract) => {
    const issues = [
      ...(!contract.internal_owner_user_id || !activeMembershipIds.has(contract.internal_owner_user_id) ? [fr ? "Responsable absent" : "Missing owner"] : []),
      ...(!documentContractIds.has(contract.id) ? [fr ? "Document source absent" : "Missing source document"] : []),
      ...(!obligationContractIds.has(contract.id) ? [fr ? "Aucune obligation" : "No obligation"] : []),
      ...(!kpiContractIds.has(contract.id) ? [fr ? "Aucun KPI" : "No KPI"] : []),
    ];
    return {contract, issues};
  }).filter((item) => item.issues.length);

  const financialByCurrency = new Map<string, number>();
  for (const item of financialItems) {
    if (["paid", "delivered", "cancelled", "rejected"].includes(item.status)) continue;
    financialByCurrency.set(item.currency, (financialByCurrency.get(item.currency) ?? 0) + Number(item.calculated_amount || 0));
  }
  const openFinancialItems = financialItems.filter((item) => !["paid", "delivered", "cancelled", "rejected"].includes(item.status));
  const financialDue30 = openFinancialItems.filter((item) => item.due_date && daysUntil(item.due_date) <= 30).length;
  const financialDue60 = openFinancialItems.filter((item) => item.due_date && daysUntil(item.due_date) > 30 && daysUntil(item.due_date) <= 60).length;
  const financialDue90 = openFinancialItems.filter((item) => item.due_date && daysUntil(item.due_date) > 60 && daysUntil(item.due_date) <= 90).length;
  const recentActivity = [
    ...reports.map((row) => ({date: row.submitted_at, contractId: row.contract_id, label: fr ? "Rapport soumis" : "Report submitted", detail: row.period_end})),
    ...incidents.map((row) => ({date: row.created_at, contractId: row.contract_id, label: fr ? `Incident ${row.severity}` : `${row.severity} incident`, detail: row.title})),
    ...financialItems.map((row) => ({date: row.created_at, contractId: row.contract_id, label: fr ? "Échéance financière" : "Financial item", detail: `${row.calculated_amount} ${row.currency}`})),
    ...documents.map((row) => ({date: row.created_at, contractId: row.contract_id, label: fr ? "Document ajouté" : "Document added", detail: row.title})),
    ...renewalStages.filter((row) => row.decided_at).map((row) => ({date: row.decided_at ?? "", contractId: row.contract_id, label: fr ? "Décision de renouvellement" : "Renewal decision", detail: row.review_stage})),
  ].filter((row) => row.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const contractById = new Map(contracts.map((row) => [row.id, row]));

  const reviewItems = (source: ContractRow[]) => source.flatMap((contract) => {
    if (!["active","renewed","under_review"].includes(contract.status)) return [];
    const days = daysUntil(contract.end_date);
    if (days > 90) return [];
    const completed = stagesByContract.get(contract.id) ?? new Set<string>();
    const missingStages = [
      ...(days <= 90 && !completed.has("j90") ? [fr ? "J-90" : "D-90"] : []),
      ...(days <= 60 && !completed.has("j60") ? [fr ? "J-60" : "D-60"] : []),
      ...(days <= 30 && !completed.has("j30") ? [fr ? "J-30" : "D-30"] : []),
    ];
    const finalMissing = days <= 30 && !finalByContract.has(contract.id);
    if (!missingStages.length && !finalMissing) return [];
    const reviewLabel = [
      ...(missingStages.length ? [fr ? `Revue(s) ${missingStages.join(" / ")}` : `Review(s) ${missingStages.join(" / ")}`] : []),
      ...(finalMissing ? [fr ? "décision finale" : "final decision"] : []),
    ].join(" + ");
    return [{contract, days, reviewLabel}];
  }).sort((a, b) => a.days - b.days);

  const active = contracts.filter((row) => ["active","renewed","under_review"].includes(row.status));
  const reviewQueueAll = reviewItems(contracts);
  const reviewQueue = reviewItems(filteredContracts);
  const expiredOpen = contracts.filter((row) => daysUntil(row.end_date) < 0 && !CLOSED.has(row.status));
  const suspended = contracts.filter((row) => row.status === "suspended");

  const tiles = [
    {label: fr ? "Contrats actifs" : "Active contracts", value: active.length, help: fr ? "Ouvrir le portefeuille" : "Open portfolio", href: "/dashboard/contracts#contract-portfolio"},
    {label: fr ? "Revues à traiter" : "Reviews due", value: reviewQueueAll.length, help: fr ? "J-90 / J-60 / J-30 / décision finale" : "D-90 / D-60 / D-30 / final decision", href: "/dashboard/contracts#renewal-queue"},
    {label: fr ? "Expirés à traiter" : "Expired to resolve", value: expiredOpen.length, help: fr ? "Afficher les contrats expirés" : "Show expired contracts", href: "/dashboard/contracts?expiry=expired#contract-portfolio"},
    {label: fr ? "Suspendus" : "Suspended", value: suspended.length, help: fr ? "Afficher les contrats suspendus" : "Show suspended contracts", href: "/dashboard/contracts?status=suspended#contract-portfolio"},
  ];

  const operationalCentres = [
    {label: fr ? "Centre d’exécution" : "Execution centre", help: fr ? "Livrables, obligations et rapports" : "Deliverables, obligations and reports", href: "/dashboard/contracts/execution-center"},
    {label: fr ? "Incidents & risques" : "Incidents & risks", help: fr ? "Exposition et actions correctives" : "Exposure and corrective actions", href: "/dashboard/contracts/risk-center"},
    {label: fr ? "Documents & avenants" : "Documents & amendments", help: fr ? "Versions et pièces contractuelles" : "Versions and contract records", href: "/dashboard/contracts/documents"},
    {label: fr ? "Reporting & analyses" : "Reporting & analytics", help: fr ? "Performance du portefeuille" : "Portfolio performance", href: "/dashboard/contracts/reports"},
    {label: fr ? "Finance & paiements" : "Finance & payments", help: fr ? "Échéances, approbations et règlements" : "Due items, approvals and settlements", href: "/dashboard/contracts/finance"},
    {label: fr ? "Portail prestataire" : "Provider portal", help: fr ? "Accès, rapports et preuves externes" : "External access, reports and evidence", href: "/dashboard/contracts/provider-portal"},
  ];

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <section className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">SUPER LEADER OPERATIONS · v4.10.45</p>
        <h1 className="mt-3 text-3xl font-black sm:text-5xl">{fr ? "Prestataires & Contrats" : "Service Providers & Contracts"}</h1>
        <p className="mt-3 max-w-4xl text-slate-300">{fr ? "Pilote le cycle de vie des prestations externes : contrat, responsable, échéance, exécution, performance et décision de renouvellement." : "Manage the lifecycle of external services: contract, owner, expiry, execution, performance and renewal decision."}</p>
        <div className="mt-5 flex flex-wrap gap-3"><Link href="/dashboard/contracts/settings" className="rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-black text-slate-950">{fr ? "Paramètres & modèles" : "Settings & templates"}</Link></div>
      </section>

      {query.success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{query.success}</p> : null}
      {query.error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{query.error}</p> : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <Link href={tile.href} key={tile.label} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{tile.label}</p>
          <p className="mt-2 text-4xl font-black">{tile.value}</p>
          <p className="mt-1 text-xs font-bold text-slate-500 group-hover:text-indigo-700">{tile.help} →</p>
        </Link>)}
      </section>

      <section className="mt-7 rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{fr ? "CENTRES OPÉRATIONNELS" : "OPERATIONAL CENTRES"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Piloter tout le cycle contractuel" : "Manage the full contract lifecycle"}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Ces espaces sont maintenant disponibles. Chaque carte ouvre directement le centre correspondant." : "These workspaces are now available. Each card opens the corresponding centre."}</p></div><span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-black uppercase text-emerald-800">{fr ? "6 centres actifs" : "6 active centres"}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{operationalCentres.map((centre) => <Link key={centre.href} href={centre.href} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-indigo-300 hover:bg-indigo-50"><p className="font-black">{centre.label} →</p><p className="mt-1 text-xs text-slate-500">{centre.help}</p></Link>)}</div>
      </section>

      <section className="mt-7 rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">{fr ? "COCKPIT DES ACTIONS" : "ACTION COCKPIT"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Ce qui demande une intervention" : "Items requiring action"}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Les indicateurs sont calculés en temps réel à partir de l’exécution des contrats." : "Indicators are calculated live from contract execution data."}</p></div><span className={`rounded-full px-4 py-2 text-xs font-black uppercase ${pendingReports.length + overdueDeliverables.length + criticalIncidents.length + blockedPayments.length + reviewQueueAll.length ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{pendingReports.length + overdueDeliverables.length + criticalIncidents.length + blockedPayments.length + reviewQueueAll.length} {fr ? "action(s)" : "action(s)"}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Link href="/dashboard/contracts/execution-center" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-xs font-black uppercase text-indigo-700">{fr ? "Rapports à valider" : "Reports to review"}</p><p className="mt-2 text-3xl font-black">{pendingReports.length}</p></Link>
          <Link href="/dashboard/contracts/execution-center" className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-black uppercase text-amber-800">{fr ? "Livrables en retard" : "Overdue deliverables"}</p><p className="mt-2 text-3xl font-black">{overdueDeliverables.length}</p></Link>
          <Link href="/dashboard/contracts/risk-center" className="rounded-2xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-black uppercase text-red-700">{fr ? "Incidents élevés" : "High incidents"}</p><p className="mt-2 text-3xl font-black">{criticalIncidents.length}</p></Link>
          <Link href="/dashboard/contracts/finance?view=blocked" className="rounded-2xl border border-orange-200 bg-orange-50 p-4"><p className="text-xs font-black uppercase text-orange-700">{fr ? "Paiements bloqués" : "Blocked payments"}</p><p className="mt-2 text-3xl font-black">{blockedPayments.length}</p></Link>
          <Link href="/dashboard/contracts#renewal-queue" className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4"><p className="text-xs font-black uppercase text-cyan-700">{fr ? "Renouvellements" : "Renewals"}</p><p className="mt-2 text-3xl font-black">{reviewQueueAll.length}</p></Link>
        </div>
      </section>

      <section className="mt-7 grid gap-5 xl:grid-cols-2">
        <article className="rounded-3xl border border-violet-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "RESPONSABILITÉ PERSONNELLE" : "PERSONAL OWNERSHIP"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Mes contrats" : "My contracts"}</h2></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">{myContracts.length}</span></div>
          <div className="mt-4 space-y-3">{myContracts.slice(0, 5).map((contract) => <Link key={contract.id} href={`/dashboard/contracts/${contract.id}`} className="block rounded-2xl border border-slate-200 p-4 hover:border-violet-300"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{contract.title}</p><p className="mt-1 text-xs text-slate-500">{providerById.get(contract.provider_id)?.legal_name ?? "—"} · {contract.contract_number}</p></div><span className="text-xs font-black text-violet-700">J-{Math.max(0, daysUntil(contract.end_date))}</span></div></Link>)}{!myContracts.length ? <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">{fr ? "Aucun contrat actif ne vous est directement attribué." : "No active contract is directly assigned to you."}</p> : null}</div>
          {myContracts.length > 5 ? <Link href={`/dashboard/contracts?owner=${context.user.id}#contract-portfolio`} className="mt-4 inline-block text-sm font-black text-violet-700">{fr ? "Voir tous mes contrats →" : "View all my contracts →"}</Link> : null}
        </article>

        <article className="rounded-3xl border border-amber-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "QUALITÉ DES DOSSIERS" : "RECORD QUALITY"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Contrats à compléter" : "Contracts to complete"}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-black ${qualityIssues.length ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{qualityIssues.length}</span></div>
          <div className="mt-4 space-y-3">{qualityIssues.slice(0, 5).map(({contract, issues}) => <Link key={contract.id} href={`/dashboard/contracts/${contract.id}`} className="block rounded-2xl border border-slate-200 p-4 hover:border-amber-300"><p className="font-black">{contract.title}</p><p className="mt-1 text-xs font-semibold text-amber-800">{issues.join(" · ")}</p></Link>)}{!qualityIssues.length ? <p className="rounded-2xl bg-emerald-50 p-5 text-center text-sm font-bold text-emerald-800">{fr ? "Tous les contrats actifs possèdent les éléments essentiels." : "All active contracts contain the essential elements."}</p> : null}</div>
        </article>
      </section>

      <section className="mt-7 grid gap-5 xl:grid-cols-2">
        <article className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "ENGAGEMENTS FINANCIERS OUVERTS" : "OPEN FINANCIAL COMMITMENTS"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Synthèse par devise" : "Summary by currency"}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{[...financialByCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => <Link key={currency} href="/dashboard/contracts/finance" className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-black uppercase text-emerald-700">{currency}</p><p className="mt-2 text-2xl font-black">{money(amount, currency, fr ? "fr-FR" : "en-GB")}</p></Link>)}{!financialByCurrency.size ? <p className="sm:col-span-2 rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">{fr ? "Aucun engagement financier ouvert." : "No open financial commitment."}</p> : null}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><Link href="/dashboard/contracts/finance" className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-500">≤ 30 {fr ? "jours" : "days"}</p><p className="mt-1 text-xl font-black">{financialDue30}</p></Link><Link href="/dashboard/contracts/finance" className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-500">31–60 {fr ? "jours" : "days"}</p><p className="mt-1 text-xl font-black">{financialDue60}</p></Link><Link href="/dashboard/contracts/finance" className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-500">61–90 {fr ? "jours" : "days"}</p><p className="mt-1 text-xl font-black">{financialDue90}</p></Link></div>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{fr ? "ACTIVITÉ RÉCENTE" : "RECENT ACTIVITY"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Derniers événements du portefeuille" : "Latest portfolio events"}</h2>
          <div className="mt-4 space-y-3">{recentActivity.map((item, index) => {const contract = contractById.get(item.contractId); return <Link key={`${item.date}-${item.contractId}-${index}`} href={`/dashboard/contracts/${item.contractId}`} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 p-3 hover:border-indigo-200"><div><p className="text-sm font-black">{item.label}</p><p className="mt-1 text-xs text-slate-500">{contract?.title ?? "—"} · {item.detail}</p></div><span className="whitespace-nowrap text-[10px] font-bold text-slate-400">{item.date.slice(0, 10)}</span></Link>})}{!recentActivity.length ? <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">{fr ? "Aucune activité récente." : "No recent activity."}</p> : null}</div>
        </article>
      </section>

      <section className="mt-7 rounded-3xl border border-cyan-200 bg-cyan-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr ? "ALERTES & DIGEST" : "ALERTS & DIGEST"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Récapitulatif automatique aux responsables" : "Automatic owner digest"}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-950">{fr ? "Chaque matin ouvré, Super Leader regroupe par responsable les rapports à valider, retards, incidents, paiements bloqués et renouvellements. Les doublons sont empêchés par une clé quotidienne." : "Every working morning, Super Leader groups pending reports, delays, incidents, blocked payments and renewals by owner. A daily key prevents duplicates."}</p></div><span className="rounded-full bg-white px-4 py-2 text-xs font-black uppercase text-cyan-800">{fr ? "Planifié à 08:45 UTC" : "Scheduled at 08:45 UTC"}</span></div>
      </section>

      <section id="contract-filters" className="mt-7 scroll-mt-28 rounded-3xl border border-indigo-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{fr ? "RECHERCHE & FILTRES" : "SEARCH & FILTERS"}</p><h2 className="mt-2 text-xl font-black">{fr ? "Retrouver rapidement un contrat" : "Find a contract quickly"}</h2></div>{filteredContracts.length !== contracts.length ? <span className="rounded-full bg-indigo-100 px-4 py-2 text-xs font-black text-indigo-800">{filteredContracts.length} / {contracts.length}</span> : null}</div>
        <form method="get" action="/dashboard/contracts" className="mt-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <label className="text-xs font-black uppercase tracking-wide text-slate-600 xl:col-span-2">{fr ? "Recherche" : "Search"}<input name="q" defaultValue={query.q ?? ""} placeholder={fr ? "Contrat, référence, prestataire, responsable…" : "Contract, reference, provider, owner…"} className={fieldClass()} /></label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-600">Statut<select name="status" defaultValue={contractStatus} className={fieldClass()}><option value="all">{fr ? "Tous" : "All"}</option>{["draft","active","under_review","renewed","suspended","completed","terminated"].map((status) => <option key={status} value={status}>{statusLabel(status, fr)}</option>)}</select></label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Prestataire" : "Provider"}<select name="provider" defaultValue={contractProvider} className={fieldClass()}><option value="all">{fr ? "Tous" : "All"}</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.legal_name}</option>)}</select></label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Responsable" : "Owner"}<select name="owner" defaultValue={contractOwner} className={fieldClass()}><option value="all">{fr ? "Tous" : "All"}</option>{memberships.map((member) => {const profile = profileById.get(member.user_id); return <option key={member.user_id} value={member.user_id}>{profile?.full_name || profile?.email || member.user_id}</option>;})}</select></label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Échéance" : "Expiry"}<select name="expiry" defaultValue={expiryFilter} className={fieldClass()}><option value="all">{fr ? "Toutes" : "All"}</option><option value="30">≤ 30 {fr ? "jours" : "days"}</option><option value="60">≤ 60 {fr ? "jours" : "days"}</option><option value="90">≤ 90 {fr ? "jours" : "days"}</option><option value="expired">{fr ? "Expirés" : "Expired"}</option></select></label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Origine" : "Origin"}<select name="origin" defaultValue={originFilter} className={fieldClass()}><option value="all">{fr ? "Toutes" : "All"}</option><option value="native">{fr ? "Créé dans Super Leader" : "Native"}</option><option value="current_import">{fr ? "Import actif" : "Active import"}</option><option value="historical_import">{fr ? "Historique importé" : "Historical import"}</option></select></label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Trier par" : "Sort by"}<select name="sort" defaultValue={sortMode} className={fieldClass()}><option value="expiry_asc">{fr ? "Expiration proche" : "Nearest expiry"}</option><option value="expiry_desc">{fr ? "Expiration lointaine" : "Latest expiry"}</option><option value="title">{fr ? "Titre" : "Title"}</option><option value="provider">{fr ? "Prestataire" : "Provider"}</option><option value="value_desc">{fr ? "Valeur décroissante" : "Highest value"}</option></select></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-black text-white">{fr ? "Appliquer" : "Apply"}</button><Link href="/dashboard/contracts#contract-filters" className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-black">{fr ? "Réinitialiser" : "Reset"}</Link></div>
        </form>
      </section>

      <section id="renewal-queue" className="mt-7 scroll-mt-28 rounded-3xl border border-cyan-200 bg-cyan-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr ? "FILE DE RENOUVELLEMENT" : "RENEWAL QUEUE"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Revues contractuelles à traiter" : "Contract reviews requiring action"}</h2><p className="mt-2 text-sm text-cyan-900">{fr ? "Les jalons J-90, J-60 et J-30 apparaissent automatiquement. À J-30, la décision finale devient disponible." : "D-90, D-60 and D-30 milestones appear automatically. At D-30, the final decision becomes available."}</p></div>
          <span className={`rounded-full px-4 py-2 text-sm font-black ${reviewQueue.length ? "bg-amber-300 text-amber-950" : "bg-emerald-100 text-emerald-800"}`}>{reviewQueue.length} {fr ? "à traiter" : "due"}</span>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {reviewQueue.map(({contract, days, reviewLabel}) => {const provider = providerById.get(contract.provider_id); const owner = profileById.get(contract.internal_owner_user_id); return <article key={contract.id} className={`rounded-2xl border bg-white p-5 ${days <= 30 ? "border-amber-300" : "border-cyan-200"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-cyan-700">{reviewLabel}</p><h3 className="mt-1 text-lg font-black">{contract.title}</h3><p className="mt-1 text-sm text-slate-500">{provider?.legal_name || "—"} · {owner?.full_name || owner?.email || "—"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${days < 0 ? "bg-red-100 text-red-800" : days <= 30 ? "bg-amber-100 text-amber-900" : "bg-cyan-100 text-cyan-800"}`}>{days < 0 ? (fr ? `Expiré depuis ${Math.abs(days)} j` : `Expired ${Math.abs(days)}d ago`) : `J-${days}`}</span></div>
            <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">{fr ? "Expiration" : "Expiry"}: {contract.end_date}</p><Link href={`/dashboard/contracts/${contract.id}`} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">{fr ? "Ouvrir la revue" : "Open review"}</Link></div>
          </article>;})}
          {!reviewQueue.length ? <p className="lg:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center font-bold text-emerald-800">{fr ? "Aucune revue contractuelle en retard ou arrivée à échéance." : "No contract review is overdue or currently due."}</p> : null}
        </div>
      </section>

      <section id="contract-portfolio" className="mt-7 scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{fr ? "PORTEFEUILLE CONTRACTUEL" : "CONTRACT PORTFOLIO"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Contrats" : "Contracts"}</h2></div>
          <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black">{filteredContracts.length} / {contracts.length}</span>
        </div>

        <p className="mt-4 text-sm text-slate-500">{fr ? "Les filtres ci-dessus s’appliquent à la file de renouvellement et au portefeuille." : "The filters above apply to both the renewal queue and the contract portfolio."}</p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3 pr-4">{fr ? "Contrat" : "Contract"}</th><th className="pr-4">{fr ? "Prestataire" : "Provider"}</th><th className="pr-4">{fr ? "Responsable" : "Owner"}</th><th className="pr-4">{fr ? "Expiration" : "Expiry"}</th><th className="pr-4">{fr ? "Valeur" : "Value"}</th><th className="pr-4">Statut</th><th></th></tr></thead>
            <tbody>{paginatedContracts.map((contract) => {
              const provider = providerById.get(contract.provider_id);
              const owner = profileById.get(contract.internal_owner_user_id);
              const days = daysUntil(contract.end_date);
              return <tr key={contract.id} className="border-b border-slate-100 align-top">
                <td className="py-4 pr-4"><p className="font-black">{contract.title}</p><p className="text-xs text-slate-500">{contract.contract_number}{contract.department ? ` · ${contract.department}` : ""}</p><div className="mt-1 flex flex-wrap gap-1">{contract.source_mode !== "native" ? <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-black text-cyan-800">{contract.source_mode === "historical_import" ? (fr ? "HISTORIQUE IMPORTÉ" : "HISTORICAL IMPORT") : (fr ? "IMPORT ACTIF" : "ACTIVE IMPORT")}</span> : null}{contract.contract_clarity_status === "review_required" ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-800">{fr ? "REVUE CLAUSES" : "CLAUSE REVIEW"}</span> : null}</div></td>
                <td className="pr-4 py-4"><p className="font-bold">{provider?.legal_name ?? "—"}</p><p className="text-xs text-slate-500">{provider?.service_category ?? ""}</p></td>
                <td className="pr-4 py-4">{owner?.full_name || owner?.email || "—"}</td>
                <td className="pr-4 py-4"><p className={`font-black ${days < 0 ? "text-red-700" : days <= 30 ? "text-amber-700" : ""}`}>{contract.end_date}</p><p className="text-xs text-slate-500">{days < 0 ? (fr ? `Expiré depuis ${Math.abs(days)} j` : `Expired ${Math.abs(days)}d ago`) : (fr ? `${days} j restant(s)` : `${days}d remaining`)}</p></td>
                <td className="pr-4 py-4 font-bold">{money(contract.value_amount, contract.currency, fr ? "fr-FR" : "en-GB")}</td>
                <td className="pr-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(contract.status)}`}>{statusLabel(contract.status, fr)}</span></td>
                <td className="py-4 text-right"><Link href={`/dashboard/contracts/${contract.id}`} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">{fr ? "Passeport" : "Passport"}</Link></td>
              </tr>;
            })}</tbody>
          </table>
          {!filteredContracts.length ? <p className="py-10 text-center text-slate-500">{fr ? "Aucun contrat ne correspond aux filtres." : "No contracts match these filters."}</p> : null}
        </div>
        {totalContractPages > 1 ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"><p className="text-sm font-bold text-slate-600">{fr ? `Page ${currentContractPage} sur ${totalContractPages} · ${filteredContracts.length} résultat(s)` : `Page ${currentContractPage} of ${totalContractPages} · ${filteredContracts.length} result(s)`}</p><div className="flex gap-2">{currentContractPage > 1 ? <Link href={hrefWith({page: String(currentContractPage - 1)}, "contract-portfolio")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">← {fr ? "Précédent" : "Previous"}</Link> : null}{currentContractPage < totalContractPages ? <Link href={hrefWith({page: String(currentContractPage + 1)}, "contract-portfolio")} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Suivant" : "Next"} →</Link> : null}</div></div> : null}
      </section>

      {canManage ? <section className="mt-7 grid gap-6 xl:grid-cols-2">
        <form action={createServiceProviderAction} className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "NOUVEAU PRESTATAIRE" : "NEW PROVIDER"}</p>
          <h2 className="mt-2 text-2xl font-black">{fr ? "Créer la fiche prestataire" : "Create provider record"}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">{fr ? "Raison sociale *" : "Legal name *"}<input name="legalName" required className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Nom commercial" : "Trading name"}<input name="tradingName" className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Catégorie de service *" : "Service category *"}<input name="serviceCategory" required placeholder={fr ? "IT, juridique, sécurité…" : "IT, legal, security…"} className={fieldClass()} /></label>
            <label className="text-sm font-bold">Pays<input name="country" className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Contact" : "Contact person"}<input name="contactName" className={fieldClass()} /></label>
            <label className="text-sm font-bold">Email<input name="contactEmail" type="email" className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Téléphone" : "Phone"}<input name="contactPhone" className={fieldClass()} /></label>
            <label className="text-sm font-bold sm:col-span-2">Notes<textarea name="notes" rows={3} className={fieldClass()} /></label>
          </div>
          <button className="mt-5 rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr ? "Ajouter le prestataire" : "Add provider"}</button>
        </form>

        <form action={createServiceContractAction} className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "NOUVEAU CONTRAT" : "NEW CONTRACT"}</p>
          <h2 className="mt-2 text-2xl font-black">{fr ? "Créer le passeport du contrat" : "Create contract passport"}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold sm:col-span-2">{fr ? "Prestataire *" : "Provider *"}<select name="providerId" required className={fieldClass()}><option value="">—</option>{providers.filter((p) => p.status !== "inactive").map((p) => <option key={p.id} value={p.id}>{p.legal_name} · {p.service_category}</option>)}</select></label>
            <label className="text-sm font-bold">{fr ? "Numéro / référence *" : "Number / reference *"}<input name="contractNumber" required className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Titre du contrat *" : "Contract title *"}<input name="title" required className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Département" : "Department"}<input name="department" className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Responsable interne *" : "Internal owner *"}<select name="internalOwnerUserId" required className={fieldClass()}><option value="">—</option>{memberships.map((m) => {const p = profileById.get(m.user_id); return <option key={m.user_id} value={m.user_id}>{p?.full_name || p?.email || m.user_id} · {m.role}</option>;})}</select></label>
            <label className="text-sm font-bold">{fr ? "Début *" : "Start *"}<input name="startDate" type="date" required className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Expiration *" : "Expiry *"}<input name="endDate" type="date" required className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Valeur" : "Value"}<input name="valueAmount" type="number" min="0" step="0.01" defaultValue="0" className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Devise" : "Currency"}<input name="currency" defaultValue="USD" maxLength={8} className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Alerte renouvellement (jours)" : "Renewal alert (days)"}<input name="renewalNoticeDays" type="number" min="0" max="730" defaultValue="90" className={fieldClass()} /></label>
            <label className="text-sm font-bold">{fr ? "Objectif de performance (%)" : "Performance target (%)"}<input name="performanceTarget" type="number" min="0" max="100" step="0.1" defaultValue="80" className={fieldClass()} /></label>
            <label className="text-sm font-bold sm:col-span-2">{fr ? "Périmètre / objet de la prestation" : "Scope of service"}<textarea name="serviceScope" rows={4} className={fieldClass()} /></label>
            <label className="text-sm font-bold sm:col-span-2">{fr ? "Conditions de paiement" : "Payment terms"}<textarea name="paymentTerms" rows={2} className={fieldClass()} /></label>
            <label className="text-sm font-bold sm:col-span-2">Notes<textarea name="notes" rows={2} className={fieldClass()} /></label>
          </div>

          <details className="mt-5 rounded-2xl border border-amber-300 bg-white p-4">
            <summary className="cursor-pointer font-black text-amber-950">{fr ? "Importer un contrat existant / clauses avancées" : "Import existing contract / advanced clauses"}</summary>
            <p className="mt-2 text-xs leading-5 text-slate-600">{fr ? "Utilise cette zone pour un contrat déjà signé ou déjà exécuté. Le PDF source reste immuable ; Super Leader distingue les données historiques des événements réellement suivis dans la plateforme." : "Use this section for an already signed or historical contract. The source PDF remains immutable; Super Leader distinguishes reconstructed history from events actually monitored in the platform."}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold sm:col-span-2">{fr ? "Mode d’entrée" : "Entry mode"}<select name="sourceMode" defaultValue="native" className={fieldClass()}><option value="native">{fr ? "Nouveau contrat créé dans Super Leader" : "New contract created in Super Leader"}</option><option value="current_import">{fr ? "Importer un contrat existant encore en cours" : "Import existing active contract"}</option><option value="historical_import">{fr ? "Importer un contrat historique / déjà exécuté" : "Import historical / already executed contract"}</option></select></label>
              <label className="text-sm font-bold">{fr ? "Statut initial si import" : "Initial status if imported"}<select name="initialStatus" defaultValue="active" className={fieldClass()}><option value="draft">Draft</option><option value="active">Active</option><option value="under_review">Under review</option><option value="renewed">Renewed</option><option value="suspended">Suspended</option><option value="completed">Completed</option><option value="terminated">Terminated</option></select></label>
              <label className="text-sm font-bold">{fr ? "Début du suivi dans Super Leader" : "Super Leader tracking start"}<input name="trackingStartDate" type="date" className={fieldClass()} /></label>
              <label className="text-sm font-bold">{fr ? "Type de renouvellement" : "Renewal type"}<select name="renewalType" defaultValue="manual" className={fieldClass()}><option value="manual">{fr ? "Décision manuelle" : "Manual decision"}</option><option value="tacit">{fr ? "Renouvellement tacite" : "Tacit renewal"}</option><option value="none">{fr ? "Pas de renouvellement prévu" : "No renewal planned"}</option></select></label>
              <label className="text-sm font-bold">{fr ? "Durée du renouvellement (mois)" : "Renewal period (months)"}<input name="renewalPeriodMonths" type="number" min="1" max="120" placeholder="12" className={fieldClass()} /></label>
              <label className="text-sm font-bold">{fr ? "Préavis de non-renouvellement (jours)" : "Non-renewal notice (days)"}<input name="nonRenewalNoticeDays" type="number" min="0" max="730" placeholder="30" className={fieldClass()} /></label>
              <label className="text-sm font-bold">{fr ? "Préavis de résiliation (jours)" : "Termination notice (days)"}<input name="terminationNoticeDays" type="number" min="0" max="730" className={fieldClass()} /></label>
              <label className="text-sm font-bold">{fr ? "Confidentialité après fin (mois)" : "Post-term confidentiality (months)"}<input name="confidentialityPostTermMonths" type="number" min="0" max="1200" className={fieldClass()} /></label>
              <label className="mt-6 flex items-center gap-2 text-sm font-bold"><input name="confidentialityIndefinite" type="checkbox" />{fr ? "Confidentialité post-contractuelle indéfinie" : "Indefinite post-contract confidentiality"}</label>
              <label className="text-sm font-bold sm:col-span-2">{fr ? "Causes de résiliation immédiate" : "Immediate termination triggers"}<textarea name="immediateTerminationTriggers" rows={2} className={fieldClass()} /></label>
              <label className="text-sm font-bold">{fr ? "Qualité / cohérence du contrat" : "Contract clarity"}<select name="contractClarityStatus" defaultValue="unchecked" className={fieldClass()}><option value="unchecked">{fr ? "À vérifier" : "Unchecked"}</option><option value="clear">{fr ? "Clair" : "Clear"}</option><option value="review_required">{fr ? "Revue requise / incohérence détectée" : "Review required / inconsistency detected"}</option></select></label>
              <label className="text-sm font-bold">{fr ? "Note de cohérence" : "Clarity note"}<input name="contractClarityNote" placeholder={fr ? "Ex. préambule 2 ans / article 6 : 1 an" : "e.g. preamble 2 years / clause 6: 1 year"} className={fieldClass()} /></label>
              <label className="text-sm font-bold sm:col-span-2">{fr ? "Note sur l’exécution antérieure" : "Legacy execution note"}<textarea name="legacyExecutionNote" rows={3} placeholder={fr ? "Ce qui est connu de l’exécution avant le suivi Super Leader." : "What is known about execution before Super Leader tracking."} className={fieldClass()} /></label>
              <div className="sm:col-span-2"><SecureAttachmentUpload purpose="contract" prefix="contractSource" label={fr ? "Contrat signé original (PDF / Word)" : "Original signed contract (PDF / Word)"} help={fr ? "Document privé · 10 Mo max. Une fois archivé comme source contractuelle, il ne sera pas remplacé silencieusement." : "Private document · 10 MB max. Once archived as the contractual source, it cannot be silently replaced."} chooseLabel={fr ? "Choisir le contrat" : "Choose contract"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Document prêt" : "Document ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Document invalide." : "Invalid document."} /></div>
            </div>
          </details>
          <button disabled={!providers.length} className="mt-5 rounded-xl bg-amber-500 px-5 py-3 font-black text-amber-950 disabled:cursor-not-allowed disabled:opacity-50">{fr ? "Créer / importer le contrat" : "Create / import contract"}</button>
          {!providers.length ? <p className="mt-2 text-xs font-bold text-amber-800">{fr ? "Ajoute d’abord un prestataire." : "Add a provider first."}</p> : null}
        </form>
      </section> : null}

      <section id="session-roadmap" className="mt-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{fr ? "ROADMAP DE LA SESSION" : "SESSION ROADMAP"}</p>
            <h2 className="mt-2 text-2xl font-black">{fr ? "État du module et finalisation" : "Module status and completion"}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{fr ? "Le cycle contractuel et son tableau de bord consolidé sont opérationnels. Les évolutions futures seront suivies séparément sans maintenir ce module dans un état incomplet." : "The contract lifecycle and its consolidated dashboard are operational. Future enhancements will be tracked separately without keeping this module in an incomplete state."}</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-black uppercase tracking-wide text-emerald-800">{fr ? "Module et dashboard finalisés" : "Module and dashboard complete"}</span>
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h3 className="text-lg font-black text-emerald-950">✓ {fr ? "Déjà opérationnel" : "Already operational"}</h3>
            <ul className="mt-4 space-y-2 text-sm font-semibold leading-6 text-emerald-950">
              <li>✓ {fr ? "Fiches prestataires et portefeuille des contrats" : "Provider records and contract portfolio"}</li>
              <li>✓ {fr ? "Passeport du contrat, échéance et responsable interne" : "Contract passport, expiry and internal owner"}</li>
              <li>✓ {fr ? "Livrables, reporting d’exécution et validation" : "Deliverables, execution reporting and validation"}</li>
              <li>✓ {fr ? "KPI, validation des résultats et score de performance" : "KPIs, result validation and performance score"}</li>
              <li>✓ {fr ? "Incidents, non-conformités et actions correctives" : "Incidents, non-conformities and corrective actions"}</li>
              <li>✓ {fr ? "Recommandation et décision de renouvellement par contrat" : "Contract-level renewal recommendation and decision"}</li>
              <li>✓ {fr ? "Calendrier de revue J-90 / J-60 / J-30 et décision finale" : "D-90 / D-60 / D-30 review calendar and final decision"}</li>
              <li>✓ {fr ? "File centralisée des renouvellements à traiter" : "Central queue for renewal reviews"}</li>
              <li>✓ {fr ? "Recherche, filtres, tri et pagination du portefeuille" : "Portfolio search, filters, sorting and pagination"}</li>
              <li>✓ {fr ? "Modification auditée des fiches prestataires" : "Audited provider record editing"}</li>
              <li>✓ {fr ? "Import de contrats existants / historiques avec document source immuable" : "Existing / historical contract import with immutable source document"}</li>
              <li>✓ {fr ? "Obligations contractuelles récurrentes et règles de rémunération" : "Recurring contractual obligations and compensation rules"}</li>
              <li>✓ {fr ? "Centre global d’exécution et des livrables" : "Global execution and deliverables centre"}</li>
              <li>✓ {fr ? "Vue globale des incidents et risques" : "Global incidents and risks view"}</li>
              <li>✓ {fr ? "Avenants, versions contractuelles et registre documentaire" : "Amendments, contract versions and document register"}</li>
              <li>✓ {fr ? "Reporting portefeuille et analyses" : "Portfolio reporting and analytics"}</li>
              <li>✓ {fr ? "Finance contractuelle et suivi des paiements" : "Contract finance and payment tracking"}</li>
              <li>✓ {fr ? "Portail sécurisé et rapports des prestataires" : "Secure provider portal and reports"}</li>
            </ul>
          </article>
          <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h3 className="text-lg font-black text-emerald-950">✓ {fr ? "Tableau de bord opérationnel" : "Operational dashboard"}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-emerald-800">{fr ? "Toutes les fonctions prévues pour le pilotage quotidien des contrats sont maintenant actives." : "All functions planned for day-to-day contract management are now active."}</p>
            <ul className="mt-4 space-y-2 text-sm font-semibold leading-6 text-emerald-950">
              <li>✓ {fr ? "Cockpit unique des actions urgentes : rapports, livrables, incidents, paiements et renouvellements" : "Single urgent-action cockpit: reports, deliverables, incidents, payments and renewals"}</li>
              <li>✓ {fr ? "Vue personnalisée « Mes contrats » pour chaque responsable interne" : "Personalised My contracts view for each internal owner"}</li>
              <li>✓ {fr ? "Indicateurs de qualité : contrat sans responsable, document, obligation ou KPI" : "Data-quality indicators: contracts missing owner, document, obligation or KPI"}</li>
              <li>✓ {fr ? "Synthèse des engagements financiers par devise et période" : "Financial commitment summary by currency and period"}</li>
              <li>✓ {fr ? "Activité récente et décisions importantes du portefeuille" : "Recent portfolio activity and important decisions"}</li>
              <li>✓ {fr ? "Alertes automatiques et digest périodique aux responsables" : "Automated alerts and periodic owner digest"}</li>
            </ul>
          </article>
        </div>
      </section>

      {editingProvider ? <section id="provider-edit" className="mt-7 scroll-mt-28 rounded-3xl border-2 border-indigo-300 bg-indigo-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "MODIFICATION PRESTATAIRE" : "EDIT PROVIDER"}</p><h2 className="mt-2 text-2xl font-black">{editingProvider.legal_name}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Les changements sont enregistrés dans le journal d’audit." : "Changes are recorded in the audit log."}</p></div><Link href={hrefWith({editProvider: undefined}, "service-providers")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">{fr ? "Annuler" : "Cancel"}</Link></div>
        <form action={updateServiceProviderDetailsAction} className="mt-5 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="providerId" value={editingProvider.id} />
          <label className="text-sm font-bold">{fr ? "Raison sociale *" : "Legal name *"}<input name="legalName" required defaultValue={editingProvider.legal_name} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr ? "Nom commercial" : "Trading name"}<input name="tradingName" defaultValue={editingProvider.trading_name ?? ""} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr ? "Catégorie de service *" : "Service category *"}<input name="serviceCategory" required defaultValue={editingProvider.service_category} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr ? "Pays" : "Country"}<input name="country" defaultValue={editingProvider.country ?? ""} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr ? "Contact" : "Contact person"}<input name="contactName" defaultValue={editingProvider.contact_name ?? ""} className={fieldClass()} /></label>
          <label className="text-sm font-bold">Email<input name="contactEmail" type="email" defaultValue={editingProvider.contact_email ?? ""} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr ? "Téléphone" : "Phone"}<input name="contactPhone" defaultValue={editingProvider.contact_phone ?? ""} className={fieldClass()} /></label>
          <label className="text-sm font-bold sm:col-span-2">Notes<textarea name="notes" rows={4} defaultValue={editingProvider.notes} className={fieldClass()} /></label>
          <div className="sm:col-span-2"><button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr ? "Enregistrer les modifications" : "Save changes"}</button></div>
        </form>
      </section> : null}

      <section id="service-providers" className="mt-7 scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{fr ? "REGISTRE" : "REGISTRY"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Prestataires" : "Service providers"}</h2></div><span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black">{filteredProviders.length} / {providers.length}</span></div>
        <form method="get" action="/dashboard/contracts" className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50 p-4">
          <label className="min-w-[260px] flex-1 text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Rechercher un prestataire" : "Search providers"}<input name="providerQ" defaultValue={query.providerQ ?? ""} placeholder={fr ? "Nom, catégorie, contact, email, pays…" : "Name, category, contact, email, country…"} className={fieldClass()} /></label>
          <label className="min-w-[180px] text-xs font-black uppercase tracking-wide text-slate-600">Statut<select name="providerStatus" defaultValue={providerStatusFilter} className={fieldClass()}><option value="all">{fr ? "Tous" : "All"}</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select></label>
          <button className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white">{fr ? "Rechercher" : "Search"}</button>
          <Link href="/dashboard/contracts#service-providers" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black">{fr ? "Effacer" : "Clear"}</Link>
        </form>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{paginatedProviders.map((provider) => <article key={provider.id} className="rounded-2xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{provider.legal_name}</h3><p className="text-sm text-slate-500">{provider.service_category}{provider.country ? ` · ${provider.country}` : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${provider.status === "active" ? "bg-emerald-100 text-emerald-800" : provider.status === "suspended" ? "bg-red-100 text-red-800" : "bg-slate-200 text-slate-700"}`}>{provider.status}</span></div>
          <p className="mt-3 text-sm text-slate-600">{provider.contact_name || "—"}{provider.contact_email ? ` · ${provider.contact_email}` : ""}</p>
          {canManage ? <div className="mt-4 flex flex-wrap gap-2"><Link href={`/dashboard/contracts?editProvider=${provider.id}#provider-edit`} className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-black text-white">{fr ? "Modifier la fiche" : "Edit details"}</Link><form action={updateServiceProviderStatusAction} className="flex gap-2"><input type="hidden" name="providerId" value={provider.id}/><select name="status" defaultValue={provider.status} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"><option value="active">Active</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select><button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">{fr ? "Statut" : "Status"}</button></form></div> : null}
        </article>)}</div>
        {!filteredProviders.length ? <p className="mt-5 rounded-2xl bg-slate-50 p-8 text-center text-slate-500">{fr ? "Aucun prestataire ne correspond à la recherche." : "No providers match the search."}</p> : null}
        {totalProviderPages > 1 ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"><p className="text-sm font-bold text-slate-600">{fr ? `Page ${currentProviderPage} sur ${totalProviderPages}` : `Page ${currentProviderPage} of ${totalProviderPages}`}</p><div className="flex gap-2">{currentProviderPage > 1 ? <Link href={hrefWith({providerPage: String(currentProviderPage - 1)}, "service-providers")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">← {fr ? "Précédent" : "Previous"}</Link> : null}{currentProviderPage < totalProviderPages ? <Link href={hrefWith({providerPage: String(currentProviderPage + 1)}, "service-providers")} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Suivant" : "Next"} →</Link> : null}</div></div> : null}
      </section>
    </div>
  </main>;
}
