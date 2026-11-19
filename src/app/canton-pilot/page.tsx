import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {createClient} from "@/lib/supabase/server";
import {redirect} from "next/navigation";
import Link from "next/link";
import {cantonPilotSignOut} from "@/app/actions/canton-pilot-auth";
import CantonVisitorPage from "@/app/dashboard/canton-visitors/page";
export const dynamic="force-dynamic";
export default async function CantonPilot({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 if(!cantonLiveEnabled()){
  return <main className="mx-auto max-w-2xl space-y-4 p-7"><h1 className="text-2xl font-bold">Canton — Real pilot</h1><p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">The real pilot is disabled until an isolated Supabase database and its own test employee accounts have been configured. No live client data is available here.</p><Link className="text-indigo-700 underline" href="/canton-demo">Open the visual simulation</Link></main>;
 }
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user)redirect("/canton-pilot/login");
 return <><div className="mx-auto flex max-w-7xl justify-between gap-2 px-4 pt-4 text-xs text-slate-600"><span>Test workspace · {user.email} · Fake data only</span><form action={cantonPilotSignOut}><button className="underline">Sign out</button></form></div><CantonVisitorPage searchParams={searchParams}/></>;
}
