"use client";
import {useState} from "react";
type Phase="scheduled"|"pending"|"arrived"|"completed"|"feedback"|"followup"|"closed";
const stages:Phase[]=["scheduled","pending","arrived","completed","feedback","followup","closed"];
const labels:Record<Phase,string>={
 scheduled:"Rendez-vous programmé",pending:"QR d'arrivée scanné",arrived:"Accueil confirmé",
 completed:"Départ enregistré",feedback:"Feedback reçu",followup:"Suivi attribué",closed:"Suivi terminé"
};
const cn="rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900";
export default function CantonDemoClient(){
 const [phase,setPhase]=useState<Phase>("scheduled");
 const [unit,setUnit]=useState<"DIG"|"TCF">("DIG");
 const [language,setLanguage]=useState<"fr"|"en">("fr");
 const [rating,setRating]=useState(5);
 const [followup,setFollowup]=useState("Rappeler pour proposer la prochaine étape");
 const current=stages.indexOf(phase);
 const isFr=language==="fr";
 const headline=isFr?"Parcours visiteur — Simulation":"Visitor Journey — Simulation";
 const description=isFr?"Cette démonstration utilise uniquement des données fictives. Elle ne sauvegarde rien dans Super Leader.":"This demonstration uses fake data only. Nothing is saved in Super Leader.";
 const next=()=>setPhase(stages[Math.min(current+1,stages.length-1)]);
 const reset=()=>{setPhase("scheduled");setRating(5);setFollowup("Rappeler pour proposer la prochaine étape")};
 return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
  <div className="rounded-2xl bg-slate-900 p-6 text-white">
   <div className="mb-2 flex flex-wrap justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-widest text-amber-300">ILEAD Global · Canton Visitor Center · V4.10.132</span><select aria-label="Language" className="rounded bg-white p-2 text-slate-900" value={language} onChange={e=>setLanguage(e.target.value as "fr"|"en")}><option value="fr">Français</option><option value="en">English</option></select></div>
   <h1 className="text-2xl font-bold">{headline}</h1>
   <p className="mt-2 text-sm text-slate-100">{description}</p>
   <div className="mt-4 inline-block rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-950">{isFr?"SIMULATION — AUCUNE DONNÉE RÉELLE":"SIMULATION — NO REAL DATA"}</div>
  </div>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
   [isFr?"Attendus":"Expected",current<2?"1":"0"],[isFr?"Sur place":"On site",current>=2&&current<3?"1":"0"],[isFr?"Terminé":"Completed",current>=3?"1":"0"],[isFr?"Suivi ouvert":"Open follow-up",current===5?"1":"0"]
  ].map(([l,n])=><section key={l} className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">{l}</div><div className="mt-1 text-2xl font-bold">{n}</div></section>)}</div>
  <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">{isFr?"Visite de test":"Test visit"}</h2>
   <div className="mt-3 grid gap-3 sm:grid-cols-2">
    <label className="text-sm">{isFr?"Département":"Department"}<select className={"mt-1 w-full "+cn} value={unit} onChange={e=>{setUnit(e.target.value as "DIG"|"TCF");reset()}}><option value="DIG">DIG — Terrains</option><option value="TCF">TCF — Ferme</option></select></label>
    <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{isFr?"Visiteur fictif":"Fake visitor"}:</strong> Alex Exemple<br/><strong>{isFr?"Objet":"Purpose"}:</strong> {unit==="DIG"?(isFr?"Visite d'un terrain":"Land tour"):(isFr?"Visite de la ferme":"Farm tour")}</div>
   </div>
   <ol className="mt-5 grid gap-2 sm:grid-cols-2">{stages.map((s,i)=><li key={s} className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${i<=current?"border-emerald-300 bg-emerald-50":"border-slate-200"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i<=current?"bg-emerald-700 text-white":"bg-slate-100"}`}>{i+1}</span>{labels[s]}</li>)}</ol>
  </section>
  <section className="rounded-xl border bg-white p-5" aria-live="polite">
   <h2 className="text-lg font-semibold">{isFr?"Étape actuelle":"Current step"} : {labels[phase]}</h2>
   {phase==="scheduled"&&<p className="mt-2 text-sm">{isFr?"Un commercial a programmé une visite. Le visiteur peut scanner le QR d'arrivée à la réception.":"A salesperson scheduled a visit. The visitor can scan the arrival QR at reception."}</p>}
   {phase==="pending"&&<p className="mt-2 text-sm">{isFr?"Le visiteur a renseigné son arrivée par QR. Le personnel contrôle le rendez-vous avant de valider, sans créer de doublon.":"The visitor entered an arrival request via QR. Reception verifies the existing appointment before approving it."}</p>}
   {phase==="arrived"&&<p className="mt-2 text-sm">{isFr?"La réception a confirmé l'arrivée. Un rendez-vous existant est réutilisé.":"Reception approved check-in and reused the scheduled appointment."}</p>}
   {phase==="completed"&&<p className="mt-2 text-sm">{isFr?"Le départ est enregistré. Le visiteur peut scanner le QR de feedback et saisir son code individuel.":"Departure recorded. The visitor can scan the feedback QR and enter their visit code."}</p>}
   {phase==="feedback"&&<div className="mt-3"><p className="text-sm">{isFr?"Note de satisfaction simulée":"Simulated satisfaction rating"}</p><div className="mt-2 flex flex-wrap gap-2">{[1,2,3,4,5].map(n=><button type="button" key={n} onClick={()=>setRating(n)} aria-pressed={rating===n} className={`min-h-11 min-w-11 rounded-lg border px-3 font-semibold ${rating===n?"bg-indigo-700 text-white":"bg-white"}`}>{n} ★</button>)}</div><p className="mt-2 text-sm">{rating<=2?(isFr?"Alerte satisfaction : intervention recommandée.":"Low rating: follow-up recommended."):(isFr?"Feedback enregistré dans la simulation.":"Feedback recorded in this simulation.")}</p></div>}
   {phase==="followup"&&<label className="mt-3 block text-sm">{isFr?"Action assignée":"Assigned next action"}<input className={"mt-1 w-full "+cn} value={followup} maxLength={140} onChange={e=>setFollowup(e.target.value)}/></label>}
   {phase==="closed"&&<p className="mt-2 text-sm">{isFr?"Parcours terminé : visite enregistrée, satisfaction recueillie et suivi clôturé.":"Journey complete: visit recorded, feedback captured and follow-up closed."}</p>}
   <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={next} disabled={phase==="closed"||(phase==="followup"&&!followup.trim())} className="rounded-lg bg-indigo-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{phase==="scheduled"?"Scanner QR d'arrivée":phase==="pending"?"Confirmer l'arrivée":phase==="arrived"?"Enregistrer le départ":phase==="completed"?"Scanner QR de feedback":phase==="feedback"?"Assigner le suivi":phase==="followup"?"Clôturer le suivi":"Terminé"}</button><button type="button" onClick={reset} className="rounded-lg border px-4 py-3">{isFr?"Recommencer":"Restart"}</button></div>
  </section>
  <p className="text-xs text-slate-500">{isFr?"Ce parcours est destiné à valider l'ergonomie uniquement. Les vrais formulaires QR, comptes employés, permissions, emails et WhatsApp ne sont pas testés ici.":"This flow is only for UX testing. Real QR forms, employee accounts, permissions, emails and WhatsApp are not tested here."}</p>
 </main>;
}