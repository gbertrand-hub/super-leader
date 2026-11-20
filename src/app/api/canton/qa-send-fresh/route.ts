import {NextResponse} from "next/server";
import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {sendCantonQaFeedbackEmail} from "@/lib/canton/qa-email-delivery";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const APPOINTMENT_ID="e63998e6-9423-4e00-bb4c-8a309c87f0fe";

export async function GET(){
  if(!cantonLiveEnabled()) return NextResponse.json({ok:false},{status:404});
  const result=await sendCantonQaFeedbackEmail(APPOINTMENT_ID);
  return NextResponse.json(
    {ok:result.outcome==="sent",outcome:result.outcome,detail:result.detail},
    {status:result.outcome==="sent"?200:409,headers:{"Cache-Control":"no-store"}}
  );
}
