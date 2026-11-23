import {NextResponse} from "next/server";
import {verifyCronRequest} from "@/lib/crm/webhook-security";
import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {processCantonQaEmailQueue} from "@/lib/canton/qa-email-delivery";

export const dynamic="force-dynamic";
export const runtime="nodejs";

/** Opt-in preview-only scheduled endpoint. No impact on production CRM cron.
 * Must be invoked by a trusted authenticated scheduler; not a public URL.
 */
export async function GET(request:Request){
 if(!cantonLiveEnabled())return NextResponse.json({ok:false,error:"QA only"},{status:404});
 if(!verifyCronRequest(request))return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
 try{
  const result=await processCantonQaEmailQueue(10);
  return NextResponse.json({ok:true,...result},{headers:{"Cache-Control":"no-store"}});
 }catch{
  return NextResponse.json({ok:false,error:"QA email worker failed. Review server logs."},{status:500});
 }
}
