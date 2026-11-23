"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {canEnrollStudents,getAcademyAssignments} from "@/lib/academy/access";

const clean=(v:FormDataEntryValue|null,n=240)=>String(v??"").trim().slice(0,n);
async function context(){const s=await createClient(),{data:{user}}=await s.auth.getUser();if(!user)redirect("/login");const a=createAdminClient(),{data:m}=await a.from("organization_members").select("organization_id,role").eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();if(!m)throw new Error("Compte organisationnel requis.");return{a,user,m,assignments:await getAcademyAssignments(a,m.organization_id,user.id)}}
const go=(message:string,error=false)=>redirect(`/dashboard/academy/certificates?${error?"error":"success"}=${encodeURIComponent(message)}`);

export async function issueSchoolCertificateAction(fd:FormData){
  const enrollmentId=clean(fd.get("enrollment_id"),80),title=clean(fd.get("title")),score=clean(fd.get("final_score"),20),attendance=clean(fd.get("attendance_percent"),20);
  const c=await context(),{data:e}=await c.a.from("academy_school_enrollments").select("school_id,academic_status").eq("id",enrollmentId).eq("organization_id",c.m.organization_id).maybeSingle<{school_id:string;academic_status:string}>();
  if(!e)go("Inscription introuvable.",true);if(!canEnrollStudents(c.m.role,c.assignments,e!.school_id))throw new Error("Émission non autorisée.");if(e!.academic_status!=="graduated")go("L’étudiant doit d’abord avoir le statut Diplômé.",true);
  const {data:id,error}=await c.a.rpc("issue_academy_school_certificate",{p_enrollment_id:enrollmentId,p_actor_id:c.user.id,p_title:title,p_final_score:score?Number(score):null,p_attendance_percent:attendance?Number(attendance):null});
  if(error||!id)go(error?.message||"Émission impossible.",true);revalidatePath("/dashboard/academy/certificates");redirect(`/dashboard/academy/certificates/${id}?success=Certificat%20émis`);
}

export async function revokeSchoolCertificateAction(fd:FormData){
  const id=clean(fd.get("certificate_id"),80),reason=clean(fd.get("reason"),1000),c=await context();if(reason.length<5)redirect(`/dashboard/academy/certificates/${id}?error=Motif%20obligatoire`);
  const {data:item}=await c.a.from("academy_school_certificates").select("id,enrollment_id,school_id,status").eq("id",id).eq("organization_id",c.m.organization_id).maybeSingle<{id:string;enrollment_id:string;school_id:string;status:string}>();
  if(!item)throw new Error("Certificat introuvable.");if(!canEnrollStudents(c.m.role,c.assignments,item.school_id))throw new Error("Révocation non autorisée.");
  await c.a.from("academy_school_certificates").update({status:"revoked",revoked_by:c.user.id,revoked_at:new Date().toISOString(),revocation_reason:reason,updated_at:new Date().toISOString()}).eq("id",id);
  await c.a.from("academy_school_certificate_audit_log").insert({organization_id:c.m.organization_id,certificate_id:id,enrollment_id:item.enrollment_id,actor_id:c.user.id,action:"revoked",details:{reason}});
  revalidatePath(`/dashboard/academy/certificates/${id}`);redirect(`/dashboard/academy/certificates/${id}?success=Certificat%20révoqué`);
}
