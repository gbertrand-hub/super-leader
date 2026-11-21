import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";

export async function syncCantonFeedbackToCrm({
 appointmentId,
 feedbackId,
 rating,
 contactRequested,
 comment,
}:{
 appointmentId:string;
 feedbackId:string;
 rating:number;
 contactRequested:boolean;
 comment:string|null;
}):Promise<{synced:boolean;interactionId:string|null}>{
 const db=createAdminClient();

 const {data:feedback,error:feedbackError}=await db.from("canton_visit_feedback")
  .select("id,crm_interaction_id").eq("id",feedbackId).eq("appointment_id",appointmentId).maybeSingle();
 if(feedbackError||!feedback)return {synced:false,interactionId:null};
 if(feedback.crm_interaction_id)return {synced:true,interactionId:feedback.crm_interaction_id};

 const {data:visit}=await db.from("canton_appointments")
  .select("id,organization_id,visitor_id,commercial_interest,visit_outcome,crm_referred_by,announced_by,host_user_id")
  .eq("id",appointmentId).maybeSingle();
 if(!visit)return {synced:false,interactionId:null};

 const {data:visitor}=await db.from("canton_visitors")
  .select("crm_client_id").eq("id",visit.visitor_id).eq("organization_id",visit.organization_id).maybeSingle();
 const crmClientId=visitor?.crm_client_id||null;
 const actorId=visit.crm_referred_by||visit.announced_by||visit.host_user_id||null;
 if(!crmClientId||!actorId)return {synced:false,interactionId:null};

 const experience=rating>=4?"positive":rating===3?"neutral":"alert";
 const summary=[
  "Visitor Feedback · Canton visit",
  "Experience: "+experience,
  "Rating: "+rating+"/5",
  "Contact requested: "+(contactRequested?"yes":"no"),
  visit.commercial_interest?"Internal commercial assessment: "+visit.commercial_interest:null,
  visit.visit_outcome?"Internal visit outcome: "+visit.visit_outcome:null,
  comment?"Visitor comment: "+comment:null
 ].filter(Boolean).join(" | ").slice(0,5000);

 const {data:interaction,error:interactionError}=await db.from("crm_interactions").insert({
  organization_id:visit.organization_id,
  client_id:crmClientId,
  employee_id:actorId,
  channel:"other",
  direction:"inbound",
  interaction_type:rating<=2?"complaint":"information",
  outcome:(rating<=2||contactRequested)?"follow_up":"resolved",
  summary,
  occurred_at:new Date().toISOString(),
  feedback_requested:false,
  created_by:actorId
 }).select("id").single();
 if(interactionError||!interaction?.id)return {synced:false,interactionId:null};

 const {data:linked,error:linkError}=await db.from("canton_visit_feedback")
  .update({crm_interaction_id:interaction.id})
  .eq("id",feedbackId)
  .is("crm_interaction_id",null)
  .select("id,crm_interaction_id")
  .maybeSingle();

 if(linkError)return {synced:false,interactionId:null};
 if(linked?.crm_interaction_id===interaction.id)return {synced:true,interactionId:interaction.id};

 // Another concurrent request linked first. Remove the duplicate interaction we just created.
 const {data:current}=await db.from("canton_visit_feedback")
  .select("crm_interaction_id").eq("id",feedbackId).maybeSingle();
 if(current?.crm_interaction_id&&current.crm_interaction_id!==interaction.id){
  await db.from("crm_interactions").delete().eq("id",interaction.id);
  return {synced:true,interactionId:current.crm_interaction_id};
 }
 return {synced:false,interactionId:null};
}
