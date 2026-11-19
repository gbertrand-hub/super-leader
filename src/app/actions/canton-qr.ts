"use server";
import {createHash} from "node:crypto";
import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
const dash="/dashboard/canton-visitors";
const value=(f:FormData,key:string,max=200)=>String(f.get(key)??"").trim().slice(0,max);
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fail=(msg:string):never=>redirect(dash+"?error="+encodeURIComponent(msg));
async function staff(){
 const sb=await createClient();
 const {data:{user}}=await sb.auth.getUser();
 if(!user)redirect("/login");
 const db=createAdminClient();
 const {data:m}=await db.from("organization_members").select("role,organization_id").eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(!m)fail("Access denied");
 const {data:assigned}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",m.organization_id).eq("user_id",user.id).maybeSingle();
 return {db,user,org:m.organization_id as string,role:m.role as string,canReview:["owner","admin","manager"].includes(m.role)||!!assigned};
}
export async function createCantonQrSite(f:FormData){
 const {db,user,org,role}=await staff();
 if(!["owner","admin"].includes(role))fail("Only administrators can create public QR sites");
 const label=value(f,"label",120);
 if(label.length<3)fail("Site name is required");
 const {error}=await db.from("canton_qr_sites").insert({organization_id:org,label,created_by:user.id});
 if(error)fail("Could not create site");
 revalidatePath(dash);redirect(dash+"?success=QR%20site%20created");
}
export async function submitCantonQrIntake(f:FormData){
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
  organization_id:qrSite.organization_id,site_id:qrSite.id,full_name:name,email:email||null,phone:phone||null,
  department,purpose,ip_hash:hash,
 });
 if(error)redirect(back+"&error=unavailable");
 redirect(back+"&success=1");
}
export async function reviewCantonQrIntake(f:FormData){
 const {db,user,org,canReview}=await staff();
 if(!canReview)fail("Reception authorization required");
 const id=value(f,"id",40),decision=value(f,"decision",20);
 if(!uuid(id)||!["approve","reject"].includes(decision))fail("Invalid request");
 const {data:request}=await db.from("canton_intake_requests")
  .select("id,status,full_name,email,phone,department,purpose,organization_id")
  .eq("id",id).eq("organization_id",org).maybeSingle();
 if(!request || request.status!=="pending")fail("Request already processed");
 // Keep QR self-registration as a request; approval never automatically creates a CRM sales lead.
 if(decision==="reject"){
  const {data:changed,error}=await db.from("canton_intake_requests").update({status:"rejected",reviewed_by:user.id,reviewed_at:new Date().toISOString()})
   .eq("id",id).eq("organization_id",org).eq("status","pending").select("id");
  if(error||!changed?.length)fail("Request changed, refresh");
 }else{
  const {data:visitId,error}=await db.rpc("canton_approve_qr_intake",{
   p_request_id:id,p_organization_id:org,p_actor_id:user.id
  });
  if(error||!visitId)fail("QR registration needs review: "+(error?.message||"Unknown database error").slice(0,140));
 }
 revalidatePath(dash);
 redirect(dash+"?success="+encodeURIComponent("QR request "+(decision==="approve"?"approved":"rejected")));
}
export async function submitCantonQrFeedback(f:FormData){
 const code=value(f,"code",16).toUpperCase();
 const back="/canton-feedback-qr?code="+encodeURIComponent(code);
 if(value(f,"website",100))redirect("/canton-feedback-qr?success=1");
 if(!/^[0-9A-F]{16}$/.test(code))redirect("/canton-feedback-qr?error=invalid");
 const rating=Number(value(f,"rating",1));
 if(!Number.isInteger(rating)||rating<1||rating>5)redirect(back+"&error=invalid");
 const db=createAdminClient();
 const {data:visit}=await db.from("canton_appointments").select("id,status,check_out_at")
  .eq("feedback_code",code).maybeSingle();
 if(!visit || visit.status!=="completed" || !visit.check_out_at)redirect(back+"&error=unavailable");
 if(Date.now()-new Date(visit.check_out_at).getTime()>30*86400000)redirect(back+"&error=expired");
 const {error}=await db.from("canton_visit_feedback").insert({
  appointment_id:visit.id,rating,contact_requested:value(f,"contact",3)==="yes",comment:value(f,"comment",1000)||null
 });
 if(error)redirect(back+"&error=already");
 redirect("/canton-feedback-qr?success=1");
}
