import {NextResponse} from "next/server";
import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {sendCantonQaFeedbackEmail} from "@/lib/canton/qa-email-delivery";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const APPOINTMENT_ID="65661bee-df6c-4f54-9599-f42f173c8af4";

/** Temporary QA-only one-shot endpoint.
 * Safety comes from the isolated preview gate, exact appointment, exact allowlisted
 * recipient, pending-only outbox claim, and idempotent Resend key.
 */
export async function GET(){
 if(!cantonLiveEnabled())return NextResponse.json({ok:false},{status:404});
 const result=await sendCantonQaFeedbackEmail(APPOINTMENT_ID);
 return NextResponse.json({ok:result.outcome==="sent",outcome:result.outcome,detail:result.detail},{
  status:result.outcome==="sent"?200:409,
  headers:{"Cache-Control":"no-store"}
 });
}
