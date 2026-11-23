import Link from "next/link";
import {redirect} from "next/navigation";
import {ProviderPortalAttachmentUpload} from "@/components/contracts/provider-portal-attachment-upload";
import {
  signOutProviderPortalAction,
  submitProviderDeliverableAction,
  submitProviderObligationAction,
  submitProviderReportAction,
} from "@/app/actions/service-provider-portal";
import {getProviderPortalContext, linkedProviderIds} from "@/lib/contracts/provider-portal-access";

type ProviderRow = {id: string; legal_name: string; trading_name: string | null; service_category: string; status: string};
type ContractRow = {
  id: string;
  organization_id: string;
  provider_id: string;
  contract_number: string;
  title: string;
  service_scope: string;
  start_date: string;
  end_date: string;
  status: string;
  performance_target: number | string;
};
type ObligationRow = {id: string; contract_id: string; title: string; description: string; responsible_party: string; evidence_required: boolean; target_quantity: number | string | null; unit: string; status: string};
type OccurrenceRow = {id: string; contract_id: string; obligation_id: string; period_start: string | null; period_end: string | null; due_date: string; expected_quantity: number | string | null; actual_quantity: number | string | null; status: string; submission_note: string; review_note: string; review_score: number | string | null};
type DeliverableRow = {id: string; contract_id: string; title: string; description: string; due_date: string; status: string; submission_note: string; review_note: string};
type ReportRow = {id: string; contract_id: string; period_start: string; period_end: string; status: string; work_completed: string; review_note: string; submitted_at: string};
type FinanceRow = {id: string; contract_id: string; period_start: string | null; period_end: string | null; due_date: string | null; calculated_amount: number | string; currency: string; status: string; settled_amount: number | string | null; settled_at: string | null};
type AttachmentRow = {id: string; contract_id: string; resource_type: string; resource_id: string; file_name: string; created_at: string};

const ACTIVE_CONTRACT_STATUSES = new Set(["active", "under_review", "renewed", "suspended"]);

function money(value: number | string | null | undefined, currency: string) {
  const amount = Number(value ?? 0);
  return `${new Intl.NumberFormat("fr-FR", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number.isFinite(amount) ? amount : 0)} ${currency}`;
}

function statusClass(status: string) {
  if (["accepted", "paid", "delivered", "active", "renewed"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["rejected", "terminated", "cancelled"].includes(status)) return "bg-red-100 text-red-800";
  if (["submitted", "under_review", "held", "partial"].includes(status)) return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

function badge(status: string) {
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClass(status)}`}>{status}</span>;
}

function feedbackMessage(params: {success?: string; error?: string}) {
  if (params.error) return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{params.error}</div>;
  if (params.success) return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{params.success}</div>;
  return null;
}

export default async function ProviderPortalPage({searchParams}: {searchParams?: Promise<{success?: string; error?: string}>}) {
  const params = await (searchParams ?? Promise.resolve<{success?: string; error?: string}>({}));
  const context = await getProviderPortalContext();
  if (!context) return null;
  if (context.links.some((link) => link.password_setup_required)) redirect("/provider-set-password");
  const providerIds = linkedProviderIds(context);
  const now = new Date().toISOString();
  await context.admin.from("service_provider_portal_users").update({last_login_at: now, activated_at: now, updated_at: now}).eq("user_id", context.userId).eq("status", "active");

  const [{data: providerData}, {data: contractData}] = await Promise.all([
    context.admin.from("service_providers").select("id,legal_name,trading_name,service_category,status").in("id", providerIds),
    context.admin.from("service_contracts").select("id,organization_id,provider_id,contract_number,title,service_scope,start_date,end_date,status,performance_target").in("provider_id", providerIds).order("end_date", {ascending: true}),
  ]);
  const providers = (providerData ?? []) as ProviderRow[];
  const contracts = ((contractData ?? []) as ContractRow[]).filter((contract) =>
    context.links.some((link) => link.provider_id === contract.provider_id && link.organization_id === contract.organization_id),
  );
  const contractIds = contracts.map((contract) => contract.id);

  let obligations: ObligationRow[] = [];
  let occurrences: OccurrenceRow[] = [];
  let deliverables: DeliverableRow[] = [];
  let reports: ReportRow[] = [];
  let finances: FinanceRow[] = [];
  let attachments: AttachmentRow[] = [];
  if (contractIds.length) {
    const [obligationResult, occurrenceResult, deliverableResult, reportResult, financeResult, attachmentResult] = await Promise.all([
      context.admin.from("service_contract_obligations").select("id,contract_id,title,description,responsible_party,evidence_required,target_quantity,unit,status").in("contract_id", contractIds).in("responsible_party", ["provider", "both"]).neq("status", "cancelled"),
      context.admin.from("service_contract_obligation_occurrences").select("id,contract_id,obligation_id,period_start,period_end,due_date,expected_quantity,actual_quantity,status,submission_note,review_note,review_score").in("contract_id", contractIds).order("due_date", {ascending: true}),
      context.admin.from("service_contract_deliverables").select("id,contract_id,title,description,due_date,status,submission_note,review_note").in("contract_id", contractIds).neq("status", "cancelled").order("due_date", {ascending: true}),
      context.admin.from("service_contract_reports").select("id,contract_id,period_start,period_end,status,work_completed,review_note,submitted_at").in("contract_id", contractIds).order("submitted_at", {ascending: false}),
      context.admin.from("service_contract_financial_items").select("id,contract_id,period_start,period_end,due_date,calculated_amount,currency,status,settled_amount,settled_at").in("contract_id", contractIds).neq("status", "cancelled").order("due_date", {ascending: false}),
      context.admin.from("service_provider_portal_attachments").select("id,contract_id,resource_type,resource_id,file_name,created_at").in("contract_id", contractIds).order("created_at", {ascending: false}),
    ]);
    obligations = (obligationResult.data ?? []) as ObligationRow[];
    occurrences = (occurrenceResult.data ?? []) as OccurrenceRow[];
    deliverables = (deliverableResult.data ?? []) as DeliverableRow[];
    reports = (reportResult.data ?? []) as ReportRow[];
    finances = (financeResult.data ?? []) as FinanceRow[];
    attachments = (attachmentResult.data ?? []) as AttachmentRow[];
  }

  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const obligationById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
  const attachmentMap = new Map<string, AttachmentRow[]>();
  for (const attachment of attachments) {
    const key = `${attachment.resource_type}:${attachment.resource_id}`;
    const rows = attachmentMap.get(key) ?? [];
    rows.push(attachment);
    attachmentMap.set(key, rows);
  }
  const today = new Date().toISOString().slice(0, 10);
  const openContracts = contracts.filter((contract) => ACTIVE_CONTRACT_STATUSES.has(contract.status)).length;
  const pendingObligations = occurrences.filter((row) => ["planned", "submitted", "partial", "rejected"].includes(row.status)).length;
  const pendingDeliverables = deliverables.filter((row) => !["accepted", "cancelled"].includes(row.status)).length;
  const unpaid = finances.filter((row) => ["approved", "held", "pending"].includes(row.status)).length;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-[28px] bg-slate-950 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">Super Leader · v4.10.17</p>
              <h1 className="mt-2 text-3xl font-black">Portail prestataire</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Un espace externe limité à tes propres contrats. Tu peux soumettre tes obligations, livrables, preuves et rapports, puis suivre tes échéances financières.</p>
            </div>
            <form action={signOutProviderPortalAction}>
              <button className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-black text-white">Se déconnecter</button>
            </form>
          </div>
        </header>

        {feedbackMessage(params)}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">Contrats ouverts</p><p className="mt-2 text-3xl font-black">{openContracts}</p></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">Obligations à suivre</p><p className="mt-2 text-3xl font-black">{pendingObligations}</p></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">Livrables à suivre</p><p className="mt-2 text-3xl font-black">{pendingDeliverables}</p></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">Échéances financières</p><p className="mt-2 text-3xl font-black">{unpaid}</p></div>
        </section>

        {contracts.length === 0 ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm"><p className="font-bold">Aucun contrat n’est encore relié à cet accès prestataire.</p></section>
        ) : contracts.map((contract) => {
          const provider = providerById.get(contract.provider_id);
          const contractOccurrences = occurrences.filter((row) => row.contract_id === contract.id && obligationById.has(row.obligation_id));
          const contractDeliverables = deliverables.filter((row) => row.contract_id === contract.id);
          const contractReports = reports.filter((row) => row.contract_id === contract.id).slice(0, 5);
          const contractFinance = finances.filter((row) => row.contract_id === contract.id);
          return (
            <section key={contract.id} className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
              <div className="bg-slate-950 p-5 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-cyan-300">{provider?.legal_name ?? "Prestataire"} · {contract.contract_number}</p>
                    <h2 className="mt-1 text-2xl font-black">{contract.title}</h2>
                    <p className="mt-2 text-sm text-slate-300">{contract.start_date} → {contract.end_date}</p>
                  </div>
                  {badge(contract.status)}
                </div>
                {contract.service_scope ? <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-300">{contract.service_scope}</p> : null}
              </div>

              <div className="grid gap-5 p-5 xl:grid-cols-2">
                <div className="space-y-5">
                  <div>
                    <h3 className="text-lg font-black">Obligations contractuelles</h3>
                    <div className="mt-3 space-y-3">
                      {contractOccurrences.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Aucune échéance d’obligation disponible.</p> : contractOccurrences.map((occurrence) => {
                        const obligation = obligationById.get(occurrence.obligation_id);
                        if (!obligation) return null;
                        const closed = ["accepted", "waived"].includes(occurrence.status);
                        const files = attachmentMap.get(`obligation_occurrence:${occurrence.id}`) ?? [];
                        return (
                          <details key={occurrence.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4" open={!closed && occurrence.due_date <= today}>
                            <summary className="cursor-pointer list-none">
                              <div className="flex items-start justify-between gap-3">
                                <div><p className="font-black">{obligation.title}</p><p className="mt-1 text-xs text-slate-500">Échéance {occurrence.due_date}{occurrence.expected_quantity !== null ? ` · attendu ${occurrence.expected_quantity} ${obligation.unit}` : ""}</p></div>
                                {badge(occurrence.status)}
                              </div>
                            </summary>
                            {obligation.description ? <p className="mt-3 text-sm leading-6 text-slate-600">{obligation.description}</p> : null}
                            {files.length ? <div className="mt-3 flex flex-wrap gap-2">{files.map((file) => <Link key={file.id} href={`/api/provider-portal/attachments/${file.id}`} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-indigo-700 underline">{file.file_name}</Link>)}</div> : null}
                            {occurrence.review_note ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-900">Retour iLEAD : {occurrence.review_note}</p> : null}
                            {!closed ? (
                              <form action={submitProviderObligationAction} className="mt-4 space-y-3">
                                <input type="hidden" name="contractId" value={contract.id} />
                                <input type="hidden" name="occurrenceId" value={occurrence.id} />
                                {obligation.target_quantity !== null ? <input name="actualQuantity" type="number" step="any" defaultValue={occurrence.actual_quantity ?? ""} placeholder={`Quantité réalisée (${obligation.unit})`} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" /> : null}
                                <textarea name="submissionNote" defaultValue={occurrence.submission_note} placeholder="Compte rendu / commentaire de réalisation" className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                                <ProviderPortalAttachmentUpload contractId={contract.id} />
                                <button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white">Soumettre pour validation</button>
                              </form>
                            ) : null}
                          </details>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-black">Livrables</h3>
                    <div className="mt-3 space-y-3">
                      {contractDeliverables.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Aucun livrable défini.</p> : contractDeliverables.map((deliverable) => {
                        const closed = deliverable.status === "accepted";
                        const files = attachmentMap.get(`deliverable:${deliverable.id}`) ?? [];
                        return (
                          <details key={deliverable.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{deliverable.title}</p><p className="mt-1 text-xs text-slate-500">Échéance {deliverable.due_date}</p></div>{badge(deliverable.status)}</div></summary>
                            {deliverable.description ? <p className="mt-3 text-sm leading-6 text-slate-600">{deliverable.description}</p> : null}
                            {files.length ? <div className="mt-3 flex flex-wrap gap-2">{files.map((file) => <Link key={file.id} href={`/api/provider-portal/attachments/${file.id}`} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-indigo-700 underline">{file.file_name}</Link>)}</div> : null}
                            {deliverable.review_note ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-900">Retour iLEAD : {deliverable.review_note}</p> : null}
                            {!closed ? <form action={submitProviderDeliverableAction} className="mt-4 space-y-3"><input type="hidden" name="contractId" value={contract.id} /><input type="hidden" name="deliverableId" value={deliverable.id} /><textarea name="submissionNote" defaultValue={deliverable.submission_note} placeholder="Commentaire de soumission" className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" /><ProviderPortalAttachmentUpload contractId={contract.id} /><button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white">Soumettre le livrable</button></form> : null}
                          </details>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <h3 className="text-lg font-black">Rapport d’activité</h3>
                    <form action={submitProviderReportAction} className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <input type="hidden" name="contractId" value={contract.id} />
                      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-black uppercase text-slate-600">Début période<input type="date" name="periodStart" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case" /></label><label className="text-xs font-black uppercase text-slate-600">Fin période<input type="date" name="periodEnd" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case" /></label></div>
                      <textarea name="workCompleted" required placeholder="Travail réalisé pendant la période" className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                      <textarea name="challenges" placeholder="Difficultés / blocages" className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                      <textarea name="nextActions" placeholder="Prochaines actions" className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                      <ProviderPortalAttachmentUpload contractId={contract.id} />
                      <button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">Soumettre le rapport</button>
                    </form>
                    {contractReports.length ? <div className="mt-3 space-y-2">{contractReports.map((report) => <div key={report.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-black">{report.period_start} → {report.period_end}</p>{badge(report.status)}</div><p className="mt-1 line-clamp-2 text-xs text-slate-600">{report.work_completed}</p>{report.review_note ? <p className="mt-2 text-xs font-bold text-amber-800">Retour : {report.review_note}</p> : null}{(attachmentMap.get(`report:${report.id}`) ?? []).map((file) => <Link key={file.id} href={`/api/provider-portal/attachments/${file.id}`} className="mt-2 inline-block text-xs font-black text-indigo-700 underline">{file.file_name}</Link>)}</div>)}</div> : null}
                  </div>

                  <div>
                    <h3 className="text-lg font-black">Échéances financières</h3>
                    <p className="mt-1 text-xs text-slate-500">Vue informative uniquement : le prestataire ne peut ni approuver ni marquer un paiement comme réglé.</p>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                      {contractFinance.length === 0 ? <p className="p-4 text-sm text-slate-500">Aucune échéance financière enregistrée.</p> : contractFinance.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-b-0"><div><p className="font-black">{money(item.calculated_amount, item.currency)}</p><p className="mt-1 text-xs text-slate-500">{item.period_start ?? "—"} → {item.period_end ?? "—"} · échéance {item.due_date ?? "—"}</p>{item.status === "paid" && item.settled_amount !== null ? <p className="mt-1 text-xs font-bold text-emerald-700">Réglé : {money(item.settled_amount, item.currency)}</p> : null}</div>{badge(item.status)}</div>)}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
