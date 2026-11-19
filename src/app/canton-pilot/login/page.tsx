import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {cantonPilotSignIn} from "@/app/actions/canton-pilot-auth";
export const dynamic="force-dynamic";
export default async function CantonPilotLogin({searchParams}:{searchParams:Promise<{error?:string}>}){
 const {error}=await searchParams;
 const ready=cantonLiveEnabled();
 return <main className="mx-auto max-w-md p-6 sm:p-10">
  <div className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">ILEAD GLOBAL · CANTON</p><h1 className="mt-2 text-2xl font-bold">Pilot staff login / Connexion test</h1><p className="mt-2 text-sm">Isolated staging accounts only. Never enter your production Super Leader password here.</p></div>
  {!ready?<div className="mt-5 rounded border border-amber-300 bg-amber-50 p-5 text-amber-900">Staff pilot is not enabled. The isolated database and test authentication must be configured first.</div>:
   <form action={cantonPilotSignIn} className="mt-5 space-y-4 rounded-xl border bg-white p-5">
    {error&&<p role="alert" className="text-red-700">Invalid test email or password.</p>}
    <label className="block text-sm">Test account email<input type="email" name="email" autoComplete="username" required className="mt-1 w-full rounded border px-3 py-3 text-base"/></label>
    <label className="block text-sm">Test password<input type="password" name="password" autoComplete="current-password" required className="mt-1 w-full rounded border px-3 py-3 text-base"/></label>
    <button className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-white">Sign in to Canton pilot</button>
   </form>}
  <p className="mt-4 text-sm text-slate-500">The pilot cannot read production Supabase data.</p>
 </main>;
}
