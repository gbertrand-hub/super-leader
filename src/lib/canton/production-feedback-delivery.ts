import "server-only";

import {randomUUID} from "node:crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {cantonProductionEnabled} from "@/lib/canton/feature-gate";
import {cantonFeedbackEmail} from "@/lib/canton/feedback-email-template";
import {getSiteUrl} from "@/lib/supabase/env";

type Result={enabled:boolean;queued:number;sent:number;failed:number;cancelled:number;skipped:number};

function clean(value:string|undefined){return String(value??"").trim().replace(/^['"]|['"]$/g,"").trim();}

function configured(){
 return cantonProductionEnabled()
  && !!clean(process.env.RESEND_API_KEY)
  && !!clean(process.env.FEEDBACK_FROM_EMAIL);
}

async function cancel(db:ReturnType<typeof createAdminClient>,appointmentId:string,reason:string){
 await db.from("canton_feedback_invitation_outbox").update({
  status:"cancelled",processed_at:new Date().toISOString(),reason
 }).eq("appointment_id",appointmentId).eq("channel","email").in("status",["pending","sending"]);
}

export async function processCantonProductionFeedbackEmails(limit=20):Promise<Result>{
 if(!configured())return {enabled:false,queued:0,sent:0,failed:0,cancelled:0,skipped:0};

 const db=createAdminClient();
 const max=Math.max(1,Math.min(50,Math.trunc(limit)||20));
 const now=new Date().toISOString();
 const {data:queue,error}=await db.from("canton_feedback_invitation_outbox")
  .select("appointment_id")
  .eq("channel","email").eq("status","pending").lte("due_at",now)
  .order("due_at",{ascending:true}).limit(max);
 if(error)throw new Error("Cannot load Canton feedback queue: "+error.message);

 let sent=0,failed=0,cancelled=0,skipped=0;
 for(const item of queue||[]){
  const appointmentId=String(item.appointment_id||"");
  const claimToken=randomUUID();
  const {data:claimed,error:claimError}=await db.rpc("canton_claim_feedback_invitation",{
   p_appointment_id:appointmentId,p_claim_token:claimToken
  });
  if(claimError)throw new Error("Cannot claim Canton invitation: "+claimError.message);
  if(!Array.isArray(claimed)||claimed.length!==1){skipped++;continue;}

  const {data:visit,error:visitError}=await db.from("canton_appointments")
   .select("id,organization_id,visitor_id,department,status,check_out_at,feedback_token")
   .eq("id",appointmentId).maybeSingle();
  if(visitError||!visit||visit.status!=="completed"||!visit.check_out_at||!visit.feedback_token){
   await cancel(db,appointmentId,"visit_not_eligible");cancelled++;continue;
  }

  const [{data:person,error:personError},{data:existingFeedback}]=await Promise.all([
   db.from("canton_visitors")
    .select("email,feedback_email_opt_in,feedback_opt_in_at,feedback_preferred_locale")
    .eq("id",visit.visitor_id).eq("organization_id",visit.organization_id).maybeSingle(),
   db.from("canton_visit_feedback").select("id").eq("appointment_id",appointmentId).maybeSingle()
  ]);
  if(existingFeedback){
   await cancel(db,appointmentId,"feedback_already_received");cancelled++;continue;
  }
  if(personError||!person?.email||!person.feedback_email_opt_in||!person.feedback_opt_in_at){
   await cancel(db,appointmentId,"missing_current_email_consent");cancelled++;continue;
  }

  const language=person.feedback_preferred_locale==="fr"?"fr":"en";
  const base=getSiteUrl();
  const feedbackUrl=base+"/canton-feedback/"+encodeURIComponent(visit.feedback_token)+"?lang="+language;
  const payload=cantonFeedbackEmail({
   language,
   department:visit.department==="DIG"||visit.department==="TCF"?visit.department:"OTHER",
   feedbackUrl
  });

  let providerMessageId:string|null=null;
  let providerErrorCode:string|null=null;
  try{
   const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
     Authorization:"Bearer "+clean(process.env.RESEND_API_KEY),
     "Content-Type":"application/json",
     "Idempotency-Key":"canton-feedback-"+appointmentId,
    },
    body:JSON.stringify({
     from:(clean(process.env.FEEDBACK_FROM_NAME)||"Super Leader")+" <"+clean(process.env.FEEDBACK_FROM_EMAIL)+">",
     to:[person.email],
     subject:payload.subject,
     text:payload.text,
     tags:[{name:"category",value:"canton_visit_feedback"}]
    }),
    cache:"no-store",
    signal:AbortSignal.timeout(15000)
   });
   const body=await response.json().catch(()=>({})) as {id?:string};
   if(response.ok&&body.id)providerMessageId=body.id;
   else providerErrorCode="resend_http_"+response.status;
  }catch{
   providerErrorCode="provider_request_uncertain_manual_review";
  }

  const {data:ack,error:ackError}=await db.rpc("canton_ack_feedback_invitation",{
   p_appointment_id:appointmentId,p_claim_token:claimToken,
   p_status:providerMessageId?"sent":"failed",
   p_provider_message_id:providerMessageId,p_error_code:providerErrorCode
  });
  if(ackError||ack!==true)throw new Error("Canton delivery outcome could not be recorded safely");
  if(providerMessageId)sent++; else failed++;
 }

 return {enabled:true,queued:queue?.length||0,sent,failed,cancelled,skipped};
}
