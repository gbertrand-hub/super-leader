"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {assertEnrollmentPermission} from "@/lib/academy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const txt=(value:FormDataEntryValue|null,max=5000)=>String(value??"").trim().slice(0,max);
const day=(value:FormDataEntryValue|null)=>/^\d{4}-\d{2}-\d{2}$/.test(String(value??""))?String(value):null;
const academicStatuses=new Set(["candidate","admitted","enrolled","active","suspended","graduated","withdrawn","inactive"]);
const trainingStatuses=new Set(["not_started","active","paused","at_risk","completed","withdrawn"]);
const riskLevels=new Set(["low","medium","high","critical"]);
const channels=new Set(["phone","whatsapp","email","sms","meeting","video","other"]);
const outcomes=new Set(["resolved","follow_up","no_answer","escalated","other"]);

function go(clientId:string,message:string,kind:"success"|"error"="success"):never{
  redirect(`/dashboard/crm/${clientId}?${kind}=${encodeURIComponent(message)}`);
}

async function context(){
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const admin=createAdminClient();
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",data.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership)throw new Error("Action non autorisée.");
  return {admin,user:data.user,membership};
}

async function secureEnrollment(formData:FormData,permission:"training"|"followup"){
  const clientId=txt(formData.get("client_id"),80),enrollmentId=txt(formData.get("enrollment_id"),80),schoolId=txt(formData.get("school_id"),80);
  const ctx=await context();
  const [{data:client},{data:enrollment}]=await Promise.all([
    ctx.admin.from("crm_clients").select("id,linked_user_id").eq("id",clientId).eq("organization_id",ctx.membership.organization_id).maybeSingle<{id:string;linked_user_id:string|null}>(),
    ctx.admin.from("academy_school_enrollments").select("id,school_id,crm_client_id,user_id,completed_on").eq("id",enrollmentId).eq("school_id",schoolId).eq("organization_id",ctx.membership.organization_id).maybeSingle<{id:string;school_id:string;crm_client_id:string|null;user_id:string|null;completed_on:string|null}>(),
  ]);
  const linked=Boolean(client&&enrollment&&(enrollment.crm_client_id===client.id||(client.linked_user_id&&enrollment.user_id===client.linked_user_id)));
  const permitted=linked&&await assertEnrollmentPermission(ctx.admin,ctx.membership.organization_id,ctx.user.id,ctx.membership.role,schoolId,enrollmentId,permission);
  if(!permitted)go(clientId||"",permission==="training"?"Accès pédagogique non autorisé.":"Suivi académique non autorisé.","error");
  return {...ctx,clientId,enrollmentId,schoolId,enrollment:enrollment!};
}

export async function updateCrmLearnerProgressAction(formData:FormData){
  const ctx=await secureEnrollment(formData,"training");
  const academicStatus=txt(formData.get("academic_status"),30),trainingStatus=txt(formData.get("training_status"),30),riskLevel=txt(formData.get("risk_level"),20);
  const rawProgress=Number(String(formData.get("progress_percent")??"0").replace(",","."));
  if(!academicStatuses.has(academicStatus)||!trainingStatuses.has(trainingStatus)||!riskLevels.has(riskLevel)||!Number.isFinite(rawProgress)||rawProgress<0||rawProgress>100)go(ctx.clientId,"Informations de progression invalides.","error");
  const completedOn=academicStatus==="graduated"?(ctx.enrollment.completed_on??new Date().toISOString().slice(0,10)):null;
  const {error:enrollmentError}=await ctx.admin.from("academy_school_enrollments").update({academic_status:academicStatus,completed_on:completedOn,updated_at:new Date().toISOString()}).eq("id",ctx.enrollmentId).eq("organization_id",ctx.membership.organization_id);
  if(enrollmentError)go(ctx.clientId,enrollmentError.message,"error");
  const {error}=await ctx.admin.from("academy_student_progress").upsert({
    organization_id:ctx.membership.organization_id,enrollment_id:ctx.enrollmentId,progress_percent:rawProgress,
    current_module:txt(formData.get("current_module"),240)||null,last_activity_on:day(formData.get("last_activity_on")),
    expected_completion_on:day(formData.get("expected_completion_on")),training_status:trainingStatus,risk_level:riskLevel,
    blocker_notes:txt(formData.get("blocker_notes"),5000)||null,next_action:txt(formData.get("next_action"),500)||null,
    next_action_on:day(formData.get("next_action_on")),updated_by:ctx.user.id,updated_at:new Date().toISOString(),
  },{onConflict:"enrollment_id"});
  if(error)go(ctx.clientId,error.message,"error");
  revalidatePath(`/dashboard/crm/${ctx.clientId}`);
  go(ctx.clientId,"Suivi académique mis à jour.");
}

export async function addCrmLearnerFollowupAction(formData:FormData){
  const ctx=await secureEnrollment(formData,"followup");
  const summary=txt(formData.get("summary"),5000),channel=txt(formData.get("channel"),30),outcome=txt(formData.get("outcome"),30);
  if(summary.length<2||!channels.has(channel)||!outcomes.has(outcome))go(ctx.clientId,"Le suivi académique est incomplet.","error");
  const nextAction=txt(formData.get("next_action"),500)||null,nextActionOn=day(formData.get("next_action_on"));
  const {error}=await ctx.admin.from("academy_student_followups").insert({organization_id:ctx.membership.organization_id,enrollment_id:ctx.enrollmentId,employee_id:ctx.user.id,channel,outcome,summary,next_action:nextAction,next_action_on:nextActionOn});
  if(error)go(ctx.clientId,error.message,"error");
  if(nextAction||nextActionOn)await ctx.admin.from("academy_student_progress").upsert({organization_id:ctx.membership.organization_id,enrollment_id:ctx.enrollmentId,next_action:nextAction,next_action_on:nextActionOn,updated_by:ctx.user.id,updated_at:new Date().toISOString()},{onConflict:"enrollment_id"});
  revalidatePath(`/dashboard/crm/${ctx.clientId}`);
  go(ctx.clientId,"Suivi académique enregistré dans l’historique.");
}
