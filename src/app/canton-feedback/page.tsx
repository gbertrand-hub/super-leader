import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import {submitCantonFeedback} from "@/app/actions/canton-visitors";
import {createAdminClient} from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
export async function CantonFeedbackContent({token="",success,error,lang,returnPath}:{token?:string;success?:string;error?:string;lang?:string;returnPath?:string}){

 const {locale}=await getI18n();
 const language=lang==="fr"||lang==="en"?lang:locale;
 const fr=language==="fr";
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-lg p-8">Canton QR forms are not available in this test environment.</main>;
 const valid=/^[0-9a-f-]{36}$/i.test(token);
 let allowed=false;
 let siteName="Visitor Experience";
 if(valid){
  const db=createAdminClient();
  const {data:row}=await db.from("canton_appointments").select("id,status,site_id,organization_id").eq("feedback_token",token).maybeSingle();
  if(row?.site_id){
   const {data:site}=await db.from("visitor_sites").select("name").eq("id",row.site_id).eq("organization_id",row.organization_id).maybeSingle();
   if(site?.name)siteName=site.name;
  }
  if(row?.status==="completed"){
   const {data:response}=await db.from("canton_visit_feedback").select("id").eq("appointment_id",row.id).maybeSingle();
   allowed=!response;
  }
 }
 const input="w-full rounded-lg border border-slate-300 px-3 py-2";
 return <main className="mx-auto max-w-xl space-y-5 p-6">
  <div className="flex justify-end"><CantonLanguageSwitch locale={language} returnPath={returnPath||("/canton-feedback?token="+encodeURIComponent(token))}/></div>
  <header className="rounded-2xl bg-slate-900 p-7 text-white"><p className="text-xs tracking-widest text-amber-300">ILEAD GLOBAL • {siteName.toUpperCase()}</p><h1 className="mt-2 text-2xl font-bold">{fr?"Votre avis sur la visite":"Your visit feedback"}</h1><p className="mt-2 text-sm">{fr?"Merci de votre visite. Votre avis prend moins d’une minute.":"Thank you for visiting us. This takes less than a minute."}</p></header>
  {success?<p className="rounded bg-green-100 p-4">{fr?"Merci pour votre retour !":"Thank you for your feedback!"}</p>:
   !allowed?<p className="rounded bg-slate-100 p-4">{fr?"Ce lien n’est plus disponible ou a déjà été utilisé.":"This feedback link is unavailable or has already been used."}</p>:
   <form action={submitCantonFeedback} className="space-y-4 rounded-2xl border p-6">
    {error&&<p className="text-red-700">{fr?"Impossible d’enregistrer votre avis. Réessayez.":"Could not save your response. Please try again."}</p>}
    <input name="token" type="hidden" value={token}/>
    <fieldset><legend className="font-semibold">{fr?"Comment évaluez-vous votre visite ? *":"How would you rate your visit? *"}</legend><div className="mt-2 flex gap-3">{[1,2,3,4,5].map(n=><label key={n} className="flex items-center gap-1"><input type="radio" name="rating" value={n} required/> {n}★</label>)}</div></fieldset>
    <label className="block text-sm font-medium">{fr?"Qualité de l’accueil":"Welcome experience"}<select className={input} name="welcome"><option value="">{fr?"Choisir (facultatif)":"Choose (optional)"}</option><option value="very_satisfied">{fr?"Très satisfait":"Very satisfied"}</option><option value="satisfied">{fr?"Satisfait":"Satisfied"}</option><option value="neutral">{fr?"Neutre":"Neutral"}</option><option value="dissatisfied">{fr?"Insatisfait":"Dissatisfied"}</option></select></label>
    <label className="block text-sm font-medium">{fr?"Votre visite a-t-elle répondu à vos attentes ?":"Did your visit meet expectations?"}<select className={input} name="expectations"><option value="">{fr?"Choisir (facultatif)":"Choose (optional)"}</option><option value="yes">{fr?"Oui":"Yes"}</option><option value="partially">{fr?"Partiellement":"Partially"}</option><option value="no">{fr?"Non":"No"}</option></select></label>
    <label className="block text-sm font-medium">{fr?"Souhaitez-vous être recontacté ?":"Would you like us to contact you?"}<select className={input} name="contact"><option value="no">{fr?"Non":"No"}</option><option value="yes">{fr?"Oui":"Yes"}</option></select></label>
    <label className="block text-sm font-medium">{fr?"Commentaires":"Comments"}<textarea className={input} name="comment" maxLength={1200} rows={3}/></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-medium text-white">{fr?"Envoyer mon avis":"Send feedback"}</button>
   </form>}
  <p className="text-xs text-slate-500">{fr?"Votre avis est associé à votre visite et nous aide à nous améliorer. Réponse facultative.":"Your response is linked to your visit and helps us improve. Feedback is optional."}</p>
 </main>;
}

export default async function CantonFeedbackPage({searchParams}:{searchParams:Promise<{token?:string;success?:string;error?:string;lang?:string}>}){
 const params=await searchParams;
 return <CantonFeedbackContent {...params}/>;
}
