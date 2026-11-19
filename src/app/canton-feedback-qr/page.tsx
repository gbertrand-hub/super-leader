import {assertCantonLive, cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {submitCantonQrFeedback} from "@/app/actions/canton-qr";
export const dynamic="force-dynamic";
export default async function CantonFeedbackQr({searchParams}:{searchParams:Promise<{code?:string;error?:string;success?:string}>}){
 const {code="",error,success}=await searchParams;
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-lg p-8">Canton QR forms are not available in this test environment.</main>;
 const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900";
 return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
  <header className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs uppercase tracking-widest text-amber-300">ILEAD Global · Canton</p><h1 className="mt-2 text-2xl font-bold">Votre avis / Your feedback</h1><p className="mt-2 text-sm">Thank you for your visit. It takes less than one minute.</p></header>
  {success?<p role="status" className="rounded-xl bg-green-50 p-5 text-green-900">Merci ! Thank you for helping us improve.</p>:
   <form action={submitCantonQrFeedback} className="space-y-5 rounded-xl border bg-white p-5">
    {error&&<p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">Ce code est invalide, expiré ou déjà utilisé. / Invalid, expired or already used code.</p>}
    <div className="hidden" aria-hidden="true"><label>Leave empty<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <label className="block text-sm font-medium">Code de visite / Visit code *<input className={input+" uppercase tracking-widest"} name="code" defaultValue={code} required maxLength={16} minLength={16} autoCapitalize="characters" autoComplete="off" placeholder="16-character code"/></label>
    <p className="text-xs text-slate-500">Ask reception for your visit code at checkout. / Demandez votre code à la réception au départ.</p>
    <fieldset><legend className="font-semibold">Satisfaction générale / Overall rating *</legend><div className="mt-2 flex flex-wrap gap-3">{[1,2,3,4,5].map(n=><label key={n} className="flex min-h-11 items-center gap-2"><input type="radio" name="rating" value={n} required/> {n} ★</label>)}</div></fieldset>
    <label className="block text-sm font-medium">Souhaitez-vous être recontacté ? / Would you like a follow-up?<select className={input} name="contact"><option value="no">Non / No</option><option value="yes">Oui / Yes</option></select></label>
    <label className="block text-sm font-medium">Commentaire / Comment<textarea className={input} rows={3} name="comment" maxLength={1000}/></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-semibold text-white">Envoyer / Submit feedback</button>
    <p className="text-xs text-slate-500">Feedback is optional. One response per visit. No marketing consent is implied.</p>
   </form>}
 </main>;
}
