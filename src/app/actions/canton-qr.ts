"use server";
import {assertCantonLive} from "@/lib/canton/feature-gate";
import {createHash} from "node:crypto";
import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createAdminClient} from "@/lib/supabase/admin";
import {syncCantonFeedbackToCrm} from "@/lib/canton/feedback-crm-sync";
import {createClient} from "@/lib/supabase/server";
const dash="/dashboard/canton-visitors";
const value=(f:FormData,key:string,max=200)=>String(f.get(key)??"").trim().slice(0,max);
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const safeStaffReturn=(raw:string,view:"admin"|"reception")=>{
 const fallback=dash+"?view="+view;
 if(!raw.startsWith(dash+"?")||raw.length>500) return fallback;
 const params=new URLSearchParams(raw.slice(dash.length+1));
 if(params.get("view")!==view)return fallback;
 const site=params.get("site")||"";
 if(site&&site!=="all"&&!uuid(site))return fallback;
 return fallback+(site?"&site="+encodeURIComponent(site):"");
};
const fail=(msg:string,back=dash):never=>redirect(back+(back.includes("?")?"&":"?")+"error="+encodeURIComponent(msg));
const success=(back:string,msg:string):never=>redirect(back+(back.includes("?")?"&":"?")+"success="+encodeURIComponent(msg));
async function staff(){
 const sb=await createClient();
 const {data:{user}}=await sb.auth.getUser();
 if(!user)redirect("/login");
 const db=createAdminClient();
 const {data:m}=await db.from("organization_members").select("role,organization_id").eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(!m) throw new Error("Access denied");
 const {data:assigned}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",m.organization_id).eq("user_id",user.id).maybeSingle();
 return {db,user,org:m.organization_id as string,role:m.role as string,canReview:["owner","admin","manager"].includes(m.role)||!!assigned};
}
export async function createCantonQrSite(f:FormData){
 assertCantonLive();
 const back=safeStaffReturn(value(f,"returnTo",500),"admin");
 const {db,user,org,role}=await staff();
 if(!["owner","admin"].includes(role))fail("Only administrators can create public QR sites",back);
 const label=value(f,"label",120);
 const streetAddress=value(f,"streetAddress",300).replace(/\s+/g," ").trim();
 const visitorSiteId=value(f,"visitorSiteId",40);
 if(label.length<3||!uuid(visitorSiteId))fail("Site name and operational site are required",back);
 const {data:visitorSite}=await db.from("visitor_sites")
  .select("id").eq("id",visitorSiteId).eq("organization_id",org).eq("is_active",true).maybeSingle();
 if(!visitorSite)fail("Operational visitor site is not active",back);
 const {error}=await db.from("canton_qr_sites").insert({
  organization_id:org,label,street_address:streetAddress||null,visitor_site_id:visitorSiteId,created_by:user.id
 });
 if(error)fail("Could not create site",back);
 revalidatePath(dash);success(back,"QR site created");
}
export async function updateCantonQrSiteAddress(f:FormData){
 assertCantonLive();
 const back=safeStaffReturn(value(f,"returnTo",500),"admin");
 const {db,org,role}=await staff();
 if(!["owner","admin"].includes(role))fail("Only administrators can edit office location",back);
 const site=value(f,"site",40);
 const streetAddress=value(f,"streetAddress",300).trim();
 if(!uuid(site)||streetAddress.length<8)fail("A valid office street address is required",back);
 const {data,error}=await db.from("canton_qr_sites")
 .update({street_address:streetAddress}).eq("id",site).eq("organization_id",org).select("id");
 if(error||!data?.length)fail("Office location could not be saved",back);
 revalidatePath(dash);
 success(back,"Office location saved");
}
export async function submitCantonQrIntake(f:FormData){
 assertCantonLive();
 const site=value(f,"site",40);
 const back="/canton-checkin?site="+encodeURIComponent(site);
 if(!uuid(site))redirect("/canton-checkin?error=invalid");
 if(value(f,"website",100))redirect(back+"&success=1"); // honeypot, no write
 const name=value(f,"fullName",180),email=value(f,"email",200).toLowerCase();
 const phone=value(f,"phone",40).replace(/[^0-9+]/g,"");
 const department=value(f,"department",20);
 const purpose=value(f,"purpose",100)||"other";
 if(name.length<2 || (!phone&&!email) || (email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !["DIG","TCF","OTHER"].includes(department)){
  redirect(back+"&error=invalid");
 }
 const db=createAdminClient();
 const {data:qrSite}=await db.from("canton_qr_sites").select("id,organization_id,enabled").eq("id",site).eq("enabled",true).maybeSingle();
 if(!qrSite)redirect(back+"&error=unavailable");
 const validatedSite=qrSite!;
 // Defense in depth; blocking check on the shared database, with a limited per-IP and per-contact time window.
 const h=await headers();
 const rawIp=(h.get("x-real-ip")||h.get("x-forwarded-for")?.split(",")[0]||"").trim();
 const key=process.env.CANTON_INTAKE_RATE_SECRET;
 if(!key || !rawIp)redirect(back+"&error=unavailable");
 const hash=createHash("sha256").update(key+"|"+rawIp).digest("hex");
 const since=new Date(Date.now()-60*60*1000).toISOString();
 const {count,error:countError}=await db.from("canton_intake_requests").select("id",{count:"exact",head:true})
  .eq("ip_hash",hash).gte("created_at",since);
 if(countError || (count??0)>=5)redirect(back+"&error=limit");
 let similar=db.from("canton_intake_requests").select("id",{count:"exact",head:true}).eq("site_id",site).gte("created_at",since).eq("status","pending");
 similar=email?similar.eq("email",email):similar.eq("phone",phone);
 const {count:duplicates,error:duplicateError}=await similar;
 if(duplicateError || (duplicates??0)>0)redirect(back+"&error=duplicate");
 const {error}=await db.from("canton_intake_requests").insert({
  organization_id:validatedSite.organization_id,site_id:validatedSite.id,full_name:name,email:email||null,phone:phone||null,
  department,purpose,ip_hash:hash,
 });
 if(error)redirect(back+"&error=unavailable");
 redirect(back+"&success=1");
}
export async function reviewCantonQrIntake(f:FormData){
 assertCantonLive();
 const back=safeStaffReturn(value(f,"returnTo",500),"reception");
 const {db,user,org,canReview}=await staff();
 if(!canReview)fail("Reception authorization required",back);
 const id=value(f,"id",40),decision=value(f,"decision",20);
 if(!uuid(id)||!["approve","reject"].includes(decision))fail("Invalid request",back);
 const {data:request}=await db.from("canton_intake_requests")
  .select("id,status,full_name,email,phone,department,purpose,organization_id")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!request || request.status!=="pending")throw new Error("Request already processed");
 // Keep QR self-registration as a request; approval never automatically creates a CRM sales lead.
 if(decision==="reject"){
  const {data:changed,error}=await db.from("canton_intake_requests").update({status:"rejected",reviewed_by:user.id,reviewed_at:new Date().toISOString()})
   .eq("id",id).eq("organization_id",org).eq("status","pending").select("id");
  if(error||!changed?.length)fail("Request changed, refresh",back);
 }else{
  const {data:visitId,error}=await db.rpc("canton_approve_qr_intake",{
   p_request_id:id,p_organization_id:org,p_actor_id:user.id
  });
  if(error||!visitId)fail("QR registration needs review: "+(error?.message||"Unknown database error").slice(0,140),back);
 }
 revalidatePath(dash);
 success(back,"QR request "+(decision==="approve"?"approved":"rejected"));
}
export async function submitCantonQrFeedback(f:FormData){
 assertCantonLive();
 const site=value(f,"site",40);
 const validSite=uuid(site);
 const back="/canton-feedback-qr"+(validSite?"?site="+encodeURIComponent(site):"");
 const join=back.includes("?")?"&":"?";
 if(!validSite)redirect(back+join+"error=unavailable");
 if(value(f,"website",100))redirect(back+join+"success=1");
 const mode=value(f,"mode",12);
 const rating=Number(value(f,"rating",2));
 if(!Number.isInteger(rating)||rating<1||rating>5||!["identified","anonymous"].includes(mode)){
  redirect(back+join+"error=invalid");
 }
 const secret=process.env.CANTON_INTAKE_RATE_SECRET;
 const hdr=await headers();
 const rawIp=(hdr.get("x-real-ip")||hdr.get("x-forwarded-for")?.split(",")[0]||"").trim();
 if(!secret||!rawIp)redirect(back+join+"error=unavailable");
 const db=createAdminClient();
 const ipHash=createHash("sha256").update(secret+"|feedback|"+rawIp).digest("hex");
 const {count:recent,error:rateError}=await db.from("canton_qr_feedback_attempts")
  .select("id",{count:"exact",head:true}).eq("ip_hash",ipHash)
  .gte("submitted_at",new Date(Date.now()-60*60*1000).toISOString());
 if(rateError||(recent??0)>=10)redirect(back+join+"error=limit");
 const {error:logError}=await db.from("canton_qr_feedback_attempts").insert({ip_hash:ipHash});
 if(logError)redirect(back+join+"error=unavailable");
 const comment=value(f,"comment",1000)||null;
 const {data:qrSite,error:siteError}=await db.from("canton_qr_sites")
  .select("id,organization_id,enabled").eq("id",site).eq("enabled",true).maybeSingle();
 if(siteError||!qrSite?.organization_id)redirect(back+join+"error=unavailable");
 const organizationId=qrSite.organization_id as string;
 if(mode==="anonymous"){
  const department=value(f,"department",20);
  if(!["DIG","TCF","OTHER"].includes(department))redirect(back+join+"error=invalid");
  const {error}=await db.from("canton_anonymous_feedback").insert({organization_id:organizationId,department,rating,comment});
  if(error)redirect(back+join+"error=unavailable");
  redirect(back+join+"success=1");
 }
 const name=value(f,"fullName",180).replace(/\\s+/g," ").toLowerCase();
 const last4=value(f,"last4",4);
 if(name.length<2||!/^[0-9]{4}$/.test(last4))redirect(back+join+"error=unavailable");
 const {data:candidates,error:matchError}=await db.rpc("canton_find_feedback_visit",{
  p_organization_id:organizationId,p_name:name,p_last4:last4
 });
 // No candidate visit details are ever returned to the visitor. Ambiguity always fails closed.
 let resolvedCandidates:Array<{appointment_id:string}> =
  !matchError&&Array.isArray(candidates)?candidates.filter(x=>uuid(x?.appointment_id||"")):[];

 // Defensive QA/runtime fallback: reproduce the same match server-side if PostgREST RPC
 // unexpectedly returns no usable row. This does not weaken identity matching.
 if(resolvedCandidates.length!==1){
  const since=new Date(Date.now()-7*24*60*60*1000).toISOString();
  const {data:recentVisits}=await db.from("canton_appointments")
   .select("id,visitor_id,check_out_at")
   .eq("organization_id",organizationId)
   .eq("status","completed")
   .not("check_out_at","is",null)
   .gte("check_out_at",since)
   .order("check_out_at",{ascending:false})
   .limit(100);
  const visitorIds=[...new Set((recentVisits||[]).map(v=>v.visitor_id).filter(Boolean))];
  const {data:recentVisitors}=visitorIds.length
   ? await db.from("canton_visitors").select("id,full_name,phone").eq("organization_id",organizationId).in("id",visitorIds)
   : {data:[] as Array<{id:string;full_name:string;phone:string|null}>};
  const {data:existingFeedback}=await db.from("canton_visit_feedback").select("appointment_id").in("appointment_id",(recentVisits||[]).map(v=>v.id));
  const feedbackIds=new Set((existingFeedback||[]).map(x=>x.appointment_id));
  const visitorById=new Map((recentVisitors||[]).map(v=>[v.id,v]));
  const normalizeName=(s:string)=>s.trim().replace(/\s+/g," ").toLowerCase();
  const digits=(s:string|null|undefined)=>String(s||"").replace(/[^0-9]/g,"");
  resolvedCandidates=(recentVisits||[]).filter(v=>{
   const person=visitorById.get(v.visitor_id);
   return !!person
    && !feedbackIds.has(v.id)
    && normalizeName(person.full_name)===name
    && digits(person.phone).slice(-4)===last4;
  }).slice(0,2).map(v=>({appointment_id:v.id}));
 }
 if(resolvedCandidates.length!==1)redirect(back+join+"error=unavailable");
 const visitId=resolvedCandidates[0]?.appointment_id;
 if(!uuid(visitId||""))redirect(back+join+"error=unavailable");
 const contactRequested=value(f,"contact",3)==="yes";
 const {data:feedback,error}=await db.from("canton_visit_feedback").insert({
  appointment_id:visitId,rating,
  contact_requested:contactRequested,comment
 }).select("id").single();
 if(error||!feedback?.id)redirect(back+join+"error=unavailable");

 await syncCantonFeedbackToCrm({
  appointmentId:visitId,
  feedbackId:feedback.id,
  rating,
  contactRequested,
  comment
 });
 redirect(back+join+"success=1");
}
