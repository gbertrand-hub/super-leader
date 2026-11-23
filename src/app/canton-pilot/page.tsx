import {cantonLiveEnabled,cantonAuthTestEnabled} from "@/lib/canton/feature-gate";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {redirect} from "next/navigation";
import Link from "next/link";
import {cantonPilotSignOut} from "@/app/actions/canton-pilot-auth";
import CantonVisitorPage from "@/app/dashboard/canton-visitors/page";
export const dynamic="force-dynamic";
export default async function CantonPilot({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 if(cantonAuthTestEnabled() && !cantonLiveEnabled()){
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(user){
   const allowed=["canton-admin@qa.example.invalid","canton-manager@qa.example.invalid","canton-commercial@qa.example.invalid","canton-reception@qa.example.invalid"];
   if(!user.email||!allowed.includes(user.email.toLowerCase())) {await db.auth.signOut();redirect("/canton-pilot/login?error=invalid");}
   const admin=createAdminClient();
   const orgId="021cdbb8-af4d-412e-8ec7-e7bba08d1349";
   const {data:membership,error:membershipError}=await admin.from("organization_members")
    .select("role,organization_id,is_active").eq("organization_id",orgId).eq("user_id",user.id).eq("is_active",true).maybeSingle();
   const {data:reception,error:receptionError}=await admin.from("canton_reception_staff")
    .select("user_id").eq("organization_id",orgId).eq("user_id",user.id).maybeSingle();
   const roles:Record<string,string>={"canton-admin@qa.example.invalid":"admin","canton-manager@qa.example.invalid":"manager","canton-commercial@qa.example.invalid":"employee","canton-reception@qa.example.invalid":"employee"};
   const expected=roles[user.email.toLowerCase()];
   const receptionExpected=user.email.toLowerCase()==="canton-reception@qa.example.invalid";
   const roleOk=!membershipError&&!receptionError&&membership?.role===expected&&!!reception===receptionExpected;
   const title=roleOk?"Connexion et autorisations validées ✅":"Connexion réussie — autorisations à corriger ⚠️";
   const rights=expected==="admin"?"Supervision, réception et attribution de suivis":expected==="manager"?"Réception et attribution des suivis":receptionExpected?"Arrivées, départs et réception des visiteurs":"Création des rendez-vous et suivi de ses visites";
   return <main className="mx-auto max-w-2xl space-y-5 p-6">
    <div className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs uppercase tracking-wide text-amber-300">ILEAD GLOBAL · Canton QA</p><h1 className="mt-2 text-2xl font-bold">{title}</h1><p className="mt-3 text-sm">{user.email}</p></div>
    <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">Contrôle du profil / Role check</h2><p className="mt-2 text-sm"><strong>Profil attendu :</strong> {receptionExpected?"Réception":expected==="employee"?"Commercial":expected}</p><p className="mt-2 text-sm"><strong>Profil enregistré :</strong> {membership?.role||"Introuvable"}</p><p className="mt-2 text-sm"><strong>Accès réception :</strong> {reception?"Oui":"Non"}</p><p className="mt-2 text-sm"><strong>Responsabilités :</strong> {rights}</p><p className={roleOk?"mt-3 rounded bg-emerald-50 p-3 text-emerald-900":"mt-3 rounded bg-rose-50 p-3 text-rose-900"}>{roleOk?"Le rôle du compte correspond à la configuration de test.":"Le profil ou son autorisation ne correspond pas. Aucun accès opérationnel accordé."}</p></section>
    <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Validation de connexion et de rôles uniquement. Les enregistrements, QR Codes et opérations réelles sont toujours désactivés.</p>
    <form action={cantonPilotSignOut}><button className="rounded-lg bg-indigo-700 px-4 py-3 text-white">Déconnexion / Sign out</button></form>
   </main>;
  }
  redirect("/canton-pilot/login");
 }
 if(!cantonLiveEnabled()){
  return <main className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8"><div className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs font-bold uppercase tracking-wider text-amber-300">ILEAD Global · V4.10.132</p><h1 className="mt-2 text-2xl font-bold">Canton Visitor Center — Test opérationnel</h1><p className="mt-2 text-slate-200">Le test avec plusieurs employés n’est pas encore activé. Aucune donnée réelle n’est utilisée.</p></div><section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">État de préparation</h2><ul className="mt-3 space-y-2 text-sm"><li>✅ Démonstration ordinateur et téléphone validée</li><li>✅ Tables des visiteurs et tests SQL dans la base isolée</li><li>✅ Parcours QR, visite, feedback et suivi testé au niveau SQL</li><li>⏳ Connexion Vercel à l’environnement Supabase de test</li><li>⏳ Comptes fictifs et droits d’accès des quatre profils</li><li>⏳ Tests de bout en bout avant activation</li></ul></section><p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">Les opérations sont volontairement bloquées jusqu’à validation de l’authentification et de la séparation avec la production. Ne saisissez pas de véritables informations de visiteurs.</p><Link className="inline-block rounded-lg bg-indigo-700 px-4 py-3 font-semibold text-white" href="/canton-demo">Retourner à la simulation</Link></main>;
 }
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user)redirect("/canton-pilot/login");
 return <><div className="mx-auto flex max-w-7xl justify-between gap-2 px-4 pt-4 text-xs text-slate-600"><span>Test workspace · {user.email} · Fake data only</span><form action={cantonPilotSignOut}><button className="underline">Sign out</button></form></div><CantonVisitorPage searchParams={searchParams}/></>;
}
