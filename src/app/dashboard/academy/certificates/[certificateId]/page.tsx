import Image from "next/image";
import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {revokeSchoolCertificateAction} from "@/app/actions/academy-certificates";
import {PrintCertificateButton} from "@/components/academy/print-certificate-button";
import {getSchoolCertificateVerificationUrl} from "@/lib/academy/certificate-links";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {canEnrollStudents,enrollmentVisibleTo,getAcademyAssignments,hasSchoolAccess} from "@/lib/academy/access";

type Props={params:Promise<{certificateId:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>};
const one=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]||"":v||"";

export default async function CertificatePage({params,searchParams}:Props){
  const id=(await params).certificateId,q=(await searchParams)||{},s=await createClient(),{data:{user}}=await s.auth.getUser();if(!user)redirect("/login");
  const a=createAdminClient(),{data:m}=await a.from("organization_members").select("organization_id,role").eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();if(!m)redirect("/dashboard/company");
  const{data:c}=await a.from("academy_school_certificates").select("*").eq("id",id).eq("organization_id",m.organization_id).maybeSingle<any>();if(!c)notFound();
  const{data:e}=await a.from("academy_school_enrollments").select("school_id,program_id,cohort_id,assigned_follow_up_user_id").eq("id",c.enrollment_id).maybeSingle<{school_id:string;program_id:string|null;cohort_id:string|null;assigned_follow_up_user_id:string|null}>(),assignments=await getAcademyAssignments(a,m.organization_id,user.id);
  if(!e||!hasSchoolAccess(m.role,assignments,e.school_id)||!enrollmentVisibleTo(user.id,m.role,assignments,e.school_id,e))notFound();
  const valid=c.status==="active",verify=getSchoolCertificateVerificationUrl(c.verification_token),canManage=canEnrollStudents(m.role,assignments,e.school_id);
  return <main className="min-h-screen bg-slate-100 px-5 py-8 print:bg-white print:p-0"><div className="mx-auto max-w-6xl">
    <div className="mb-5 flex justify-between print:hidden"><Link href="/dashboard/academy/certificates" className="font-black text-violet-700">← Registre des certificats</Link><PrintCertificateButton label="Imprimer / Enregistrer en PDF"/></div>
    {one(q.success)?<p className="mb-4 rounded-xl bg-emerald-100 p-4 font-bold">{one(q.success)}</p>:null}{one(q.error)?<p className="mb-4 rounded-xl bg-red-100 p-4 font-bold text-red-950">{one(q.error)}</p>:null}
    <article className="relative overflow-hidden rounded-[2rem] border-[10px] border-double border-amber-500 bg-white px-10 py-12 text-center shadow-2xl print:shadow-none"><div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-r from-slate-950 via-violet-800 to-slate-950"/><header className="flex items-start justify-between gap-5 text-left"><Image src={c.school_logo_storage_path_snapshot?`/api/academy/school-certificate-logo/${c.verification_token}`:"/branding/ilead-global-logo.png"} alt={c.school_name_snapshot} width={220} height={130} unoptimized={Boolean(c.school_logo_storage_path_snapshot)} className="h-28 w-44 rounded-xl object-contain"/><div className="text-right"><p className="text-xs font-black uppercase tracking-[.25em] text-violet-700">iLEAD Global Institute</p><p className="mt-2 font-black uppercase">{c.school_name_snapshot}</p><span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${valid?"bg-emerald-100 text-emerald-800":"bg-red-100 text-red-800"}`}>{valid?"VALIDE":"RÉVOQUÉ"}</span></div></header>
      <p className="mt-10 text-sm font-black uppercase tracking-[.35em] text-amber-600">Certificat officiel</p><h1 className="mt-3 font-serif text-5xl font-black text-slate-950">{c.title}</h1><p className="mt-7 text-lg text-slate-600">Ce certificat est décerné à</p><h2 className="mt-2 border-b-2 border-slate-300 pb-3 font-serif text-4xl font-black text-violet-900">{c.student_name_snapshot}</h2><p className="mx-auto mt-6 max-w-3xl text-lg text-slate-700">pour avoir satisfait aux exigences de la formation <strong>{c.program_name_snapshot||c.school_name_snapshot}</strong>{c.cohort_name_snapshot?<> dans la cohorte <strong>{c.cohort_name_snapshot}</strong></>:null}.</p>
      {c.final_score!=null||c.attendance_percent!=null?<div className="mt-6 flex justify-center gap-8 font-bold">{c.final_score!=null?<span>Note finale : {c.final_score}</span>:null}{c.attendance_percent!=null?<span>Présence : {c.attendance_percent}%</span>:null}</div>:null}
      <footer className="mt-12 grid grid-cols-[1fr_auto_1fr] items-end gap-6 border-t pt-6 text-left"><div><p className="text-xs uppercase text-slate-500">Émis le</p><p className="font-black">{new Intl.DateTimeFormat("fr-CA",{dateStyle:"long"}).format(new Date(c.issued_at))}</p><p className="mt-2 font-mono text-sm font-black">{c.certificate_number}</p></div><div className="rounded-xl border bg-white p-2 text-center"><Image src={`/api/academy/school-certificate-qr/${c.verification_token}`} alt="QR de vérification" width={130} height={130} unoptimized/><p className="text-[9px] font-black uppercase">Scanner pour vérifier</p></div><div className="text-right"><div className="ml-auto w-56 border-b border-slate-700"/><p className="mt-2 font-black">Direction académique</p></div></footer>
    </article>
    <section className="mt-6 rounded-3xl bg-white p-6 shadow print:hidden"><Link href={verify} target="_blank" className="block break-all rounded-xl bg-slate-50 p-4 font-bold text-violet-700">{verify}</Link>{canManage&&valid?<form action={revokeSchoolCertificateAction} className="mt-5 rounded-2xl bg-red-50 p-5"><input type="hidden" name="certificate_id" value={c.id}/><h3 className="font-black text-red-950">Révoquer ce certificat</h3><div className="mt-3 flex gap-3"><input name="reason" minLength={5} required placeholder="Motif obligatoire" className="min-w-0 flex-1 rounded-xl border p-3"/><button className="rounded-xl bg-red-700 px-5 font-black text-white">Révoquer</button></div></form>:null}</section>
  </div></main>;
}
