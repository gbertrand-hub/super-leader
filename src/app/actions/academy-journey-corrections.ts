"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const allowedSteps=new Set(["sale","payment","receipt","finance","schedule","enrollment","followup","access"]);
const text=(value:FormDataEntryValue|null,max=500)=>String(value??"").trim().slice(0,max);

function safeReturn(value:string,organizationId:string){
  if(value.startsWith("/dashboard/academy/journey-control?")&&!value.includes("//"))return value;
  return `/dashboard/academy/journey-control?organization=${encodeURIComponent(organizationId)}&state=issues`;
}

async function context(organizationId:string){
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const admin=createAdminClient();
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("organization_id",organizationId).eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership)throw new Error("Action non autorisée dans cette organisation.");
  return {admin,userId:auth.user.id};
}

async function verifyStudent(admin:ReturnType<typeof createAdminClient>,organizationId:string,studentKey:string,enrollmentId:string){
  const [kind,id]=studentKey.split(":",2);
  if(!id||!["crm","user"].includes(kind))return false;
  let query=admin.from("academy_school_enrollments").select("id").eq("organization_id",organizationId).limit(1);
  query=kind==="crm"?query.eq("crm_client_id",id):query.eq("user_id",id);
  if(enrollmentId)query=query.eq("id",enrollmentId);
  const {data}=await query.maybeSingle<{id:string}>();
  return Boolean(data);
}

export async function updateJourneyCorrectionAction(formData:FormData){
  const organizationId=text(formData.get("organization_id"),80);
  const studentKey=text(formData.get("student_key"),100);
  const enrollmentId=text(formData.get("enrollment_id"),80);
  const issueKey=text(formData.get("issue_key"),180);
  const stepKey=text(formData.get("step_key"),40);
  const schoolName=text(formData.get("school_name"),180);
  const nextStatus=text(formData.get("next_status"),20);
  const note=text(formData.get("resolution_note"),1000);
  const returnTo=safeReturn(text(formData.get("return_to"),1200),organizationId);
  if(!organizationId||!studentKey||!issueKey||!allowedSteps.has(stepKey)||!["resolved","open"].includes(nextStatus))throw new Error("Données de correction invalides.");
  if(nextStatus==="resolved"&&note.length<3)redirect(`${returnTo}&error=${encodeURIComponent("Ajoutez une courte note expliquant la correction effectuée.")}`);
  const {admin,userId}=await context(organizationId);
  if(!(await verifyStudent(admin,organizationId,studentKey,enrollmentId)))throw new Error("Étudiant ou inscription introuvable.");
  const {error}=await admin.rpc("record_academy_journey_correction",{p_organization_id:organizationId,p_student_key:studentKey,p_enrollment_id:enrollmentId||null,p_issue_key:issueKey,p_step_key:stepKey,p_school_name:schoolName||null,p_status:nextStatus,p_note:note||null,p_actor_id:userId});
  if(error)throw new Error(`Impossible d’enregistrer le suivi : ${error.message}`);
  revalidatePath("/dashboard/academy/journey-control");
  redirect(`${returnTo}&success=${encodeURIComponent(nextStatus==="resolved"?"Correction déclarée comme traitée.":"Correction rouverte.")}`);
}
