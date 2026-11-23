import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";

const LEADERS = new Set(["owner", "admin", "executive", "hr", "manager"]);

type ContractRow = {id:string; provider_id:string; contract_number:string; title:string; internal_owner_user_id:string; end_date:string; status:string; current_version:number};
type ProviderRow = {id:string; legal_name:string};
type DocumentRow = {id:string; contract_id:string; document_type:string; title:string; document_date:string|null; file_name:string; created_by:string; created_at:string};
type AmendmentRow = {id:string; contract_id:string; amendment_number:number; title:string; effective_date:string; status:string; previous_version:number; resulting_version:number; document_id:string|null; created_at:string};
type ProfileRow = {id:string; full_name:string|null; email:string|null};

function fieldClass() {return "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";}
function daysUntil(date:string) {const target=new Date(`${date}T00:00:00Z`).getTime(); const today=new Date(); const start=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()); return Math.ceil((target-start)/86400000);}

export default async function ContractDocumentsPage({searchParams}:{searchParams:Promise<{q?:string;type?:string;status?:string}>}) {
  const [{locale}, query, context] = await Promise.all([getI18n(), searchParams, requireAccessContext()]);
  const fr = locale === "fr";
  if (!LEADERS.has(context.role)) redirect("/dashboard/my-day");

  const [contractRes, providerRes, documentRes, amendmentRes] = await Promise.all([
    context.admin.from("service_contracts").select("id,provider_id,contract_number,title,internal_owner_user_id,end_date,status,current_version").eq("organization_id", context.organizationId).order("end_date", {ascending:true}),
    context.admin.from("service_providers").select("id,legal_name").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_documents").select("id,contract_id,document_type,title,document_date,file_name,created_by,created_at").eq("organization_id", context.organizationId).order("created_at", {ascending:false}).limit(500),
    context.admin.from("service_contract_amendments").select("id,contract_id,amendment_number,title,effective_date,status,previous_version,resulting_version,document_id,created_at").eq("organization_id", context.organizationId).order("created_at", {ascending:false}).limit(500),
  ]);

  let contracts=(contractRes.data??[]) as ContractRow[];
  if (context.role === "manager") contracts=contracts.filter((row)=>row.internal_owner_user_id===context.user.id);
  const contractIds=new Set(contracts.map((row)=>row.id));
  const providers=(providerRes.data??[]) as ProviderRow[];
  const providerById=new Map(providers.map((row)=>[row.id,row]));
  const contractById=new Map(contracts.map((row)=>[row.id,row]));
  const documents=((documentRes.data??[]) as DocumentRow[]).filter((row)=>contractIds.has(row.contract_id));
  const amendments=((amendmentRes.data??[]) as AmendmentRow[]).filter((row)=>contractIds.has(row.contract_id));
  const creatorIds=[...new Set(documents.map((row)=>row.created_by))];
  const {data:profileData}=creatorIds.length?await context.admin.from("profiles").select("id,full_name,email").in("id",creatorIds):{data:[] as ProfileRow[]};
  const profileById=new Map(((profileData??[]) as ProfileRow[]).map((row)=>[row.id,row]));

  const q=String(query.q??"").trim().toLowerCase();
  const type=String(query.type??"").trim();
  const status=String(query.status??"").trim();
  const filteredDocs=documents.filter((doc)=>{
    const contract=contractById.get(doc.contract_id); const provider=contract?providerById.get(contract.provider_id):null;
    if (type && doc.document_type!==type) return false;
    if (!q) return true;
    return [doc.title,doc.file_name,doc.document_type,contract?.title,contract?.contract_number,provider?.legal_name].some((v)=>String(v??"").toLowerCase().includes(q));
  });
  const filteredAmendments=amendments.filter((item)=>{
    const contract=contractById.get(item.contract_id); const provider=contract?providerById.get(contract.provider_id):null;
    if (status && item.status!==status) return false;
    if (!q) return true;
    return [item.title,item.status,contract?.title,contract?.contract_number,provider?.legal_name].some((v)=>String(v??"").toLowerCase().includes(q));
  });

  const applied=amendments.filter((row)=>row.status==="applied").length;
  const ready=amendments.filter((row)=>row.status==="ready").length;
  const drafts=amendments.filter((row)=>row.status==="draft").length;

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-7xl">
    <Link href="/dashboard/contracts" className="text-sm font-black text-blue-700">← {fr?"Retour aux contrats":"Back to contracts"}</Link>
    <header className="mt-4 rounded-3xl bg-slate-950 p-7 text-white shadow-xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">SUPER LEADER OPERATIONS · V4.10.12</p><h1 className="mt-3 text-4xl font-black">{fr?"Documents contractuels & avenants":"Contract documents & amendments"}</h1><p className="mt-3 max-w-4xl text-slate-300">{fr?"Un registre central pour retrouver les pièces contractuelles, suivre les versions et empêcher toute modification silencieuse des conditions actives.":"A central register for contract documents, versions and controlled amendments."}</p></header>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr?"Documents archivés":"Archived documents"}</p><p className="mt-2 text-3xl font-black">{documents.length}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr?"Avenants appliqués":"Applied amendments"}</p><p className="mt-2 text-3xl font-black text-emerald-700">{applied}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr?"Prêts à appliquer":"Ready to apply"}</p><p className="mt-2 text-3xl font-black text-indigo-700">{ready}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr?"Brouillons":"Drafts"}</p><p className="mt-2 text-3xl font-black text-amber-700">{drafts}</p></div></section>

    <form className="mt-5 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[1fr_220px_220px_auto]"><input name="q" defaultValue={query.q??""} placeholder={fr?"Rechercher contrat, prestataire, document…":"Search contract, provider, document…"} className={fieldClass()}/><select name="type" defaultValue={type} className={fieldClass()}><option value="">{fr?"Tous les documents":"All documents"}</option>{["amendment","annex","exhibit","nda","insurance","invoice","receipt","correspondence","other"].map((v)=><option key={v} value={v}>{v}</option>)}</select><select name="status" defaultValue={status} className={fieldClass()}><option value="">{fr?"Tous les avenants":"All amendments"}</option>{["draft","ready","applied","cancelled"].map((v)=><option key={v} value={v}>{v}</option>)}</select><button className="rounded-xl bg-slate-950 px-5 py-2 font-black text-white">{fr?"Filtrer":"Filter"}</button></form>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{fr?"Avenants":"Amendments"}</h2><div className="mt-4 space-y-3">{filteredAmendments.map((item)=>{const contract=contractById.get(item.contract_id); const provider=contract?providerById.get(contract.provider_id):null; return <Link key={item.id} href={`/dashboard/contracts/${item.contract_id}#contract-documents`} className="block rounded-2xl border border-slate-200 p-4 hover:border-indigo-300"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-indigo-700">{fr?`Avenant n°${item.amendment_number}`:`Amendment #${item.amendment_number}`} · V{item.previous_version} → V{item.resulting_version}</p><p className="mt-1 font-black">{item.title}</p><p className="mt-1 text-sm text-slate-500">{provider?.legal_name||"—"} · {contract?.title||"—"} · {item.effective_date}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase">{item.status}</span></div></Link>;})}{!filteredAmendments.length?<p className="rounded-xl bg-slate-50 p-5 text-center text-slate-500">{fr?"Aucun avenant correspondant.":"No matching amendment."}</p>:null}</div></section>

    <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{fr?"Registre des documents":"Document register"}</h2><div className="mt-4 grid gap-3 lg:grid-cols-2">{filteredDocs.map((doc)=>{const contract=contractById.get(doc.contract_id); const provider=contract?providerById.get(contract.provider_id):null; const creator=profileById.get(doc.created_by); return <article key={doc.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-blue-700">{doc.document_type}</p><p className="mt-1 font-black">{doc.title}</p><p className="mt-1 text-sm text-slate-500">{provider?.legal_name||"—"} · {contract?.title||"—"}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-800">{contract?`V${contract.current_version}`:"—"}</span></div><p className="mt-3 text-xs text-slate-500">{doc.document_date||doc.created_at.slice(0,10)} · {creator?.full_name||creator?.email||"—"} · {doc.file_name}</p><div className="mt-3 flex flex-wrap gap-2"><Link href={`/api/attachments/contract-document/${doc.id}`} target="_blank" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr?"Ouvrir":"Open"}</Link><Link href={`/dashboard/contracts/${doc.contract_id}#contract-documents`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">{fr?"Passeport":"Passport"}</Link></div></article>;})}{!filteredDocs.length?<p className="rounded-xl bg-slate-50 p-5 text-center text-slate-500 lg:col-span-2">{fr?"Aucun document correspondant.":"No matching document."}</p>:null}</div></section>

    <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-black">{fr?"Rappel de gouvernance":"Governance reminder"}</h2><p className="mt-2 text-sm text-amber-950">{fr?"Le registre n’autorise pas la suppression silencieuse des documents. Un changement de durée, valeur, périmètre, conditions de paiement ou cible de performance doit passer par un avenant signé et explicitement appliqué.":"Documents are not silently deleted. Material term changes require a signed amendment and explicit application."}</p><p className="mt-2 text-xs font-bold text-amber-800">{fr?`Contrats suivis: ${contracts.length} · prochaine échéance: ${contracts.length?Math.min(...contracts.map((c)=>daysUntil(c.end_date))):"—"} jours`:`Tracked contracts: ${contracts.length}`}</p></section>
  </div></main>;
}
