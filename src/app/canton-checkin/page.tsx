import {assertCantonLive, cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {createAdminClient} from "@/lib/supabase/admin";
import {submitCantonQrIntake} from "@/app/actions/canton-qr";
export const dynamic="force-dynamic";
export default async function CantonCheckin({searchParams}:{searchParams:Promise<{site?:string;error?:string;success?:string}>}){
 const {site="",error,success}=await searchParams;
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-lg p-8">Canton QR forms are not available in this test environment.</main>;
 const valid=/^[0-9a-f-]{36}$/i.test(site);
 const db=createAdminClient();
 const {data:location}=valid?await db.from("canton_qr_sites").select("id,label").eq("id",site).eq("enabled",true).maybeSingle():{data:null};
 const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900";
 return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
  <header className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs uppercase tracking-widest text-amber-300">ILEAD Global · Canton, Texas</p><h1 className="mt-2 text-2xl font-bold">Bienvenue / Welcome</h1><p className="mt-2 text-sm text-slate-200">Visitor registration / Enregistrement des visiteurs</p>{location&&<p className="mt-2 text-sm">{location.label}</p>}</header>
  {success?<div role="status" className="rounded-xl bg-green-50 p-6 text-green-900"><h2 className="text-lg font-semibold">Thank you! / Merci !</h2><p>Votre demande d&apos;arrivée a été envoyée. Veuillez vous présenter à la réception pour confirmation. / Please see the reception team to complete check-in.</p></div>:
   !location?<div className="rounded-xl bg-amber-50 p-5 text-amber-900">This registration QR is unavailable. Please contact reception.</div>:
   <form action={submitCantonQrIntake} className="space-y-4 rounded-xl border bg-white p-5">
    {error&&<p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{error==="limit"?"Too many attempts. Please see reception.":error==="duplicate"?"Your request was already received. Please see reception.":error==="invalid"?"Please check your details.":"Registration is unavailable; please see reception."}</p>}
    <input type="hidden" name="site" value={site}/>
    <div className="hidden" aria-hidden="true"><label>Leave empty<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <label className="block text-sm font-medium">Nom complet / Full name *<input className={input} name="fullName" required maxLength={180}/></label>
    <label className="block text-sm font-medium">Email <input className={input} name="email" type="email" maxLength={200}/></label>
    <label className="block text-sm font-medium">Téléphone / Phone <input className={input} name="phone" type="tel" maxLength={40}/></label>
    <p className="text-xs text-slate-500">Provide an email or phone number so reception can find your registration.</p>
    <label className="block text-sm font-medium">Je visite / Visiting<select className={input} name="department"><option value="DIG">DIG – Real Estate</option><option value="TCF">TCF – Texas Community Farm</option><option value="OTHER">Autre / Other</option></select></label>
    <label className="block text-sm font-medium">Objet / Purpose<select className={input} name="purpose"><option value="land_tour">Land tour</option><option value="farm_tour">Farm tour</option><option value="meeting">Meeting</option><option value="other">Other</option></select></label>
    <button className="w-full rounded-lg bg-indigo-700 p-3 font-semibold text-white">Announce my arrival / Signaler mon arrivée</button>
    <p className="text-xs text-slate-500">Your details are used for reception and visit management. Reception must confirm arrival. / Vos informations servent à gérer votre accueil.</p>
   </form>}
 </main>;
}
