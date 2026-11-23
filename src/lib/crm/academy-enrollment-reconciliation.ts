import type {createAdminClient} from "@/lib/supabase/admin";

type AdminClient=ReturnType<typeof createAdminClient>;
type Mapping={product_id:string;school_id:string;program_id:string|null;cohort_id:string;academic_status:string};
type Sale={id:string;crm_client_id:string|null;product_id:string|null;sale_date:string;collection_owner_id:string|null};
type Client={id:string;linked_user_id:string|null};
type Enrollment={school_id:string;cohort_id:string|null;user_id:string|null;crm_client_id:string|null};
export type MissingSchoolEnrollment={saleId:string;clientId:string;userId:string|null;mapping:Mapping;saleDate:string;followUpUserId:string|null};

function chunks<T>(values:T[],size=300){const result:T[][]=[];for(let index=0;index<values.length;index+=size)result.push(values.slice(index,index+size));return result;}

async function confirmedSaleIds(admin:AdminClient,organizationId:string){
  const ids=new Set<string>();
  for(let from=0;;from+=1000){
    const {data,error}=await admin.from("sales_payments").select("id,sale_id").eq("organization_id",organizationId).eq("status","confirmed").order("id").range(from,from+999);
    if(error)throw new Error(error.message);
    for(const row of data??[])ids.add(String(row.sale_id));
    if((data??[]).length<1000)break;
  }
  return [...ids];
}

export async function findMissingSchoolEnrollments(admin:AdminClient,organizationId:string){
  const saleIds=await confirmedSaleIds(admin,organizationId);
  if(!saleIds.length)return [];
  const sales:Sale[]=[];
  for(const ids of chunks(saleIds)){
    const {data,error}=await admin.from("sales_records").select("id,crm_client_id,product_id,sale_date,collection_owner_id").eq("organization_id",organizationId).not("crm_client_id","is",null).not("product_id","is",null).in("id",ids);
    if(error)throw new Error(error.message);
    sales.push(...((data??[])as Sale[]));
  }
  const productIds=[...new Set(sales.map(sale=>sale.product_id).filter((id):id is string=>Boolean(id)))];
  const clientIds=[...new Set(sales.map(sale=>sale.crm_client_id).filter((id):id is string=>Boolean(id)))];
  const [mappingsResult,clientsResult,enrollmentsResult]=await Promise.all([
    productIds.length?admin.from("academy_sales_product_mappings").select("product_id,school_id,program_id,cohort_id,academic_status").eq("organization_id",organizationId).eq("is_active",true).in("product_id",productIds):Promise.resolve({data:[],error:null}),
    clientIds.length?admin.from("crm_clients").select("id,linked_user_id").eq("organization_id",organizationId).in("id",clientIds):Promise.resolve({data:[],error:null}),
    admin.from("academy_school_enrollments").select("school_id,cohort_id,user_id,crm_client_id").eq("organization_id",organizationId),
  ]);
  const error=mappingsResult.error||clientsResult.error||enrollmentsResult.error;if(error)throw new Error(error.message);
  const mappings=new Map(((mappingsResult.data??[])as Mapping[]).map(mapping=>[mapping.product_id,mapping]));
  const clients=new Map(((clientsResult.data??[])as Client[]).map(client=>[client.id,client]));
  const existing=new Set<string>();
  for(const enrollment of (enrollmentsResult.data??[])as Enrollment[]){
    const subject=enrollment.user_id?`user:${enrollment.user_id}`:enrollment.crm_client_id?`client:${enrollment.crm_client_id}`:"";
    if(subject)existing.add(`${subject}:${enrollment.school_id}:${enrollment.cohort_id??"none"}`);
  }
  const missing:MissingSchoolEnrollment[]=[],planned=new Set<string>();
  for(const sale of sales){
    if(!sale.crm_client_id||!sale.product_id)continue;
    const mapping=mappings.get(sale.product_id),client=clients.get(sale.crm_client_id);if(!mapping||!client)continue;
    const subject=client.linked_user_id?`user:${client.linked_user_id}`:`client:${client.id}`,key=`${subject}:${mapping.school_id}:${mapping.cohort_id}`;
    if(existing.has(key)||planned.has(key))continue;
    planned.add(key);missing.push({saleId:sale.id,clientId:client.id,userId:client.linked_user_id,mapping,saleDate:sale.sale_date,followUpUserId:sale.collection_owner_id});
  }
  return missing;
}

export async function regularizeMissingSchoolEnrollments(input:{admin:AdminClient;organizationId:string;actorId:string}){
  const candidates=await findMissingSchoolEnrollments(input.admin,input.organizationId);let created=0,skipped=0;
  for(const candidate of candidates){
    const {data:enrollment,error}=await input.admin.from("academy_school_enrollments").insert({
      organization_id:input.organizationId,school_id:candidate.mapping.school_id,program_id:candidate.mapping.program_id,cohort_id:candidate.mapping.cohort_id,
      user_id:candidate.userId,crm_client_id:candidate.userId?null:candidate.clientId,academic_status:candidate.mapping.academic_status,source:"crm_conversion",
      enrolled_on:candidate.saleDate,assigned_follow_up_user_id:candidate.followUpUserId,notes:`Inscription historique régularisée depuis la vente ${candidate.saleId}`,created_by:input.actorId,
    }).select("id").maybeSingle<{id:string}>();
    if(error){if(error.code==="23505"){skipped+=1;continue;}throw new Error(error.message);}
    if(!enrollment){skipped+=1;continue;}
    const {error:progressError}=await input.admin.from("academy_student_progress").upsert({organization_id:input.organizationId,enrollment_id:enrollment.id,training_status:"not_started",risk_level:"low",updated_by:input.actorId},{onConflict:"enrollment_id"});
    if(progressError)throw new Error(progressError.message);
    const {error:auditError}=await input.admin.from("crm_audit_log").insert({organization_id:input.organizationId,actor_id:input.actorId,entity_type:"academy_enrollment",entity_id:enrollment.id,action:"historical_paid_sale_enrollment_created",details:{saleId:candidate.saleId,clientId:candidate.clientId,schoolId:candidate.mapping.school_id,cohortId:candidate.mapping.cohort_id}});
    if(auditError)throw new Error(auditError.message);
    created+=1;
  }
  return {candidates:candidates.length,created,skipped,remaining:(await findMissingSchoolEnrollments(input.admin,input.organizationId)).length};
}
