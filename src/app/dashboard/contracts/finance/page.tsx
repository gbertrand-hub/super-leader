import Link from "next/link";
import {redirect} from "next/navigation";
import {reviewContractFinancialItemAction, settleContractFinancialItemAction} from "@/app/actions/service-contracts";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";

type ContractRow = {id:string;provider_id:string;contract_number:string;title:string;internal_owner_user_id:string;status:string;currency:string};
type ProviderRow = {id:string;legal_name:string};
type FinancialRow = {id:string;contract_id:string;compensation_rule_id:string;item_type:string;period_start:string|null;period_end:string|null;due_date:string|null;calculated_amount:number|string;currency:string;gate_status:string;gate_note:string;status:string;source_reference:string;request_note:string;review_note:string;settlement_reference:string;settled_amount:number|string|null;created_by:string;reviewed_by:string|null;reviewed_at:string|null;settled_by:string|null;settled_at:string|null;created_at:string};
type RuleRow = {id:string;contract_id:string;label:string;rule_type:string};
type ProfileRow = {id:string;full_name:string|null;email:string|null};
type Filter = "all"|"pending"|"blocked"|"review"|"approved"|"overdue"|"paid";
type FinanceSearchParams = {q?:string|string[];view?:string|string[];contract?:string|string[]};

const LEADERS = new Set(["owner","admin","executive","hr","manager"]);
const FINANCE_DECISION_ROLES = new Set(["owner","admin"]);
const CLOSED_CONTRACTS = new Set(["completed","terminated"]);
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]??"":value??"";
const n=(value:number|string|null|undefined)=>{const out=Number(value??0);return Number.isFinite(out)?out:0;};
function todayIso(){const d=new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).toISOString().slice(0,10);}
function money(value:number|string|null|undefined,currency:string,locale:string){try{return new Intl.NumberFormat(locale,{style:"currency",currency,maximumFractionDigits:2}).format(n(value));}catch{return `${n(value).toLocaleString(locale,{maximumFractionDigits:2})} ${currency}`;}}
function sumByCurrency(rows:Array<{currency:string;amount:number}>){const totals=new Map<string,number>();for(const row of rows)totals.set(row.currency||"USD",(totals.get(row.currency||"USD")??0)+row.amount);return [...totals.entries()].sort(([a],[b])=>a.localeCompare(b));}
function gateTone(gate:string){if(gate==="ready")return "bg-emerald-100 text-emerald-800";if(gate==="blocked")return "bg-red-100 text-red-800";return "bg-amber-100 text-amber-900";}
function statusTone(status:string){if(["paid","delivered"].includes(status))return "bg-emerald-100 text-emerald-800";if(status==="approved")return "bg-cyan-100 text-cyan-900";if(status==="rejected")return "bg-rose-100 text-rose-800";if(status==="held")return "bg-orange-100 text-orange-900";return "bg-slate-100 text-slate-700";}
function statusLabel(status:string,fr:boolean){const labels:Record<string,[string,string]>={pending:["À valider","Pending"],held:["En attente","On hold"],approved:["Approuvé à payer","Approved to pay"],rejected:["Rejeté","Rejected"],paid:["Payé","Paid"],delivered:["Remis","Delivered"],cancelled:["Annulé","Cancelled"]};return (labels[status]??[status,status])[fr?0:1];}
function filterLabel(value:Filter,fr:boolean){const labels:Record<Filter,[string,string]>={all:["Tous","All"],pending:["À valider","Pending"],blocked:["Bloqués","Blocked"],review:["À revoir","Review"],approved:["Approuvés à payer","Approved to pay"],overdue:["Échus non payés","Overdue unpaid"],paid:["Payés / remis","Paid / delivered"]};return labels[value][fr?0:1];}

export default async function ContractFinancePage({searchParams}:{searchParams?:Promise<FinanceSearchParams>}){
  const [{locale},params,context]=await Promise.all([getI18n(),searchParams??Promise.resolve<FinanceSearchParams>({}),requireAccessContext()]);
  const fr=locale==="fr", localeCode=fr?"fr-FR":"en-GB";
  if(!LEADERS.has(context.role))redirect("/dashboard/my-day");
  const q=one(params.q).trim().toLowerCase();
  const requested=one(params.view) as Filter;
  const view:Filter=(["all","pending","blocked","review","approved","overdue","paid"] as Filter[]).includes(requested)?requested:"all";
  const contractFilter=one(params.contract);
  const [contractsRes,providersRes,financialRes,rulesRes]=await Promise.all([
    context.admin.from("service_contracts").select("id,provider_id,contract_number,title,internal_owner_user_id,status,currency").eq("organization_id",context.organizationId).order("end_date",{ascending:true}),
    context.admin.from("service_providers").select("id,legal_name").eq("organization_id",context.organizationId),
    context.admin.from("service_contract_financial_items").select("id,contract_id,compensation_rule_id,item_type,period_start,period_end,due_date,calculated_amount,currency,gate_status,gate_note,status,source_reference,request_note,review_note,settlement_reference,settled_amount,created_by,reviewed_by,reviewed_at,settled_by,settled_at,created_at").eq("organization_id",context.organizationId).order("created_at",{ascending:false}).limit(600),
    context.admin.from("service_contract_compensation_rules").select("id,contract_id,label,rule_type").eq("organization_id",context.organizationId),
  ]);
  const loadError=[contractsRes,providersRes,financialRes,rulesRes].find(result=>result.error)?.error;if(loadError)throw new Error(loadError.message);
  let contracts=(contractsRes.data??[]) as ContractRow[];
  if(context.role==="manager")contracts=contracts.filter(row=>row.internal_owner_user_id===context.user.id);
  const contractIds=new Set(contracts.map(row=>row.id));
  const financial=((financialRes.data??[]) as FinancialRow[]).filter(row=>contractIds.has(row.contract_id));
  const providers=(providersRes.data??[]) as ProviderRow[];
  const rules=(rulesRes.data??[]) as RuleRow[];
  const providerById=new Map(providers.map(row=>[row.id,row.legal_name]));
  const contractById=new Map(contracts.map(row=>[row.id,row]));
  const ruleById=new Map(rules.map(row=>[row.id,row]));
  const actorIds=[...new Set(financial.flatMap(row=>[row.created_by,...(row.reviewed_by?[row.reviewed_by]:[]),...(row.settled_by?[row.settled_by]:[])]))];
  const profilesRes=actorIds.length?await context.admin.from("profiles").select("id,full_name,email").in("id",actorIds):{data:[] as ProfileRow[],error:null};
  if(profilesRes.error)throw new Error(profilesRes.error.message);
  const actorById=new Map(((profilesRes.data??[]) as ProfileRow[]).map(row=>[row.id,row.full_name||row.email||"—"]));
  const today=todayIso();
  const isOpenContract=(id:string)=>{const c=contractById.get(id);return c?!CLOSED_CONTRACTS.has(c.status):false;};
  const activeRows=financial.filter(row=>isOpenContract(row.contract_id));
  const pending=activeRows.filter(row=>["pending","held"].includes(row.status)).length;
  const blocked=activeRows.filter(row=>row.gate_status==="blocked" && ["pending","held"].includes(row.status)).length;
  const review=activeRows.filter(row=>row.gate_status==="review" && ["pending","held"].includes(row.status)).length;
  const approvedRows=activeRows.filter(row=>row.status==="approved");
  const overdueRows=approvedRows.filter(row=>Boolean(row.due_date)&&String(row.due_date)<today);
  const settledRows=financial.filter(row=>["paid","delivered"].includes(row.status));
  const approvedTotals=sumByCurrency(approvedRows.map(row=>({currency:row.currency,amount:n(row.calculated_amount)})));
  const settledTotals=sumByCurrency(settledRows.map(row=>({currency:row.currency,amount:n(row.settled_amount??row.calculated_amount)})));
  const canDecide=FINANCE_DECISION_ROLES.has(context.role);

  let visible=financial.filter(row=>{
    const contract=contractById.get(row.contract_id);if(!contract)return false;
    if(contractFilter&&row.contract_id!==contractFilter)return false;
    const provider=providerById.get(contract.provider_id)??"";
    const rule=ruleById.get(row.compensation_rule_id)?.label??"";
    if(q&&!`${contract.contract_number} ${contract.title} ${provider} ${rule} ${row.source_reference}`.toLowerCase().includes(q))return false;
    if(view==="pending"&&!(["pending","held"].includes(row.status)))return false;
    if(view==="blocked"&&!(row.gate_status==="blocked"&&["pending","held"].includes(row.status)))return false;
    if(view==="review"&&!(row.gate_status==="review"&&["pending","held"].includes(row.status)))return false;
    if(view==="approved"&&row.status!=="approved")return false;
    if(view==="overdue"&&!(row.status==="approved"&&Boolean(row.due_date)&&String(row.due_date)<today))return false;
    if(view==="paid"&&!["paid","delivered"].includes(row.status))return false;
    return true;
  });
  visible=visible.slice(0,250);

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-4 text-sm font-black"><Link href="/dashboard/contracts/reports" className="text-indigo-700">← {fr?"Reporting & analyses":"Reporting & analytics"}</Link><Link href="/dashboard/contracts/execution-center" className="text-indigo-700">{fr?"Centre d’exécution":"Execution centre"} →</Link></div><Link href="/dashboard/module-status" className="rounded-xl border bg-white px-4 py-2 text-xs font-black uppercase tracking-wide">{fr?"Feuille de route":"Roadmap"}</Link></div>
    <header className="mt-5 rounded-[2rem] bg-slate-950 p-8 text-white shadow-xl"><p className="text-xs font-black uppercase tracking-[.24em] text-emerald-300">SUPER LEADER OPERATIONS · V4.10.16</p><h1 className="mt-2 text-4xl font-black">{fr?"Finance & paiements contractuels":"Contract Finance & payments"}</h1><p className="mt-3 max-w-4xl text-slate-200">{fr?"Une file centrale pour contrôler les échéances contractuelles, identifier les blocages, approuver les montants et enregistrer les règlements sans exécuter de virement bancaire depuis Super Leader.":"A central queue to control contract payables, identify blockers, approve amounts and record settlements without executing bank transfers from Super Leader."}</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/dashboard/finance" className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">{fr?"Ouvrir Finance central":"Open central Finance"}</Link><Link href="/dashboard/finance/expenses" className="rounded-xl border border-white/30 px-4 py-2 text-sm font-black text-white">{fr?"Dépenses & preuves":"Expenses & proofs"}</Link></div></header>

    <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {[[fr?"À valider":"Pending",pending,"text-slate-950"],[fr?"Bloqués":"Blocked",blocked,"text-red-700"],[fr?"À revoir":"Review",review,"text-amber-700"],[fr?"Approuvés à payer":"Approved to pay",approvedRows.length,"text-cyan-800"],[fr?"Échus non payés":"Overdue unpaid",overdueRows.length,"text-red-700"],[fr?"Réglés / remis":"Paid / delivered",settledRows.length,"text-emerald-700"],[fr?"Contrats suivis":"Contracts tracked",contracts.filter(c=>!CLOSED_CONTRACTS.has(c.status)).length,"text-indigo-700"]].map(([label,value,tone])=><article key={String(label)} className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${tone}`}>{value}</p></article>)}
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-2"><article className="rounded-3xl border bg-white p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-[.2em] text-cyan-700">{fr?"APPROUVÉ À PAYER":"APPROVED TO PAY"}</p><div className="mt-4 space-y-2">{approvedTotals.map(([currency,total])=><div key={currency} className="flex items-center justify-between rounded-xl bg-cyan-50 px-4 py-3"><span className="font-black">{currency}</span><span className="text-xl font-black">{money(total,currency,localeCode)}</span></div>)}{!approvedTotals.length?<p className="rounded-xl bg-emerald-50 p-4 font-bold text-emerald-800">{fr?"Aucun montant approuvé en attente.":"No approved amount awaiting payment."}</p>:null}</div></article><article className="rounded-3xl border bg-white p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-700">{fr?"RÈGLEMENTS ENREGISTRÉS":"RECORDED SETTLEMENTS"}</p><div className="mt-4 space-y-2">{settledTotals.map(([currency,total])=><div key={currency} className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3"><span className="font-black">{currency}</span><span className="text-xl font-black">{money(total,currency,localeCode)}</span></div>)}{!settledTotals.length?<p className="rounded-xl bg-slate-50 p-4 font-bold text-slate-500">—</p>:null}</div></article></section>

    <section className="mt-6 rounded-3xl border bg-white p-5 shadow-sm"><form className="grid gap-3 lg:grid-cols-[1fr_180px_240px_auto]"><input name="q" defaultValue={one(params.q)} placeholder={fr?"Contrat, prestataire, règle, référence…":"Contract, provider, rule, reference…"} className="rounded-xl border px-4 py-3"/><select name="view" defaultValue={view} className="rounded-xl border px-4 py-3">{(["all","pending","blocked","review","approved","overdue","paid"] as Filter[]).map(item=><option key={item} value={item}>{filterLabel(item,fr)}</option>)}</select><select name="contract" defaultValue={contractFilter} className="rounded-xl border px-4 py-3"><option value="">{fr?"Tous les contrats":"All contracts"}</option>{contracts.map(contract=><option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.title}</option>)}</select><button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{fr?"Filtrer":"Filter"}</button></form></section>

    <section className="mt-6"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.2em] text-rose-700">{fr?"FILE FINANCE":"FINANCE QUEUE"}</p><h2 className="mt-1 text-3xl font-black">{fr?"Échéances contractuelles":"Contract financial items"}</h2></div><p className="text-sm font-bold text-slate-500">{visible.length} {fr?"élément(s) affiché(s)":"item(s) shown"}</p></div><div className="mt-4 space-y-4">{visible.map(item=>{const contract=contractById.get(item.contract_id)!;const provider=providerById.get(contract.provider_id)??"—";const rule=ruleById.get(item.compensation_rule_id);const overdue=item.status==="approved"&&Boolean(item.due_date)&&String(item.due_date)<today;return <article key={item.id} className={`rounded-3xl border bg-white p-6 shadow-sm ${overdue?"border-red-300":"border-slate-200"}`}><div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${gateTone(item.gate_status)}`}>Gate: {item.gate_status}</span><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusTone(item.status)}`}>{statusLabel(item.status,fr)}</span>{overdue?<span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black uppercase text-red-800">{fr?"ÉCHU":"OVERDUE"}</span>:null}</div><h3 className="mt-3 text-xl font-black">{contract.title}</h3><p className="mt-1 text-sm font-semibold text-slate-600">{provider} · {contract.contract_number}</p><p className="mt-2 font-bold text-slate-800">{rule?.label??(fr?"Règle contractuelle":"Contract rule")}</p><p className="mt-1 text-xs text-slate-500">{item.period_start||"—"} → {item.period_end||"—"}{item.due_date?` · ${fr?"Échéance":"Due"}: ${item.due_date}`:""}</p></div><div className="text-right"><p className="text-3xl font-black">{item.item_type==="benefit"&&n(item.calculated_amount)===0?(fr?"Avantage en nature":"In-kind benefit"):money(item.calculated_amount,item.currency,localeCode)}</p><Link href={`/dashboard/contracts/${contract.id}`} className="mt-3 inline-block text-sm font-black text-indigo-700 underline">{fr?"Ouvrir le Passeport":"Open passport"}</Link></div></div><div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-3"><div><p className="text-xs font-black uppercase text-slate-400">{fr?"Contrôle exécution":"Execution gate"}</p><p className="mt-1 text-sm font-bold">{item.gate_note||"—"}</p></div><div><p className="text-xs font-black uppercase text-slate-400">{fr?"Référence source":"Source reference"}</p><p className="mt-1 text-sm font-bold">{item.source_reference||"—"}</p></div><div><p className="text-xs font-black uppercase text-slate-400">{fr?"Traçabilité":"Traceability"}</p><p className="mt-1 text-sm font-bold">{fr?"Créé par":"Created by"} {actorById.get(item.created_by)??"—"}{item.reviewed_by?` · ${fr?"Revu par":"Reviewed by"} ${actorById.get(item.reviewed_by)??"—"}`:""}{item.settled_by?` · ${fr?"Réglé par":"Settled by"} ${actorById.get(item.settled_by)??"—"}`:""}</p></div></div>{item.review_note?<p className="mt-3 rounded-xl bg-cyan-50 p-3 text-sm font-semibold">{fr?"Revue":"Review"}: {item.review_note}</p>:null}{item.settlement_reference?<p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold">{fr?"Règlement":"Settlement"}: {item.settlement_reference} · {money(item.settled_amount??item.calculated_amount,item.currency,localeCode)}</p>:null}
      {canDecide&&["pending","held"].includes(item.status)?<form action={reviewContractFinancialItemAction} className="mt-4 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-[180px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="itemId" value={item.id}/><select name="decision" defaultValue="approved" className="rounded-xl border bg-white px-3 py-2"><option value="approved">{fr?"Approuver":"Approve"}</option><option value="held">{fr?"Mettre en attente":"Put on hold"}</option><option value="rejected">{fr?"Rejeter":"Reject"}</option></select><input name="reviewNote" placeholder={fr?"Motif / justification":"Reason / justification"} className="rounded-xl border bg-white px-3 py-2"/><button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">{fr?"Enregistrer la décision":"Save decision"}</button></form>:null}
      {canDecide&&item.status==="approved"?<form action={settleContractFinancialItemAction} className="mt-4 grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 md:grid-cols-[180px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="itemId" value={item.id}/><input name="settledAmount" type="number" min="0" step="0.01" defaultValue={String(n(item.calculated_amount))} className="rounded-xl border bg-white px-3 py-2"/><input name="settlementReference" required placeholder={item.item_type==="benefit"?(fr?"Preuve de remise / référence":"Delivery proof / reference"):(fr?"Référence bancaire / reçu":"Bank / receipt reference")} className="rounded-xl border bg-white px-3 py-2"/><button className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white">{item.item_type==="benefit"?(fr?"Marquer remis":"Mark delivered"):(fr?"Marquer payé":"Mark paid")}</button></form>:null}
      {!canDecide&&["pending","held","approved"].includes(item.status)?<p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold text-slate-600">{fr?"Lecture seule : les décisions et règlements sont réservés à Owner/Admin.":"Read-only: decisions and settlements are reserved for Owner/Admin."}</p>:null}</article>})}{!visible.length?<p className="rounded-3xl border border-dashed bg-white p-12 text-center font-bold text-slate-500">{fr?"Aucune échéance ne correspond aux filtres.":"No financial item matches the filters."}</p>:null}</div></section>
    <section className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-xl font-black text-amber-950">{fr?"Séparation des responsabilités":"Separation of duties"}</h2><p className="mt-2 text-sm leading-6 text-amber-900">{fr?"Super Leader enregistre l’approbation et la preuve/référence du règlement. Aucun virement bancaire n’est exécuté depuis cette page. Les pièces comptables, dépenses et contrôles bancaires restent disponibles dans Finance central.":"Super Leader records approval and settlement proof/reference. No bank transfer is executed from this page. Accounting documents, expenses and bank controls remain in central Finance."}</p></section>
  </div></main>;
}
