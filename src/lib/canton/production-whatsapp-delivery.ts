import "server-only";

import {randomUUID} from "node:crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {cantonProductionEnabled} from "@/lib/canton/feature-gate";
import {buildCantonMetaTemplatePayload} from "@/lib/canton/whatsapp-provider-payload";
import {getSiteUrl} from "@/lib/supabase/env";

type Result = {enabled: boolean; queued: number; accepted: number; failed: number; cancelled: number; skipped: number};
const disabled = (): Result => ({enabled:false,queued:0,accepted:0,failed:0,cancelled:0,skipped:0});
const env = (key:string) => String(process.env[key] || "").trim().replace(/^['"]|['"]$/g, "");
const phonePattern = /^\+[1-9]\d{7,14}$/;

/** Deployment-wide fail-closed gates, independent of the CRM WhatsApp automation. */
function configuration() {
  if (!cantonProductionEnabled() || process.env.VERCEL_ENV !== "production" ||
    env("CANTON_FEEDBACK_WHATSAPP_AUTOMATION_ENABLED") !== "true" ||
    env("CANTON_WHATSAPP_META_TEMPLATE_APPROVED") !== "true") return null;
  const accessToken=env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId=env("WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion=env("WHATSAPP_GRAPH_VERSION");
  const templateName=env("CANTON_WHATSAPP_FEEDBACK_TEMPLATE_NAME");
  const siteUrl=getSiteUrl();
  if (!accessToken || !/^\d+$/.test(phoneNumberId) ||
      !/^v\d+\.\d+$/.test(graphVersion) || !/^[a-z0-9_]{2,100}$/.test(templateName) ||
      siteUrl !== "https://app.ileadglobal.org") return null;
  return {accessToken,phoneNumberId,graphVersion,templateName};
}

/**
 * Accepts at most one provider request per claimed invitation; never retries
 * failures, timeouts or uncertain outcomes automatically. Requires migrations
 * 142-145 to have been tested and applied prior to enabling any environment flag.
 * This processor is intentionally NOT registered in vercel.json cron schedules.
 */
export async function processCantonProductionWhatsAppInvitations(limit=20):Promise<Result> {
  const config=configuration();
  if(!config) return disabled();
  const db=createAdminClient();
  const max=Math.max(1,Math.min(25,Math.trunc(limit)||20));
  const {data:queue,error:queueError}=await db.from("canton_feedback_invitation_outbox")
    .select("appointment_id")
    .eq("channel","whatsapp").eq("status","pending")
    .lte("due_at",new Date().toISOString())
    .order("due_at",{ascending:true}).limit(max);
  if(queueError)throw new Error("Canton WhatsApp queue could not be queried");
  let accepted=0,failed=0,cancelled=0,skipped=0;
  for(const item of queue||[]){
    const appointmentId=String(item.appointment_id||"");
    const token=randomUUID();
    const {data:claimed,error:claimError}=await db.rpc("canton_claim_whatsapp_feedback_invitation",{
      p_appointment_id:appointmentId,p_claim_token:token,
    });
    if(claimError)throw new Error("Canton WhatsApp claim failed; verify database migration readiness");
    if(!Array.isArray(claimed)||claimed.length!==1){skipped++;continue;}

    const cancelClaim=async(reason:string)=>{
      const {error}=await db.from("canton_feedback_invitation_outbox").update({
        status:"cancelled",reason,processed_at:new Date().toISOString(),
      }).eq("appointment_id",appointmentId).eq("channel","whatsapp")
        .eq("status","sending").eq("claim_token",token);
      if(error)throw new Error("Unable to cancel claimed WhatsApp invitation");
    };
    const failClaim=async(reason:string)=>{
      const {data:ack,error}=await db.rpc("canton_ack_whatsapp_feedback_invitation",{
        p_appointment_id:appointmentId,p_claim_token:token,p_status:"failed",
        p_provider_message_id:null,p_error_code:reason,
      });
      if(error||ack!==true)throw new Error("Unable to acknowledge WhatsApp outcome");
    };

    // All reads must succeed. Missing or stale consent fails closed.
    const {data:visit,error:visitError}=await db.from("canton_appointments")
      .select("id,organization_id,visitor_id,status,check_out_at,feedback_token,site_id")
      .eq("id",appointmentId).maybeSingle();
    if(visitError){await failClaim("visit_read_error_manual_review");failed++;continue;}
    if(!visit||visit.status!=="completed"||!visit.check_out_at||!visit.feedback_token){
      await cancelClaim("visit_not_eligible");cancelled++;continue;
    }
    const [personResult,feedbackResult,settingsResult]=await Promise.all([
      db.from("canton_visitors")
        .select("full_name,phone,feedback_whatsapp_consent_phone,feedback_whatsapp_opt_in,feedback_whatsapp_opt_in_at,feedback_preferred_locale")
        .eq("id",visit.visitor_id).eq("organization_id",visit.organization_id).maybeSingle(),
      db.from("canton_visit_feedback").select("id").eq("appointment_id",appointmentId).maybeSingle(),
      db.from("canton_feedback_delivery_settings")
        .select("whatsapp_enabled,whatsapp_template_ready")
        .eq("organization_id",visit.organization_id).maybeSingle(),
    ]);
    if(personResult.error||feedbackResult.error||settingsResult.error){
      await failClaim("consent_read_error_manual_review");failed++;continue;
    }
    if(feedbackResult.data){await cancelClaim("feedback_already_received");cancelled++;continue;}
    const person=personResult.data,settings=settingsResult.data;
    if(!person?.feedback_whatsapp_opt_in||!person.feedback_whatsapp_opt_in_at||
      !person.phone||!phonePattern.test(person.phone)||
      person.feedback_whatsapp_consent_phone!==person.phone||
      !settings?.whatsapp_enabled||!settings.whatsapp_template_ready){
      await cancelClaim("whatsapp_consent_or_setting_revoked");cancelled++;continue;
    }
    const {data:site,error:siteError}=visit.site_id
      ? await db.from("visitor_sites").select("name").eq("id",visit.site_id)
          .eq("organization_id",visit.organization_id).maybeSingle()
      : {data:null,error:null};
    if(siteError){await failClaim("site_read_error_manual_review");failed++;continue;}

    let requestBody:ReturnType<typeof buildCantonMetaTemplatePayload>;
    try{
      requestBody=buildCantonMetaTemplatePayload({
        recipient:person.phone,visitorName:person.full_name,
        siteName:site?.name||"ILEAD Global",token:visit.feedback_token,
        templateName:config.templateName,
        language:person.feedback_preferred_locale==="fr"?"fr":"en",
        frCode:env("CANTON_WHATSAPP_TEMPLATE_LANGUAGE_FR")||"fr",
        enCode:env("CANTON_WHATSAPP_TEMPLATE_LANGUAGE_EN")||"en_US",
      });
    }catch{
      await failClaim("invalid_meta_template_payload_manual_review");failed++;continue;
    }

    // The dedicated template must be approved by Meta for a URL button:
    // https://app.ileadglobal.org/canton-feedback/{{1}}
    // If the provider accepts the request but the response is lost, never retry.
    let providerId:string|null=null, failureReason="provider_response_uncertain_manual_review";
    try{
      const response=await fetch(
        `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,{
          method:"POST",
          headers:{Authorization:`Bearer ${config.accessToken}`,"Content-Type":"application/json"},
          body:JSON.stringify(requestBody),cache:"no-store",signal:AbortSignal.timeout(15000),
        });
      const result=(await response.json().catch(()=>({}))) as {
        messages?:Array<{id?:string}>;error?:{code?:number};
      };
      if(response.ok && result.messages?.[0]?.id){
        providerId=result.messages[0].id;
      }else{
        failureReason=`meta_http_${response.status}${result.error?.code?"_"+result.error.code:""}`;
      }
    }catch{
      failureReason="provider_response_uncertain_manual_review";
    }
    const {data:ack,error:ackError}=await db.rpc("canton_ack_whatsapp_feedback_invitation",{
      p_appointment_id:appointmentId,p_claim_token:token,
      p_status:providerId?"sent":"failed",
      p_provider_message_id:providerId,p_error_code:providerId?null:failureReason,
    });
    // A feedback submitted during the external request can cancel the claim.
    // Such an uncertain outcome must be reconciled manually, never resent.
    if(ackError||ack!==true)throw new Error("WhatsApp provider outcome needs manual reconciliation");
    if(providerId)accepted++;else failed++;
  }
  return {enabled:true,queued:queue?.length||0,accepted,failed,cancelled,skipped};
}
