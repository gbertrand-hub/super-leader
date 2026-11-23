import Image from "next/image";
import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {PrintCertificateButton} from "@/components/academy/print-certificate-button";
import {canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Line={description:string;quantity:number;unitPrice:number;total:number};
type Row={id:string;sale_id:string|null;document_type:string;document_number:string;verification_token:string;title:string;counterparty_name:string|null;counterparty_email:string|null;counterparty_phone:string|null;counterparty_address:string|null;issue_date:string;due_date:string|null;currency:string;subtotal:number|string;tax_amount:number|string;total_amount:number|string;paid_amount:number|string;balance_amount:number|string;status:string;line_items:Line[]|null;payment_terms:string|null;payment_instructions:string|null;notes:string|null;created_by:string;approved_by:string|null;approved_at:string|null};
type FinanceSettings={legal_name:string|null;registration_number:string|null;tax_identifier:string|null;billing_address:string|null;finance_email:string|null;finance_phone:string|null;default_tax_label:string|null;document_footer:string|null};
const labels:Record<string,string>={proforma:"PRO FORMA",invoice:"FACTURE",receipt:"REÇU",credit_note:"AVOIR",expense_receipt:"JUSTIFICATIF",other:"DOCUMENT"};
const statusLabels:Record<string,string>={draft:"Brouillon",pending_approval:"À approuver",approved:"Approuvé",sent:"Envoyé",accepted:"Accepté",rejected:"Rejeté",expired:"Expiré",partial:"Paiement partiel",paid:"Payé",overdue:"En retard",cancelled:"Annulé",converted:"Converti",archived:"Archivé"};
const n=(value:unknown)=>Number(value)||0;
const money=(value:unknown,currency:string)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency,maximumFractionDigits:currency==="XAF"?0:2}).format(n(value));
const date=(value:string|null)=>value?new Intl.DateTimeFormat("fr-FR",{dateStyle:"long"}).format(new Date(`${value.slice(0,10)}T12:00:00Z`)):"—";

export default async function FinanceDocumentPage({params}:{params:Promise<{documentId:string}>}) {
  const {documentId}=await params;
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const admin=createAdminClient();
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership)notFound();
  const [{data:item},{data:organization},{data:settings}]=await Promise.all([
    admin.from("finance_documents").select("id,sale_id,document_type,document_number,verification_token,title,counterparty_name,counterparty_email,counterparty_phone,counterparty_address,issue_date,due_date,currency,subtotal,tax_amount,total_amount,paid_amount,balance_amount,status,line_items,payment_terms,payment_instructions,notes,created_by,approved_by,approved_at").eq("id",documentId).eq("organization_id",membership.organization_id).maybeSingle<Row>(),
    admin.from("organizations").select("name").eq("id",membership.organization_id).maybeSingle<{name:string}>(),
    admin.from("finance_settings").select("legal_name,registration_number,tax_identifier,billing_address,finance_email,finance_phone,default_tax_label,document_footer").eq("organization_id",membership.organization_id).maybeSingle<FinanceSettings>(),
  ]);
  if(!item)notFound();
  const financeAdmin=["owner","admin"].includes(membership.role);
  let saleDocumentAccess=financeAdmin;
  if(!saleDocumentAccess&&item.sale_id&&canUseCommercialModules(membership.role)){
    const {data:sale}=await admin.from("sales_records").select("seller_id,collection_owner_id").eq("organization_id",membership.organization_id).eq("id",item.sale_id).maybeSingle<{seller_id:string;collection_owner_id:string|null}>();
    if(sale){
      const visibleUserIds=await getVisibleUserIds({admin,organizationId:membership.organization_id,actorId:auth.user.id,role:membership.role});
      saleDocumentAccess=sale.seller_id===auth.user.id||sale.collection_owner_id===auth.user.id||(membership.role==="manager"&&visibleUserIds.includes(sale.seller_id));
    }
  }
  if(!saleDocumentAccess)notFound();
  const returnHref=financeAdmin?`/dashboard/finance/documents?document=${item.id}`:"/dashboard/sales";
  const lines=item.line_items?.length?item.line_items:[{description:item.title,quantity:1,unitPrice:n(item.subtotal)||n(item.total_amount),total:n(item.subtotal)||n(item.total_amount)}];
  return <main className="min-h-screen bg-slate-100 px-5 py-8 text-slate-950 print:bg-white print:p-0"><div className="mx-auto max-w-5xl">
    <div className="mb-5 flex items-center justify-between gap-3 print:hidden"><Link href={returnHref} className="font-black text-indigo-700">← Retour</Link><PrintCertificateButton label="Imprimer / Enregistrer en PDF"/></div>
    <article className="rounded-[2rem] border bg-white p-8 shadow-xl print:rounded-none print:border-0 print:p-4 print:shadow-none sm:p-12">
      <header className="flex flex-col justify-between gap-6 border-b-4 border-slate-950 pb-7 sm:flex-row"><div><p className="text-xs font-black uppercase tracking-[.3em] text-amber-600">Super Leader Finance</p><h1 className="mt-2 text-2xl font-black">{settings?.legal_name??organization?.name??"iLEAD Global"}</h1>{settings?.billing_address?<p className="mt-2 whitespace-pre-line text-sm text-slate-600">{settings.billing_address}</p>:null}<p className="mt-1 text-sm text-slate-500">{[settings?.finance_email,settings?.finance_phone].filter(Boolean).join(" · ")}</p>{settings?.registration_number||settings?.tax_identifier?<p className="mt-1 text-xs text-slate-500">{settings?.registration_number?`Enregistrement : ${settings.registration_number}`:""}{settings?.registration_number&&settings?.tax_identifier?" · ":""}{settings?.tax_identifier?`Identifiant fiscal : ${settings.tax_identifier}`:""}</p>:null}</div><div className="sm:text-right"><p className="text-4xl font-black text-indigo-800">{labels[item.document_type]??"DOCUMENT"}</p><p className="mt-2 font-mono text-lg font-black">{item.document_number}</p><span className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase">{statusLabels[item.status]??item.status}</span></div></header>
      <section className="grid gap-6 py-7 sm:grid-cols-2"><div><p className="text-xs font-black uppercase text-slate-500">Émis à</p><p className="mt-2 text-xl font-black">{item.counterparty_name??"Client"}</p>{item.counterparty_address?<p className="mt-1 whitespace-pre-line text-sm text-slate-600">{item.counterparty_address}</p>:null}{item.counterparty_email?<p className="text-sm text-slate-600">{item.counterparty_email}</p>:null}{item.counterparty_phone?<p className="text-sm text-slate-600">{item.counterparty_phone}</p>:null}</div><div className="grid grid-cols-2 gap-4 sm:text-right"><div><p className="text-xs font-black uppercase text-slate-500">Émission</p><p className="mt-2 font-black">{date(item.issue_date)}</p></div><div><p className="text-xs font-black uppercase text-slate-500">Échéance</p><p className="mt-2 font-black">{date(item.due_date)}</p></div></div></section>
      <h2 className="text-2xl font-black">{item.title}</h2>
      <div className="mt-5 overflow-hidden rounded-2xl border"><table className="w-full text-sm"><thead className="bg-slate-950 text-left text-white"><tr><th className="p-3">Description</th><th className="p-3 text-right">Qté</th><th className="p-3 text-right">Prix unitaire</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{lines.map((line,index)=><tr key={`${line.description}-${index}`} className="border-t"><td className="p-3 font-bold">{line.description}</td><td className="p-3 text-right">{line.quantity}</td><td className="p-3 text-right">{money(line.unitPrice,item.currency)}</td><td className="p-3 text-right font-black">{money(line.total,item.currency)}</td></tr>)}</tbody></table></div>
      <section className="mt-6 ml-auto max-w-md space-y-2 rounded-2xl bg-slate-50 p-5"><div className="flex justify-between gap-5"><span>Sous-total</span><strong>{money(item.subtotal,item.currency)}</strong></div><div className="flex justify-between gap-5"><span>{settings?.default_tax_label??"Taxes"}</span><strong>{money(item.tax_amount,item.currency)}</strong></div><div className="flex justify-between gap-5 border-t pt-3 text-xl"><span className="font-black">Total</span><strong>{money(item.total_amount,item.currency)}</strong></div>{item.document_type==="invoice"?<><div className="flex justify-between gap-5 text-emerald-700"><span>Déjà payé</span><strong>{money(item.paid_amount,item.currency)}</strong></div><div className="flex justify-between gap-5 text-amber-700"><span>Solde</span><strong>{money(item.balance_amount,item.currency)}</strong></div></>:null}</section>
      <section className="mt-7 grid gap-5 sm:grid-cols-2">{item.payment_terms?<div className="rounded-2xl border p-4"><p className="text-xs font-black uppercase text-slate-500">Conditions de paiement</p><p className="mt-2 whitespace-pre-line text-sm">{item.payment_terms}</p></div>:null}{item.payment_instructions?<div className="rounded-2xl border p-4"><p className="text-xs font-black uppercase text-slate-500">Instructions de paiement</p><p className="mt-2 whitespace-pre-line text-sm">{item.payment_instructions}</p></div>:null}</section>
      {item.notes?<p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm"><strong>Note :</strong> {item.notes}</p>:null}
      {settings?.document_footer?<p className="mt-8 rounded-xl bg-slate-50 p-4 text-center text-sm font-semibold text-slate-700">{settings.document_footer}</p>:null}
      <footer className="mt-10 grid items-end gap-5 border-t pt-5 text-xs text-slate-500 sm:grid-cols-[1fr_auto]"><div><p>Document généré par Super Leader Finance · identifiant interne {item.id}</p><p className="mt-1">Toute modification de statut ou de paiement est journalisée dans l’audit financier.</p><p className="mt-2 font-bold text-slate-700">Scannez le QR pour vérifier l’authenticité et le statut actuel de ce document.</p></div><div className="rounded-xl border bg-white p-2 text-center"><Image src={`/api/finance/document-qr/${item.verification_token}`} alt="QR de vérification du document financier" width={130} height={130} unoptimized/><p className="text-[9px] font-black uppercase">Scanner pour vérifier</p></div></footer>
    </article>
  </div></main>;
}
