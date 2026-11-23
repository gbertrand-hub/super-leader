"use server";
import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {canManageAmbassadors} from "@/lib/crm/ambassador-access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

function text(fd:FormData,key:string,max=3000){const v=String(fd.get(key)??"").trim();return v?v.slice(0,max):null}
function go(message:string,kind:"success"|"error"="success"):never{redirect(`/dashboard/crm/ambassadors?${kind}=${encodeURIComponent(message)}`)}
async function context(){const sb=await createClient();const {data}=await sb.auth.getUser();if(!data.user)redirect("/login");const admin=createAdminClient();const {data:m}=await admin.from("organization_members").select("organization_id,role").eq("user_id",data.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();if(!m)redirect("/dashboard/company");if(!(await canManageAmbassadors(admin,m.organization_id,data.user.id,m.role)))redirect("/dashboard/crm/prospects?error=access-denied");return{admin,user:data.user,m}}

export async function saveAmbassadorAction(fd:FormData){
 const {admin,user,m}=await context();const id=text(fd,"id",50);const fullName=text(fd,"fullName",200);const code=(text(fd,"code",50)||`AMB-${randomUUID().slice(0,6)}`).toUpperCase();const type="fixed";const amount=0;
 if(!fullName)go("Vérifie le nom de l’ambassadeur.","error");
 const values={code,full_name:fullName,email:text(fd,"email",200)?.toLowerCase(),phone:text(fd,"phone",50),whatsapp_phone:text(fd,"whatsappPhone",50),country_code:text(fd,"country",2),city:text(fd,"city",100),status:String(fd.get("status")??"active"),level_name:text(fd,"level",100),commission_type:type,commission_value:amount,currency:String(fd.get("currency")??"USD"),notes:text(fd,"notes"),joined_at:text(fd,"joinedAt",20)||new Date().toISOString().slice(0,10),updated_by:user.id,updated_at:new Date().toISOString()};
 const result=id?await admin.from("crm_ambassadors").update(values).eq("organization_id",m.organization_id).eq("id",id):await admin.from("crm_ambassadors").insert({...values,organization_id:m.organization_id,created_by:user.id}).select("id").single();
 if(result.error)go(result.error.message,"error");const ambassadorId=id||String(result.data?.id);await admin.from("crm_ambassador_audit_log").insert({organization_id:m.organization_id,ambassador_id:ambassadorId,actor_id:user.id,action:id?"ambassador_updated":"ambassador_created",details:{code,fields:Object.keys(values)}});revalidatePath("/dashboard/crm/ambassadors");revalidatePath("/dashboard/crm/prospects");go(id?"Informations de l’ambassadeur mises à jour.":"Ambassadeur enregistré.");
}

export async function calculateAmbassadorCommissionsAction(){
 const {admin,user,m}=await context();
 const [{data:payments,error:paymentsError},{data:sales,error:salesError},{data:clients,error:clientsError},{data:ambassadors,error:ambassadorsError},{data:existingCommissions,error:existingError}]=await Promise.all([
  admin.from("sales_payments").select("id,sale_id,amount,currency").eq("organization_id",m.organization_id).eq("status","confirmed").eq("is_initial_payment",true),
  admin.from("sales_records").select("id,customer_email,customer_phone,ambassador_id").eq("organization_id",m.organization_id),
  admin.from("crm_clients").select("id,email,phone,ambassador_id").eq("organization_id",m.organization_id).not("ambassador_id","is",null),
  admin.from("crm_ambassadors").select("id,commission_type,commission_value,currency").eq("organization_id",m.organization_id).eq("status","active"),
  admin.from("crm_ambassador_commissions").select("payment_id,ambassador_id").eq("organization_id",m.organization_id)]);
 const readError=paymentsError||salesError||clientsError||ambassadorsError||existingError;if(readError)go(`Calcul impossible : ${readError.message}`,"error");
 const ambassadorMap=new Map((ambassadors??[]).map(a=>[a.id,a]));const clientByContact=new Map<string,string>();for(const c of clients??[]){if(c.email)clientByContact.set(`e:${String(c.email).toLowerCase()}`,c.ambassador_id);if(c.phone)clientByContact.set(`p:${String(c.phone).replace(/\D/g,'')}`,c.ambassador_id)}const saleMap=new Map((sales??[]).map(s=>[s.id,s]));const existingKeys=new Set((existingCommissions??[]).map(c=>`${c.payment_id}:${c.ambassador_id}`));let created=0;let alreadyExisting=0;
 for(const payment of payments??[]){const sale=saleMap.get(payment.sale_id);if(!sale)continue;const ambassadorId=sale.ambassador_id||(sale.customer_email&&clientByContact.get(`e:${String(sale.customer_email).toLowerCase()}`))||(sale.customer_phone&&clientByContact.get(`p:${String(sale.customer_phone).replace(/\D/g,'')}`));const ambassador=ambassadorId?ambassadorMap.get(ambassadorId):null;if(!ambassador)continue;const key=`${payment.id}:${ambassador.id}`;if(existingKeys.has(key)){alreadyExisting++;continue}const commission=ambassador.commission_type==='percentage'?Number(payment.amount)*Number(ambassador.commission_value)/100:Number(ambassador.commission_value);const {error}=await admin.from("crm_ambassador_commissions").insert({organization_id:m.organization_id,ambassador_id:ambassador.id,sale_id:payment.sale_id,payment_id:payment.id,basis_amount:payment.amount,commission_type:ambassador.commission_type,commission_value:ambassador.commission_value,commission_amount:commission,currency:payment.currency,status:'pending'});if(error){if(error.code==='23505'){alreadyExisting++;existingKeys.add(key);continue}go(`Calcul impossible : ${error.message}`,"error")}created++;existingKeys.add(key)}
 await admin.from("crm_ambassador_audit_log").insert({organization_id:m.organization_id,actor_id:user.id,action:"commissions_calculated",details:{created,already_existing:alreadyExisting}});revalidatePath("/dashboard/crm/ambassadors");go(`${created} nouvelle(s) commission(s) créée(s) · ${alreadyExisting} déjà existante(s).`);
}

export async function reviewAmbassadorCommissionAction(fd:FormData){
 const {admin,user,m}=await context();const id=text(fd,"id",50);const decision=String(fd.get("decision")??"");
 if(!id||!['approved','rejected','paid'].includes(decision))go("Décision invalide.","error");
 const {data:commission,error:readError}=await admin.from("crm_ambassador_commissions").select("id,status").eq("organization_id",m.organization_id).eq("id",id).maybeSingle<{id:string;status:string}>();
 if(readError)go(readError.message,"error");if(!commission)go("Commission introuvable.","error");
 const allowed=commission.status==='pending'?(decision==='approved'||decision==='rejected'):(commission.status==='approved'&&decision==='paid');
 if(!allowed)go(`Transition refusée : ${commission.status} → ${decision}. Actualise la page avant de réessayer.`,"error");
 const paymentReference=decision==='paid'?text(fd,"paymentReference",200):null;if(decision==='paid'&&!paymentReference)go("La référence du paiement est obligatoire.","error");
 const now=new Date().toISOString();const values=decision==='paid'?{status:'paid',paid_by:user.id,paid_at:now,payment_reference:paymentReference}:{status:decision,reviewed_by:user.id,reviewed_at:now};
 const {data:updated,error}=await admin.from("crm_ambassador_commissions").update(values).eq("organization_id",m.organization_id).eq("id",id).eq("status",commission.status).select("id").maybeSingle();
 if(error)go(error.message,"error");if(!updated)go("Cette commission a déjà été traitée. Actualise la page.","error");
 const {error:auditError}=await admin.from("crm_ambassador_audit_log").insert({organization_id:m.organization_id,commission_id:id,actor_id:user.id,action:`commission_${decision}`,details:{from_status:commission.status,to_status:decision,payment_reference:paymentReference}});if(auditError)go(`Commission mise à jour, mais journalisation impossible : ${auditError.message}`,"error");
 revalidatePath("/dashboard/crm/ambassadors");go("Commission mise à jour.")
}
