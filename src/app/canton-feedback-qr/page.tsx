import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import {submitCantonQrFeedback} from "@/app/actions/canton-qr";
export const dynamic="force-dynamic";
export default async function CantonFeedbackQr({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {error,success}=await searchParams;
 const {locale}=await getI18n();
 const fr=locale==="fr";
 if(!cantonLiveEnabled())return <main className="mx-auto max-w-lg p-8">Canton QR forms are unavailable here.</main>;
 const input="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900";
 const stars=()=><fieldset><legend className="font-semibold">{fr?"Votre note *":"Overall rating *"}</legend><div className="mt-2 flex flex-wrap gap-4">{[1,2,3,4,5].map(n=><label key={n} className="flex min-h-11 items-center gap-2"><input type="radio" name="rating" value={n} required/> {n} ★</label>)}</div></fieldset>;
 const honeypot=<div className="hidden" aria-hidden="true"><label>Leave empty<input name="website" tabIndex={-1} autoComplete="off"/></label></div>;
 return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
  <div className="flex justify-end"><CantonLanguageSwitch locale={locale} returnPath="/canton-feedback-qr"/></div>
  <header className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs uppercase tracking-widest text-amber-300">ILEAD Global · Canton</p><h1 className="mt-2 text-2xl font-bold">{fr?"Votre avis":"Your feedback"}</h1><p className="mt-2 text-sm">{fr?"Votre avis nous aide à progresser. Moins d’une minute, sans code de visite.":"Your feedback helps us improve. Less than a minute. No visit code."}</p></header>
  {success?<p role="status" className="rounded-xl bg-green-50 p-5 text-green-900">{fr?"Merci pour votre avis !":"Thank you for helping us improve!"}</p>:<>
   {error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error==="limit"?(fr?"Trop de tentatives. Réessayez plus tard.":"Too many attempts. Please try later."):(fr?"Impossible de retrouver une visite unique. Vérifiez les informations ou choisissez un avis anonyme.":"Could not identify a single visit. Check your details or leave anonymous feedback.")}</p>}
   <form action={submitCantonQrFeedback} className="space-y-4 rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">{fr?"Avis associé à ma visite":"Feedback on my visit"}</h2>
    <p className="text-sm text-slate-600">{fr?"Indiquez votre nom et les 4 derniers chiffres de votre téléphone.":"Enter your name and the last four digits of your phone number."}</p>
    {honeypot}<input type="hidden" name="mode" value="identified"/>
    <label className="block text-sm font-medium">{fr?"Nom complet *":"Full name *"}<input className={input} name="fullName" required maxLength={180} autoComplete="name"/></label>
    <label className="block text-sm font-medium">{fr?"4 derniers chiffres du téléphone *":"Last four phone digits *"}<input className={input} name="last4" required inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="off" placeholder="1234"/></label>
    {stars()}
    <label className="block text-sm font-medium">{fr?"Souhaitez-vous être recontacté ?":"Would you like a follow-up?"}<select className={input} name="contact"><option value="no">{fr?"Non":"No"}</option><option value="yes">{fr?"Oui":"Yes"}</option></select></label>
    <label className="block text-sm font-medium">{fr?"Commentaire":"Comment"}<textarea className={input} rows={3} name="comment" maxLength={1000}/></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-semibold text-white">{fr?"Envoyer mon avis":"Submit feedback"}</button>
   </form>
   <form action={submitCantonQrFeedback} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5">
    <h2 className="text-lg font-semibold">{fr?"Donner un avis anonyme":"Anonymous feedback"}</h2>
    <p className="text-sm text-slate-600">{fr?"Sans nom ni téléphone. Cet avis est comptabilisé séparément.":"No name or phone required. Anonymous feedback is counted separately."}</p>
    {honeypot}<input type="hidden" name="mode" value="anonymous"/>
    <label className="block text-sm font-medium">{fr?"Service concerné":"Department"}<select name="department" className={input}><option value="DIG">{fr?"DIG — Terrains":"DIG — Land"}</option><option value="TCF">{fr?"TCF — Élevage":"TCF — Farm"}</option><option value="OTHER">{fr?"Autre":"Other"}</option></select></label>
    {stars()}
    <label className="block text-sm font-medium">{fr?"Commentaire":"Comment"}<textarea className={input} rows={3} name="comment" maxLength={1000}/></label>
    <button className="w-full rounded-lg border border-indigo-700 p-3 font-semibold text-indigo-800">{fr?"Envoyer anonymement":"Submit anonymously"}</button>
   </form>
   <p className="text-xs text-slate-500">{fr?"Avis facultatif. Une réponse identifiée par visite. Un avis anonyme n’est pas associé à une visite.":"Feedback is optional. One identified response per visit. Anonymous reviews are not linked to an appointment."}</p>
  </>}
 </main>;
}
