"use client";
import {useEffect,useState} from "react";
import {CantonDemoAppointmentDesk,CantonDemoReceptionQueue,type DemoVisit,type DemoVisitStatus} from "@/components/canton/canton-demo-visits";

type View="dashboard"|"reception"|"appointments"|"commercial"|"feedback"|"admin";
type Stage="scheduled"|"pending"|"arrived"|"completed";
type Language="fr"|"en";
const sites=["Canton HQ","Dallas (simulation)"] as const;
const DEMO_VISITS_KEY="super-leader-canton-demo-session-visits-v1";
const validDemoVisit=(value:unknown):value is DemoVisit=>{
 if(!value||typeof value!=="object")return false;
 const v=value as Partial<DemoVisit>;
 return typeof v.id==="string"&&v.id.length<=100&&
  typeof v.name==="string"&&v.name.length>=2&&v.name.length<=100&&
  typeof v.phone==="string"&&v.phone.length<=30&&
  typeof v.purpose==="string"&&v.purpose.length<=160&&
  (v.site==="Canton HQ"||v.site==="Dallas (simulation)")&&
  (v.department==="DIG"||v.department==="TCF"||v.department==="DIRECTION")&&
  (v.status==="scheduled"||v.status==="pending"||v.status==="arrived"||v.status==="completed")&&
  typeof v.scheduledAt==="string"&&v.scheduledAt.length<=64&&
  (v.checkInAt===null||(typeof v.checkInAt==="string"&&v.checkInAt.length<=64))&&
  (v.checkOutAt===null||(typeof v.checkOutAt==="string"&&v.checkOutAt.length<=64));
};
function decodeSavedVisits(raw:string|null):DemoVisit[]{
 if(!raw||raw.length>100000)return [];
 try{
  const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed))return [];
  return parsed.slice(0,100).filter(validDemoVisit);
 }catch{return [];}
}

const teammates=["Cécile (demo)","Jordan (demo)","Patricia (demo)"] as const;
const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button="min-h-10 cursor-pointer rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-40";
const outline="min-h-10 cursor-pointer rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-50";
const labels:Record<View,[string,string]>={
 dashboard:["Tableau de bord","Dashboard"],reception:["Réception","Reception"],
 appointments:["Rendez-vous","Appointments"],commercial:["Suivi commercial","Commercial follow-up"],
 feedback:["Avis","Feedback"],admin:["Administration","Administration"]
};
export default function CantonDemoClient(){
 const [language,setLanguage]=useState<Language>("fr");
 const [site,setSite]=useState<(typeof sites)[number]>("Canton HQ");
 const [view,setView]=useState<View>("dashboard");
 const [stage,setStage]=useState<Stage>("scheduled");
 const [search,setSearch]=useState("");
 const [owner,setOwner]=useState<(typeof teammates)[number]>("Cécile (demo)");
 const [selectedOwner,setSelectedOwner]=useState<(typeof teammates)[number]>("Cécile (demo)");
 const [checkInAt,setCheckInAt]=useState<string|null>(null);
 const [checkOutAt,setCheckOutAt]=useState<string|null>(null);
 const [outcome,setOutcome]=useState("");
 const [resultNote,setResultNote]=useState("");
 const [followupOpen,setFollowupOpen]=useState(true);
 const [rating,setRating]=useState(0);
 const [feedbackVisitId,setFeedbackVisitId]=useState("");
 const [feedbackComment,setFeedbackComment]=useState("");
 const [showQr,setShowQr]=useState(false);
 const [toast,setToast]=useState("");
 const [additionalVisits,setAdditionalVisits]=useState<DemoVisit[]>([]);
 const [demoStorageReady,setDemoStorageReady]=useState(false);
 const [restoredVisits,setRestoredVisits]=useState(0);
 // Session storage only; intentionally not a real customer database or remote sync.
 // Restore before enabling writes, so development hot reload cannot erase visit records.
 useEffect(()=>{
  try{
   const restored=decodeSavedVisits(window.sessionStorage.getItem(DEMO_VISITS_KEY));
   setAdditionalVisits(restored);
   setRestoredVisits(restored.length);
  }catch{}
  setDemoStorageReady(true);
 },[]);
 useEffect(()=>{
  if(!demoStorageReady)return;
  try{window.sessionStorage.setItem(DEMO_VISITS_KEY,JSON.stringify(additionalVisits.slice(0,100)));}
  catch{/* Private browsing or disabled browser storage: simulation stays in memory. */}
 },[additionalVisits,demoStorageReady]);
 const handleAdditionalVisitStatus=(id:string,status:DemoVisitStatus)=>{
  setAdditionalVisits(items=>items.map(v=>v.id===id?{
   ...v,status,checkInAt:status==="arrived"?new Date().toISOString():v.checkInAt,
   checkOutAt:status==="completed"?new Date().toISOString():v.checkOutAt
  }:v));
  setToast(status==="pending"?t("QR fictif enregistré.","Simulated QR queued."):status==="arrived"?t("Arrivée fictive confirmée.","Simulated check-in confirmed."):t("Départ fictif enregistré.","Simulated checkout recorded."));
 };
 const fr=language==="fr";
 const t=(f:string,e:string)=>fr?f:e;
 const setPage=(p:View)=>{setView(p);setToast("")};
 const title=t("Gestion des visiteurs et rendez-vous","Visitor & Appointment Management");
 const visitorName="Alex Exemple";
 const stageLabel=stage==="scheduled"?t("Attendu","Expected"):stage==="pending"?t("Arrivée QR à confirmer","QR arrival awaiting review"):stage==="arrived"?t("Sur place","On site"):t("Visite terminée","Visit completed");
 const siteRows=site==="Canton HQ"?1:0;
 const showVisitor=siteRows>0&&visitorName.toLowerCase().includes(search.trim().toLowerCase());
 const cantonTime=(iso:string|null)=>iso?new Date(iso).toLocaleString(fr?"fr-FR":"en-US",{timeZone:"America/Chicago",hour:"2-digit",minute:"2-digit",month:"short",day:"numeric"}):"—";
 const reset=()=>{
  setStage("scheduled");setOwner("Cécile (demo)");setSelectedOwner("Cécile (demo)");setCheckInAt(null);setCheckOutAt(null);setOutcome("");setResultNote("");
  setFollowupOpen(true);setRating(0);setFeedbackVisitId("");setFeedbackComment("");setSearch("");setToast("");setView("dashboard");setSite("Canton HQ");setAdditionalVisits([]);setRestoredVisits(0);
  try{window.sessionStorage.removeItem(DEMO_VISITS_KEY);}catch{}
 };
 return <main className="mx-auto max-w-6xl space-y-5 p-4 text-slate-900 md:p-7">
  <header className="rounded-2xl bg-slate-900 p-5 text-white md:p-7">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div><p className="text-xs font-bold uppercase tracking-widest text-amber-300">ILEAD · SUPER LEADER · CANTON</p><h1 className="mt-2 text-2xl font-bold md:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-sm text-slate-200">{t("Prototype visuel autonome — données fictives uniquement. Aucun accès à Supabase, aucune écriture réelle.","Standalone visual prototype — fictitious data only. No Supabase access or real writes.")}</p></div>
    <div className="flex gap-2"><button type="button" onClick={()=>setLanguage("fr")} aria-pressed={fr} className={fr?"rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-900":"rounded-lg border border-white/50 px-3 py-2 text-sm text-white"}>FR</button><button type="button" onClick={()=>setLanguage("en")} aria-pressed={!fr} className={!fr?"rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-900":"rounded-lg border border-white/50 px-3 py-2 text-sm text-white"}>EN</button></div>
   </div>
   <div className="mt-4 inline-flex rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-950">{t("SIMULATION LOCALE — AUCUN MESSAGE ENVOYÉ","LOCAL SIMULATION — NO MESSAGES SENT")}</div>
  </header>
  <nav aria-label={t("Navigation Canton","Canton navigation")} className="sticky top-0 z-10 overflow-x-auto rounded-2xl border bg-white p-2 shadow-sm"><div className="flex min-w-max gap-2">
   {(Object.keys(labels) as View[]).map(p=><button type="button" key={p} aria-current={view===p?"page":undefined} onClick={()=>setPage(p)} className={view===p?"rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white":"rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-indigo-50"}>{labels[p][fr?0:1]}</button>)}
  </div></nav>
  <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4"><span className="text-sm font-bold">{t("Site actif","Active site")}</span>
   {sites.map(s=><button key={s} type="button" onClick={()=>{setSite(s);setToast("")}} aria-pressed={site===s} className={site===s?"rounded-full bg-indigo-700 px-4 py-2 text-sm font-semibold text-white":"rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-indigo-100"}>{s}</button>)}
   <span className="ml-auto text-xs text-slate-500">{t("Le site reste sélectionné lors des changements d'onglet.","Site stays selected across tabs.")}</span>
  </section>
  {restoredVisits>0&&<p role="status" className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm font-medium text-sky-900">{t("Visites de test restaurées dans cet onglet : ","Test visits restored in this tab: ")}{restoredVisits}. {t("Ouvrez Rendez-vous ou Réception pour les retrouver.","Open Appointments or Reception to see them.")}</p>}
  {toast&&<p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">{toast}</p>}
  {view==="dashboard"&&<section className="space-y-4">
   <h2 className="text-xl font-bold">{t("Vue d'ensemble","Overview")}</h2>
   <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {[
     {title:t("Attendus","Expected"),value:(siteRows&&stage==="scheduled"?1:0)+additionalVisits.filter(v=>v.site===site&&["scheduled","pending"].includes(v.status)).length,open:"reception" as View},
     {title:t("Sur place","On site"),value:(siteRows&&stage==="arrived"?1:0)+additionalVisits.filter(v=>v.site===site&&v.status==="arrived").length,open:"reception" as View},
     {title:t("Terminées","Completed"),value:(siteRows&&stage==="completed"?1:0)+additionalVisits.filter(v=>v.site===site&&v.status==="completed").length,open:"appointments" as View},
     {title:t("Suivis ouverts","Open follow-ups"),value:siteRows&&followupOpen?1:0,open:"commercial" as View}
    ].map(card=><button type="button" onClick={()=>setPage(card.open)} key={card.title} className="rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-indigo-400 hover:shadow-md"><div className="flex justify-between text-sm text-slate-600"><span>{card.title}</span><span aria-hidden>→</span></div><div className="mt-1 text-3xl font-bold">{card.value}</div></button>)}
   </div><p className="text-sm text-slate-600">{t("Cliquez sur un compteur pour ouvrir directement le poste concerné.","Click a metric to open the relevant workspace directly.")}</p>
  </section>}
  {view==="reception"&&<section className="space-y-4 rounded-xl border bg-white p-5">
   <h2 className="text-xl font-bold">{t("Poste de réception","Reception desk")}</h2>
   <form onSubmit={e=>e.preventDefault()} className="flex flex-col gap-2 md:flex-row"><label htmlFor="canton-demo-search" className="sr-only">{t("Rechercher un visiteur","Find a visitor")}</label><input id="canton-demo-search" className={input+" flex-1"} value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("Rechercher un nom…","Search by name…")}/><button type="button" onClick={()=>setSearch("")} className={outline}>{t("Effacer","Clear")}</button></form>
   {showVisitor?<article className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">{visitorName} · DIG</h3><p className="text-sm text-slate-600">{stageLabel} · {site}</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800">QA DEMO</span></div>
    {checkInAt&&<div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
     <span><strong>{t("Arrivée","Check-in")}:</strong> {cantonTime(checkInAt)}</span>
     <span><strong>{t("Accueil","Reception by")}:</strong> {t("Réception Canton (démo)","Canton reception (demo)")}</span>
     <span><strong>{t("Départ","Checkout")}:</strong> {cantonTime(checkOutAt)}</span>
    </div>}
    <div className="mt-3 flex flex-wrap gap-2">
     {stage==="scheduled"&&<button type="button" className={button} onClick={()=>{setStage("pending");setToast(t("Demande QR simulée.","QR request simulated."))}}>{t("Simuler le scan QR","Simulate QR arrival")}</button>}
     {stage==="pending"&&<button type="button" className={button} onClick={()=>{setStage("arrived");setCheckInAt(new Date().toISOString());setToast(t("Arrivée confirmée sans doublon.","Arrival confirmed without duplicate."))}}>{t("Confirmer l'arrivée","Confirm check-in")}</button>}
     {stage==="arrived"&&<button type="button" className={button} onClick={()=>{setStage("completed");setCheckOutAt(new Date().toISOString());setToast(t("Départ enregistré.","Checkout recorded."))}}>{t("Enregistrer le départ","Check out")}</button>}
     {stage==="completed"&&<button type="button" className={outline} onClick={()=>setPage("feedback")}>{t("Recueillir un avis","Record feedback")}</button>}
    </div>
   </article>:<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{t("Aucun visiteur fictif sur ce site pour cette recherche.","No simulated visitor matches this site and search.")}</p>}
   <CantonDemoReceptionQueue site={site} fr={fr} visits={additionalVisits} search={search} onChange={handleAdditionalVisitStatus} onFeedback={id=>{setFeedbackVisitId(id);setRating(0);setFeedbackComment("");setPage("feedback")}}/>
   <p className="text-xs text-slate-500">{t("La simulation n'utilise aucun vrai QR ni compte utilisateur.","No real QR codes or user accounts are used.")}</p>
  </section>}
  {view==="appointments"&&<section className="space-y-4 rounded-xl border bg-white p-5">
   <h2 className="text-xl font-bold">{t("Visites et rendez-vous","Visits and appointments")}</h2>
   <CantonDemoAppointmentDesk site={site} fr={fr} visits={additionalVisits} onAdd={v=>{setAdditionalVisits(items=>[...items,v]);setToast(t("Nouvelle visite fictive enregistrée.","New simulated visit registered."))}} onReception={()=>setPage("reception")}/>
   {siteRows?<div className="mt-4 rounded-xl border p-4"><div className="font-semibold">{visitorName} · DIG</div><div className="mt-1 text-sm text-slate-600">{stageLabel} · Canton HQ</div><div className="mt-2 text-sm text-slate-600">{t("Arrivée","Check-in")}: {cantonTime(checkInAt)} · {t("Départ","Checkout")}: {cantonTime(checkOutAt)}</div><button className={outline+" mt-3"} type="button" onClick={()=>setPage("reception")}>{t("Ouvrir à la réception","Open in reception")}</button></div>:<p className="mt-4 text-sm text-slate-600">{t("Aucune visite fictive sur ce site.","No simulated visits at this site.")}</p>}
  </section>}
  {view==="commercial"&&<section className="space-y-4">
   <div><h2 className="text-xl font-bold">{t("Suivi commercial","Commercial follow-up")}</h2><p className="text-sm text-slate-600">{t("Réaffecter une action si Cécile est indisponible, puis enregistrer le résultat réel avant clôture.","Reassign an action if Cécile is unavailable, then record a concrete result before closure.")}</p></div>
   {siteRows?<article className="space-y-4 rounded-xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{visitorName} · DIG</h3><span className={followupOpen?"rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900":"rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900"}>{followupOpen?t("Ouvert","Open"):t("Terminé","Completed")}</span></div>
    <p className="text-sm">{t("Prochaine action : rappeler pour confirmer les documents.","Next action: call to confirm paperwork.")}</p>
    <p className="text-sm font-semibold text-slate-700">{t("Responsable actuel","Current owner")}: {owner}</p>
    {followupOpen?<><div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4"><label className="block text-sm font-semibold">{t("Attribuer à un autre collaborateur","Assign to another teammate")}<select className={input+" mt-2"} value={selectedOwner} onChange={e=>setSelectedOwner(e.target.value as (typeof teammates)[number])}>{teammates.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
     <p className="mt-2 text-xs text-indigo-900">{selectedOwner===owner?t("Sélectionnez un autre collaborateur avant de confirmer.","Choose a different teammate before confirming."):t("En attente de confirmation : ","Pending confirmation: ")+selectedOwner}</p>
     <button type="button" disabled={selectedOwner===owner} className={button+" mt-3"} onClick={()=>{setOwner(selectedOwner);setToast(t("Réaffectation confirmée : ","Reassignment confirmed: ")+selectedOwner)}}>{t("Confirmer la réaffectation","Confirm reassignment")}</button></div>
     <form className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" onSubmit={e=>{e.preventDefault();if(outcome&&resultNote.trim().length>=5){setFollowupOpen(false);setToast(t("Résultat enregistré et suivi clôturé (simulation).","Outcome recorded and follow-up closed (simulation)."))}}}>
      <label className="block text-sm font-semibold">{t("Résultat du suivi *","Follow-up outcome *")}<select name="outcome" className={input+" mt-2"} required value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="">{t("Sélectionner","Select")}</option><option value="contacted">{t("Contact établi","Contacted")}</option><option value="appointment_scheduled">{t("Rendez-vous fixé","Appointment scheduled")}</option><option value="proposal_sent">{t("Proposition envoyée","Proposal sent")}</option><option value="no_response">{t("Sans réponse","No response")}</option><option value="other">{t("Autre résultat","Other outcome")}</option></select></label>
      <label className="block text-sm font-semibold">{t("Compte rendu obligatoire *","Required result note *")}<textarea className={input+" mt-2"} rows={3} minLength={5} maxLength={1000} required value={resultNote} onChange={e=>setResultNote(e.target.value)}/></label>
      <button className={button} disabled={!outcome||resultNote.trim().length<5} type="submit">{t("Enregistrer le résultat et clôturer","Save outcome and close")}</button>
     </form></>:<div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"><p><strong>{t("Résultat","Outcome")}:</strong> {({contacted:t("Contact établi","Contacted"),appointment_scheduled:t("Rendez-vous fixé","Appointment scheduled"),proposal_sent:t("Proposition envoyée","Proposal sent"),no_response:t("Sans réponse","No response"),other:t("Autre résultat","Other outcome")} as Record<string,string>)[outcome]||outcome}</p><p className="mt-1"><strong>{t("Compte rendu","Result note")}:</strong> {resultNote}</p></div>}
   </article>:<p className="rounded-xl border bg-white p-4 text-sm text-slate-500">{t("Aucune action fictive sur ce site.","No simulated action at this site.")}</p>}
  </section>}
  {view==="feedback"&&<section className="space-y-4 rounded-xl border bg-white p-5">
   <h2 className="text-xl font-bold">{t("Avis du visiteur","Visitor feedback")}</h2>
   <p className="text-sm text-slate-600">{t("Le visiteur retrouve sa visite par nom et quatre derniers chiffres du téléphone, ou répond anonymement. Aucun code de réception.","The visitor matches their visit by name and last four phone digits, or replies anonymously. No reception code.")}</p>
   {additionalVisits.some(v=>v.site===site&&v.status==="completed")&&<div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
    <h3 className="text-base font-semibold text-indigo-950">{t("Avis liés à une visite terminée","Feedback linked to a completed visit")}</h3>
    <label className="block text-sm font-medium">{t("Visiteur et visite","Visitor and visit")}
     <select className={input+" mt-1"} value={feedbackVisitId} onChange={e=>{setFeedbackVisitId(e.target.value);setRating(0);setFeedbackComment("")}}>
      <option value="">{t("Choisir la visite","Choose a visit")}</option>
      {additionalVisits.filter(v=>v.site===site&&v.status==="completed").map(v=><option key={v.id} value={v.id}>{v.name} · {v.department}{v.feedbackRating?" · "+v.feedbackRating+"/5":""}</option>)}
     </select>
    </label>
    {additionalVisits.filter(v=>v.site===site&&v.status==="completed"&&v.id===feedbackVisitId).map(v=><div key={v.id} className="space-y-3">
     {v.feedbackRating?<p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{t("Avis enregistré pour cette visite","Feedback recorded for this visit")}: {v.feedbackRating}/5 {v.feedbackComment?"· "+v.feedbackComment:""}</p>:<>
      <div className="flex flex-wrap gap-2">{[1,2,3,4,5].map(n=><button type="button" key={n} aria-pressed={rating===n} onClick={()=>setRating(n)} className={rating===n?"min-h-11 min-w-11 rounded-lg bg-indigo-700 p-3 font-semibold text-white":"min-h-11 min-w-11 rounded-lg border bg-white p-3 font-semibold text-slate-800"}>{n} ★</button>)}</div>
      <label className="block text-sm font-medium">{t("Commentaire (facultatif)","Comment (optional)")}<textarea className={input+" mt-1"} value={feedbackComment} maxLength={500} rows={2} onChange={e=>setFeedbackComment(e.target.value)}/></label>
      <button type="button" className={button} disabled={!rating} onClick={()=>{
       setAdditionalVisits(items=>items.map(item=>item.id===v.id&&item.status==="completed"&&!item.feedbackRating?{...item,feedbackRating:rating,feedbackComment:feedbackComment.trim()}:item));
       setToast(t("Avis fictif enregistré pour ","Simulated feedback saved for ")+v.name);
      }}>{t("Enregistrer l'avis de cette visite","Save feedback for this visit")}</button>
     </>}
    </div>)}
   </div>}
   {siteRows?<><div className="flex flex-wrap gap-2">{[1,2,3,4,5].map(n=><button type="button" key={n} aria-pressed={rating===n} onClick={()=>setRating(n)} className={rating===n?"min-h-11 min-w-11 rounded-lg bg-indigo-700 p-3 font-semibold text-white":"min-h-11 min-w-11 rounded-lg border bg-white p-3 font-semibold"}>{n} ★</button>)}</div>
    <p className="text-sm">{rating? t("Note fictive sélectionnée : ","Simulated score selected: ")+rating+"/5":t("Choisissez une note pour tester l'interface.","Select a rating to test the interface.")}</p>
    <button type="button" className={button} onClick={()=>setToast(t("Feedback fictif enregistré uniquement à l'écran.","Simulated feedback recorded on screen only."))} disabled={!rating}>{t("Enregistrer l'avis (simulation)","Record feedback (simulation)")}</button></>:<p className="text-sm text-slate-500">{t("Aucun feedback fictif pour ce site.","No simulated feedback for this site.")}</p>}
  </section>}
  {view==="admin"&&<section className="space-y-4 rounded-xl border bg-white p-5">
   <h2 className="text-xl font-bold">{t("QR codes et gestion du site","QR codes & site management")}</h2>
   <p className="text-sm text-slate-600">{t("Les QR codes occupent moins d'espace : ouvrez cette section seulement lorsque nécessaire.","QR codes take less space: open this section only when needed.")}</p>
   <button type="button" className={outline} onClick={()=>setShowQr(!showQr)} aria-expanded={showQr}>{showQr?t("Masquer les QR","Hide QR codes"):t("Afficher les QR","Show QR codes")}</button>
   {showQr&&<div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg border border-dashed p-5"><p className="font-semibold">{t("QR d'arrivée","Arrival QR")}</p><p className="mt-2 text-sm text-slate-600">{t("Emplacement réservé au QR réel, à configurer dans la préproduction.","Placeholder for the real QR, to be configured in preproduction.")}</p></div><div className="rounded-lg border border-dashed p-5"><p className="font-semibold">{t("QR de satisfaction","Feedback QR")}</p><p className="mt-2 text-sm text-slate-600">{t("Emplacement réservé au QR réel, à configurer dans la préproduction.","Placeholder for the real QR, to be configured in preproduction.")}</p></div></div>}
   <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{t("Aucun QR public, email, WhatsApp ou changement de droits n'est exécuté ici.","No public QR, email, WhatsApp, or permission changes run here.")}</p>
  </section>}
  <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-slate-600">{t("Prototype local : les visites fictives restent enregistrées dans cet onglet pendant la session. « Réinitialiser » les efface. N’utilisez aucune donnée personnelle réelle.","Local prototype: simulated visits are retained in this tab for the session. Reset clears them. Do not enter real personal data.")}</p><button type="button" className={outline} onClick={reset}>{t("Réinitialiser la simulation","Reset simulation")}</button></footer>
 </main>;
}
