import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import {createAdminClient} from "@/lib/supabase/admin";
import {submitCantonQrIntake} from "@/app/actions/canton-qr";
export const dynamic="force-dynamic";
export default async function CantonCheckin({searchParams}:{searchParams:Promise<{site?:string;error?:string;success?:string}>}){
 const {site="",error,success}=await searchParams;
 const {locale}=await getI18n();const fr=locale==="fr";
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-lg p-8">Canton QR forms are not available in this test environment.</main>;
 const valid=/^[0-9a-f-]{36}$/i.test(site);
 const db=createAdminClient();
 const {data:location}=valid?await db.from("canton_qr_sites").select("id,label").eq("id",site).eq("enabled",true).maybeSingle():{data:null};
 const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900";
 return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
  <div className="flex justify-end"><CantonLanguageSwitch locale={locale} returnPath={"/canton-checkin?site="+encodeURIComponent(site)}/></div>
  <header className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs uppercase tracking-widest text-amber-300">ILEAD Global · Canton, Texas</p><h1 className="mt-2 text-2xl font-bold">{fr?"Bienvenue":"Welcome"}</h1><p className="mt-2 text-sm text-slate-200">{fr?"Enregistrement des visiteurs":"Visitor registration"}</p>{location&&<p className="mt-2 text-sm">{location.label}</p>}</header>
  {success?<div role="status" className="rounded-xl bg-green-50 p-6 text-green-900"><h2 className="text-lg font-semibold">{fr?"Merci !":"Thank you!"}</h2><p>{fr?"Votre demande d’arrivée a été envoyée. Présentez-vous à la réception pour confirmer votre arrivée.":"Your arrival request was received. Please see reception to confirm check-in."}</p></div>:
   !location?<div className="rounded-xl bg-amber-50 p-5 text-amber-900">{fr?"Ce QR Code est indisponible. Contactez la réception.":"This registration QR is unavailable. Please contact reception."}</div>:
   <form action={submitCantonQrIntake} className="space-y-4 rounded-xl border bg-white p-5">
    {error&&<p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{error==="limit"?(fr?"Trop de tentatives. Contactez la réception.":"Too many attempts. Please see reception."):error==="duplicate"?(fr?"Votre demande a déjà été reçue. Contactez la réception.":"Your request was already received. Please see reception."):error==="invalid"?(fr?"Vérifiez vos informations.":"Please check your details."):(fr?"Enregistrement indisponible. Contactez la réception.":"Registration is unavailable; please see reception.")}</p>}
    <input type="hidden" name="site" value={site}/>
    <div className="hidden" aria-hidden="true"><label>Leave empty<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <label className="block text-sm font-medium">{fr?"Nom complet *":"Full name *"}<input className={input} name="fullName" required maxLength={180}/></label>
    <label className="block text-sm font-medium">Email <input className={input} name="email" type="email" maxLength={200}/></label>
    <label className="block text-sm font-medium">{fr?"Téléphone":"Phone"} <input className={input} name="phone" type="tel" maxLength={40}/></label>
    <p className="text-xs text-slate-500">{fr?"Indiquez un email ou un téléphone pour retrouver votre demande.":"Provide an email or phone number so reception can find your registration."}</p>
    <label className="block text-sm font-medium">{fr?"Je visite":"Visiting"}<select className={input} name="department"><option value="DIG">{fr?"DIG – Immobilier":"DIG – Real Estate"}</option><option value="TCF">TCF – Texas Community Farm</option><option value="OTHER">{fr?"Autre":"Other"}</option></select></label>
    <label className="block text-sm font-medium">{fr?"Objet de la visite":"Purpose of visit"}<select className={input} name="purpose"><option value="land_tour">{fr?"Visite de terrain":"Land tour"}</option><option value="farm_tour">{fr?"Visite de la ferme":"Farm tour"}</option><option value="meeting">{fr?"Rendez-vous":"Meeting"}</option><option value="other">{fr?"Autre":"Other"}</option></select></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-semibold text-white">{fr?"Signaler mon arrivée":"Announce my arrival"}</button>
    <p className="text-xs text-slate-500">{fr?"Vos informations servent à gérer votre accueil. La réception confirme votre arrivée.":"Your details are used for visit management. Reception confirms arrival."}</p>
   </form>}
 </main>;
}
