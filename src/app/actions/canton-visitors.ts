"use server";
import {assertCantonLive} from "@/lib/canton/feature-gate";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";

const depts = new Set(["DIG","TCF","DIRECTION","OTHER"]);
const roles = new Set(["owner","admin","manager","employee","hr"]);
const route = "/canton-pilot";
const seniorRoles = new Set(["owner","admin"]);
const field=(f:FormData,k:string,n=180)=>String(f.get(k)??"").trim().slice(0,n);
const fail=(message:string):never=>redirect(route+"?error="+encodeURIComponent(message));
async function context(){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/canton-pilot/login");
 const db=createAdminClient();
 const {data:m,error}=await db.from("organization_members").select("organization_id,role")
 .eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(error||!m||!roles.has(m.role)) throw new Error("No access to Canton Visitor Center");
 const {data:reception}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",m.organization_id).eq("user_id",user.id).maybeSingle();
 return {db,user,org:m.organization_id as string,role:m.role as string,isReception:!!reception};
}
export async function createCantonAppointment(f:FormData){
 assertCantonLive();
 const {db,user,org,role}=await context();
 const name=field(f,"name"), rawPhone=field(f,"phone",35);
 const phone=rawPhone.replace(/[^+0-9]/g,"")||null;
 const email=field(f,"email",200).toLowerCase()||null;
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Please enter a valid email address");
 const department=field(f,"department").toUpperCase();
 const purpose=field(f,"purpose",100)||"other";
 const scheduled=field(f,"scheduled");
 if(!name || (!phone&&!email) || !depts.has(department)) fail("Name, phone or email, and department are required");
 if(department==="DIRECTION" && !seniorRoles.has(role)) fail("Only the organization administration can schedule confidential direction visits");
 if(scheduled&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduled)) fail("Invalid Canton appointment date");
 let matched: {id:string}|null=null;
 if(phone){
  const {data}=await db.from("canton_visitors").select("id").eq("organization_id",org).eq("phone",phone).maybeSingle();
  matched=data;
 }
 if(email){
  const {data}=await db.from("canton_visitors").select("id").eq("organization_id",org).eq("email",email).maybeSingle();
  if(matched&&data&&matched.id!==data.id) fail("Phone and email match different people; resolve manually");
  matched=matched||data;
 }
 if(!matched){
  // Match an existing CRM client; do not create a commercial prospect for non-commercial visitors.
  let crmId:string|null=null;
  const matches: Array<{id:string}>=[];
  if(email){
   const {data}=await db.from("crm_clients").select("id").eq("organization_id",org).eq("email",email).limit(3);
   matches.push(...(data||[]));
  }
  if(phone){
   const {data}=await db.from("crm_clients").select("id").eq("organization_id",org).eq("phone",phone).limit(3);
   matches.push(...(data||[]));
  }
  const ids=[...new Set(matches.map(c=>c.id))];
  if(ids.length>1) fail("Multiple CRM contacts match. Please resolve the identity in CRM first");
  crmId=ids[0]||null;
  const {data,error}=await db.from("canton_visitors").insert({organization_id:org,full_name:name,phone,email,crm_client_id:crmId,created_by:user.id}).select("id").single();
  if(error){
   if(error.code==="23505") fail("This visitor was just registered; refresh and retry");
   fail("Unable to register visitor");
  }
  matched=data;
 }
 const visitorId=matched?.id ?? "";
 if(!visitorId) fail("Visitor identity could not be resolved");
 const scheduledLocal=scheduled ? scheduled.replace("T"," ")+":00" : null;
 if(scheduledLocal){
  const {data:existing}=await db.from("canton_appointments").select("id")
   .eq("organization_id",org).eq("visitor_id",visitorId).eq("department",department)
   .eq("purpose",purpose).eq("scheduled_local",scheduledLocal)
   .not("status","in","(cancelled,no_show)").limit(1).maybeSingle();
  if(existing) fail("An appointment already exists for this visitor, purpose and time");
 }
 const {error}=await db.from("canton_appointments").insert({
  organization_id:org,visitor_id:visitorId,department,purpose,
  scheduled_local:scheduledLocal,status:scheduled?"scheduled":"announced",
  host_name:field(f,"host",140)||null,notes:field(f,"notes",1000)||null,announced_by:user.id
 });
 if(error) fail(error.code==="23505"?"Duplicate appointment detected":"Unable to schedule visit");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Visit registered"));
}
export async function updateCantonVisit(f:FormData){
 assertCantonLive();
 const {db,org,user,role,isReception}=await context(),id=field(f,"id"),action=field(f,"action");
 if(!/^[0-9a-f-]{36}$/i.test(id)) fail("Invalid visit");
 const {data:row}=await db.from("canton_appointments").select("status,check_in_at,check_out_at,department,announced_by")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!row) fail("Visit not found");
 const visit = row!;
 const isSenior=seniorRoles.has(role);
 const isCreator=visit.announced_by===user.id;
 const canOperateStandardVisit=visit.department!=="DIRECTION" && (isReception || role==="manager" || role==="hr");
 if(!isSenior && visit.department==="DIRECTION") fail("Confidential visit: administrator access required");
 if(!isSenior && !isCreator && !canOperateStandardVisit) fail("Not authorized to manage this visit");
 if(["reschedule","no_show","followup"].includes(action) && !isSenior && !isCreator && role!=="manager") fail("Only the organizer or a manager can change this visit");
 const now=new Date().toISOString();
 let patch:Record<string,unknown>={updated_at:now};
 if(action==="reschedule" && ["announced","scheduled","no_show"].includes(visit.status)){
  const scheduled=field(f,"scheduled");
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduled)) fail("Invalid date for reschedule");
  patch={...patch,status:"scheduled",scheduled_local:scheduled.replace("T"," ")+":00"};
 } else
 if(action==="checkin" && ["announced","scheduled"].includes(visit.status)){
  patch={...patch,status:"arrived",check_in_at:now};
 } else if(action==="checkout" && ["arrived","in_progress"].includes(visit.status)&&!visit.check_out_at){
  patch={...patch,status:"completed",check_out_at:now};
 } else if(action==="no_show" && visit.status==="scheduled"){
  patch={...patch,status:"no_show"};
 } else if(action==="followup" && visit.status==="completed"){
  patch={...patch,follow_up_required:field(f,"required")==="yes"};
 } else fail("Action not allowed in current status");
 const {data:changed,error}=await db.from("canton_appointments").update(patch)
  .eq("id",id).eq("organization_id",org).eq("status",visit.status).select("id");
 if(error) fail(error.code==="23505"?"An appointment already exists at this time":"Unable to update visit");
 if(!changed?.length) fail("Visit changed in another session. Please refresh and retry");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Visit updated"));
}
export async function submitCantonFeedback(f:FormData){
 assertCantonLive();
 const token=field(f,"token"),rating=Number(field(f,"rating"));
 if(!/^[0-9a-f-]{36}$/i.test(token)||!Number.isInteger(rating)||rating<1||rating>5)
  redirect("/canton-feedback?error=invalid");
 const db=createAdminClient();
 const {data:visit}=await db.from("canton_appointments").select("id,status")
  .eq("feedback_token",token).maybeSingle();
 if(!visit||visit.status!=="completed") redirect("/canton-feedback?error=unavailable");
 const welcome=field(f,"welcome"),expectations=field(f,"expectations");
 if(welcome&&!["very_satisfied","satisfied","neutral","dissatisfied"].includes(welcome))
  redirect("/canton-feedback?error=invalid");
 if(expectations&&!["yes","partially","no"].includes(expectations))
  redirect("/canton-feedback?error=invalid");
 const {error}=await db.from("canton_visit_feedback").insert({
  appointment_id:visit.id,rating,
  welcome_rating:welcome||null,expectations:expectations||null,
  contact_requested:field(f,"contact")==="yes",
  comment:field(f,"comment",1200)||null
 });
 if(error) redirect("/canton-feedback?error=already-submitted");
 redirect("/canton-feedback?success=1");
}

export async function manageCantonReceptionStaff(f:FormData) {
 assertCantonLive();
 const {db,org,user,role}=await context();
 if(!seniorRoles.has(role)) fail("Only administrators can manage reception staff");
 const memberId=field(f,"userId",40),operation=field(f,"operation");
 if(!/^[0-9a-f-]{36}$/i.test(memberId)) fail("Invalid staff member");
 const {data:member}=await db.from("organization_members").select("user_id").eq("organization_id",org).eq("user_id",memberId).eq("is_active",true).maybeSingle();
 if(!member) fail("Staff member is not active in this organization");
 if(operation==="grant"){
  const {error}=await db.from("canton_reception_staff").upsert({organization_id:org,user_id:memberId,granted_by:user.id},{onConflict:"organization_id,user_id"});
  if(error) fail("Reception permission could not be granted");
 } else if(operation==="revoke"){
  const {error}=await db.from("canton_reception_staff").delete().eq("organization_id",org).eq("user_id",memberId);
  if(error) fail("Reception permission could not be revoked");
 } else fail("Invalid operation");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Reception access updated"));
}

export async function assignCantonFollowUp(f:FormData){
 assertCantonLive();
 const {db,org,user,role}=await context();
 if(!["owner","admin","manager"].includes(role)) fail("Only a manager can assign follow-up");
 const id=field(f,"id",40),ownerId=field(f,"ownerId",40),note=field(f,"note",1000),dueDate=field(f,"dueDate",10);
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(ownerId))fail("Invalid follow-up record");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate+"T12:00:00Z")))fail("Invalid follow-up date");
 const {data:member}=await db.from("organization_members").select("user_id")
  .eq("organization_id",org).eq("user_id",ownerId).eq("is_active",true).maybeSingle();
 if(!member)fail("Follow-up owner must be active in this organization");
 const {data:visit}=await db.from("canton_appointments").select("status,department")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!visit||visit.status!=="completed")throw new Error("Complete the visit before assigning follow-up");
 if(visit.department==="DIRECTION" && role==="manager")fail("Confidential direction visits require admin");
 const {data:changed,error}=await db.from("canton_appointments").update({
  follow_up_required:true,follow_up_status:"open",follow_up_owner_id:ownerId,
  follow_up_note:note||null,follow_up_due_date:dueDate,follow_up_completed_at:null,updated_at:new Date().toISOString()
 }).eq("id",id).eq("organization_id",org).eq("status","completed").select("id");
 if(error||!changed?.length)fail("Could not assign follow-up");
 revalidatePath(route);redirect(route+"?success="+encodeURIComponent("Follow-up assigned"));
}
export async function completeCantonFollowUp(f:FormData){
 assertCantonLive();
 const {db,org,user,role}=await context();
 const id=field(f,"id",40);
 if(!/^[0-9a-f-]{36}$/i.test(id))fail("Invalid follow-up");
 const {data:row}=await db.from("canton_appointments").select("id,department,follow_up_owner_id,follow_up_status")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!row||row.follow_up_status!=="open")throw new Error("Follow-up is not open");
 if(row.department==="DIRECTION"&&!seniorRoles.has(role))fail("Confidential visit");
 if(!seniorRoles.has(role)&&role!=="manager"&&row.follow_up_owner_id!==user.id)fail("Only the follow-up owner or a manager may close");
 const {data:changed,error}=await db.from("canton_appointments").update({
  follow_up_status:"completed",follow_up_completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
 }).eq("id",id).eq("organization_id",org).eq("follow_up_status","open").select("id");
 if(error||!changed?.length)fail("Follow-up changed, refresh");
 revalidatePath(route);redirect(route+"?success="+encodeURIComponent("Follow-up completed"));
}
