import {cantonAuthTestEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import {cantonPilotSignIn} from "@/app/actions/canton-pilot-auth";
export const dynamic="force-dynamic";
export default async function CantonPilotLogin({searchParams}:{searchParams:Promise<{error?:string}>}){
 const {error}=await searchParams;
 const {locale}=await getI18n();const fr=locale==="fr";
 const ready=cantonAuthTestEnabled();
 return <main className="mx-auto max-w-md p-6 sm:p-10">
  <div className="mb-4 flex justify-end"><CantonLanguageSwitch locale={locale} returnPath="/canton-pilot/login"/></div>
  <div className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">ILEAD GLOBAL · CANTON</p><h1 className="mt-2 text-2xl font-bold">{fr?"Connexion des employés (TEST)":"Employee test sign-in"}</h1><p className="mt-2 text-sm">{fr?"Comptes de test uniquement. N’utilisez jamais votre mot de passe Super Leader de production.":"QA accounts only. Never enter your production Super Leader password here."}</p></div>
  {!ready?<div className="mt-5 rounded border border-amber-300 bg-amber-50 p-5 text-amber-900">{fr?"La connexion de test est désactivée ici.":"Test sign-in is disabled in this environment."}</div>:
   <form action={cantonPilotSignIn} className="mt-5 space-y-4 rounded-xl border bg-white p-5">
    {error&&<p role="alert" className="text-red-700">{fr?"Email ou mot de passe de test invalide.":"Invalid test email or password."}</p>}
    <label className="block text-sm">{fr?"Email du compte de test":"Test account email"}<input type="email" name="email" autoComplete="username" required className="mt-1 w-full rounded border px-3 py-3 text-base"/></label>
    <label className="block text-sm">{fr?"Mot de passe de test":"Test password"}<input type="password" name="password" autoComplete="current-password" required className="mt-1 w-full rounded border px-3 py-3 text-base"/></label>
    <button className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-white">{fr?"Se connecter":"Sign in"}</button>
   </form>}
  <p className="mt-4 text-sm text-slate-500">{fr?"Connexion réservée aux quatre comptes de test Canton.":"Sign-in reserved for the four Canton QA accounts."}</p>
 </main>;
}
