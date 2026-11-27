import {NextResponse} from "next/server";
import {processCantonProductionWhatsAppInvitations} from "@/lib/canton/production-whatsapp-delivery";
import {verifyCronRequest} from "@/lib/crm/webhook-security";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Not scheduled automatically. Production-only, explicit double opt-in. */
export async function GET(request:Request){
  if(!process.env.CRON_SECRET?.trim()||!verifyCronRequest(request)){
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  }
  if(process.env.VERCEL_ENV!=="production"||
     process.env.CANTON_FEEDBACK_WHATSAPP_AUTOMATION_ENABLED!=="true"){
    return NextResponse.json({ok:true,enabled:false,message:"Canton WhatsApp automation is disabled."});
  }
  try{
    return NextResponse.json({ok:true,...await processCantonProductionWhatsAppInvitations(20)});
  }catch{
    return NextResponse.json({ok:false,error:"Canton WhatsApp processing needs review."},{status:500});
  }
}
