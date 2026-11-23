import Link from "next/link";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {academyGlobalRoles,getAcademyAssignments} from "@/lib/academy/access";

type School = {id:string; code:string; name:string; description:string; color:string};
const tones:Record<string,string>={violet:"from-violet-600 to-indigo-700",blue:"from-blue-600 to-cyan-700",emerald:"from-emerald-600 to-teal-700",amber:"from-amber-500 to-orange-700"};

export default async function SchoolsPage(){
  const supabase=await createClient(); const {data:auth}=await supabase.auth.getUser(); if(!auth.user) redirect("/login");
  const admin=createAdminClient();
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership) redirect("/dashboard/company");
  const assignments=await getAcademyAssignments(admin,membership.organization_id,auth.user.id);
  const {data:schools,error}=await admin.from("academy_schools").select("id,code,name,description,color").eq("organization_id",membership.organization_id).eq("is_active",true).order("name");
  if(error) return <main className="p-8"><h1 className="text-3xl font-black">Grandes Écoles</h1><p className="mt-4 rounded-2xl bg-amber-50 p-5 text-amber-900">Exécute la migration <b>075_grandes_ecoles_foundation_v4_8_13.sql</b>.</p></main>;
  const assignedSchoolIds=new Set(assignments.map(x=>x.school_id));
  const rows=((schools??[]) as School[]).filter(x=>academyGlobalRoles.has(membership.role)||assignedSchoolIds.has(x.id));
  const stats=await Promise.all(rows.map(async school=>{const [programs,cohorts,students,staff]=await Promise.all([
    admin.from("academy_programs").select("id",{count:"exact",head:true}).eq("school_id",school.id).eq("status","active"),
    admin.from("academy_cohorts").select("id",{count:"exact",head:true}).eq("school_id",school.id).in("status",["open","active"]),
    admin.from("academy_school_enrollments").select("id",{count:"exact",head:true}).eq("school_id",school.id).in("academic_status",["enrolled","active"]),
    admin.from("academy_staff_assignments").select("id",{count:"exact",head:true}).eq("school_id",school.id).eq("is_active",true),
  ]); return {school,programs:programs.count??0,cohorts:cohorts.count??0,students:students.count??0,staff:staff.count??0};}));
  return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-7xl">
    <Link href="/dashboard/academy" className="font-bold text-violet-700">← Super Leader Academy</Link>
    <header className="mt-5 rounded-3xl bg-slate-950 p-8 text-white"><p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">ILEAD GLOBAL INSTITUTE</p><h1 className="mt-2 text-4xl font-black">Grandes Écoles</h1><p className="mt-3 max-w-3xl text-slate-300">Chaque école dispose de ses programmes, cohortes, apprenants, enseignants et employés de suivi, sans dupliquer les contacts du CRM.</p></header>
    <section className="mt-7 grid gap-6 lg:grid-cols-3">{stats.map(({school,programs,cohorts,students,staff})=><Link key={school.id} href={`/dashboard/academy/schools/${school.id}`} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"><div className={`bg-gradient-to-br ${tones[school.color]??tones.violet} p-6 text-white`}><p className="text-xs font-black uppercase tracking-[.18em]">Grande école</p><h2 className="mt-2 text-2xl font-black">{school.name}</h2><p className="mt-3 text-sm text-white/80">{school.description}</p></div><div className="grid grid-cols-2 gap-px bg-slate-200"><Stat n={programs} label="Programmes"/><Stat n={cohorts} label="Cohortes"/><Stat n={students} label="Apprenants"/><Stat n={staff} label="Staff assigné"/></div></Link>)}{!stats.length?<p className="rounded-3xl border border-dashed bg-white p-8 text-slate-600">Aucune école ne vous est actuellement assignée.</p>:null}</section>
  </div></main>;
}
function Stat({n,label}:{n:number;label:string}){return <div className="bg-white p-4"><p className="text-2xl font-black text-slate-950">{n}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p></div>}
