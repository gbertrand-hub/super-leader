import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:"Vérification d’un document financier",robots:{index:false,follow:false}};

type Row={organization_id:string;document_type:string;document_number:string;title:string;issue_date:string;due_date:string|null;currency:string;total_amount:number|string;paid_amount:number|string;balance_amount:number|string;status:string;related_document_id:string|null};
const labels:Record<string,string>={proforma:"Pro forma",invoice:"Facture",receipt:"Reçu",credit_note:"Avoir",expense_receipt:"Justificatif",other:"Document"};
const statuses:Record<string,string>={draft:"Brouillon",pending_approval:"En attente d’approbation",approved:"Approuvé",sent:"Envoyé",accepted:"Accepté",rejected:"Rejeté",expired:"Expiré",partial:"Partiellement payé",paid:"Payé",overdue:"En retard",cancelled:"Annulé",converted:"Converti",archived:"Archivé"};
const money=(value:unknown,currency:string)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:currency==="XAF"?0:2}).format(Number(value)||0);
const date=(value:string|null)=>value?new Intl.DateTimeFormat("fr-FR",{dateStyle:"long"}).format(new Date(`${value.slice(0,10)}T12:00:00Z`)):"—";

export default async function VerifyFinanceDocumentPage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params,admin=createAdminClient();
  const {data:item}=await admin.from("finance_documents").select("organization_id,document_type,document_number,title,issue_date,due_date,currency,total_amount,paid_amount,balance_amount,status,related_document_id").eq("verification_token",token).maybeSingle<Row>();
  if(!item)notFound();
  const [{data:organization},{data:source}]=await Promise.all([
    admin.from("organizations").select("name").eq("id",item.organization_id).maybeSingle<{name:string}>(),
    item.related_document_id?admin.from("finance_documents").select("document_number").eq("id",item.related_document_id).eq("organization_id",item.organization_id).maybeSingle<{document_number:string}>():Promise.resolve({data:null}),
  ]);
  const invalid=["cancelled","rejected","archived"].includes(item.status),warning=["draft","pending_approval","expired","overdue","converted"].includes(item.status),tone=invalid?"bg-rose-50 text-rose-950 border-rose-300":warning?"bg-amber-50 text-amber-950 border-amber-300":"bg-emerald-50 text-emerald-950 border-emerald-300",heading=invalid?"Document non valide":warning?"Document authentique — attention requise":"Document authentique et valide";
  return <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-950"><article className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] bg-white shadow-2xl"><header className="bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-950 p-7 text-white"><p className="text-xs font-black uppercase tracking-[.25em] text-amber-300">Super Leader Finance</p><h1 className="mt-2 text-3xl font-black">Vérification du document</h1><p className="mt-2 text-sm text-slate-300">Registre officiel de {organization?.name??"iLEAD Global"}</p></header><div className="p-7"><section className={`rounded-2xl border p-5 ${tone}`}><h2 className="text-2xl font-black">{heading}</h2><p className="mt-2 font-bold">Statut actuel : {statuses[item.status]??item.status}</p></section><dl className="mt-6 grid gap-4 sm:grid-cols-2"><Item label="Organisation" value={organization?.name??"iLEAD Global"}/><Item label="Type" value={labels[item.document_type]??item.document_type}/><Item label="Numéro" value={item.document_number}/><Item label="Date d’émission" value={date(item.issue_date)}/><Item label="Objet" value={item.title} wide/><Item label="Montant" value={money(item.total_amount,item.currency)}/><Item label="Montant payé" value={money(item.paid_amount,item.currency)}/>{item.document_type==="invoice"?<Item label="Solde" value={money(item.balance_amount,item.currency)}/>:null}{source?<Item label="Document d’origine" value={source.document_number}/>:null}</dl><p className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center text-sm font-bold text-slate-600">Vérification publique limitée : aucune identité, coordonnée, instruction bancaire, note interne ou pièce justificative du client n’est affichée.</p></div></article></main>;
}

function Item({label,value,wide=false}:{label:string;value:string;wide?:boolean}){return <div className={`rounded-2xl border p-4 ${wide?"sm:col-span-2":""}`}><dt className="text-xs font-black uppercase text-slate-500">{label}</dt><dd className="mt-1 font-black">{value}</dd></div>}
