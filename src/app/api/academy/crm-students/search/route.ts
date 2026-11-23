import {NextResponse} from "next/server";
import {academyGlobalRoles,getAcademyAssignments} from "@/lib/academy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export async function GET(request:Request){
  const supabase=await createClient(),{data:auth}=await supabase.auth.getUser();
  if(!auth.user)return NextResponse.json({results:[]},{status:401});
  const admin=createAdminClient(),{data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership)return NextResponse.json({results:[]},{status:403});
  const assignments=await getAcademyAssignments(admin,membership.organization_id,auth.user.id),canEnroll=academyGlobalRoles.has(membership.role)||assignments.some(item=>["director","academic_coordinator"].includes(item.assignment_role));
  if(!canEnroll)return NextResponse.json({results:[]},{status:403});
  const raw=new URL(request.url).searchParams.get("q")?.trim()??"",term=raw.replace(/[,%_()]/g," ").replace(/\s+/g," ").slice(0,80);
  if(term.length<2)return NextResponse.json({results:[]});
  const pattern=`%${term}%`,{data,error}=await admin.from("crm_clients").select("id,full_name,email,phone,whatsapp_phone,reference,status,linked_user_id").eq("organization_id",membership.organization_id).or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},whatsapp_phone.ilike.${pattern},reference.ilike.${pattern}`).order("full_name").limit(12);
  if(error)return NextResponse.json({results:[],error:"Recherche temporairement indisponible."},{status:500});
  const clients=data??[],clientIds=clients.map(item=>String(item.id));
  const {data:links}=clientIds.length?await admin.from("person_identity_associations").select("primary_user_id,crm_client_id,related_user_id").eq("organization_id",membership.organization_id).eq("status","active").in("crm_client_id",clientIds):{data:[]};
  const clientByUser=new Map<string,string>();
  clients.forEach(item=>{if(item.linked_user_id)clientByUser.set(String(item.linked_user_id),String(item.id));});
  (links??[]).forEach(link=>{const clientId=String(link.crm_client_id);if(link.primary_user_id)clientByUser.set(String(link.primary_user_id),clientId);if(link.related_user_id)clientByUser.set(String(link.related_user_id),clientId);});
  const userIds=[...clientByUser.keys()],enrollmentQuery=admin.from("academy_school_enrollments").select("school_id,program_id,cohort_id,academic_status,crm_client_id,user_id").eq("organization_id",membership.organization_id);
  const {data:enrollments}=clientIds.length?await (userIds.length?enrollmentQuery.or(`crm_client_id.in.(${clientIds.join(",")}),user_id.in.(${userIds.join(",")})`):enrollmentQuery.in("crm_client_id",clientIds)):{data:[]};
  const enrollmentByClient=new Map<string,Array<{schoolId:string;programId:string|null;cohortId:string|null;status:string}>>();
  (enrollments??[]).forEach(row=>{const clientId=row.crm_client_id?String(row.crm_client_id):row.user_id?clientByUser.get(String(row.user_id)):undefined;if(!clientId)return;const list=enrollmentByClient.get(clientId)??[];if(!list.some(item=>item.schoolId===String(row.school_id)))list.push({schoolId:String(row.school_id),programId:row.program_id?String(row.program_id):null,cohortId:row.cohort_id?String(row.cohort_id):null,status:String(row.academic_status)});enrollmentByClient.set(clientId,list);});
  return NextResponse.json({results:clients.map(item=>({id:String(item.id),name:String(item.full_name),email:item.email?String(item.email):null,phone:item.phone?String(item.phone):item.whatsapp_phone?String(item.whatsapp_phone):null,reference:String(item.reference),status:String(item.status),enrollments:enrollmentByClient.get(String(item.id))??[]}))});
}
