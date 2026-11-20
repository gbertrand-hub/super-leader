import "server-only";
import {randomUUID} from "node:crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {cantonFeedbackEmail} from "@/lib/canton/feedback-email-template";

const QA_ORG="021cdbb8-af4d-412e-8ec7-e7bba08d1349";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function permittedAddress(email:string):boolean {
 const allow=(process.env.CANTON_QA_EMAIL_RECIPIENT||"").trim().toLowerCase();
 return allow.length>4&&allow.includes("@")&&email.toLowerCase()===allow;
}
function gate():boolean {
 return cantonLiveEnabled()&&process.env.CANTON_QA_EMAIL_TEST_ENABLED==="true"
  &&process.env.VERCEL_ENV==="preview"
  &&!!process.env.RESEND_API_KEY
  &&!!process.env.FEEDBACK_FROM_EMAIL
  &&!!process.env.CANTON_QA_EMAIL_RECIPIENT;
}
export type CantonQaDeliveryResult={
 outcome:"disabled"|"not_allowed"|"not_due"|"cancelled"|"failed"|"sent";
 detail:string;
};
export async function sendCantonQaFeedbackEmail(appointmentId:string):Promise<CantonQaDeliveryResult>{
 if(!gate())return {outcome:"disabled",detail:"QA external email gate is disabled or incomplete"};
 if(!UUID.test(appointmentId))return {outcome:"not_allowed",detail:"Invalid visit"};
 const db=createAdminClient();
 const {data:visit,error:visitError}=await db.from("canton_appointments")
  .select("id,organization_id,visitor_id,department,status,check_out_at,feedback_token")
  .eq("id",appointmentId).eq("organization_id",QA_ORG).maybeSingle();
 if(visitError||!visit||visit.status!=="completed"||!visit.check_out_at)
  return {outcome:"not_allowed",detail:"No eligible completed QA visit"};
 const {data:person,error:personError}=await db.from("canton_visitors")
  .select("email,feedback_email_opt_in,feedback_opt_in_at,feedback_preferred_locale")
  .eq("id",visit.visitor_id).eq("organization_id",QA_ORG).maybeSingle();
 if(personError||!person?.email||!person.feedback_email_opt_in||!person.feedback_opt_in_at)
  return {outcome:"not_allowed",detail:"Consent or email missing"};
 if(!permittedAddress(person.email))return {outcome:"not_allowed",detail:"Not an allowlisted QA recipient"};
 const {data:feedback}=await db.from("canton_visit_feedback").select("id")
  .eq("appointment_id",appointmentId).limit(1).maybeSingle();
 if(feedback)return {outcome:"cancelled",detail:"Feedback already received"};
 const {data:queued}=await db.from("canton_feedback_invitation_outbox")
  .select("status,due_at").eq("organization_id",QA_ORG)
  .eq("appointment_id",appointmentId).eq("channel","email").maybeSingle();
 if(queued?.status!=="pending"||!queued.due_at||Date.parse(queued.due_at)>Date.now())
  return {outcome:"not_due",detail:"No pending due email"};
 const claimToken=randomUUID();
 const {data:claimed,error:claimError}=await db.rpc("canton_claim_email_invitation",{
  p_organization_id:QA_ORG,p_appointment_id:appointmentId,p_claim_token:claimToken
 });
 if(claimError)throw new Error("Cannot claim QA invitation");
 if(!Array.isArray(claimed)||claimed.length!==1)return {outcome:"not_due",detail:"Claim rejected or cancelled"};
 // Re-check immediately before provider request, after successful atomic claim.
 const [{data:stillNoFeedback},{data:currentVisitor}]=await Promise.all([
  db.from("canton_visit_feedback").select("id").eq("appointment_id",appointmentId).maybeSingle(),
  db.from("canton_visitors").select("email,feedback_email_opt_in").eq("id",visit.visitor_id).eq("organization_id",QA_ORG).maybeSingle()
 ]);
 if(stillNoFeedback || !currentVisitor?.feedback_email_opt_in || currentVisitor.email!==person.email){
  await db.rpc("canton_ack_email_invitation",{
   p_organization_id:QA_ORG,p_appointment_id:appointmentId,p_claim_token:claimToken,
   p_status:"failed",p_error_code:"eligibility_changed",p_provider_message_id:null
  });
  return {outcome:"cancelled",detail:"Conditions changed before sending"};
 }
 const language=person.feedback_preferred_locale==="fr"?"fr":"en";
 // Use the actual deployment URL only; this test must never link to production.
 const deploymentHost=process.env.VERCEL_URL||"";
 const validHost=/^[a-z0-9-]+\.vercel\.app$/.test(deploymentHost);
 if(!validHost){
  await db.rpc("canton_ack_email_invitation",{
   p_organization_id:QA_ORG,p_appointment_id:appointmentId,p_claim_token:claimToken,
   p_status:"failed",p_error_code:"qa_preview_url_missing",p_provider_message_id:null
  });
  return {outcome:"failed",detail:"QA preview host missing"};
 }
 const url="https://"+deploymentHost+"/canton-feedback/"+encodeURIComponent(visit.feedback_token)+"?lang="+language;
 const payload=cantonFeedbackEmail({language,department:visit.department==="DIG"||visit.department==="TCF"?visit.department:"OTHER",feedbackUrl:url});
 let providerMessageId:string|null=null;
 let providerErrorCode:string|null=null;
 try{
  const response=await fetch("https://api.resend.com/emails",{
   method:"POST",
   headers:{
    "Authorization":"Bearer "+process.env.RESEND_API_KEY,
    "Content-Type":"application/json",
    "Idempotency-Key":"canton-qa-"+appointmentId,
   },
   body:JSON.stringify({
    from:process.env.FEEDBACK_FROM_EMAIL,
    to:[person.email],
    subject:payload.subject,
    text:payload.text,
   }),
   signal:AbortSignal.timeout(15000)
  });
  const body=await response.json().catch(()=>({})) as {id?:string;name?:string};
  if(response.ok&&body.id)providerMessageId=body.id;
  else providerErrorCode="resend_http_"+response.status;
 }catch{
  providerErrorCode="provider_request_uncertain_manual_review";
 }
 const {data:ack,error:ackError}=await db.rpc("canton_ack_email_invitation",{
  p_organization_id:QA_ORG,p_appointment_id:appointmentId,p_claim_token:claimToken,
  p_status:providerMessageId?"sent":"failed",
  p_provider_message_id:providerMessageId,p_error_code:providerErrorCode
 });
 if(ackError||ack!==true)throw new Error("QA delivery provider outcome recorded ambiguously; manual review required");
 return providerMessageId
  ?{outcome:"sent",detail:"QA Resend accepted one message"}
  :{outcome:"failed",detail:"Provider failed or outcome uncertain; no automatic retry"};
}

/** A bounded worker for isolated Canton QA.
 * Never invokes Resend unless every existing safety gate and exact-recipient allowlist passes.
 * No automatic retries of uncertain provider requests: 'sending' stays locked for review.
 */
export async function processCantonQaEmailQueue(limit=10):Promise<{
 enabled:boolean;eligible:number;sent:number;failed:number;skipped:number;
}>{
 if(!gate())return {enabled:false,eligible:0,sent:0,failed:0,skipped:0};
 const db=createAdminClient();
 const max=Math.max(1,Math.min(20,Math.trunc(limit)||10));
 const {data:due,error}=await db.from("canton_feedback_invitation_outbox")
   .select("appointment_id")
   .eq("organization_id",QA_ORG).eq("channel","email").eq("status","pending")
   .lte("due_at",new Date().toISOString()).order("due_at",{ascending:true}).limit(max);
 if(error)throw new Error("Cannot read QA invitation queue");
 let sent=0,failed=0,skipped=0;
 for(const entry of due||[]){
  const result=await sendCantonQaFeedbackEmail(entry.appointment_id);
  if(result.outcome==="sent")sent++;
  else if(result.outcome==="failed")failed++;
  else skipped++;
 }
 return {enabled:true,eligible:due?.length||0,sent,failed,skipped};
}
