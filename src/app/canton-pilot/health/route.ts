import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Read-only QA connectivity probe. Never touches production or performs writes.
 * Does not disclose server-side credentials or user identities.
 */
export async function GET() {
 const headers = {"Cache-Control":"no-store"};
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
 const isQa = process.env.VERCEL_ENV === "preview" &&
   url === "https://xehstmnqljjhacjiukvc.supabase.co";
 if (!isQa) return NextResponse.json({environment:"not-qa",ready:false},{status:404,headers});
 const report = {
   environment:"canton-isolated-qa",
   serverKeyVerified:false,
   qaOrganizationFound:false,
   fourMembersReady:false,
   receptionAuthorized:false,
   intakeRateSecretPresent:!!process.env.CANTON_INTAKE_RATE_SECRET,
   liveActionsEnabled:false
 };
 try {
   const db = createAdminClient();
   const {error:authError} = await db.auth.admin.listUsers({page:1,perPage:1});
   report.serverKeyVerified = !authError;
   if(report.serverKeyVerified) {
     const orgId="021cdbb8-af4d-412e-8ec7-e7bba08d1349";
     const {data:org,error:orgError}=await db.from("organizations").select("id").eq("id",orgId).eq("name","Canton Visitor Center - QA ONLY").maybeSingle();
     report.qaOrganizationFound = !orgError && !!org;
     if(report.qaOrganizationFound){
       const {data:members,error:membersError}=await db.from("organization_members").select("user_id,role").eq("organization_id",orgId).eq("is_active",true);
       const {data:recep,error:recepError}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",orgId);
       const ids=new Set((members||[]).map(m=>m.user_id));
       report.fourMembersReady = !membersError && ids.size===4 && (members||[]).some(m=>m.role==="admin") && (members||[]).some(m=>m.role==="manager");
       report.receptionAuthorized = !recepError && !!recep?.some(r=>ids.has(r.user_id));
     }
   }
 } catch {
   // Keep the diagnostic generic; avoid returning any key, error, or user details.
 }
 // An explicit release switch is never implied by connectivity success.
 report.liveActionsEnabled = process.env.CANTON_VISITOR_ENABLE_LIVE === "true" &&
    process.env.CANTON_TEST_DATABASE_READY === "true";
 const ready = report.serverKeyVerified && report.qaOrganizationFound &&
   report.fourMembersReady && report.receptionAuthorized && report.intakeRateSecretPresent;
 return NextResponse.json({...report,ready},{status:ready?200:503,headers});
}
