"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const CORE_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const CATEGORIES = new Set(["communications", "events_travel", "benefits_partners", "membership_concierge", "growth_membership", "general"]);
const PRIORITIES = new Set(["normal", "important", "critical"]);
const STATUSES = new Set(["open", "in_progress", "blocked", "completed", "cancelled"]);

function text(value: FormDataEntryValue | null, max = 500) { return String(value ?? "").trim().slice(0, max); }
function dateTime(value: FormDataEntryValue | null) { const raw=text(value,50); if(!raw) return null; const d=new Date(raw); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function go(message:string, kind:"success"|"error", view="open"):never { const q=new URLSearchParams({view,[kind]:message}); redirect(`/dashboard/vip/operations?${q.toString()}`); }

async function getContext() {
  const {locale}=await getI18n(); const tr=(fr:string,en:string)=>locale==="fr"?fr:en;
  const supabase=await createClient(); const {data:auth}=await supabase.auth.getUser(); if(!auth.user) redirect("/login");
  const admin=createAdminClient();
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership) redirect("/dashboard/company");
  const {data:settings}=await admin.from("vip_program_settings").select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id,vip_communications_assistant_user_id,vip_events_travel_assistant_user_id,vip_benefits_partners_assistant_user_id,vip_membership_concierge_assistant_user_id,vip_operations_require_backup_for_critical,vip_operations_escalation_hours").eq("organization_id",membership.organization_id).maybeSingle<any>();
  const ids={manager:settings?.vip_manager_user_id,assistant:settings?.vip_assistant_manager_user_id,growth_membership:settings?.vip_growth_membership_manager_user_id,communications:settings?.vip_communications_assistant_user_id,events_travel:settings?.vip_events_travel_assistant_user_id,benefits_partners:settings?.vip_benefits_partners_assistant_user_id,membership_concierge:settings?.vip_membership_concierge_assistant_user_id};
  const leadership=auth.user.id===ids.manager||auth.user.id===ids.assistant;
  const specialized=Object.entries(ids).filter(([k,v])=>!["manager","assistant"].includes(k)&&v===auth.user!.id).map(([k])=>k);
  if(!CORE_ROLES.has(membership.role)&&!leadership&&specialized.length===0) redirect("/dashboard/my-day");
  return {user:auth.user,membership,admin,tr,settings:settings??{},leadership,specialized};
}

function canManageCategory(ctx:any, category:string) {
  if (["owner","admin"].includes(ctx.membership.role) || ctx.leadership) return true;
  if (ctx.membership.role==="executive") return true;
  if (ctx.membership.role==="hr" && ["membership_concierge","general"].includes(category)) return true;
  return ctx.specialized.includes(category);
}

async function history(admin:any, taskId:string, actorId:string, action:string, details:Record<string,unknown>={}) {
  const {error}=await admin.from("vip_operational_task_history").insert({task_id:taskId,actor_id:actorId,action,details});
  if(error) console.error("VIP task history failed",error);
}

export async function saveVipOperationalTaskAction(formData:FormData) {
  const ctx=await getContext(); const {user,membership,admin,tr,settings}=ctx;
  const taskId=text(formData.get("taskId"),80); const title=text(formData.get("title"),220); const description=text(formData.get("description"),4000)||null;
  const category=text(formData.get("category"),60)||"general"; const priority=text(formData.get("priority"),30)||"normal"; const ownerUserId=text(formData.get("ownerUserId"),80)||null; const backupUserId=text(formData.get("backupUserId"),80)||null; const dueAt=dateTime(formData.get("dueAt"));
  if(title.length<3||!CATEGORIES.has(category)||!PRIORITIES.has(priority)||!canManageCategory(ctx,category)) go(tr("Tâche VIP invalide ou hors de ton périmètre.","Invalid VIP task or outside your scope."),"error");
  if(ownerUserId&&backupUserId&&ownerUserId===backupUserId) go(tr("Le responsable et le backup doivent être différents.","Owner and backup must be different people."),"error");
  if(priority==="critical"&&settings.vip_operations_require_backup_for_critical!==false&&!backupUserId) go(tr("Une tâche critique exige un backup.","A critical task requires a backup."),"error");
  if(priority==="critical"&&!dueAt) go(tr("Une tâche critique exige une échéance.","A critical task requires a due date."),"error");
  for(const uid of [ownerUserId,backupUserId].filter(Boolean) as string[]) { const {data:m}=await admin.from("organization_members").select("user_id").eq("organization_id",membership.organization_id).eq("user_id",uid).eq("is_active",true).maybeSingle(); if(!m) go(tr("Le responsable ou le backup n’est pas un membre actif.","Owner or backup is not an active member."),"error"); }
  const payload={title,description,category,priority,owner_user_id:ownerUserId,backup_user_id:backupUserId,due_at:dueAt,updated_by:user.id,updated_at:new Date().toISOString()};
  if(taskId){ const {data:cur}=await admin.from("vip_operational_tasks").select("id,category,status").eq("id",taskId).eq("organization_id",membership.organization_id).maybeSingle<any>(); if(!cur||!canManageCategory(ctx,cur.category)) go(tr("Tâche introuvable ou non autorisée.","Task not found or not allowed."),"error"); const {error}=await admin.from("vip_operational_tasks").update(payload).eq("id",taskId).eq("organization_id",membership.organization_id); if(error) go(error.message,"error"); await history(admin,taskId,user.id,"task_updated",payload); }
  else { const {data:created,error}=await admin.from("vip_operational_tasks").insert({organization_id:membership.organization_id,...payload,status:"open",created_by:user.id}).select("id").single<{id:string}>(); if(error||!created) go(error?.message??tr("Création impossible.","Unable to create task."),"error"); await history(admin,created.id,user.id,"task_created",{category,priority,ownerUserId,backupUserId,dueAt}); }
  revalidatePath("/dashboard/vip/operations"); go(tr("Tâche VIP enregistrée.","VIP task saved."),"success");
}

export async function updateVipOperationalTaskStatusAction(formData:FormData){
  const ctx=await getContext(); const {user,membership,admin,tr}=ctx; const taskId=text(formData.get("taskId"),80); const nextStatus=text(formData.get("nextStatus"),30);
  if(!taskId||!STATUSES.has(nextStatus)) go(tr("Action invalide.","Invalid action."),"error");
  const {data:task}=await admin.from("vip_operational_tasks").select("id,category,status,owner_user_id,backup_user_id").eq("id",taskId).eq("organization_id",membership.organization_id).maybeSingle<any>();
  if(!task) go(tr("Tâche introuvable.","Task not found."),"error");
  const assigned=user.id===task.owner_user_id||user.id===task.backup_user_id; if(!assigned&&!canManageCategory(ctx,task.category)) go(tr("Tu n’as pas l’autorisation de mettre à jour cette tâche.","You are not allowed to update this task."),"error");
  const now=new Date().toISOString(); const {error}=await admin.from("vip_operational_tasks").update({status:nextStatus,completed_at:nextStatus==="completed"?now:null,updated_by:user.id,updated_at:now}).eq("id",taskId); if(error) go(error.message,"error");
  await history(admin,taskId,user.id,"status_changed",{from:task.status,to:nextStatus}); revalidatePath("/dashboard/vip/operations"); go(tr("Statut de la tâche mis à jour.","Task status updated."),"success");
}
