import {notFound} from "next/navigation";
import Link from "next/link";
import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
export const dynamic="force-dynamic";
/** Diagnostics show readiness conditions, NEVER key values or client records. */
export default function CantonPilotStatus(){
 if(process.env.VERCEL_ENV!=="preview" && process.env.NODE_ENV!=="development") notFound();
 const target="xehstmnqljjhacjiukvc";
 let connectedRef="";
 try {connectedRef=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||"").hostname.split(".")[0]||"";}catch{}
 const checks=[
  {label:"Vercel deployment is Preview",pass:process.env.VERCEL_ENV==="preview"},
  {label:"Supabase URL points to isolated Canton QA project",pass:connectedRef===target},
  {label:"QA database/auth verified by operator",pass:process.env.CANTON_TEST_DATABASE_READY==="true"},
  {label:"Canton live gate explicitly enabled",pass:process.env.CANTON_VISITOR_ENABLE_LIVE==="true"},
  {label:"Private form rate-limiter secret configured",pass:Boolean(process.env.CANTON_INTAKE_RATE_SECRET)},
  {label:"All pilot safety conditions",pass:cantonLiveEnabled()},
 ];
 const safe=checks.every(c=>c.pass);
 return <main className="mx-auto max-w-2xl space-y-5 p-6">
  <header className="rounded-xl bg-slate-900 p-6 text-white"><p className="text-xs tracking-wider text-amber-300">ILEAD Global · Canton V4.10.132</p><h1 className="mt-2 text-2xl font-bold">Pilot readiness / Vérification des tests</h1><p className="mt-2 text-sm">No secret keys or visitor data are displayed here.</p></header>
  <div role="status" className={safe?"rounded-xl bg-emerald-50 p-4 text-emerald-900":"rounded-xl bg-amber-50 p-4 text-amber-900"}>{safe?"Environment gates enabled — still verify real user permissions.":"Real visitor operations remain disabled. Simulation can be tested safely."}</div>
  <ul className="space-y-2">{checks.map(c=><li key={c.label} className="flex items-center gap-3 rounded-lg border bg-white p-3"><span aria-label={c.pass?"passed":"not ready"} className={c.pass?"font-bold text-green-700":"font-bold text-amber-700"}>{c.pass?"PASS":"WAIT"}</span><span className="text-sm">{c.label}</span></li>)}</ul>
  <div className="flex flex-wrap gap-4"><Link href="/canton-demo" className="rounded bg-indigo-700 px-4 py-3 text-white">Visual simulation</Link><Link href="/canton-pilot" className="rounded border px-4 py-3">Employee pilot</Link></div>
  <p className="text-xs text-slate-500">This page checks environment configuration only. It does not prove the QA schema or accounts are healthy. Production data must never be used for Canton acceptance tests.</p>
 </main>;
}