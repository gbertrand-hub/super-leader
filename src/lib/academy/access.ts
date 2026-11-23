import "server-only";

import {createAdminClient} from "@/lib/supabase/admin";

export const academyGlobalRoles = new Set(["owner", "admin", "hr"]);
export type AcademyAssignmentRole = "director"|"academic_coordinator"|"instructor"|"follow_up"|"finance"|"communication"|"marketing"|"data_analyst"|"observer";
export type AcademyAssignment = {school_id:string;program_id:string|null;cohort_id:string|null;assignment_role:AcademyAssignmentRole};

export async function getAcademyAssignments(admin:ReturnType<typeof createAdminClient>,organizationId:string,userId:string){
  const {data}=await admin.from("academy_staff_assignments").select("school_id,program_id,cohort_id,assignment_role").eq("organization_id",organizationId).eq("user_id",userId).eq("is_active",true);
  return (data??[]) as AcademyAssignment[];
}

export function schoolAssignments(assignments:AcademyAssignment[],schoolId:string){return assignments.filter(x=>x.school_id===schoolId)}
export function hasSchoolAccess(role:string,assignments:AcademyAssignment[],schoolId:string){return academyGlobalRoles.has(role)||schoolAssignments(assignments,schoolId).length>0}
export function hasAssignmentRole(assignments:AcademyAssignment[],schoolId:string,roles:AcademyAssignmentRole[]){return schoolAssignments(assignments,schoolId).some(x=>roles.includes(x.assignment_role))}
export function canEnrollStudents(role:string,a:AcademyAssignment[],schoolId:string){return academyGlobalRoles.has(role)||hasAssignmentRole(a,schoolId,["director","academic_coordinator"])}
export function canViewFinance(role:string,a:AcademyAssignment[],schoolId:string){return academyGlobalRoles.has(role)||hasAssignmentRole(a,schoolId,["director","finance","data_analyst"])}
export function canEditFinance(role:string,a:AcademyAssignment[],schoolId:string){return ["owner","admin"].includes(role)||hasAssignmentRole(a,schoolId,["finance"])}
export function canEditTraining(role:string,a:AcademyAssignment[],schoolId:string){return academyGlobalRoles.has(role)||hasAssignmentRole(a,schoolId,["director","academic_coordinator","instructor"])}
export function canAddFollowup(role:string,a:AcademyAssignment[],schoolId:string){return academyGlobalRoles.has(role)||hasAssignmentRole(a,schoolId,["director","academic_coordinator","follow_up"])}
export function canManageCards(role:string){return ["owner","admin","hr"].includes(role)}
export function canViewAnalytics(role:string,a:AcademyAssignment[],schoolId:string){return academyGlobalRoles.has(role)||hasAssignmentRole(a,schoolId,["director","academic_coordinator","data_analyst"])}

export function enrollmentVisibleTo(userId:string,role:string,assignments:AcademyAssignment[],schoolId:string,enrollment:{program_id:string|null;cohort_id:string|null;assigned_follow_up_user_id:string|null}){
  if(academyGlobalRoles.has(role))return true;
  return schoolAssignments(assignments,schoolId).some(a=>{
    if(a.assignment_role==="follow_up")return enrollment.assigned_follow_up_user_id===userId;
    if(a.assignment_role==="instructor")return (!a.program_id||a.program_id===enrollment.program_id)&&(!a.cohort_id||a.cohort_id===enrollment.cohort_id);
    return ["director","academic_coordinator","finance","data_analyst","observer"].includes(a.assignment_role);
  });
}

export async function assertEnrollmentPermission(admin:ReturnType<typeof createAdminClient>,organizationId:string,userId:string,role:string,schoolId:string,enrollmentId:string,permission:"finance"|"training"|"followup"){
  const assignments=await getAcademyAssignments(admin,organizationId,userId);
  const allowed=permission==="finance"?canEditFinance(role,assignments,schoolId):permission==="training"?canEditTraining(role,assignments,schoolId):canAddFollowup(role,assignments,schoolId);
  if(!allowed)return false;
  const {data}=await admin.from("academy_school_enrollments").select("id,program_id,cohort_id,assigned_follow_up_user_id").eq("id",enrollmentId).eq("organization_id",organizationId).eq("school_id",schoolId).maybeSingle<{id:string;program_id:string|null;cohort_id:string|null;assigned_follow_up_user_id:string|null}>();
  return Boolean(data&&enrollmentVisibleTo(userId,role,assignments,schoolId,data));
}
