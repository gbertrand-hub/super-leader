import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {createClient} from "@/lib/supabase/server";
import {redirect} from "next/navigation";
import Link from "next/link";
import {cantonPilotSignOut} from "@/app/actions/canton-pilot-auth";
import CantonVisitorPage from "@/app/dashboard/canton-visitors/page";
export const dynamic="force-dynamic";
export default async function CantonPilot({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 if(!cantonLiveEnabled()){
  return <main className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8"><div className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs font-bold uppercase tracking-wider text-amber-300">ILEAD Global · V4.10.132</p><h1 className="mt-2 text-2xl font-bold">Canton Visitor Center — Test opérationnel</h1><p className="mt-2 text-slate-200">Le test avec plusieurs employés n’est pas encore activé. Aucune donnée réelle n’est utilisée.</p></div><section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">État de préparation</h2><ul className="mt-3 space-y-2 text-sm"><li>✅ Démonstration ordinateur et téléphone validée</li><li>✅ Tables des visiteurs et tests SQL dans la base isolée</li><li>✅ Parcours QR, visite, feedback et suivi testé au niveau SQL</li><li>⏳ Connexion Vercel à l’environnement Supabase de test</li><li>⏳ Comptes fictifs et droits d’accès des quatre profils</li><li>⏳ Tests de bout en bout avant activation</li></ul></section><p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">Les opérations sont volontairement bloquées jusqu’à validation de l’authentification et de la séparation avec la production. Ne saisissez pas de véritables informations de visiteurs.</p><Link className="inline-block rounded-lg bg-indigo-700 px-4 py-3 font-semibold text-white" href="/canton-demo">Retourner à la simulation</Link></main>;
 }
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user)redirect("/canton-pilot/login");
 return <><div className="mx-auto flex max-w-7xl justify-between gap-2 px-4 pt-4 text-xs text-slate-600"><span>Test workspace · {user.email} · Fake data only</span><form action={cantonPilotSignOut}><button className="underline">Sign out</button></form></div><CantonVisitorPage searchParams={searchParams}/></>;
}
