"use server";

import {revalidatePath} from "next/cache";
import {redirect, unstable_rethrow} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getSiteUrl} from "@/lib/supabase/env";
import type {User} from "@supabase/supabase-js";
import {promoteCrmClientForConfirmedSale, regularizePayingProspectCandidates} from "@/lib/crm/customer-lifecycle";
import {regularizeMissingSchoolEnrollments} from "@/lib/crm/academy-enrollment-reconciliation";

const allowedRoles = new Set(["owner", "admin", "executive"]);
const statuses = new Set(["candidate", "admitted", "enrolled", "active"]);

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function finish(message: string, type: "success" | "error" = "success"): never {
  redirect(`/dashboard/crm/identity-sync?${type}=${encodeURIComponent(message)}`);
}

function finishSearch(message:string,type:"success"|"error",q:string):never{
  redirect(`/dashboard/crm/identity-sync?q=${encodeURIComponent(q)}&${type}=${encodeURIComponent(message)}`);
}

async function findAuthUserByEmail(admin:ReturnType<typeof createAdminClient>,email:string):Promise<User|null>{
  const target=email.trim().toLowerCase();
  for(let page=1;page<=50;page+=1){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
    if(error)throw new Error(error.message);
    const found=data.users.find(user=>user.email?.trim().toLowerCase()===target);
    if(found)return found;
    if(data.users.length<200)break;
  }
  return null;
}

async function linkLearnerIdentity(args:{admin:ReturnType<typeof createAdminClient>;organizationId:string;actorId:string;clientId:string;userId:string;action:"account_invited"|"existing_account_linked"|"enrollments_synchronized"}){
  const {admin,organizationId,actorId,clientId,userId,action}=args;
  const {data:occupied}=await admin.from("crm_clients").select("id").eq("organization_id",organizationId).eq("linked_user_id",userId).neq("id",clientId).limit(1);
  if(occupied?.length)throw new Error("Ce compte utilisateur est déjà relié à un autre dossier CRM.");
  const now=new Date().toISOString();
  const {error:clientError}=await admin.from("crm_clients").update({linked_user_id:userId,updated_at:now}).eq("id",clientId).eq("organization_id",organizationId);
  if(clientError)throw new Error(clientError.message);
  const {data:enrollments,error:enrollmentError}=await admin.from("academy_school_enrollments").update({user_id:userId,updated_at:now}).eq("organization_id",organizationId).eq("crm_client_id",clientId).select("id");
  if(enrollmentError)throw new Error(enrollmentError.message);
  const {error:auditError}=await admin.from("academy_learner_identity_audit").insert({organization_id:organizationId,crm_client_id:clientId,user_id:userId,action,actor_id:actorId,details:{enrollments_synchronized:enrollments?.length??0}});
  if(auditError)throw new Error(auditError.message);
  return enrollments?.length??0;
}

async function context() {
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", auth.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if (!membership || !allowedRoles.has(membership.role)) redirect("/dashboard?error=access-denied");
  return {admin, user: auth.user, membership};
}

export async function regularizePayingProspectsAction(){
  const {admin,user,membership}=await context();
  const result=await regularizePayingProspectCandidates({admin,organizationId:membership.organization_id,actorId:user.id,source:"historical_regularization"});
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/crm/prospects");
  revalidatePath("/dashboard/crm");
  if(!result.promoted&&!result.linksRepaired&&!result.contractsCreated&&!result.salesReconciled)finish("Les clients payants, leurs ventes et leurs contrats CRM sont déjà cohérents.");
  finish(`${result.promoted} client(s) activé(s), ${result.linksRepaired} lien(s) vente-client réparé(s) et ${result.contractsCreated} achat(s) matérialisé(s) dans le dossier CRM. ${result.remaining} cas certain(s) restent à régulariser.`);
}

export async function regularizeHistoricalSchoolEnrollmentsAction(){
  const {admin,user,membership}=await context();
  const result=await regularizeMissingSchoolEnrollments({admin,organizationId:membership.organization_id,actorId:user.id});
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy");
  if(!result.candidates)finish("Toutes les ventes scolaires payées et identifiées possèdent déjà une inscription académique.");
  finish(`${result.created} inscription(s) académique(s) créée(s), ${result.skipped} doublon(s) évité(s), ${result.remaining} cas certain(s) restant(s). La Finance n’a pas été modifiée.`);
}

export async function saveAcademySalesMappingAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const productId = value(formData, "productId");
  const schoolId = value(formData, "schoolId");
  const programId = value(formData, "programId") || null;
  const cohortId = value(formData, "cohortId");
  const academicStatus = value(formData, "academicStatus");
  if (!productId || !schoolId || !cohortId || !statuses.has(academicStatus)) finish("Configuration incomplète.", "error");

  const [{data: product}, {data: school}, {data: cohort}, programResult] = await Promise.all([
    admin.from("sales_products").select("id").eq("id", productId).eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("academy_schools").select("id").eq("id", schoolId).eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("academy_cohorts").select("id,school_id,program_id").eq("id", cohortId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;school_id:string;program_id:string|null}>(),
    programId ? admin.from("academy_programs").select("id,school_id").eq("id", programId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;school_id:string}>() : Promise.resolve({data:null,error:null}),
  ]);
  if (!product || !school || !cohort || cohort.school_id !== schoolId || (programResult.data && programResult.data.school_id !== schoolId)) finish("Produit, école, programme ou cohorte incompatible.", "error");

  const {error} = await admin.from("academy_sales_product_mappings").upsert({
    organization_id: membership.organization_id,
    product_id: productId,
    school_id: schoolId,
    program_id: programId ?? cohort.program_id,
    cohort_id: cohortId,
    academic_status: academicStatus,
    is_active: true,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, {onConflict: "organization_id,product_id"});
  if (error) finish(`Configuration impossible : ${error.message}`, "error");

  await admin.from("sales_records").update({product_id: productId}).eq("organization_id", membership.organization_id).eq("product_id", productId).eq("workflow_status", "approved");
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/academy");
  finish("Produit relié à l’école. Les ventes approuvées ont été resynchronisées.");
}

export async function resolveCrmIdentityReviewAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const saleId = value(formData, "saleId");
  const clientId = value(formData, "clientId");
  const [{data: sale}, {data: client}] = await Promise.all([
    admin.from("sales_records").select("id").eq("id", saleId).eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("crm_clients").select("id").eq("id", clientId).eq("organization_id", membership.organization_id).maybeSingle(),
  ]);
  if (!sale || !client) finish("Vente ou dossier CRM introuvable.", "error");
  const {error} = await admin.from("sales_records").update({crm_client_id: clientId}).eq("id", saleId).eq("organization_id", membership.organization_id);
  if (error) finish(`Rapprochement impossible : ${error.message}`, "error");
  await promoteCrmClientForConfirmedSale({admin,organizationId:membership.organization_id,saleId,actorId:user.id,source:"manual_identity_resolution"});
  await admin.from("crm_identity_review_queue").update({status:"resolved",resolved_client_id:clientId,resolved_by:user.id,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("sale_id", saleId).eq("organization_id", membership.organization_id);
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/crm");
  finish("Identité rapprochée avec succès.");
}

export async function resolveAcademyCrmIdentityReviewAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const enrollmentId = value(formData, "enrollmentId");
  const clientId = value(formData, "clientId");
  const [{data: enrollment}, {data: client}] = await Promise.all([
    admin.from("academy_school_enrollments").select("id,user_id").eq("id", enrollmentId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;user_id:string|null}>(),
    admin.from("crm_clients").select("id,linked_user_id").eq("id", clientId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;linked_user_id:string|null}>(),
  ]);
  if (!enrollment?.user_id || !client) finish("Inscription ou dossier CRM introuvable.", "error");
  if (client.linked_user_id && client.linked_user_id !== enrollment.user_id) finish("Ce dossier CRM appartient déjà à un autre utilisateur.", "error");

  const {data: occupied} = await admin.from("crm_clients").select("id").eq("organization_id", membership.organization_id).eq("linked_user_id", enrollment.user_id).neq("id", clientId).limit(1);
  if (occupied?.length) finish("Cet apprenant est déjà relié à un autre dossier CRM.", "error");

  const {error} = await admin.from("crm_clients").update({linked_user_id:enrollment.user_id,updated_at:new Date().toISOString()}).eq("id",clientId).eq("organization_id",membership.organization_id);
  if (error) finish(`Rapprochement impossible : ${error.message}`, "error");
  const {error: enrollmentError} = await admin.from("academy_school_enrollments").update({crm_client_id:clientId,updated_at:new Date().toISOString()}).eq("organization_id",membership.organization_id).eq("user_id",enrollment.user_id);
  if (enrollmentError) finish(`Rattachement des inscriptions impossible : ${enrollmentError.message}`, "error");
  await admin.from("academy_crm_identity_review_queue").update({status:"resolved",resolved_client_id:clientId,resolved_by:user.id,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("organization_id",membership.organization_id).eq("user_id",enrollment.user_id).eq("status","open");
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/academy/students");
  finish("Apprenant et toutes ses inscriptions reliés au même dossier CRM.");
}

export async function createLearnerAccessAction(formData:FormData){
  const {admin,user,membership}=await context();
  const clientId=value(formData,"clientId"),q=value(formData,"q");
  const {data:client}=await admin.from("crm_clients").select("id,full_name,email,linked_user_id").eq("id",clientId).eq("organization_id",membership.organization_id).maybeSingle<{id:string;full_name:string;email:string|null;linked_user_id:string|null}>();
  if(!client?.email)finishSearch("Une adresse e-mail est obligatoire pour créer l’accès.","error",q);
  if(client.linked_user_id)finishSearch("Ce dossier possède déjà un compte. Utilisez Resynchroniser si nécessaire.","error",q);
  try{
    let authUser=await findAuthUserByEmail(admin,client.email);
    let action:"account_invited"|"existing_account_linked"="existing_account_linked";
    if(!authUser){
      const next="/dashboard/academy/my-quizzes";
      const {data,error}=await admin.auth.admin.inviteUserByEmail(client.email,{redirectTo:`${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,data:{full_name:client.full_name,account_type:"academy_student"}});
      if(error||!data.user)throw new Error(error?.message||"Invitation non créée");
      authUser=data.user;action="account_invited";
    }
    await admin.from("profiles").upsert({id:authUser.id,full_name:client.full_name,email:client.email,updated_at:new Date().toISOString()},{onConflict:"id"});
    const count=await linkLearnerIdentity({admin,organizationId:membership.organization_id,actorId:user.id,clientId,userId:authUser.id,action});
    revalidatePath("/dashboard/crm/identity-sync");revalidatePath("/dashboard/academy/students");revalidatePath("/dashboard/academy/journey-control");
    finishSearch(action==="account_invited"?`Invitation envoyée et ${count} inscription(s) synchronisée(s).`:`Compte existant relié et ${count} inscription(s) synchronisée(s).`,"success",q);
  }catch(error){unstable_rethrow(error);finishSearch(`Traitement impossible : ${error instanceof Error?error.message:"erreur inconnue"}`,"error",q);}
}

export async function linkExistingLearnerAccountAction(formData:FormData){
  const {admin,user,membership}=await context();
  const clientId=value(formData,"clientId"),userId=value(formData,"userId"),q=value(formData,"q");
  const [{data:client},{data:profile}]=await Promise.all([
    admin.from("crm_clients").select("id,email,linked_user_id").eq("id",clientId).eq("organization_id",membership.organization_id).maybeSingle<{id:string;email:string|null;linked_user_id:string|null}>(),
    admin.from("profiles").select("id,email").eq("id",userId).maybeSingle<{id:string;email:string|null}>(),
  ]);
  if(!client||!profile||!client.email||client.email.toLowerCase()!==profile.email?.toLowerCase())finishSearch("Le compte sélectionné ne correspond pas exactement à l’e-mail CRM.","error",q);
  if(client.linked_user_id&&client.linked_user_id!==userId)finishSearch("Ce dossier CRM est déjà relié à un autre compte.","error",q);
  try{const count=await linkLearnerIdentity({admin,organizationId:membership.organization_id,actorId:user.id,clientId,userId,action:"existing_account_linked"});revalidatePath("/dashboard/crm/identity-sync");revalidatePath("/dashboard/academy/students");revalidatePath("/dashboard/academy/journey-control");finishSearch(`Compte relié et ${count} inscription(s) synchronisée(s).`,"success",q);}catch(error){unstable_rethrow(error);finishSearch(`Rapprochement impossible : ${error instanceof Error?error.message:"erreur inconnue"}`,"error",q);}
}

export async function resynchronizeLearnerEnrollmentsAction(formData:FormData){
  const {admin,user,membership}=await context();const clientId=value(formData,"clientId"),q=value(formData,"q");
  const {data:client}=await admin.from("crm_clients").select("id,linked_user_id").eq("id",clientId).eq("organization_id",membership.organization_id).maybeSingle<{id:string;linked_user_id:string|null}>();
  if(!client?.linked_user_id)finishSearch("Aucun compte n’est encore relié à ce dossier.","error",q);
  try{const count=await linkLearnerIdentity({admin,organizationId:membership.organization_id,actorId:user.id,clientId,userId:client.linked_user_id,action:"enrollments_synchronized"});revalidatePath("/dashboard/crm/identity-sync");revalidatePath("/dashboard/academy/students");revalidatePath("/dashboard/academy/journey-control");finishSearch(`${count} inscription(s) resynchronisée(s).`,"success",q);}catch(error){unstable_rethrow(error);finishSearch(`Resynchronisation impossible : ${error instanceof Error?error.message:"erreur inconnue"}`,"error",q);}
}
