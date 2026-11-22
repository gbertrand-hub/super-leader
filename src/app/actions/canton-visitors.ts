"use server";
import {assertCantonLive} from "@/lib/canton/feature-gate";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {syncCantonFeedbackToCrm} from "@/lib/canton/feedback-crm-sync";
import {sendCantonQaFeedbackEmail} from "@/lib/canton/qa-email-delivery";

const depts = new Set(["DIG","TCF","DIRECTION","OTHER"]);
const roles = new Set(["owner","admin","manager","employee","hr"]);
const route = "/canton";
const seniorRoles = new Set(["owner","admin"]);
const field=(f:FormData,k:string,n=180)=>String(f.get(k)??"").trim().slice(0,n);
const fail=(message:string):never=>redirect(route+"?error="+encodeURIComponent(message));
const safeCantonReturn=(value:string)=>/^\/canton(?:\/(?:reception|appointments|commercial|feedback|admin))?(?:\?[^\r\n]*)?$/.test(value)&&!value.startsWith("//")?value:route;
const withMessage=(path:string,key:"success"|"error",message:string)=>path+(path.includes("?")?"&":"?")+key+"="+encodeURIComponent(message);
async function context(){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/login?next=/canton");
 const db=createAdminClient();
 const {data:m,error}=await db.from("organization_members").select("organization_id,role")
 .eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(error||!m||!roles.has(m.role)) throw new Error("No access to Canton Visitor Center");
 const {data:reception}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",m.organization_id).eq("user_id",user.id).maybeSingle();
 return {db,user,org:m.organization_id as string,role:m.role as string,isReception:!!reception};
}
async function canAccessVisitorSite(ctx:Awaited<ReturnType<typeof context>>,siteId:string|null){
 if(!siteId) return seniorRoles.has(ctx.role);
 if(seniorRoles.has(ctx.role)) return true;
 const {data:assignment}=await ctx.db.from("visitor_site_staff").select("access_role")
  .eq("site_id",siteId).eq("user_id",ctx.user.id).eq("is_active",true).maybeSingle();
 if(assignment) return true;
 const {data:anyAssignment}=await ctx.db.from("visitor_site_staff").select("site_id")
  .eq("user_id",ctx.user.id).eq("is_active",true).limit(1).maybeSingle();
 if(anyAssignment) return false;
 const {data:site}=await ctx.db.from("visitor_sites").select("is_hq").eq("id",siteId).eq("organization_id",ctx.org).maybeSingle();
 return !!site?.is_hq && (ctx.isReception||ctx.role==="manager"||ctx.role==="hr");
}
async function requireVisitorSiteAccess(ctx:Awaited<ReturnType<typeof context>>,siteId:string|null){
 if(!(await canAccessVisitorSite(ctx,siteId))) fail("You do not have access to this visitor site");
}

export async function searchCantonCrmProspects(query:string){
 assertCantonLive();
 const {db,org}=await context();
 const q=String(query??"").trim().slice(0,120);
 if(q.length<2) return [];
 const pattern="%"+q.replace(/[%_]/g,"")+"%";
 const fields=["full_name","email","phone","reference"] as const;
 const results=await Promise.all(fields.map(fieldName=>
  db.from("crm_clients")
   .select("id,reference,full_name,email,phone")
   .eq("organization_id",org)
   .ilike(fieldName,pattern)
   .order("created_at",{ascending:false})
   .limit(8)
 ));
 const merged=new Map<string,{id:string;reference:string|null;full_name:string;email:string|null;phone:string|null}>();
 for(const result of results){
  for(const row of result.data||[]) if(!merged.has(row.id)) merged.set(row.id,row);
 }
 return [...merged.values()].slice(0,20);
}

export async function createCantonCrmReferral(f:FormData){
 assertCantonLive();
 const ctx=await context();
 const {db,user,org}=ctx;
 const clientId=field(f,"clientId",40);
 const department=field(f,"department").toUpperCase();
 const siteId=field(f,"siteId",40);
 let resolvedSiteId:string|null=null;
 if(siteId){
  if(!/^[0-9a-f-]{36}$/i.test(siteId)) fail("Invalid visitor site");
  const {data:site}=await db.from("visitor_sites").select("id").eq("id",siteId).eq("organization_id",org).eq("is_active",true).maybeSingle();
  resolvedSiteId=site?.id||null;
  if(!resolvedSiteId) fail("Visitor site not found or inactive");
 }else{
  const {data:hq}=await db.from("visitor_sites").select("id").eq("organization_id",org).eq("is_hq",true).eq("is_active",true).limit(1).maybeSingle();
  resolvedSiteId=hq?.id||null;
 }
 await requireVisitorSiteAccess(ctx,resolvedSiteId);
 const purpose=field(f,"purpose",100)||"commercial_visit";
 const scheduled=field(f,"scheduled");
 const hostUserId=field(f,"hostUserId",40);
 const notes=field(f,"notes",1000)||null;
 if(!/^[0-9a-f-]{36}$/i.test(clientId)||!["DIG","TCF","OTHER"].includes(department)) fail("Select a valid CRM prospect and department");
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduled)) fail("A Canton appointment date is required");
 const {data:client}=await db.from("crm_clients").select("id,full_name,email,phone")
  .eq("id",clientId).eq("organization_id",org).maybeSingle();
 if(!client) fail("CRM prospect not found");
 const crmClient=client as NonNullable<typeof client>;
 if(!crmClient.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(crmClient.email))) fail("This CRM prospect needs a valid email address before a commercial visit can be scheduled");
 let visitor:{id:string;crm_client_id:string|null}|null=null;
 const {data:linked}=await db.from("canton_visitors").select("id,crm_client_id")
  .eq("organization_id",org).eq("crm_client_id",clientId).limit(1).maybeSingle();
 visitor=linked;
 if(!visitor&&crmClient.email){
  const {data}=await db.from("canton_visitors").select("id,crm_client_id")
   .eq("organization_id",org).eq("email",String(crmClient.email).toLowerCase()).limit(1).maybeSingle();
  visitor=data;
 }
 if(!visitor&&crmClient.phone){
  const normalizedPhone=String(crmClient.phone).replace(/[^+0-9]/g,"");
  const {data}=await db.from("canton_visitors").select("id,crm_client_id")
   .eq("organization_id",org).eq("phone",normalizedPhone).limit(1).maybeSingle();
  visitor=data;
 }
 let visitorId=visitor?.id||"";
 if(visitor){
  if(visitor.crm_client_id&&visitor.crm_client_id!==clientId) fail("This Canton visitor is already linked to another CRM record");
  if(!visitor.crm_client_id){
   const {error}=await db.from("canton_visitors").update({crm_client_id:clientId})
    .eq("id",visitor.id).eq("organization_id",org);
   if(error) fail("Could not link visitor to CRM");
  }
 }else{
  const phone=crmClient.phone?String(crmClient.phone).replace(/[^+0-9]/g,"")||null:null;
  const email=crmClient.email?String(crmClient.email).toLowerCase():null;
  const {data,error}=await db.from("canton_visitors").insert({
   organization_id:org,full_name:crmClient.full_name,phone,email,crm_client_id:clientId,created_by:user.id
  }).select("id").single();
  if(error||!data) fail("Could not create Canton visitor link");
  const createdVisitor=data!;
  visitorId=createdVisitor.id;
 }
 if(!visitorId) visitorId=visitor!.id;
 const scheduledLocal=scheduled.replace("T"," ")+":00";
 const {data:duplicate}=await db.from("canton_appointments").select("id")
  .eq("organization_id",org).eq("visitor_id",visitorId).eq("site_id",resolvedSiteId).eq("scheduled_local",scheduledLocal)
  .not("status","in","(cancelled,no_show)").limit(1).maybeSingle();
 if(duplicate) fail("This CRM prospect already has a Canton visit at that time");
 let hostName:string|null=null,resolvedHostUserId:string|null=null;
 if(hostUserId){
  if(!/^[0-9a-f-]{36}$/i.test(hostUserId)) fail("Invalid Canton host");
  const {data:member}=await db.from("organization_members").select("user_id")
   .eq("organization_id",org).eq("user_id",hostUserId).eq("is_active",true).maybeSingle();
  if(!member) fail("Canton host must be an active organization member");
  const {data:siteAssignment}=await db.from("visitor_site_staff").select("user_id").eq("site_id",resolvedSiteId).eq("user_id",hostUserId).eq("is_active",true).maybeSingle();
  if(!siteAssignment) fail("The selected host is not assigned to this visitor site");
  const {data:profile}=await db.from("profiles").select("full_name,email").eq("id",hostUserId).maybeSingle();
  resolvedHostUserId=hostUserId;
  hostName=profile?.full_name||profile?.email||"Team member";
 }
 const {error}=await db.from("canton_appointments").insert({
  organization_id:org,visitor_id:visitorId,site_id:resolvedSiteId,department,purpose,scheduled_local:scheduledLocal,
  status:"scheduled",host_name:hostName,host_user_id:resolvedHostUserId,notes,
  announced_by:user.id,visit_origin:"crm_referral",crm_referred_by:user.id
 });
 if(error) fail("Could not schedule CRM referral visit");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("CRM prospect referred to Canton"));
}

export async function createCantonAppointment(f:FormData){
 assertCantonLive();
 const ctx=await context();
 const {db,user,org,role}=ctx;
 const name=field(f,"name"), rawPhone=field(f,"phone",35);
 const phone=rawPhone.replace(/[^+0-9]/g,"")||null;
 const rawEmail=field(f,"email",200).toLowerCase();
 if(!rawEmail) fail("Email is required for visitor registration");
 const email=rawEmail as string;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Please enter a valid email address");
 const department=field(f,"department").toUpperCase();
 const purpose=field(f,"purpose",100)||"other";
 const scheduled=field(f,"scheduled");
 const siteId=field(f,"siteId",40);
 let resolvedSiteId:string|null=null;
 if(siteId){
  if(!/^[0-9a-f-]{36}$/i.test(siteId)) fail("Invalid visitor site");
  const {data:site}=await db.from("visitor_sites").select("id").eq("id",siteId).eq("organization_id",org).eq("is_active",true).maybeSingle();
  resolvedSiteId=site?.id||null;
  if(!resolvedSiteId) fail("Visitor site not found or inactive");
 }else{
  const {data:hq}=await db.from("visitor_sites").select("id").eq("organization_id",org).eq("is_hq",true).eq("is_active",true).limit(1).maybeSingle();
  resolvedSiteId=hq?.id||null;
 }
 await requireVisitorSiteAccess(ctx,resolvedSiteId);
 if(!name || !email || !depts.has(department)) fail("Name, email, and department are required");
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
 // Staff must actively attest that the visitor agreed to one service-feedback email.
 // No checkbox means no new consent; email address alone is never consent.
 if(field(f,"feedbackEmailConsent",8)==="yes"){
  if(!email)fail("An email address is required for the feedback invitation");
  const feedbackLocale=field(f,"feedbackLocale",2)==="fr"?"fr":"en";
  const {error:consentError}=await db.from("canton_visitors").update({
   email,feedback_email_opt_in:true,feedback_preferred_locale:feedbackLocale,feedback_opt_in_source:"staff_attested_at_booking",
   feedback_opt_in_at:new Date().toISOString()
  }).eq("id",visitorId).eq("organization_id",org);
  if(consentError)fail("Could not record feedback email consent");
 }

 const scheduledLocal=scheduled ? scheduled.replace("T"," ")+":00" : null;
 if(scheduledLocal){
  const {data:existing}=await db.from("canton_appointments").select("id")
   .eq("organization_id",org).eq("visitor_id",visitorId).eq("site_id",resolvedSiteId).eq("department",department)
   .eq("purpose",purpose).eq("scheduled_local",scheduledLocal)
   .not("status","in","(cancelled,no_show)").limit(1).maybeSingle();
  if(existing) fail("An appointment already exists for this visitor, purpose and time");
  // A nearby booking is suspicious but may represent a genuine separate appointment.
  // Keep this check server-side: staff must explicitly acknowledge distinct bookings.
  const scheduledAsUtc = Date.parse(scheduled+":00Z");
  if(!Number.isFinite(scheduledAsUtc)) fail("Invalid appointment date");
  const cantonWallTime=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace("T"," ");
  const from=cantonWallTime(scheduledAsUtc-60*60*1000);
  const to=cantonWallTime(scheduledAsUtc+60*60*1000);
  const {data:nearby,error:nearbyError}=await db.from("canton_appointments").select("id,scheduled_local")
   .eq("organization_id",org).eq("visitor_id",visitorId).eq("site_id",resolvedSiteId)
   .eq("department",department).eq("purpose",purpose)
   .in("status",["scheduled","announced","arrived","in_progress"])
   .gte("scheduled_local",from).lte("scheduled_local",to).limit(3);
  if(nearbyError) fail("Could not check for nearby appointments. Please retry");
  if(nearby?.length && field(f,"confirmNearby",8)!=="yes"){
   fail("Nearby appointment already exists (within 60 min). Check the distinct-visit confirmation box before registering another visit");
  }
 }
 const hostUserId=field(f,"hostUserId",40);
 let hostName=field(f,"host",140)||null;
 let resolvedHostUserId:string|null=null;
 if(hostUserId){
  if(!/^[0-9a-f-]{36}$/i.test(hostUserId)) fail("Invalid host");
  const {data:hostMember}=await db.from("organization_members").select("user_id")
   .eq("organization_id",org).eq("user_id",hostUserId).eq("is_active",true).maybeSingle();
  if(!hostMember) fail("Host must be an active organization member");
  const {data:siteAssignment}=await db.from("visitor_site_staff").select("user_id").eq("site_id",resolvedSiteId).eq("user_id",hostUserId).eq("is_active",true).maybeSingle();
  if(!siteAssignment) fail("The selected host is not assigned to this visitor site");
  const {data:hostProfile}=await db.from("profiles").select("full_name,email").eq("id",hostUserId).maybeSingle();
  resolvedHostUserId=hostUserId;
  hostName=hostProfile?.full_name||hostProfile?.email||hostName||"Team member";
 }
 const {error}=await db.from("canton_appointments").insert({
  organization_id:org,visitor_id:visitorId,site_id:resolvedSiteId,department,purpose,
  scheduled_local:scheduledLocal,status:scheduled?"scheduled":"announced",
  host_name:hostName,host_user_id:resolvedHostUserId,notes:field(f,"notes",1000)||null,announced_by:user.id
 });
 if(error) fail(error.code==="23505"?"Duplicate appointment detected":"Unable to schedule visit");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Visit registered"));
}
export async function updateCantonVisit(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const updateFail=(message:string):never=>redirect(withMessage(returnTo,"error",message));
 const {db,org,user,role,isReception}=await context(),id=field(f,"id"),action=field(f,"action");
 if(!/^[0-9a-f-]{36}$/i.test(id)) updateFail("Invalid visit");
 const {data:row}=await db.from("canton_appointments").select("status,check_in_at,check_out_at,department,announced_by,host_user_id,site_id")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!row) updateFail("Visit not found");
 const visit = row!;
 if(!seniorRoles.has(role)){
  const ctxForSite={db,user,org,role,isReception};
  await requireVisitorSiteAccess(ctxForSite,visit.site_id||null);
 }
 const isSenior=seniorRoles.has(role);
 const isCreator=visit.announced_by===user.id;
 const isHost=visit.host_user_id===user.id;
 const canOperateStandardVisit=visit.department!=="DIRECTION" && (isReception || role==="manager" || role==="hr" || isHost);
 if(!isSenior && visit.department==="DIRECTION") updateFail("Confidential visit: administrator access required");
 if(!isSenior && !isCreator && !canOperateStandardVisit) updateFail("Not authorized to manage this visit");
 if(["reschedule","no_show","followup"].includes(action) && !isSenior && !isCreator && role!=="manager") updateFail("Only the organizer or a manager can change this visit");
 const now=new Date().toISOString();
 let patch:Record<string,unknown>={updated_at:now};
 if(action==="reschedule" && ["announced","scheduled","no_show"].includes(visit.status)){
  const scheduled=field(f,"scheduled");
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduled)) updateFail("Invalid date for reschedule");
  patch={...patch,status:"scheduled",scheduled_local:scheduled.replace("T"," ")+":00"};
 } else
 if(action==="checkin" && ["announced","scheduled"].includes(visit.status)){
  patch={...patch,status:"arrived",check_in_at:now};
 } else if(action==="start" && visit.status==="arrived" && visit.check_in_at){
  patch={...patch,status:"in_progress",visit_started_at:now};
 } else if(action==="checkout" && ["arrived","in_progress"].includes(visit.status)&&!visit.check_out_at){
  patch={...patch,status:"completed",check_out_at:now};
 } else if(action==="no_show" && visit.status==="scheduled"){
  patch={...patch,status:"no_show"};
 } else if(action==="followup" && visit.status==="completed"){
  patch={...patch,follow_up_required:field(f,"required")==="yes"};
 } else updateFail("Action not allowed in current status");
 const {data:changed,error}=await db.from("canton_appointments").update(patch)
  .eq("id",id).eq("organization_id",org).eq("status",visit.status).select("id");
 if(error) updateFail(error.code==="23505"?"An appointment already exists at this time":"Unable to update visit");
 if(!changed?.length) updateFail("Visit changed in another session. Please refresh and retry");
 revalidatePath(route);
 redirect(withMessage(returnTo,"success","Visit updated"));
}
export async function markCantonArrivalAlertRead(f:FormData){
 assertCantonLive();
 const {db,org,user}=await context();
 const id=field(f,"id",40);
 if(!/^[0-9a-f-]{36}$/i.test(id)) fail("Invalid alert");
 const {data,error}=await db.from("canton_arrival_alerts").update({read_at:new Date().toISOString()})
  .eq("id",id).eq("organization_id",org).eq("recipient_user_id",user.id).is("read_at",null).select("id");
 if(error) fail("Unable to mark alert as read");
 if(!data?.length) fail("Alert already handled or unavailable");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Arrival notification acknowledged"));
}

export async function submitCantonFeedback(f:FormData){
 assertCantonLive();
 const token=field(f,"token"),rating=Number(field(f,"rating"));
 if(!/^[0-9a-f-]{36}$/i.test(token)||!Number.isInteger(rating)||rating<1||rating>5)
  redirect("/canton-feedback?error=invalid");
 const db=createAdminClient();
 const {data:visit}=await db.from("canton_appointments").select("id,status")
  .eq("feedback_token",token).maybeSingle();
 if(!visit||visit.status!=="completed") redirect("/canton-feedback/"+encodeURIComponent(token)+"?error=unavailable");
 const welcome=field(f,"welcome"),expectations=field(f,"expectations");
 if(welcome&&!["very_satisfied","satisfied","neutral","dissatisfied"].includes(welcome))
  redirect("/canton-feedback/"+encodeURIComponent(token)+"?error=invalid");
 if(expectations&&!["yes","partially","no"].includes(expectations))
  redirect("/canton-feedback/"+encodeURIComponent(token)+"?error=invalid");
 const contactRequested=field(f,"contact")==="yes";
 const comment=field(f,"comment",1200)||null;
 const {data:feedback,error}=await db.from("canton_visit_feedback").insert({
  appointment_id:visit.id,rating,
  welcome_rating:welcome||null,expectations:expectations||null,
  contact_requested:contactRequested,
  comment
 }).select("id").single();
 if(error||!feedback?.id) redirect("/canton-feedback/"+encodeURIComponent(token)+"?error=already-submitted");

 await syncCantonFeedbackToCrm({
  appointmentId:visit.id,
  feedbackId:feedback.id,
  rating,
  contactRequested,
  comment
 });
 redirect("/canton-feedback/"+encodeURIComponent(token)+"?success=1");
}

export async function createVisitorSite(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,role}=await context();
 if(!seniorRoles.has(role)) fail("Only administrators can manage visitor sites");
 const name=field(f,"name",180), code=field(f,"code",40).toUpperCase().replace(/[^A-Z0-9_]/g,"_");
 const city=field(f,"city",120)||null, countryCode=field(f,"countryCode",2).toUpperCase()||null;
 const timezone=field(f,"timezone",80), streetAddress=field(f,"streetAddress",300)||null;
 if(name.length<2||code.length<2||!timezone) fail("Name, code and timezone are required");
 const {error}=await db.from("visitor_sites").insert({
  organization_id:org,code,name,city,country_code:countryCode,timezone,street_address:streetAddress,is_hq:false,is_active:true
 });
 if(error) fail(error.code==="23505"?"A visitor site with this code already exists":"Could not create visitor site");
 revalidatePath("/canton/admin");
 redirect(withMessage(returnTo,"success","Visitor site created"));
}

export async function updateVisitorSite(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,role}=await context();
 if(!seniorRoles.has(role)) fail("Only administrators can manage visitor sites");
 const id=field(f,"siteId",40), operation=field(f,"operation",30);
 if(!/^[0-9a-f-]{36}$/i.test(id)) fail("Invalid visitor site");
 const {data:site}=await db.from("visitor_sites").select("id,is_hq,is_active").eq("id",id).eq("organization_id",org).maybeSingle();
 const currentSite={id:site?.id||"",is_hq:!!site?.is_hq,is_active:!!site?.is_active};
 if(!currentSite.id) fail("Visitor site not found");
 if(operation==="save"){
  const name=field(f,"name",180), city=field(f,"city",120)||null, countryCode=field(f,"countryCode",2).toUpperCase()||null;
  const timezone=field(f,"timezone",80), streetAddress=field(f,"streetAddress",300)||null;
  if(name.length<2||!timezone) fail("Name and timezone are required");
  const {error}=await db.from("visitor_sites").update({name,city,country_code:countryCode,timezone,street_address:streetAddress,updated_at:new Date().toISOString()}).eq("id",id).eq("organization_id",org);
  if(error) fail("Could not update visitor site");
 }else if(operation==="toggle"){
  if(currentSite.is_hq&&currentSite.is_active) fail("The HQ cannot be disabled. Assign another HQ first");
  const {error}=await db.from("visitor_sites").update({is_active:!currentSite.is_active,updated_at:new Date().toISOString()}).eq("id",id).eq("organization_id",org);
  if(error) fail("Could not update visitor site status");
 }else if(operation==="make_hq"){
  if(currentSite.is_hq) redirect(withMessage(returnTo,"success","This site is already HQ"));
  const {error:clearError}=await db.from("visitor_sites").update({is_hq:false,updated_at:new Date().toISOString()}).eq("organization_id",org).eq("is_hq",true);
  if(clearError) fail("Could not change HQ");
  const {error}=await db.from("visitor_sites").update({is_hq:true,is_active:true,updated_at:new Date().toISOString()}).eq("id",id).eq("organization_id",org);
  if(error) fail("Could not assign new HQ");
 }else fail("Invalid site operation");
 revalidatePath("/canton/admin");
 revalidatePath("/canton");
 redirect(withMessage(returnTo,"success","Visitor site updated"));
}

export async function manageVisitorSiteStaff(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,role}=await context();
 if(!seniorRoles.has(role)) fail("Only administrators can manage site staff");
 const siteId=field(f,"siteId",40), userId=field(f,"userId",40), accessRole=field(f,"accessRole",20), operation=field(f,"operation",20);
 if(!/^[0-9a-f-]{36}$/i.test(siteId)||!/^[0-9a-f-]{36}$/i.test(userId)) fail("Invalid site or staff member");
 if(!["reception","host","manager"].includes(accessRole)) fail("Invalid site access role");
 const {data:site}=await db.from("visitor_sites").select("id").eq("id",siteId).eq("organization_id",org).eq("is_active",true).maybeSingle();
 const {data:member}=await db.from("organization_members").select("user_id").eq("organization_id",org).eq("user_id",userId).eq("is_active",true).maybeSingle();
 if(!site||!member) fail("Site or staff member is not active");
 if(operation==="grant"){
  const {error}=await db.from("visitor_site_staff").upsert({site_id:siteId,user_id:userId,access_role:accessRole,is_active:true},{onConflict:"site_id,user_id"});
  if(error) fail("Could not assign site staff");
 }else if(operation==="revoke"){
  const {error}=await db.from("visitor_site_staff").delete().eq("site_id",siteId).eq("user_id",userId);
  if(error) fail("Could not remove site staff");
 }else fail("Invalid operation");
 revalidatePath("/canton/admin");
 redirect(withMessage(returnTo,"success","Site staff updated"));
}


export async function bulkManageVisitorSiteStaff(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,role}=await context();
 if(!seniorRoles.has(role)) fail("Only administrators can manage site staff");
 const siteId=field(f,"siteId",40), accessRole=field(f,"accessRole",20), operation=field(f,"operation",20);
 const userIds=[...new Set(f.getAll("userIds").map(v=>String(v)).filter(v=>/^[0-9a-f-]{36}$/i.test(v)))].slice(0,500);
 if(!/^[0-9a-f-]{36}$/i.test(siteId)||!userIds.length) fail("Select at least one valid staff member");
 if(!["reception","host","manager"].includes(accessRole)) fail("Invalid site access role");
 const {data:site}=await db.from("visitor_sites").select("id").eq("id",siteId).eq("organization_id",org).eq("is_active",true).maybeSingle();
 if(!site) fail("Visitor site not found or inactive");
 const {data:activeMembers}=await db.from("organization_members").select("user_id")
  .eq("organization_id",org).eq("is_active",true).in("user_id",userIds);
 const activeIds=[...new Set((activeMembers||[]).map(m=>m.user_id))];
 if(!activeIds.length) fail("No active organization members selected");
 if(operation==="grant"){
  const rows=activeIds.map(user_id=>({site_id:siteId,user_id,access_role:accessRole,is_active:true}));
  const {error}=await db.from("visitor_site_staff").upsert(rows,{onConflict:"site_id,user_id"});
  if(error) fail("Could not assign selected site staff");
 }else if(operation==="revoke"){
  const {error}=await db.from("visitor_site_staff").delete().eq("site_id",siteId).in("user_id",activeIds);
  if(error) fail("Could not remove selected site staff");
 }else fail("Invalid bulk operation");
 revalidatePath("/canton/admin");
 redirect(withMessage(returnTo,"success","Site staff updated in bulk"));
}

export async function assignVisitorTeamToSite(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,role}=await context();
 if(!seniorRoles.has(role)) fail("Only administrators can manage site staff");
 const siteId=field(f,"siteId",40),teamId=field(f,"teamId",40),accessRole=field(f,"accessRole",20);
 if(!/^[0-9a-f-]{36}$/i.test(siteId)||!/^[0-9a-f-]{36}$/i.test(teamId)) fail("Invalid site or team");
 if(!["reception","host","manager"].includes(accessRole)) fail("Invalid site access role");
 const {data:site}=await db.from("visitor_sites").select("id").eq("id",siteId).eq("organization_id",org).eq("is_active",true).maybeSingle();
 const {data:team}=await db.from("teams").select("id").eq("id",teamId).eq("organization_id",org).eq("is_active",true).maybeSingle();
 if(!site||!team) fail("Site or team is not active");
 const {data:teamMembers}=await db.from("team_members").select("user_id").eq("team_id",teamId);
 const ids=[...new Set((teamMembers||[]).map(m=>m.user_id))];
 if(!ids.length) fail("This team has no members");
 const {data:activeMembers}=await db.from("organization_members").select("user_id")
  .eq("organization_id",org).eq("is_active",true).in("user_id",ids);
 const activeIds=[...new Set((activeMembers||[]).map(m=>m.user_id))];
 if(!activeIds.length) fail("This team has no active organization members");
 const rows=activeIds.map(user_id=>({site_id:siteId,user_id,access_role:accessRole,is_active:true}));
 const {error}=await db.from("visitor_site_staff").upsert(rows,{onConflict:"site_id,user_id"});
 if(error) fail("Could not assign team to visitor site");
 revalidatePath("/canton/admin");
 redirect(withMessage(returnTo,"success","Team assigned to visitor site"));
}

export async function manageCantonReceptionStaff(f:FormData) {
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
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
 redirect(withMessage(returnTo,"success","Reception access updated"));
}

export async function qualifyCantonLegacyProspect(f:FormData){
 assertCantonLive();
 const {db,org,user,role}=await context();
 const id=field(f,"id",40);
 const interest=field(f,"interest",30);
 const allowed=["hot","warm","cold","non_commercial"];
 if(!/^[0-9a-f-]{36}$/i.test(id)||!allowed.includes(interest)) fail("Select a valid prospect qualification");
 const {data:visit}=await db.from("canton_appointments")
  .select("id,status,department,host_user_id,announced_by,follow_up_owner_id,follow_up_outcome,follow_up_status,commercial_interest")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!visit) fail("Visit not found");
 const legacyVisit=visit!;
 if(legacyVisit.status!=="completed"||!["DIG","TCF"].includes(legacyVisit.department)) fail("Only completed DIG/TCF visits can be qualified");
 if(!legacyVisit.follow_up_outcome&&legacyVisit.follow_up_status!=="completed") fail("This legacy visit has no commercial result to qualify");
 const canQualify=seniorRoles.has(role)||role==="manager"||legacyVisit.host_user_id===user.id||legacyVisit.follow_up_owner_id===user.id||legacyVisit.announced_by===user.id;
 if(!canQualify) fail("Only the visit owner, commercial owner or manager can qualify this prospect");
 if(legacyVisit.commercial_interest) fail("This prospect is already qualified");
 const {data:changed,error}=await db.from("canton_appointments").update({
  commercial_interest:interest,
  commercial_qualified_at:new Date().toISOString(),
  commercial_qualified_by:user.id,
  updated_at:new Date().toISOString()
 }).eq("id",id).eq("organization_id",org).is("commercial_interest",null).select("id");
 if(error||!changed?.length) fail("Could not save prospect qualification");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Prospect qualification saved"));
}

export async function saveCantonVisitDebrief(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,user,role}=await context();
 const id=field(f,"id",40);
 const interest=field(f,"interest",30);
 const outcome=field(f,"outcome",40);
 const note=field(f,"note",1200);
 const nextAction=field(f,"nextAction",800);
 const dueDate=field(f,"dueDate",10);
 const allowedInterest=["hot","warm","cold","non_commercial"];
 const allowedOutcome=["information_only","follow_up_requested","proposal_requested","next_appointment","ready_to_buy","not_interested","other"];
 if(!/^[0-9a-f-]{36}$/i.test(id)) fail("Invalid visit");
 if(!allowedInterest.includes(interest)||!allowedOutcome.includes(outcome)||note.length<5) fail("Complete the visit debrief");
 const {data:visit}=await db.from("canton_appointments")
  .select("id,visitor_id,status,department,host_user_id,announced_by,debriefed_at,visit_origin,crm_referred_by")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!visit) fail("Visit not found");
 const debriefVisit=visit!;
 if(debriefVisit.status!=="completed") fail("Complete the visit before debriefing");
 if(!["DIG","TCF"].includes(debriefVisit.department)) fail("Commercial debrief is only required for DIG or TCF visits");
 const isSenior=seniorRoles.has(role);
 const isHost=debriefVisit.host_user_id===user.id;
 const isCreator=debriefVisit.announced_by===user.id;
 if(!isSenior&&role!=="manager"&&!isHost&&!isCreator) fail("Only the visit owner, host or manager can submit the debrief");
 if(debriefVisit.debriefed_at) fail("This visit already has a debrief");
 const {data:changed,error}=await db.from("canton_appointments").update({
  commercial_interest:interest,
  commercial_qualified_at:new Date().toISOString(),
  commercial_qualified_by:user.id,
  visit_outcome:outcome,
  debrief_note:note,
  debriefed_by:user.id,
  debriefed_at:new Date().toISOString(),
  follow_up_required:interest!=="non_commercial"&&outcome!=="not_interested",
  updated_at:new Date().toISOString()
 }).eq("id",id).eq("organization_id",org).is("debriefed_at",null).select("id,host_user_id");
 if(error||!changed?.length) fail("Could not save the visit debrief");
 let cantonNextActionAssignee:string|null=null;
 if(nextAction||dueDate){
  if(nextAction.length<5||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate+"T12:00:00Z"))) fail("Next action and valid due date are both required");
  cantonNextActionAssignee=debriefVisit.host_user_id||user.id;
  const {error:nextError}=await db.from("canton_next_actions").insert({
   organization_id:org,appointment_id:id,assigned_to:cantonNextActionAssignee,
   action_text:nextAction,due_date:dueDate,created_by:user.id
  });
  if(nextError) fail("Debrief saved, but next action could not be scheduled");
 }

 const {data:visitorLink}=await db.from("canton_visitors").select("crm_client_id")
  .eq("id",debriefVisit.visitor_id).eq("organization_id",org).maybeSingle();
 const crmClientId=visitorLink?.crm_client_id||null;
 if(crmClientId){
  const outcomeMap:Record<string,string>={
   information_only:"resolved",
   follow_up_requested:"follow_up",
   proposal_requested:"follow_up",
   next_appointment:"follow_up",
   ready_to_buy:"follow_up",
   not_interested:"other",
   other:"other"
  };
  const interestLabel=interest==="hot"?"Hot":interest==="warm"?"Warm":interest==="cold"?"Cold":"Non-commercial";
  const summary="Canton visit completed · "+debriefVisit.department+" · Interest: "+interestLabel+" · Outcome: "+outcome+" · "+note;
  const nextFollowUpAt=dueDate?new Date(dueDate+"T18:00:00Z").toISOString():null;
  const {data:interaction,error:crmInteractionError}=await db.from("crm_interactions").insert({
   organization_id:org,
   client_id:crmClientId,
   employee_id:user.id,
   channel:"meeting",
   direction:"inbound",
   interaction_type:"sales",
   outcome:outcomeMap[outcome]||"other",
   summary,
   occurred_at:new Date().toISOString(),
   next_follow_up_at:nextFollowUpAt,
   feedback_requested:false,
   created_by:user.id
  }).select("id").single();
  if(crmInteractionError||!interaction) fail("Debrief saved, but CRM history could not be updated");
  const crmInteraction=interaction!;
  if(nextAction&&dueDate){
   const crmAssignedTo=debriefVisit.crm_referred_by||cantonNextActionAssignee||user.id;
   const priority=interest==="hot"?"urgent":interest==="warm"?"high":"normal";
   const {error:crmTaskError}=await db.from("crm_follow_up_tasks").insert({
    organization_id:org,
    client_id:crmClientId,
    interaction_id:crmInteraction.id,
    assigned_to:crmAssignedTo,
    title:"Canton follow-up · "+nextAction.slice(0,120),
    description:"Created automatically from Canton visit debrief.",
    due_at:new Date(dueDate+"T18:00:00Z").toISOString(),
    priority,
    status:"todo",
    created_by:user.id
   });
   if(crmTaskError) fail("Debrief and CRM history saved, but CRM follow-up task could not be created");
  }
 }
 revalidatePath(route);
 redirect(withMessage(returnTo,"success",crmClientId?"Visit debrief saved and synchronized to CRM":"Visit debrief saved"));
}

export async function assignCantonFollowUp(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
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
  follow_up_note:note||null,follow_up_due_date:dueDate,follow_up_completed_at:null,
  follow_up_outcome:null,follow_up_result_note:null,follow_up_completed_by:null,
  updated_at:new Date().toISOString()
 }).eq("id",id).eq("organization_id",org).eq("status","completed").select("id");
 if(error||!changed?.length)fail("Could not assign follow-up");
 revalidatePath(route);redirect(withMessage(returnTo,"success","Follow-up assigned"));
}
export async function completeCantonFollowUp(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,user,role}=await context();
 const id=field(f,"id",40);
 const outcome=field(f,"outcome",40);
 const resultNote=field(f,"resultNote",1000);
 const allowed=["contacted","appointment_scheduled","proposal_sent","sale_closed","no_response","not_interested","other"];
 if(!/^[0-9a-f-]{36}$/i.test(id))fail("Invalid follow-up");
 if(!allowed.includes(outcome))fail("Select a follow-up outcome before closing");
 if(resultNote.length<5)fail("Describe the concrete result (at least 5 characters)");
 const {data:row}=await db.from("canton_appointments").select("id,department,follow_up_owner_id,follow_up_status")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!row||row.follow_up_status!=="open")throw new Error("Follow-up is not open");
 if(row.department==="DIRECTION"&&!seniorRoles.has(role))fail("Confidential visit");
 if(!seniorRoles.has(role)&&role!=="manager"&&row.follow_up_owner_id!==user.id)fail("Only the follow-up owner or a manager may close");
 const {data:changed,error}=await db.from("canton_appointments").update({
  follow_up_status:"completed",follow_up_completed_at:new Date().toISOString(),
  follow_up_outcome:outcome,follow_up_result_note:resultNote,follow_up_completed_by:user.id,
  updated_at:new Date().toISOString()
 }).eq("id",id).eq("organization_id",org).eq("follow_up_status","open").select("id");
 if(error||!changed?.length)fail("Follow-up changed, refresh");
 revalidatePath(route);redirect(withMessage(returnTo,"success","Follow-up result recorded and closed"));
}


/** Continue commercial action after an initial result (QA only). No outbound message is sent. */
export async function createCantonNextAction(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,user,role}=await context();
 const appointmentId=field(f,"appointmentId",40);
 const actionText=field(f,"actionText",800);
 const dueDate=field(f,"dueDate",10);
 if(!/^[0-9a-f-]{36}$/i.test(appointmentId)||actionText.length<5||
    !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate+"T12:00:00Z")))
  fail("Valid next action and due date required");
 const {data:visit}=await db.from("canton_appointments")
  .select("id,status,department,follow_up_owner_id,follow_up_status,follow_up_outcome")
  .eq("id",appointmentId).eq("organization_id",org).maybeSingle();
 if(!visit||visit.status!=="completed"||visit.follow_up_status!=="completed"||!visit.follow_up_outcome||!visit.follow_up_owner_id)
  throw new Error("Complete the initial commercial follow-up first");
 if(!["DIG","TCF"].includes(visit.department))fail("Next actions available for DIG / TCF");
 if(!seniorRoles.has(role)&&role!=="manager"&&visit.follow_up_owner_id!==user.id)
  fail("Only the assigned commercial or manager may plan the next action");
 const {count,error:countError}=await db.from("canton_next_actions")
  .select("id",{head:true,count:"exact"}).eq("organization_id",org)
  .eq("appointment_id",appointmentId).eq("status","open");
 if(countError)fail("Could not check next action");
 if((count??0)>0)fail("An open next action already exists for this visit");
 const {error}=await db.from("canton_next_actions").insert({
  organization_id:org,appointment_id:appointmentId,assigned_to:visit.follow_up_owner_id,
  action_text:actionText,due_date:dueDate,created_by:user.id
 });
 if(error)fail("Could not save next action");
 revalidatePath(route);redirect(withMessage(returnTo,"success","Next commercial action scheduled"));
}
export async function reassignCantonNextAction(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const reassignFail=(message:string):never=>redirect(withMessage(returnTo,"error",message));
 const {db,org,user,role}=await context();
 if(!["owner","admin","manager"].includes(role)) reassignFail("Manager permission required to reassign an action");
 const actionId=field(f,"actionId",40);
 const assignedTo=field(f,"assignedTo",40);
 const reason=field(f,"reason",500);
 if(!/^[0-9a-f-]{36}$/i.test(actionId)||!/^[0-9a-f-]{36}$/i.test(assignedTo)) reassignFail("Invalid action or assignee");
 if(reason.length<5) reassignFail("Please add a reassignment reason of at least 5 characters");
 const {data:action}=await db.from("canton_next_actions")
  .select("id,assigned_to,appointment_id,status").eq("id",actionId)
  .eq("organization_id",org).maybeSingle();
 if(!action||action.status!=="open") return reassignFail("This next action is no longer open");
 const openAction=action;
 if(openAction.assigned_to===assignedTo) reassignFail("Select a different team member");
 const {data:member}=await db.from("organization_members").select("user_id")
  .eq("organization_id",org).eq("user_id",assignedTo).eq("is_active",true).maybeSingle();
 if(!member) reassignFail("The new assignee must be an active organization member");
 const {data:visit}=await db.from("canton_appointments").select("department,site_id")
  .eq("organization_id",org).eq("id",openAction.appointment_id).maybeSingle();
 if(!visit||!["DIG","TCF"].includes(visit.department)) return reassignFail("Only DIG / TCF commercial actions can be reassigned here");
 const commercialVisit=visit;
 if(!commercialVisit.site_id) return reassignFail("This visit has no active Canton site");
 const {data:siteAssignee}=await db.from("visitor_site_staff").select("user_id")
  .eq("organization_id",org).eq("site_id",commercialVisit.site_id).eq("user_id",assignedTo).eq("is_active",true).maybeSingle();
 if(!siteAssignee) reassignFail("The new assignee must belong to the same Canton site team");
 const {error}=await db.rpc("canton_reassign_next_action",{
  p_organization_id:org,
  p_action_id:actionId,
  p_new_assigned_to:assignedTo,
  p_reassigned_by:user.id,
  p_reason:reason
 });
 if(error) reassignFail("Could not reassign next action");
 revalidatePath(route);
 redirect(withMessage(returnTo,"success","Next commercial action reassigned"));
}
export async function completeCantonNextAction(f:FormData){
 assertCantonLive();
 const returnTo=safeCantonReturn(field(f,"returnTo",500));
 const {db,org,user,role}=await context();
 const id=field(f,"actionId",40);
 const completionNote=field(f,"completionNote",1000);
 if(!/^[0-9a-f-]{36}$/i.test(id)||completionNote.length<5)
  fail("A completion note of at least 5 characters is required");
 const {data:action}=await db.from("canton_next_actions")
  .select("id,assigned_to,appointment_id,status").eq("id",id)
  .eq("organization_id",org).maybeSingle();
 if(!action||action.status!=="open")throw new Error("Next action is not open");
 if(!seniorRoles.has(role)&&role!=="manager"&&action.assigned_to!==user.id)
  fail("Only the assigned employee or manager may close this action");
 const {data:visit}=await db.from("canton_appointments").select("department")
  .eq("organization_id",org).eq("id",action.appointment_id).maybeSingle();
 if(!visit||!["DIG","TCF"].includes(visit.department))throw new Error("Not a commercial action");
 const {data:changed,error}=await db.from("canton_next_actions")
  .update({status:"completed",completion_note:completionNote,completed_at:new Date().toISOString(),completed_by:user.id})
  .eq("id",id).eq("organization_id",org).eq("status","open").select("id");
 if(error||!changed?.length)fail("Action already updated, refresh");
 revalidatePath(route);redirect(withMessage(returnTo,"success","Next action completed"));
}

export async function createCantonSlaRecovery(f:FormData){
 assertCantonLive();
 const {db,org,user,role}=await context();
 if(!["owner","admin","manager"].includes(role)) fail("Manager permission required");
 const appointmentId=field(f,"appointmentId",40);
 const assignedTo=field(f,"assignedTo",40);
 const actionText=field(f,"actionText",800);
 const dueDate=field(f,"dueDate",10);
 if(!/^[0-9a-f-]{36}$/i.test(appointmentId)||!/^[0-9a-f-]{36}$/i.test(assignedTo)||actionText.length<5||!/^d{4}-d{2}-d{2}$/.test(dueDate))
  fail("Valid recovery action, owner and due date required");
 const {data:member}=await db.from("organization_members").select("user_id")
  .eq("organization_id",org).eq("user_id",assignedTo).eq("is_active",true).maybeSingle();
 if(!member) fail("Recovery owner must be an active organization member");
 const {data:visit}=await db.from("canton_appointments")
  .select("id,status,department,commercial_interest,commercial_qualified_at")
  .eq("id",appointmentId).eq("organization_id",org).maybeSingle();
 if(!visit) fail("Visit not found");
 const recoveryVisit=visit!;
 if(recoveryVisit.status!=="completed"||!["DIG","TCF"].includes(recoveryVisit.department)||!["hot","warm","cold"].includes(recoveryVisit.commercial_interest||""))
  fail("Only qualified completed DIG/TCF visits can receive a recovery plan");
 const qualifiedAt=recoveryVisit.commercial_qualified_at;
 if(!qualifiedAt) fail("Commercial qualification timestamp missing");
 const slaHours=recoveryVisit.commercial_interest==="hot"?24:recoveryVisit.commercial_interest==="warm"?72:168;
 if(Date.now()<=Date.parse(qualifiedAt)+slaHours*60*60*1000) fail("SLA has not been breached yet");
 const {error}=await db.from("canton_sla_recoveries").insert({
  organization_id:org,appointment_id:appointmentId,assigned_to:assignedTo,created_by:user.id,
  action_text:actionText,due_date:dueDate
 });
 if(error?.code==="23505") fail("An open recovery plan already exists for this prospect");
 if(error) fail("Could not create recovery plan");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("SLA recovery plan assigned"));
}

export async function completeCantonSlaRecovery(f:FormData){
 assertCantonLive();
 const {db,org,user,role}=await context();
 const id=field(f,"recoveryId",40);
 const completionNote=field(f,"completionNote",1000);
 if(!/^[0-9a-f-]{36}$/i.test(id)||completionNote.length<5) fail("Completion note required");
 const {data:recovery}=await db.from("canton_sla_recoveries")
  .select("id,assigned_to,status").eq("id",id).eq("organization_id",org).maybeSingle();
 if(!recovery) fail("Recovery plan not found");
 const recoveryRow=recovery!;
 if(recoveryRow.status!=="open") fail("Recovery plan is not open");
 if(!seniorRoles.has(role)&&role!=="manager"&&recoveryRow.assigned_to!==user.id) fail("Only the assigned employee or manager may close this recovery plan");
 const {data:changed,error}=await db.from("canton_sla_recoveries").update({
  status:"completed",completed_at:new Date().toISOString(),completed_by:user.id,completion_note:completionNote
 }).eq("id",id).eq("organization_id",org).eq("status","open").select("id");
 if(error||!changed?.length) fail("Recovery plan already updated, refresh");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("SLA recovery plan completed"));
}

/** QA ONLY: simulate due invitations; never call email or WhatsApp providers. */
export async function simulateCantonFeedbackInvitations(f:FormData){
 assertCantonLive();
 const {db,org,role}=await context();
 if(!["owner","admin","manager"].includes(role))fail("Manager permission required");
 const limit=Math.max(1,Math.min(20,Number(field(f,"limit",3))||20));
 const {data,error}=await db.rpc("canton_simulate_feedback_invitations",{p_organization_id:org,p_limit:limit});
 if(error)fail("Invitation simulation could not run");
 const item=Array.isArray(data)?data[0]:null;
 if(!item)fail("No simulation result");
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("Simulation only — "+item.simulated+" prepared; "+item.cancelled+" cancelled; 0 external messages sent"));
}

/** Admin-only manual QA email dispatch. Real sending remains disabled unless explicit
 * QA allowlist + CANTON_QA_EMAIL_TEST_ENABLED are configured on the isolated preview. */
export async function sendCantonQaEmailTest(f:FormData){
 assertCantonLive();
 const {role}=await context();
 if(!seniorRoles.has(role))fail("Administrator permission required for email test");
 const id=field(f,"id",40);
 if(!/^[0-9a-f-]{36}$/i.test(id))fail("Invalid visit");
 const result=await sendCantonQaFeedbackEmail(id);
 revalidatePath(route);
 redirect(route+"?success="+encodeURIComponent("QA email: "+result.outcome+" — "+result.detail));
}
