import {assertCantonLive, cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {submitCantonFeedback} from "@/app/actions/canton-visitors";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
export default async function CantonFeedbackPage({searchParams}:{searchParams:Promise<{token?:string;success?:string;error?:string}>}){
 const {token="",success,error}=await searchParams;
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-lg p-8">Canton QR forms are not available in this test environment.</main>;
 const valid=/^[0-9a-f-]{36}$/i.test(token);
 let allowed=false;
 if(valid){
  const db=createAdminClient();
  const {data:row}=await db.from("canton_appointments").select("id,status").eq("feedback_token",token).maybeSingle();
  if(row?.status==="completed"){
   const {data:response}=await db.from("canton_visit_feedback").select("id").eq("appointment_id",row.id).maybeSingle();
   allowed=!response;
  }
 }
 const input="w-full rounded-lg border border-slate-300 px-3 py-2";
 return <main className="mx-auto max-w-xl space-y-5 p-6">
  <header className="rounded-2xl bg-slate-900 p-7 text-white"><p className="text-xs tracking-widest text-amber-300">ILEAD GLOBAL • CANTON</p><h1 className="mt-2 text-2xl font-bold">Visitor experience / Votre avis</h1><p className="mt-2 text-sm">Thank you for visiting us. This takes less than a minute.</p></header>
  {success?<p className="rounded bg-green-100 p-4">Thank you for your feedback! / Merci pour votre retour !</p>:
   !allowed?<p className="rounded bg-slate-100 p-4">This feedback link is unavailable or has already been used.</p>:
   <form action={submitCantonFeedback} className="space-y-4 rounded-2xl border p-6">
    {error&&<p className="text-red-700">Could not save your response. Please try again.</p>}
    <input name="token" type="hidden" value={token}/>
    <fieldset><legend className="font-semibold">How would you rate your visit? *</legend><div className="mt-2 flex gap-3">{[1,2,3,4,5].map(n=><label key={n} className="flex items-center gap-1"><input type="radio" name="rating" value={n} required/> {n}★</label>)}</div></fieldset>
    <label className="block text-sm font-medium">Welcome experience<select className={input} name="welcome"><option value="">Choose (optional)</option><option value="very_satisfied">Very satisfied</option><option value="satisfied">Satisfied</option><option value="neutral">Neutral</option><option value="dissatisfied">Dissatisfied</option></select></label>
    <label className="block text-sm font-medium">Did your visit meet expectations?<select className={input} name="expectations"><option value="">Choose (optional)</option><option value="yes">Yes</option><option value="partially">Partially</option><option value="no">No</option></select></label>
    <label className="block text-sm font-medium">Would you like us to contact you?<select className={input} name="contact"><option value="no">No</option><option value="yes">Yes</option></select></label>
    <label className="block text-sm font-medium">Comments<textarea className={input} name="comment" maxLength={1200} rows={3}/></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-medium text-white">Send feedback</button>
   </form>}
  <p className="text-xs text-slate-500">Your response is linked to your visit and used to improve our service. Feedback is optional.</p>
 </main>;
}
