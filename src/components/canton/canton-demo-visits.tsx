"use client";
import {useState} from "react";

export type DemoSite="Canton HQ"|"Dallas (simulation)";
export type DemoVisitStatus="scheduled"|"pending"|"arrived"|"completed";
export type DemoVisit={
 id:string;
 name:string;
 phone:string;
 department:"DIG"|"TCF"|"DIRECTION";
 purpose:string;
 site:DemoSite;
 scheduledAt:string;
 status:DemoVisitStatus;
 checkInAt:string|null;
 checkOutAt:string|null;
};
const field="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const btn="cursor-pointer rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800";
const action="cursor-pointer rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100";
const normalize=(s:string)=>s.trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
const digits=(s:string)=>s.replace(/[^0-9]/g,"");
const validPhone=(s:string)=>digits(s).length>=7;
const validDate=(s:string)=>!Number.isNaN(Date.parse(s));

export function CantonDemoAppointmentDesk({site,fr,visits,onAdd,onReception}:{
 site:DemoSite;fr:boolean;visits:DemoVisit[];
 onAdd:(visit:DemoVisit)=>void;
 onReception:()=>void;
}){
 const t=(f:string,e:string)=>fr?f:e;
 const [name,setName]=useState("");
 const [phone,setPhone]=useState("");
 const [department,setDepartment]=useState<DemoVisit["department"]>("DIG");
 const [purpose,setPurpose]=useState("");
 const [scheduledAt,setScheduledAt]=useState("");
 const [mode,setMode]=useState<"scheduled"|"walkin">("scheduled");
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const here=visits.filter(v=>v.site===site);
 const submit=(e:React.FormEvent<HTMLFormElement>)=>{
  e.preventDefault();setError("");setSuccess("");
  if(normalize(name).length<2||!validPhone(phone)||normalize(purpose).length<3||mode==="scheduled"&&(!scheduledAt||!validDate(scheduledAt))){
   setError(t("Renseignez un nom, un téléphone (7 chiffres minimum), le motif et la date du rendez-vous.","Provide a name, phone (at least 7 digits), purpose and scheduled date."));return;
  }
  const duplicate=here.some(v=>v.status!=="completed"&&v.department===department&&
    (digits(v.phone)===digits(phone)||normalize(v.name)===normalize(name)));
  if(duplicate){
   setError(t("Visite potentiellement déjà enregistrée : vérifiez la liste avant de créer un doublon.","Possible duplicate visit: review existing entries before creating another."));return;
  }
  const now=new Date().toISOString();
  onAdd({
   id:crypto.randomUUID(),name:name.trim(),phone:phone.trim(),department,purpose:purpose.trim(),site,
   scheduledAt:mode==="scheduled"?scheduledAt:now,
   status:mode==="walkin"?"arrived":"scheduled",
   checkInAt:mode==="walkin"?now:null,checkOutAt:null
  });
  setSuccess(t("Visite fictive ajoutée. Ouvrez Réception pour poursuivre.","Simulated visit created. Open Reception to continue."));
  setName("");setPhone("");setPurpose("");setScheduledAt("");
 };
 return <div className="space-y-5">
  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
   <h3 className="font-bold text-indigo-950">{t("Enregistrer ou annoncer une visite","Register or announce a visit")}</h3>
   <p className="mt-1 text-xs text-indigo-900">{t("Démonstration locale : aucun visiteur réel n'est enregistré.","Local demonstration: no real visitor is registered.")} · {site}</p>
   <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
    <label className="text-sm font-medium">{t("Type de visite","Visit type")}<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)} className={field}><option value="scheduled">{t("Rendez-vous programmé","Scheduled appointment")}</option><option value="walkin">{t("Visiteur sans rendez-vous","Walk-in visitor")}</option></select></label>
    <label className="text-sm font-medium">{t("Département","Department")}<select value={department} onChange={e=>setDepartment(e.target.value as DemoVisit["department"])} className={field}><option value="DIG">DIG</option><option value="TCF">TCF</option><option value="DIRECTION">{t("Direction","Executive office")}</option></select></label>
    <label className="text-sm font-medium">{t("Nom du visiteur *","Visitor name *")}<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} className={field}/></label>
    <label className="text-sm font-medium">{t("Téléphone *","Phone *")}<input type="tel" required minLength={7} maxLength={30} value={phone} onChange={e=>setPhone(e.target.value)} className={field}/></label>
    <label className="text-sm font-medium">{t("Motif de la visite *","Visit purpose *")}<input required minLength={3} maxLength={160} value={purpose} onChange={e=>setPurpose(e.target.value)} className={field}/></label>
    {mode==="scheduled"&&<label className="text-sm font-medium">{t("Date et heure *","Date and time *")}<input type="datetime-local" required value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)} className={field}/></label>}
    {error&&<p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 sm:col-span-2">{error}</p>}
    {success&&<p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 sm:col-span-2">{success}</p>}
    <button type="submit" className={btn+" sm:col-span-2"}>{t("Enregistrer la visite (simulation)","Register visit (simulation)")}</button>
   </form>
  </div>
  {here.length>0&&<div className="rounded-xl border bg-white p-4"><h3 className="font-bold">{t("Visites enregistrées dans cette session","Visits registered in this session")} ({here.length})</h3>
   <div className="mt-3 space-y-2">{here.map(v=><div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50 p-3">
    <div><p className="font-semibold">{v.name} · {v.department}</p><p className="text-xs text-slate-600">{v.purpose} · {v.status} · {v.site}</p></div>
    <button type="button" className={action} onClick={onReception}>{t("Ouvrir la réception","Open reception")}</button>
   </div>)}</div>
  </div>}
 </div>;
}

export function CantonDemoReceptionQueue({site,fr,visits,search,onChange}:{
 site:DemoSite;fr:boolean;visits:DemoVisit[];search:string;
 onChange:(id:string,status:DemoVisitStatus)=>void;
}){
 const t=(f:string,e:string)=>fr?f:e;
 const visible=visits.filter(v=>v.site===site&&(normalize(v.name)+" "+digits(v.phone)).includes(normalize(search)));
 const label=(status:DemoVisitStatus)=>({
  scheduled:t("Attendu","Expected"),pending:t("QR à confirmer","QR awaiting review"),
  arrived:t("Sur place","On site"),completed:t("Terminée","Completed")
 } as Record<DemoVisitStatus,string>)[status];
 return <div className="space-y-3">
  {visible.map(v=><article key={v.id} className="rounded-xl border bg-white p-4">
   <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{v.name} · {v.department}</h3><p className="text-sm text-slate-600">{v.purpose} · {site} · {label(v.status)}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">QA DEMO</span></div>
   <div className="mt-2 text-xs text-slate-600">{t("Arrivée","Check-in")}: {v.checkInAt?new Date(v.checkInAt).toLocaleString(fr?"fr-FR":"en-US",{timeZone:"America/Chicago"}):"—"} · {t("Départ","Checkout")}: {v.checkOutAt?new Date(v.checkOutAt).toLocaleString(fr?"fr-FR":"en-US",{timeZone:"America/Chicago"}):"—"}</div>
   <div className="mt-3 flex flex-wrap gap-2">
    {v.status==="scheduled"&&<button type="button" className={action} onClick={()=>onChange(v.id,"pending")}>{t("Simuler le QR d'arrivée","Simulate arrival QR")}</button>}
    {v.status==="pending"&&<button type="button" className={btn} onClick={()=>onChange(v.id,"arrived")}>{t("Confirmer sur la visite existante","Confirm existing visit")}</button>}
    {v.status==="arrived"&&<button type="button" className={btn} onClick={()=>onChange(v.id,"completed")}>{t("Enregistrer le départ","Check out")}</button>}
   </div>
  </article>)}
  {visible.length===0&&visits.length>0&&<p className="text-sm text-slate-500">{t("Aucune nouvelle visite correspondante.","No additional visits match the search.")}</p>}
 </div>;
}
