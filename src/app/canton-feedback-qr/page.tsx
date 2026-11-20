import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {submitCantonQrFeedback} from "@/app/actions/canton-qr";
export const dynamic="force-dynamic";
export default async function CantonFeedbackQr({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {error,success}=await searchParams;
 if(!cantonLiveEnabled())return <main className="mx-auto max-w-lg p-8">Canton QR forms are unavailable here.</main>;
 const input="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900";
 const stars=(id:string)=><fieldset><legend className="font-semibold">Votre note / Overall rating *</legend><div className="mt-2 flex flex-wrap gap-4">{[1,2,3,4,5].map(n=><label key={n} className="flex min-h-11 items-center gap-2"><input type="radio" name="rating" value={n} required/> {n} ★</label>)}</div></fieldset>;
 const honeypot=<div className="hidden" aria-hidden="true"><label>Leave empty<input name="website" tabIndex={-1} autoComplete="off"/></label></div>;
 return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
  <header className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs uppercase tracking-widest text-amber-300">ILEAD Global · Canton</p><h1 className="mt-2 text-2xl font-bold">Votre avis / Your feedback</h1><p className="mt-2 text-sm">Votre avis nous aide à progresser. Moins d&apos;une minute, sans code de visite.</p></header>
  {success?<p role="status" className="rounded-xl bg-green-50 p-5 text-green-900">Merci pour votre avis ! Thank you for helping us improve.</p>:<>
   {error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error==="limit"?"Trop de tentatives. Réessayez plus tard. / Please try later.":"Nous ne pouvons pas associer cette réponse à une visite unique. Vérifiez les informations ou choisissez un avis anonyme. / Please check the information or leave anonymous feedback."}</p>}
   <form action={submitCantonQrFeedback} className="space-y-4 rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">Avis associé à ma visite / My visit</h2>
    <p className="text-sm text-slate-600">Indiquez votre nom et les 4 derniers chiffres de votre téléphone. Aucune information personnelle n&apos;est affichée par le formulaire.</p>
    {honeypot}<input type="hidden" name="mode" value="identified"/>
    <label className="block text-sm font-medium">Nom complet / Full name *<input className={input} name="fullName" required maxLength={180} autoComplete="name"/></label>
    <label className="block text-sm font-medium">4 derniers chiffres du téléphone / Last four phone digits *<input className={input} name="last4" required inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="off" placeholder="1234"/></label>
    {stars("named")}
    <label className="block text-sm font-medium">Souhaitez-vous être recontacté ? / Would you like follow-up?<select className={input} name="contact"><option value="no">Non / No</option><option value="yes">Oui / Yes</option></select></label>
    <label className="block text-sm font-medium">Commentaire / Comment<textarea className={input} rows={3} name="comment" maxLength={1000}/></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-semibold text-white">Envoyer mon avis / Submit feedback</button>
   </form>
   <form action={submitCantonQrFeedback} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5">
    <h2 className="text-lg font-semibold">Donner un avis anonyme / Anonymous feedback</h2>
    <p className="text-sm text-slate-600">Sans nom ni téléphone. Cet avis sera comptabilisé séparément et ne sera pas associé à une visite précise.</p>
    {honeypot}<input type="hidden" name="mode" value="anonymous"/>
    <label className="block text-sm font-medium">Service concerné / Department<select name="department" className={input}><option value="DIG">DIG — Terrains</option><option value="TCF">TCF — Farm</option><option value="OTHER">Autre / Other</option></select></label>
    {stars("anonymous")}
    <label className="block text-sm font-medium">Commentaire / Comment<textarea className={input} rows={3} name="comment" maxLength={1000}/></label>
    <button className="w-full rounded-lg border border-indigo-700 p-3 font-semibold text-indigo-800">Envoyer anonymement / Submit anonymously</button>
   </form>
   <p className="text-xs text-slate-500">Feedback optional, one identified response per visit. An anonymous response does not prove a visitor completed their appointment.</p>
  </>}
 </main>;
}
