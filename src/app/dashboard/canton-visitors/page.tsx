import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import {CantonSiteStaffManager} from "@/components/canton/canton-site-staff-manager";
import {CantonCrmProspectPicker} from "@/components/canton/canton-crm-prospect-picker";
import {CantonQrActions} from "@/components/canton/canton-qr-actions";
import Link from "next/link";
import {headers} from "next/headers";
import {createCantonQrSite,reviewCantonQrIntake,updateCantonQrSiteAddress} from "@/app/actions/canton-qr";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createCantonAppointment,createCantonCrmReferral,updateCantonVisit,manageCantonReceptionStaff,assignCantonFollowUp,completeCantonFollowUp,createCantonNextAction,reassignCantonNextAction,completeCantonNextAction,simulateCantonFeedbackInvitations,sendCantonQaEmailTest,markCantonArrivalAlertRead,saveCantonVisitDebrief,qualifyCantonLegacyProspect,createCantonSlaRecovery,completeCantonSlaRecovery,createVisitorSite,updateVisitorSite} from "@/app/actions/canton-visitors";
export const dynamic="force-dynamic";
export default async function CantonVisitorPage({searchParams}:{searchParams:Promise<{error?:string;success?:string;q?:string;view?:string;site?:string;filter?:string}>}){
 const {error,success,q="",view="",site="",filter=""}=await searchParams;
 const {locale}=await getI18n();const fr=locale==="fr";
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Canton Visitor Center</h1><p className="mt-3 rounded-lg bg-amber-50 p-4 text-amber-900">Real operations are disabled in this preview until the separate QA database, authentication, and access controls pass end-to-end testing.</p><a href="/canton-demo" className="mt-4 inline-block underline">Open the simulation</a></main>;
 const host=(await headers()).get("host")||"";
 const origin=/^(localhost(:\d+)?|app\.ileadglobal\.org|[a-z0-9-]+\.vercel\.app)$/.test(host)?`${host.startsWith("localhost")?"http":"https"}://${host}`:"";
 const qrImage=(url:string)=>"https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data="+encodeURIComponent(url);
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/login?next=/dashboard/canton-visitors");
 const db=createAdminClient();
 const {data:membership}=await db.from("organization_members").select("organization_id,role")
 .eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(!membership) return <main className="p-8">Access denied.</main>;
 const isSenior=["owner","admin"].includes(membership.role);
 const {data:reception}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",membership.organization_id).eq("user_id",user.id).maybeSingle();
 const isReception=!!reception;
 const {data:members}=(isSenior||membership.role==="manager")?await db.from("organization_members").select("user_id,role").eq("organization_id",membership.organization_id).eq("is_active",true).limit(500):{data:[]};
 const {data:hostMembers}=await db.from("organization_members").select("user_id,role").eq("organization_id",membership.organization_id).eq("is_active",true).limit(500);
 const {data:crmProspects}=await db.from("crm_clients").select("id,reference,full_name,email,phone")
  .eq("organization_id",membership.organization_id).order("created_at",{ascending:false}).limit(100);
 const {data:staffAssignments}=isSenior?await db.from("canton_reception_staff").select("user_id").eq("organization_id",membership.organization_id):{data:[]};
 const {data:allVisitorSites}=await db.from("visitor_sites")
  .select("id,code,name,city,country_code,timezone,street_address,is_hq,is_active")
  .eq("organization_id",membership.organization_id)
  .eq("is_active",true)
  .order("is_hq",{ascending:false}).order("name",{ascending:true});
 const isManager=membership.role==="manager" || membership.role==="hr";
 const {data:mySiteAssignments}=!isSenior?await db.from("visitor_site_staff")
  .select("site_id,access_role")
  .eq("user_id",user.id).eq("is_active",true):{data:[]};
 const myAssignedSiteIds=new Set((mySiteAssignments||[]).map(x=>x.site_id));
 const visitorSites=isSenior
  ? (allVisitorSites||[])
  : myAssignedSiteIds.size>0
   ? (allVisitorSites||[]).filter(s=>myAssignedSiteIds.has(s.id))
   : (allVisitorSites||[]).filter(s=>s.is_hq && (isReception||isManager));
 const siteById=new Map((visitorSites||[]).map(s=>[s.id,s]));
 const allSiteById=new Map((allVisitorSites||[]).map(s=>[s.id,s]));
 const hqSite=(allVisitorSites||[]).find(s=>s.is_hq)||null;
 const selectedSiteId=site==="all"&&isSenior?"all":siteById.has(site)?site:(isSenior?"all":visitorSites?.[0]?.id||hqSite?.id||"all");
 const memberIds=[...new Set([...(members||[]).map(m=>m.user_id),...(hostMembers||[]).map(m=>m.user_id)])];
 const {data:memberProfiles}=memberIds.length?await db.from("profiles").select("id,full_name,email,city,country").in("id",memberIds):{data:[]};
 const profileMap=new Map((memberProfiles||[]).map(p=>[p.id,p]));
 const assignedIds=new Set((staffAssignments||[]).map(p=>p.user_id));
 const {data:siteStaff}=(isSenior||isManager)?await db.from("visitor_site_staff")
  .select("site_id,user_id,access_role,is_active")
  .in("site_id",(visitorSites||[]).map(s=>s.id))
  .eq("is_active",true):{data:[]};
 const siteStaffMap=new Map((siteStaff||[]).map(x=>[x.site_id+":"+x.user_id,x]));
 const effectiveSiteId=selectedSiteId==="all"?(hqSite?.id||""):selectedSiteId;
 const selectedSiteHostIds=new Set((siteStaff||[]).filter(x=>x.site_id===effectiveSiteId&&x.is_active).map(x=>x.user_id));
 const siteHostMembers=(hostMembers||[]).filter(m=>selectedSiteHostIds.has(m.user_id));
 const activeSite=effectiveSiteId?siteById.get(effectiveSiteId)||hqSite:null;
 const activeTimeZone=activeSite?.timezone||hqSite?.timezone||"America/Chicago";

 const adminSitesToRender=selectedSiteId==="all"
  ? (visitorSites||[])
  : (visitorSites||[]).filter(s=>s.id===selectedSiteId);

 const {data:teams}=isSenior?await db.from("teams")
  .select("id,name,department")
  .eq("organization_id",membership.organization_id)
  .eq("is_active",true)
  .order("name",{ascending:true}):{data:[]};
 const teamIds=(teams||[]).map(t=>t.id);
 const {data:teamMemberRows}=teamIds.length?await db.from("team_members")
  .select("team_id,user_id")
  .in("team_id",teamIds):{data:[]};
 const teamMembersMap=new Map<string,string[]>();
 for(const row of teamMemberRows||[]){
  const list=teamMembersMap.get(row.team_id)||[];
  list.push(row.user_id);
  teamMembersMap.set(row.team_id,list);
 }
 const visitorTeams=(teams||[]).map(t=>({id:t.id,name:t.name,department:t.department,userIds:teamMembersMap.get(t.id)||[]}));


 const allowedViews=["dashboard","reception","appointments","commercial","feedback","admin"] as const;
 type CantonView=(typeof allowedViews)[number];
 const requestedView=allowedViews.includes(view as CantonView)?view as CantonView:"dashboard";
 const activeView:CantonView=requestedView==="admin"&&!isSenior?"dashboard":requestedView==="feedback"&&!(isSenior||isManager)?"dashboard":requestedView==="reception"&&!(isSenior||isManager||isReception)?"dashboard":requestedView;
 const routeByView:Record<CantonView,string>={
  dashboard:"/dashboard/canton-visitors",
  reception:"/dashboard/canton-visitors?view=reception",
  appointments:"/dashboard/canton-visitors?view=appointments",
  commercial:"/dashboard/canton-visitors?view=commercial",
  feedback:"/dashboard/canton-visitors?view=feedback",
  admin:"/dashboard/canton-visitors?view=admin"
 };
 const currentReturnPath="/dashboard/canton-visitors?view="+encodeURIComponent(activeView)+(selectedSiteId!=="all"?"&site="+encodeURIComponent(selectedSiteId):"");
 const navItems=[
  {id:"dashboard" as CantonView,fr:"Tableau de bord",en:"Dashboard",show:true},
  {id:"appointments" as CantonView,fr:"Rendez-vous",en:"Appointments",show:true},
  {id:"reception" as CantonView,fr:"Réception",en:"Reception",show:isSenior||isManager||isReception},
  {id:"feedback" as CantonView,fr:"Feedback",en:"Feedback",show:isSenior||isManager},
  {id:"commercial" as CantonView,fr:"Suivi commercial",en:"Commercial follow-up",show:true},
  {id:"admin" as CantonView,fr:"Administration",en:"Administration",show:isSenior}
 ].filter(x=>x.show);
 const {data:myReferredVisits}=await db.from("canton_appointments")
  .select("id,visitor_id,site_id,department,purpose,status,scheduled_local,host_name,host_user_id,check_in_at,visit_started_at,check_out_at,follow_up_status,visit_outcome,crm_referred_by,created_at")
  .eq("organization_id",membership.organization_id)
  .eq("crm_referred_by",user.id)
  .order("created_at",{ascending:false})
  .limit(100);

 let visitQuery=db.from("canton_appointments")
  .select("id,visitor_id,site_id,department,purpose,status,scheduled_local,host_name,host_user_id,check_in_at,visit_started_at,check_out_at,feedback_token,feedback_code,follow_up_required,follow_up_owner_id,follow_up_status,follow_up_due_date,follow_up_note,follow_up_outcome,follow_up_result_note,follow_up_completed_at,commercial_interest,commercial_qualified_at,commercial_qualified_by,visit_outcome,debrief_note,debriefed_by,debriefed_at,visit_origin,crm_referred_by,created_at,announced_by")
  .eq("organization_id",membership.organization_id);
 if(selectedSiteId!=="all") visitQuery=visitQuery.eq("site_id",selectedSiteId);
 if(!isSenior) {
  visitQuery = (isManager || isReception)
   ? visitQuery.neq("department","DIRECTION")
   : visitQuery.or(`announced_by.eq.${user.id},follow_up_owner_id.eq.${user.id},host_user_id.eq.${user.id}`).neq("department","DIRECTION");
 }
 const {data:visits,error:queryError}=await visitQuery.order("created_at",{ascending:false}).limit(150);
 const {data:sites}=(isSenior||isManager||isReception)?await db.from("canton_qr_sites").select("id,label,enabled,street_address,visitor_site_id").eq("organization_id",membership.organization_id).order("created_at",{ascending:false}):{data:[]};
 const {data:requests}=isSenior||isManager||isReception?await db.from("canton_intake_requests").select("id,full_name,department,purpose,email,phone,created_at").eq("organization_id",membership.organization_id).eq("status","pending").order("created_at",{ascending:true}).limit(100):{data:[]};
 const visitorIds=[...new Set([...(visits||[]).map(v=>v.visitor_id),...(myReferredVisits||[]).map(v=>v.visitor_id)])];
 const {data:people}=visitorIds.length?await db.from("canton_visitors").select("id,full_name,phone,email").eq("organization_id",membership.organization_id).in("id",visitorIds):{data:[]};
 const map=new Map((people||[]).map(p=>[p.id,p]));
 const visitIds=(visits||[]).map(v=>v.id);
 const {data:feedback}=visitIds.length?await db.from("canton_visit_feedback")
  .select("appointment_id,rating,contact_requested,submitted_at").in("appointment_id",visitIds):{data:[]};
 const {data:nextActions}=await db.from("canton_next_actions")
  .select("id,appointment_id,assigned_to,action_text,due_date,status,created_at,completion_note,completed_at")
  .eq("organization_id",membership.organization_id)
  .order("created_at",{ascending:false}).limit(150);
 let recoveryQuery=db.from("canton_sla_recoveries")
  .select("id,appointment_id,assigned_to,created_by,action_text,due_date,status,created_at,completed_at,completed_by,completion_note")
  .eq("organization_id",membership.organization_id);
 if(!isSenior&&!isManager) recoveryQuery=recoveryQuery.eq("assigned_to",user.id);
 const {data:slaRecoveries}=await recoveryQuery.order("created_at",{ascending:false}).limit(100);
 const openRecoveryByVisit=new Map((slaRecoveries||[]).filter(x=>x.status==="open").map(x=>[x.appointment_id,x]));
 const myOpenRecoveries=(slaRecoveries||[]).filter(x=>x.status==="open"&&x.assigned_to===user.id);
 const {data:arrivalAlerts}=await db.from("canton_arrival_alerts")
  .select("id,appointment_id,visitor_name,department,host_name,created_at,read_at")
  .eq("organization_id",membership.organization_id)
  .eq("recipient_user_id",user.id)
  .order("created_at",{ascending:false}).limit(25);
 const unreadArrivalAlerts=(arrivalAlerts||[]).filter(x=>!x.read_at);
 const visibleNextActions=(nextActions||[]).filter(action=>{
  const visit=(visits||[]).find(v=>v.id===action.appointment_id);
  return !!visit&&(isSenior||visit.department!=="DIRECTION")&&(isSenior||isManager||action.assigned_to===user.id);
 });
 const {data:invitationQueue}=(isSenior||isManager)
  ?await db.from("canton_feedback_invitation_outbox")
   .select("id,appointment_id,channel,status,due_at,created_at,reason,attempt_count,provider_error_code,provider_message_id")
   .eq("organization_id",membership.organization_id)
   .order("created_at",{ascending:false}).limit(100)
  :{data:[]};
 const visitById=new Map((visits||[]).map(v=>[v.id,v]));
 const visibleInvitationQueue=(invitationQueue||[]).filter(x=>visitById.has(x.appointment_id));
 const invitationPending=visibleInvitationQueue.filter(x=>x.status==="pending").length;
 const invitationDue=visibleInvitationQueue.filter(x=>x.status==="pending"&&Date.parse(x.due_at)<=Date.now()).length;
 const completedCount=(visits||[]).filter(v=>v.status==="completed").length;
 const feedbackResponseRate=completedCount?Math.round(100*(feedback||[]).length/completedCount)+"%":"—";
 const pendingFeedback=(feedback||[]).filter(x=>x.rating<=2||x.contact_requested).length;
 const pendingHandoffs=(visits||[]).filter(v=>v.follow_up_status==="open").length;
 const flaggedFeedbackVisits=new Set((feedback||[]).filter(f=>f.contact_requested||f.rating<=2).map(f=>f.appointment_id));
 const unassignedFollowUps=(visits||[]).filter(v=>v.status==="completed"&&!v.follow_up_owner_id&&(v.department==="DIG"||v.department==="TCF")&&(v.follow_up_status==="open"||flaggedFeedbackVisits.has(v.id))&&v.follow_up_status!=="completed");
 const unreviewedOpportunities=unassignedFollowUps.filter(v=>flaggedFeedbackVisits.has(v.id));

 const ratingAverage=(feedback||[]).length
  ? ((feedback||[]).reduce((total,f)=>total+f.rating,0)/(feedback||[]).length).toFixed(1):"—";
 const cantonDay=(stamp:string)=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:activeTimeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(stamp));const val=(type:string)=>parts.find(p=>p.type===type)?.value||"";return val("year")+"-"+val("month")+"-"+val("day");};
 const today=cantonDay(new Date().toISOString());
 const openNextActions=visibleNextActions.filter(x=>x.status==="open");
 const nextActionsToday=openNextActions.filter(x=>x.due_date===today);
 const overdueNextActions=openNextActions.filter(x=>x.due_date<today);
 const upcomingNextActions=openNextActions.filter(x=>x.due_date>today);

 const openActionByVisit=new Map<string,(typeof openNextActions)[number]>();
 for(const action of [...openNextActions].sort((a,b)=>a.due_date.localeCompare(b.due_date))){
  if(!openActionByVisit.has(action.appointment_id)) openActionByVisit.set(action.appointment_id,action);
 }
 const prospectRows=(visits||[]).filter(v=>
  v.status==="completed" &&
  ["DIG","TCF"].includes(v.department) &&
  (
    ["hot","warm","cold"].includes(v.commercial_interest||"") ||
    (!v.commercial_interest && (!!v.follow_up_outcome || v.follow_up_status==="completed"))
  )
 ).map(v=>{
  const action=openActionByVisit.get(v.id)||null;
  const ownerId=action?.assigned_to||v.follow_up_owner_id||v.host_user_id||null;
  const qualifiedAt=v.commercial_qualified_at||v.debriefed_at||v.check_out_at||v.created_at;
  const slaHours=v.commercial_interest==="hot"?24:v.commercial_interest==="warm"?72:v.commercial_interest==="cold"?168:null;
  const slaDeadline=slaHours?new Date(Date.parse(qualifiedAt)+slaHours*60*60*1000):null;
  const actionDueAt=action?new Date(action.due_date+"T23:59:59-06:00"):null;
  const remainingMs=slaDeadline?slaDeadline.getTime()-Date.now():null;
  const slaLate=!!slaDeadline&&Date.now()>slaDeadline.getTime();
  const slaPlannedTooLate=!!slaDeadline&&!!actionDueAt&&actionDueAt.getTime()>slaDeadline.getTime()&&!slaLate;
  const slaApproaching=!!slaDeadline&&!!slaHours&&remainingMs!==null&&remainingMs>0&&remainingMs<=slaHours*60*60*1000*0.25;
  return {
   visit:v,
   person:map.get(v.visitor_id),
   action,
   ownerId,
   overdue:!!action&&action.due_date<today,
   dueToday:!!action&&action.due_date===today,
   missingAction:!action,
   slaHours,
   slaDeadline,
   slaLate,
   slaPlannedTooLate,
   slaApproaching
  };
 }).sort((a,b)=>{
  const rank:Record<string,number>={hot:0,warm:1,cold:2};
  const ar=rank[a.visit.commercial_interest||""]??3, br=rank[b.visit.commercial_interest||""]??3;
  if(ar!==br)return ar-br;
  if(a.overdue!==b.overdue)return a.overdue?-1:1;
  if(a.missingAction!==b.missingAction)return a.missingAction?-1:1;
  return (a.action?.due_date||"9999-12-31").localeCompare(b.action?.due_date||"9999-12-31");
 });
 const hotProspects=prospectRows.filter(x=>x.visit.commercial_interest==="hot");
 const warmProspects=prospectRows.filter(x=>x.visit.commercial_interest==="warm");
 const coldProspects=prospectRows.filter(x=>x.visit.commercial_interest==="cold");
 const unqualifiedProspects=prospectRows.filter(x=>!x.visit.commercial_interest);
 const atRiskProspects=prospectRows.filter(x=>x.overdue||x.missingAction||!x.visit.commercial_interest||x.slaLate||x.slaPlannedTooLate);
 const mySlaAlerts=prospectRows.filter(x=>x.ownerId===user.id&&x.visit.commercial_interest&&(x.slaApproaching||x.slaLate||x.slaPlannedTooLate));
 const managerEscalations=(isSenior||isManager)?prospectRows.filter(x=>x.visit.commercial_interest&&x.slaLate):[];

 const todayRows=(visits||[]).filter(v=>{
  if(v.check_in_at) return cantonDay(v.check_in_at)===today;
  if(v.scheduled_local) return v.scheduled_local.slice(0,10)===today;
  return cantonDay(v.created_at)===today;
 });
 const count=(p:(v:(typeof todayRows)[number])=>boolean)=>todayRows.filter(p).length;
 const receptionSearch=q.trim().toLowerCase().slice(0,120);
 const receptionRows=receptionSearch
  ? todayRows.filter(v=>{
    const person=map.get(v.visitor_id);
    return [
      person?.full_name,person?.phone,person?.email,v.host_name,v.department,v.purpose
    ].some(x=>String(x||"").toLowerCase().includes(receptionSearch));
   })
  : todayRows;
 const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
 return <main data-active-view={activeView} className="space-y-6 p-4 md:p-8">
  <style>{`
   main[data-active-view="dashboard"] [data-canton-view]:not([data-canton-view~="dashboard"]),
   main[data-active-view="reception"] [data-canton-view]:not([data-canton-view~="reception"]),
   main[data-active-view="appointments"] [data-canton-view]:not([data-canton-view~="appointments"]),
   main[data-active-view="commercial"] [data-canton-view]:not([data-canton-view~="commercial"]),
   main[data-active-view="feedback"] [data-canton-view]:not([data-canton-view~="feedback"]),
   main[data-active-view="admin"] [data-canton-view]:not([data-canton-view~="admin"]) { display:none !important; }
  `}</style>
  <div className="flex justify-end"><CantonLanguageSwitch locale={locale} returnPath={currentReturnPath}/></div>
  <nav aria-label={fr?"Navigation Canton":"Canton navigation"} className="sticky top-0 z-20 -mx-2 overflow-x-auto rounded-2xl border bg-white/95 p-2 shadow-sm backdrop-blur">
   <div className="flex min-w-max gap-2">
    {navItems.map(item=><Link key={item.id} href={"/dashboard/canton-visitors?view="+encodeURIComponent(item.id)+"&site="+encodeURIComponent(selectedSiteId)} className={"rounded-xl px-4 py-2 text-sm font-semibold transition "+(activeView===item.id?"bg-slate-900 text-white":"bg-slate-50 text-slate-700 hover:bg-slate-100")}>{fr?item.fr:item.en}</Link>)}
   </div>
  </nav>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{fr?"Gestion des Visiteurs & Rendez-vous":"Visitor & Appointment Management"}</h1><p className="text-sm text-slate-500">{fr?"Réseau multi-sites · Canton HQ comme point focal":"Multi-site network · Canton HQ as focal point"}</p></div><span className="text-sm text-slate-500">{fr?"Visiteurs & Rendez-vous":"Visitors & Appointments"}</span></div>
  <section className="rounded-2xl border bg-white p-4">
   <div className="flex flex-wrap items-center gap-3">
    <div className="text-sm font-semibold text-slate-700">{fr?"Site actif":"Active site"}</div>
    <div className="flex flex-wrap gap-2">
     {isSenior&&<Link href={"/dashboard/canton-visitors?view="+encodeURIComponent(activeView)+"&site=all"} className={"rounded-full px-3 py-2 text-sm font-semibold "+(selectedSiteId==="all"?"bg-slate-900 text-white":"bg-slate-100 text-slate-700")}>{fr?"Tous les sites":"All sites"}</Link>}
     {(visitorSites||[]).map(s=><Link key={s.id} href={"/dashboard/canton-visitors?view="+encodeURIComponent(activeView)+"&site="+s.id} className={"rounded-full px-3 py-2 text-sm font-semibold "+(selectedSiteId===s.id?"bg-indigo-700 text-white":"bg-slate-100 text-slate-700")}>{s.name}{s.is_hq?" · HQ":""}</Link>)}
    </div>
   </div>
   {selectedSiteId!=="all"&&siteById.get(selectedSiteId)&&<p className="mt-2 text-xs text-slate-500">{siteById.get(selectedSiteId)?.city} · {siteById.get(selectedSiteId)?.timezone}{siteById.get(selectedSiteId)?.street_address?" · "+siteById.get(selectedSiteId)?.street_address:""}</p>}
   {selectedSiteId==="all"&&<p className="mt-2 text-xs text-slate-500">{fr?"Vue réseau consolidée sous la supervision du HQ de Canton.":"Consolidated network view under Canton HQ supervision."}</p>}
  </section>
  {error&&<p role="alert" className="rounded bg-red-100 p-3 text-red-800">{error}</p>}
  {success&&<p role="status" className="rounded bg-green-100 p-3 text-green-800">{success}</p>}
  {queryError&&<p role="alert" className="rounded bg-yellow-100 p-3">{fr?"Base de données non initialisée. Appliquez les migrations Canton.":"Database not initialized. Apply the Canton migration before using this module."}</p>}
  {unreadArrivalAlerts.length>0&&<section data-canton-view="dashboard reception" className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5">
   <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">{fr?"Notification d’arrivée":"Arrival notification"}</p><h2 className="mt-1 text-xl font-bold text-emerald-950">{fr?"Votre visiteur est arrivé":"Your visitor has arrived"}</h2></div><span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-emerald-900">{unreadArrivalAlerts.length}</span></div>
   <div className="mt-4 space-y-3">{unreadArrivalAlerts.map(alert=><article key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white p-4">
    <div><div className="font-semibold">{alert.visitor_name}</div><div className="text-sm text-slate-600">{alert.department} · {fr?"arrivé à":"arrived at"} {new Date(alert.created_at).toLocaleTimeString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone,hour:"2-digit",minute:"2-digit"})}</div></div>
    <form action={markCantonArrivalAlertRead}><input type="hidden" name="id" value={alert.id}/><button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{fr?"J’ai vu":"Acknowledge"}</button></form>
   </article>)}</div>
  </section>}
  {activeView==="dashboard"&&(mySlaAlerts.length>0||managerEscalations.length>0||myOpenRecoveries.length>0)&&<section className="rounded-xl border bg-white p-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
     <h2 className="font-semibold text-slate-900">{fr?"Suivi SLA commercial":"Commercial SLA monitoring"}</h2>
     <p className="mt-1 text-sm text-slate-500">{mySlaAlerts.length} {fr?"alerte(s) personnelle(s)":"personal alert(s)"} · {managerEscalations.length} {fr?"escalade(s) manager":"manager escalation(s)"} · {myOpenRecoveries.length} {fr?"plan(s) de rattrapage":"recovery plan(s)"}</p>
    </div>
    <Link href={"/dashboard/canton-visitors?view=commercial"+(selectedSiteId!=="all"?"&site="+encodeURIComponent(selectedSiteId):"")} className="rounded-lg border bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">{fr?"Voir le suivi commercial":"View commercial follow-up"}</Link>
   </div>
  </section>}

  {mySlaAlerts.length>0&&<section data-canton-view="commercial" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-amber-800">{fr?"Alerte commerciale personnelle":"My commercial alert"}</p><h2 className="mt-1 text-xl font-bold text-amber-950">{fr?"Prospects à traiter avant dépassement SLA":"Prospects requiring action before SLA breach"}</h2></div><span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-amber-900">{mySlaAlerts.length}</span></div>
   <div className="mt-4 space-y-3">{mySlaAlerts.map(row=><article key={row.visit.id} className="rounded-xl border border-amber-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold">{row.person?.full_name||(fr?"Visiteur":"Visitor")} · {row.visit.department}</div><div className="mt-1 text-sm text-slate-600">{row.action?.action_text||(fr?"Aucune prochaine action planifiée":"No next action scheduled")}</div></div>
    <span className={"rounded px-3 py-1 text-xs font-bold "+(row.slaLate?"bg-rose-100 text-rose-900":row.slaPlannedTooLate?"bg-orange-100 text-orange-900":"bg-amber-100 text-amber-900")}>{row.slaLate?(fr?"SLA dépassé":"SLA breached"):row.slaPlannedTooLate?(fr?"Action trop tardive":"Action too late"):(fr?"SLA approche":"SLA approaching")}</span></div>
    {row.slaDeadline&&<div className="mt-2 text-xs text-slate-500">{fr?"Limite":"Deadline"}: {row.slaDeadline.toLocaleString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone})}</div>}
   </article>)}</div>
  </section>}
  {managerEscalations.length>0&&<section data-canton-view="commercial" className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-rose-800">{fr?"Escalade manager":"Manager escalation"}</p><h2 className="mt-1 text-xl font-bold text-rose-950">{fr?"SLA commerciaux dépassés":"Commercial SLAs breached"}</h2><p className="mt-1 text-sm text-rose-900">{fr?"Ces dossiers ont dépassé leur délai de suivi et nécessitent une intervention managériale.":"These records exceeded their follow-up SLA and require managerial intervention."}</p></div><span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-rose-900">{managerEscalations.length}</span></div>
   <div className="mt-4 space-y-3">{managerEscalations.map(row=><article key={row.visit.id} className="rounded-xl border border-rose-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold">{row.person?.full_name||(fr?"Visiteur":"Visitor")} · {row.visit.department} · {row.visit.commercial_interest?.toUpperCase()}</div><div className="mt-1 text-sm text-slate-600">{fr?"Responsable":"Owner"}: {row.ownerId?(profileMap.get(row.ownerId)?.full_name||profileMap.get(row.ownerId)?.email||row.visit.host_name||"—"):(row.visit.host_name||"—")}</div></div><span className="rounded bg-rose-100 px-3 py-1 text-xs font-bold text-rose-900">{fr?"Escaladé":"Escalated"}</span></div>
    <div className="mt-2 text-sm">{row.action?.action_text||(fr?"Aucune prochaine action":"No next action")}</div>
    {row.slaDeadline&&<div className="mt-1 text-xs text-slate-500">{fr?"SLA dépassé depuis":"SLA breached since"} {row.slaDeadline.toLocaleString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone})}</div>}
    {openRecoveryByVisit.has(row.visit.id)?<div className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900"><strong>{fr?"Plan de rattrapage actif":"Active recovery plan"}:</strong> {openRecoveryByVisit.get(row.visit.id)?.action_text} · {fr?"échéance":"due"} {openRecoveryByVisit.get(row.visit.id)?.due_date}</div>:<form action={createCantonSlaRecovery} className="mt-3 grid gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 md:grid-cols-3">
     <input type="hidden" name="appointmentId" value={row.visit.id}/>
     <label className="text-sm">{fr?"Responsable du rattrapage *":"Recovery owner *"}<select name="assignedTo" required className={input} defaultValue={row.ownerId||""}><option value="">{fr?"Choisir":"Select"}</option>{(members||[]).map(m=><option value={m.user_id} key={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id}</option>)}</select></label>
     <label className="text-sm">{fr?"Action corrective *":"Recovery action *"}<input name="actionText" required minLength={5} maxLength={800} className={input} placeholder={fr?"Ex. Appeler aujourd’hui et reprogrammer le suivi":"E.g. Call today and reset follow-up"}/></label>
     <label className="text-sm">{fr?"Nouvelle échéance *":"Recovery due date *"}<input type="date" name="dueDate" required className={input}/></label>
     <button className="rounded-lg bg-rose-800 px-4 py-2 text-sm font-semibold text-white md:col-span-3">{fr?"Attribuer le plan de rattrapage":"Assign recovery plan"}</button>
    </form>}
   </article>)}</div>
  </section>}
  {myOpenRecoveries.length>0&&<section data-canton-view="commercial" className="rounded-2xl border-2 border-sky-300 bg-sky-50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-sky-800">{fr?"Plan de rattrapage SLA":"SLA recovery plan"}</p><h2 className="mt-1 text-xl font-bold text-sky-950">{fr?"Actions correctives qui vous sont attribuées":"Recovery actions assigned to you"}</h2></div><span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-sky-900">{myOpenRecoveries.length}</span></div>
   <div className="mt-4 space-y-3">{myOpenRecoveries.map(rec=>{const visit=(visits||[]).find(v=>v.id===rec.appointment_id);return <article key={rec.id} className="rounded-xl border border-sky-200 bg-white p-4">
    <div className="font-semibold">{map.get(visit?.visitor_id||"")?.full_name||(fr?"Visiteur":"Visitor")} · {visit?.department}</div>
    <p className="mt-1 text-sm">{rec.action_text}</p>
    <p className="mt-1 text-xs text-slate-600">{fr?"Échéance de rattrapage":"Recovery due"}: <strong>{rec.due_date}</strong></p>
    <form action={completeCantonSlaRecovery} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="recoveryId" value={rec.id}/><label className="min-w-[240px] flex-1 text-sm">{fr?"Compte rendu de résolution *":"Resolution note *"}<input name="completionNote" required minLength={5} maxLength={1000} className={input}/></label><button className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white">{fr?"Clôturer le plan":"Close recovery plan"}</button></form>
   </article>})}</div>
  </section>}


  <section data-canton-view="appointments" className="rounded-2xl border-2 border-cyan-300 bg-cyan-50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
     <p className="text-xs font-bold uppercase tracking-wider text-cyan-800">{fr?"Référence inter-sites":"Cross-site referral"}</p>
     <h2 className="mt-1 text-xl font-bold text-cyan-950">{fr?"Référer une visite vers un autre bureau":"Refer a visit to another office"}</h2>
     <p className="mt-1 max-w-3xl text-sm text-cyan-900">{fr?"Le commercial choisit le bureau de destination. L’équipe locale de ce bureau attribue ensuite le responsable et prend en charge la visite. Référer une visite ne donne aucun droit opérationnel sur le site destinataire.":"Sales chooses the destination office. That office's local team then assigns the host and manages the visit. Referring a visit does not grant operational access to the destination site."}</p>
    </div>
    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-cyan-900">{fr?"Source : équipe commerciale":"Source: sales team"}</span>
   </div>
   <form action={createCantonCrmReferral} className="mt-4 grid gap-3 rounded-xl border border-cyan-200 bg-white p-4 lg:grid-cols-2 xl:grid-cols-3">
    <input type="hidden" name="returnTo" value={currentReturnPath}/>
    <label className="text-sm font-semibold text-slate-700">{fr?"Prospect CRM *":"CRM prospect *"}<CantonCrmProspectPicker locale={fr?"fr":"en"}/></label>
    <label className="text-sm font-semibold text-slate-700">{fr?"Site de destination *":"Destination site *"}<select name="siteId" required defaultValue="" className={input}><option value="" disabled>{fr?"Choisir Canton, Kinshasa, etc.":"Choose Canton, Kinshasa, etc."}</option>{(allVisitorSites||[]).map(s=><option key={s.id} value={s.id}>{s.name}{s.city?" · "+s.city:""} · {s.timezone}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">{fr?"Ce choix n’accorde aucun accès au site destinataire.":"This does not grant access to the destination site."}</span></label>
    <label className="text-sm font-semibold text-slate-700">{fr?"Visite / département *":"Visit / department *"}<select name="department" required defaultValue="DIG" className={input}><option value="DIG">DIG · {fr?"Visite terrain / immobilier":"Land / real-estate visit"}</option><option value="TCF">TCF · {fr?"Visite ferme":"Farm visit"}</option><option value="OTHER">{fr?"Autre visite commerciale":"Other commercial visit"}</option></select></label>
    <label className="text-sm font-semibold text-slate-700">{fr?"Date et heure locale du site destinataire *":"Destination site's local date & time *"}<input type="datetime-local" name="scheduled" required className={input}/><span className="mt-1 block text-xs font-normal text-slate-500">{fr?"Utilisez l’heure locale affichée dans le site choisi.":"Use the local timezone shown for the selected site."}</span></label>
    <label className="text-sm font-semibold text-slate-700">{fr?"Objectif de la visite":"Visit purpose"}<select name="purpose" defaultValue="commercial_visit" className={input}><option value="commercial_visit">{fr?"Voir avant de s’engager":"See before committing"}</option><option value="land_visit">{fr?"Visite terrain":"Land visit"}</option><option value="farm_visit">{fr?"Visite ferme":"Farm visit"}</option><option value="meet_team">{fr?"Rencontrer l’équipe":"Meet the team"}</option><option value="decision_meeting">{fr?"Réunion de décision":"Decision meeting"}</option></select></label>
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><strong>{fr?"Responsable local":"Local host"}:</strong> {fr?"à attribuer par l’équipe du site destinataire.":"assigned by the destination site's team."}</div>
    <label className="text-sm font-semibold text-slate-700 lg:col-span-2 xl:col-span-3">{fr?"Notes pour l’équipe locale":"Notes for the local team"}<textarea name="notes" maxLength={1000} className={input+" min-h-24"} placeholder={fr?"Ex. Prospect intéressé par Garden City, souhaite visiter avant de signer. Questions sur financement et accès au terrain.":"E.g. Prospect interested in Garden City, wants to visit before signing. Questions about financing and land access."}/></label>
    <button className="rounded-lg bg-cyan-900 px-5 py-3 font-bold text-white lg:col-span-2 xl:col-span-3">{fr?"Référer la visite":"Refer visit"}</button>
   </form>
   {!(crmProspects||[]).length&&<p className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-600">{fr?"Aucun prospect CRM disponible dans cette base de test.":"No CRM prospects are available in this test database."}</p>}

   <div className="mt-5 rounded-xl border border-cyan-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">{fr?"Mes visites référées":"My referred visits"}</h3><p className="text-xs text-slate-500">{fr?"Vous suivez ici uniquement les visites que vous avez référées, même lorsqu’elles sont gérées par un autre bureau.":"Track only the visits you referred here, even when another office manages them."}</p></div><span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-900">{(myReferredVisits||[]).length}</span></div>
    {(myReferredVisits||[]).length?<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-2">{fr?"Prospect":"Prospect"}</th><th className="p-2">{fr?"Destination":"Destination"}</th><th className="p-2">{fr?"Date locale":"Local date"}</th><th className="p-2">{fr?"Statut":"Status"}</th><th className="p-2">{fr?"Responsable local":"Local host"}</th><th className="p-2">{fr?"Résultat":"Outcome"}</th></tr></thead><tbody>{(myReferredVisits||[]).map(v=>{const destination=allSiteById.get(v.site_id||"");const person=map.get(v.visitor_id);return <tr key={v.id} className="border-b last:border-0"><td className="p-2 font-semibold">{person?.full_name||(fr?"Prospect CRM":"CRM prospect")}</td><td className="p-2">{destination?.name||"—"}{destination?.city?" · "+destination.city:""}</td><td className="p-2">{v.scheduled_local?.slice(0,16).replace("T"," ")||"—"}</td><td className="p-2"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">{fr?({scheduled:"Planifiée",announced:"Annoncée",arrived:"Arrivé",in_progress:"En visite",completed:"Terminée",no_show:"Absent",cancelled:"Annulée"} as Record<string,string>)[v.status]||v.status:v.status}</span></td><td className="p-2">{v.host_name||(fr?"À attribuer":"Unassigned")}</td><td className="p-2">{v.visit_outcome||v.follow_up_status||"—"}</td></tr>})}</tbody></table></div>:<p className="mt-3 text-sm text-slate-500">{fr?"Aucune visite référée pour le moment.":"No referred visits yet."}</p>}
   </div>
  </section>

  <div data-canton-view="dashboard" className="space-y-3">
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
    {label:fr?"Aujourd’hui":"Today",value:todayRows.length,href:"/dashboard/canton-visitors?view=reception"},
    {label:fr?"Attendus":"Expected",value:count(v=>v.status==="scheduled"),href:"/dashboard/canton-visitors?view=reception&filter=expected"},
    {label:fr?"Sur place":"On site",value:count(v=>["arrived","in_progress"].includes(v.status)),href:"/dashboard/canton-visitors?view=reception&filter=on_site"},
    {label:fr?"Terminées":"Completed",value:count(v=>v.status==="completed"),href:"/dashboard/canton-visitors?view=appointments&filter=completed"},
    {label:fr?"Avis":"Feedback",value:(feedback||[]).length,href:"/dashboard/canton-visitors?view=feedback"},
    {label:fr?"Taux de réponse":"Response rate",value:feedbackResponseRate,href:"/dashboard/canton-visitors?view=feedback"},
    {label:fr?"Note moyenne":"Avg. rating",value:ratingAverage,href:"/dashboard/canton-visitors?view=feedback"},
    {label:fr?"Attention requise":"Attention needed",value:pendingFeedback,href:"/dashboard/canton-visitors?view=feedback&filter=attention"},
    {label:fr?"Suivis ouverts":"Follow-ups open",value:pendingHandoffs,href:"/dashboard/canton-visitors?view=commercial&filter=open"},
    {label:fr?"Sans responsable":"Unassigned follow-ups",value:unassignedFollowUps.length,href:"/dashboard/canton-visitors?view=commercial&filter=unassigned"},
    {label:fr?"Prochaines actions":"Next actions",value:openNextActions.length,href:"/dashboard/canton-visitors?view=commercial&filter=actions"},
    {label:fr?"À faire aujourd’hui":"Due today",value:nextActionsToday.length,href:"/dashboard/canton-visitors?view=commercial&filter=due_today"},
    {label:fr?"En retard":"Overdue",value:overdueNextActions.length,href:"/dashboard/canton-visitors?view=commercial&filter=overdue"}
   ].map(card=><Link key={card.label} href={card.href} className="group rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500">
    <div className="flex items-start justify-between gap-2"><div className="text-sm text-slate-500">{card.label}</div><span aria-hidden className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600">→</span></div>
    <div className="mt-1 text-2xl font-bold">{card.value}</div>
   </Link>)}</div>
   <p className="text-xs text-slate-500">{fr?"Chaque tuile ouvre directement l’espace opérationnel correspondant.":"Each tile opens the corresponding operational workspace."}</p>
  </div>
  {(isSenior||isManager||isReception)&&<section data-canton-view="reception" className="rounded-2xl border-2 border-indigo-200 bg-white p-5 shadow-sm">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
     <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">{fr?"Poste réception":"Reception desk"}</p>
     <h2 className="mt-1 text-xl font-bold">{fr?"Arrivées du jour":"Today’s arrivals"}</h2>
     <p className="mt-1 text-sm text-slate-600">{fr?"Une vue rapide pour accueillir, enregistrer l’arrivée et clôturer la visite sans chercher dans l’historique.":"A fast view to welcome visitors, check them in, and close visits without searching the full history."}</p>
    </div>
    <div className="flex flex-wrap gap-2 text-xs">
     <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-800">{fr?"QR à valider":"QR pending"}: {(requests||[]).length}</span>
     <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{fr?"Sur place":"On site"}: {count(v=>["arrived","in_progress"].includes(v.status))}</span>
    </div>
   </div>
   <form method="get" action="/dashboard/canton-visitors" className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row"><input type="hidden" name="view" value="reception"/><input type="hidden" name="site" value={selectedSiteId}/>
    <label className="sr-only" htmlFor="canton-reception-search">{fr?"Rechercher un visiteur":"Search for a visitor"}</label>
    <input id="canton-reception-search" name="q" defaultValue={q} className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-4 text-base" placeholder={fr?"Rechercher : nom, téléphone, email ou responsable…":"Search: name, phone, email or host…"}/>
    <button className="min-h-11 rounded-lg bg-slate-900 px-5 font-semibold text-white">{fr?"Rechercher":"Search"}</button>
    {receptionSearch&&<Link href={"/dashboard/canton-visitors?view=reception&site="+encodeURIComponent(selectedSiteId)} className="min-h-11 rounded-lg border bg-white px-4 py-3 text-center text-sm font-medium">{fr?"Effacer":"Clear"}</Link>}
   </form>
   {receptionSearch&&<p className="mt-2 text-xs text-slate-600">{receptionRows.length} {fr?"résultat(s) aujourd’hui pour":"result(s) today for"} <strong>“{q}”</strong></p>}
   <div className="mt-4 grid gap-3">
    {[...receptionRows.filter(v=>v.status!=="completed")].sort((a,b)=>{
      const rank:Record<string,number>={arrived:0,in_progress:0,scheduled:1,announced:1,completed:2,no_show:3,cancelled:4};
      const ar=rank[a.status]??5,br=rank[b.status]??5;
      if(ar!==br)return ar-br;
      return (a.scheduled_local||a.created_at).localeCompare(b.scheduled_local||b.created_at);
    }).map(v=>{
      const person=map.get(v.visitor_id);
      const statusLabel=fr?({announced:"Annoncée",scheduled:"Attendue",arrived:"Arrivée",in_progress:"En visite",completed:"Terminée",cancelled:"Annulée",no_show:"Absente"} as Record<string,string>)[v.status]||v.status:({announced:"Announced",scheduled:"Expected",arrived:"Arrived",in_progress:"In visit",completed:"Completed",cancelled:"Cancelled",no_show:"No show"} as Record<string,string>)[v.status]||v.status;
      const statusClass=["arrived","in_progress"].includes(v.status)?"bg-emerald-100 text-emerald-900":v.status==="scheduled"?"bg-indigo-100 text-indigo-900":v.status==="completed"?"bg-slate-100 text-slate-700":v.status==="no_show"?"bg-amber-100 text-amber-900":"bg-slate-100 text-slate-700";
      return <article key={v.id} className="grid gap-3 rounded-xl border bg-slate-50 p-4 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
       <div>
        <div className="flex flex-wrap items-center gap-2"><strong className="text-base">{person?.full_name||(fr?"Visiteur":"Visitor")}</strong><span className={"rounded-full px-2 py-1 text-xs font-semibold "+statusClass}>{statusLabel}</span>{v.visit_origin==="crm_referral"&&<span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] font-bold uppercase text-cyan-900">{fr?"Envoyé par CRM":"CRM referral"}</span>}</div>
        <p className="mt-1 text-sm text-slate-600">{siteById.get(v.site_id||"")?.name||"Canton"} · {v.department} · {v.purpose}</p>
        {person?.phone&&<p className="mt-1 text-xs text-slate-500">{person.phone}</p>}
       </div>
       <div className="text-sm">
        <div><span className="text-slate-500">{fr?"Heure":"Time"}:</span> <strong>{v.scheduled_local?.slice(11,16)||(v.check_in_at?new Date(v.check_in_at).toLocaleTimeString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone,hour:"2-digit",minute:"2-digit"}):fr?"Non programmée":"Unscheduled")}</strong></div>
        <div className="mt-1"><span className="text-slate-500">{fr?"Responsable":"Host"}:</span> {v.host_name||"—"}</div>
        {v.status==="arrived"&&v.check_in_at&&(()=>{const wait=Math.max(0,Math.floor((Date.now()-Date.parse(v.check_in_at))/60000));return <div className={"mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold "+(wait>=20?"bg-rose-100 text-rose-900":wait>=10?"bg-amber-100 text-amber-900":"bg-emerald-100 text-emerald-900")}>{fr?"Attente":"Waiting"}: {wait} min</div>;})()}
        {v.status==="in_progress"&&v.visit_started_at&&<div className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-900">{fr?"Prise en charge":"Started"}: {new Date(v.visit_started_at).toLocaleTimeString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone,hour:"2-digit",minute:"2-digit"})}</div>}
       </div>
       <div className="flex flex-wrap gap-2 md:justify-end">
        {["announced","scheduled"].includes(v.status)&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="checkin" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{fr?"✓ Enregistrer l’arrivée":"✓ Check in"}</button></form>}
        {v.status==="arrived"&&(isSenior||isManager||isReception||v.host_user_id===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="start" className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">{fr?"Démarrer la visite":"Start visit"}</button></form>}
        {["arrived","in_progress"].includes(v.status)&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="checkout" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">{fr?"Enregistrer le départ":"Check out"}</button></form>}
        {v.status==="scheduled"&&(isSenior||membership.role==="manager")&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="no_show" className="rounded-lg border bg-white px-3 py-2 text-sm">{fr?"Absent":"No show"}</button></form>}
        {v.status==="completed"&&<span className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-700">{fr?"Visite clôturée":"Visit closed"}</span>}
       </div>
      </article>;
    })}
    {receptionRows.filter(v=>v.status!=="completed").length===0&&<div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">{receptionSearch?(fr?"Aucune visite active ne correspond à cette recherche.":"No active visit matches this search."):(fr?"Aucune visite active ou attendue aujourd’hui.":"No active or expected visits today.")}</div>}
   </div>
   {receptionRows.some(v=>v.status==="completed")&&<details className="mt-4 rounded-xl border bg-slate-50">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">{fr?"Visites terminées aujourd’hui":"Completed today"} ({receptionRows.filter(v=>v.status==="completed").length})</summary>
    <div className="space-y-2 border-t p-3">
     {receptionRows.filter(v=>v.status==="completed").map(v=>{
      const person=map.get(v.visitor_id);
      return <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm">
       <div><strong>{person?.full_name||(fr?"Visiteur":"Visitor")}</strong><div className="text-xs text-slate-500">{siteById.get(v.site_id||"")?.name||"Canton"} · {v.department} · {v.purpose}</div></div>
       <div className="text-xs text-slate-600">{v.check_out_at?new Date(v.check_out_at).toLocaleTimeString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone,hour:"2-digit",minute:"2-digit"}):""}</div>
       <span className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-700">{fr?"Visite clôturée":"Visit closed"}</span>
      </div>;
     })}
    </div>
   </details>}
  </section>}
  {isSenior&&<section data-canton-view="admin" className="space-y-5">
   <section className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <div>
      <p className="text-xs font-bold uppercase tracking-wider text-amber-800">{fr?"Outils administrateur":"Administrator tools"}</p>
      <h2 className="mt-1 text-xl font-bold text-amber-950">{fr?"Simulateur des invitations email":"Email invitation simulator"}</h2>
      <p className="mt-1 text-sm text-amber-900">{fr?"Outil QA sécurisé pour vérifier les invitations du site actif sans envoyer de message externe.":"Secure QA tool for checking invitations for the active site without sending any external message."}</p>
     </div>
     <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-900">QA</span>
    </div>
    <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
     {selectedSiteId!=="all"?<form action={simulateCantonFeedbackInvitations} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="siteId" value={selectedSiteId}/>
      <input type="hidden" name="returnTo" value={currentReturnPath}/>
      <input type="hidden" name="limit" value="20"/>
      <button className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">{fr?"Simuler les invitations de ce site":"Simulate this site's invitations"}</button>
      <span className="text-xs text-slate-700">{fr?"Simulation limitée au site actif : aucun message n’est envoyé.":"Simulation is limited to the active site: no messages are sent."}</span>
     </form>:<p className="text-sm font-medium text-amber-800">{fr?"Sélectionnez un site précis en haut de la page avant de lancer une simulation.":"Select one site at the top of the page before running a simulation."}</p>}
     <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{fr?"Les envois QA réels restent limités au destinataire explicitement autorisé. WhatsApp reste désactivé tant que sa configuration n’est pas validée.":"Real QA sends remain limited to the explicitly allowlisted recipient. WhatsApp stays disabled until its configuration is approved."}</p>
    </div>
   </section>

   <section className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">{fr?"Configuration réseau":"Network configuration"}</p><h2 className="mt-1 text-xl font-bold text-indigo-950">{fr?"Bureaux & centres d’activité":"Offices & activity centers"}</h2><p className="mt-1 text-sm text-indigo-900">{fr?"Ajoutez les futurs bureaux, définissez leur fuseau horaire, leur adresse et leur équipe locale. Canton reste le HQ tant qu’un administrateur ne désigne pas explicitement un autre site.":"Add future offices, configure timezone, address and local team. Canton remains HQ until an administrator explicitly assigns another site."}</p></div>
     <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-900">{(visitorSites||[]).length} {fr?"site(s) actif(s)":"active site(s)"}</span>
    </div>
    <form action={createVisitorSite} className="mt-4 grid gap-3 rounded-xl border border-indigo-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-3"><input type="hidden" name="returnTo" value={currentReturnPath}/>
     <label className="text-sm font-semibold text-slate-700">{fr?"Nom du site *":"Site name *"}<input name="name" required minLength={2} maxLength={180} className={input} placeholder={fr?"Ex. Paris Office":"E.g. Paris Office"}/></label>
     <label className="text-sm font-semibold text-slate-700">{fr?"Code interne *":"Internal code *"}<input name="code" required minLength={2} maxLength={40} className={input} placeholder="PARIS"/></label>
     <label className="text-sm font-semibold text-slate-700">{fr?"Ville":"City"}<input name="city" maxLength={120} className={input} placeholder="Paris"/></label>
     <label className="text-sm font-semibold text-slate-700">{fr?"Pays (ISO)":"Country (ISO)"}<input name="countryCode" maxLength={2} className={input} placeholder="FR"/></label>
     <label className="text-sm font-semibold text-slate-700">{fr?"Fuseau horaire *":"Timezone *"}<input name="timezone" required maxLength={80} className={input} placeholder="Europe/Paris"/></label>
     <label className="text-sm font-semibold text-slate-700 md:col-span-2 xl:col-span-3">{fr?"Adresse physique":"Street address"}<input name="streetAddress" maxLength={300} className={input} placeholder={fr?"Adresse complète pour Google Maps et QR":"Full address for Google Maps and QR"}/></label>
     <button className="rounded-lg bg-indigo-800 px-5 py-3 font-bold text-white md:col-span-2 xl:col-span-3">{fr?"Ajouter le bureau / centre":"Add office / center"}</button>
    </form>

    <div className="mt-5 space-y-4">
     {adminSitesToRender.map(s=><article key={s.id} className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
       <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{s.name}</h3>{s.is_hq&&<span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">HQ</span>}{!s.is_active&&<span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700">{fr?"INACTIF":"INACTIVE"}</span>}</div><p className="mt-1 text-xs text-slate-500">{s.code} · {s.city||"—"} · {s.country_code||"—"} · {s.timezone}</p></div>
       <div className="flex flex-wrap gap-2">
        {!s.is_hq&&<form action={updateVisitorSite}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="siteId" value={s.id}/><button name="operation" value="make_hq" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{fr?"Définir comme HQ":"Make HQ"}</button></form>}
        <form action={updateVisitorSite}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="siteId" value={s.id}/><button name="operation" value="toggle" disabled={s.is_hq&&s.is_active} className="rounded-lg border bg-slate-50 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{s.is_active?(fr?"Désactiver":"Deactivate"):(fr?"Réactiver":"Reactivate")}</button></form>
       </div>
      </div>
      <form action={updateVisitorSite} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
       <input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="siteId" value={s.id}/>
       <input type="hidden" name="operation" value="save"/>
       <label className="text-sm">{fr?"Nom":"Name"}<input name="name" required defaultValue={s.name} className={input}/></label>
       <label className="text-sm">{fr?"Ville":"City"}<input name="city" defaultValue={s.city||""} className={input}/></label>
       <label className="text-sm">{fr?"Pays":"Country"}<input name="countryCode" maxLength={2} defaultValue={s.country_code||""} className={input}/></label>
       <label className="text-sm">{fr?"Fuseau horaire":"Timezone"}<input name="timezone" required defaultValue={s.timezone} className={input}/></label>
       <label className="text-sm md:col-span-2">{fr?"Adresse":"Address"}<input name="streetAddress" defaultValue={s.street_address||""} className={input}/></label>
       <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white xl:col-span-3">{fr?"Enregistrer les paramètres":"Save site settings"}</button>
      </form>

      <details className="mt-4 rounded-lg border bg-slate-50">
       <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">{fr?"Équipe locale & droits":"Local team & access rights"}</summary>
       <CantonSiteStaffManager
        siteId={s.id}
        siteName={s.name}
        returnTo={currentReturnPath}
        locale={fr?"fr":"en"}
        teams={visitorTeams}
        members={(members||[]).map(m=>{const p=profileMap.get(m.user_id);const assigned=siteStaffMap.get(s.id+":"+m.user_id);return {
         userId:m.user_id,
         name:p?.full_name||p?.email||m.user_id,
         email:p?.email||null,
         city:p?.city||null,
         country:p?.country||null,
         orgRole:m.role,
         accessRole:assigned?.access_role||null
        }})}
       />
      </details>
     </article>)}
    </div>
   </section>

   <details className="rounded-xl border bg-white">
    <summary className="cursor-pointer p-5">
     <div className="font-semibold">{fr?"Accès réception historique · Canton HQ":"Legacy reception access · Canton HQ"}</div>
     <div className="mt-1 text-sm font-normal text-slate-500">{fr?"Compatibilité avec l’ancien fonctionnement Canton. Pour le multi-sites, utilisez désormais « Équipe locale & droits » sur chaque site.":"Compatibility with the former Canton workflow. For multi-site access, use Local team & access rights on each site."}</div>
    </summary>
    <div className="border-t p-5">
     <div className="space-y-2">{(members||[]).map(m=><div className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm" key={m.user_id}><span>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id} <span className="text-xs text-slate-500">({m.role})</span></span><form action={manageCantonReceptionStaff}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="userId" value={m.user_id}/><button name="operation" value={assignedIds.has(m.user_id)?"revoke":"grant"} className={assignedIds.has(m.user_id)?"rounded bg-red-100 px-3 py-1":"rounded bg-emerald-100 px-3 py-1"}>{assignedIds.has(m.user_id)?(fr?"Retirer l’accès":"Remove access"):(fr?"Autoriser la réception":"Grant reception access")}</button></form></div>)}</div>
    </div>
   </details>
  </section>}


  {activeView==="dashboard"&&(isSenior||isManager)&&<section className="rounded-xl border bg-white p-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
     <h2 className="font-semibold text-slate-900">{fr?"Invitations satisfaction":"Feedback invitations"}</h2>
     <p className="mt-1 text-sm text-slate-500">{invitationPending} {fr?"en attente":"pending"} · {invitationDue} {fr?"à traiter":"due"}</p>
    </div>
    <Link href={"/dashboard/canton-visitors?view=feedback"+(selectedSiteId!=="all"?"&site="+encodeURIComponent(selectedSiteId):"")} className="rounded-lg border bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">{fr?"Voir":"View"}</Link>
   </div>
  </section>}

  {(isSenior||isManager)&&activeView==="feedback"&&<section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
   <h2 className="text-lg font-semibold">{fr?"Invitations de satisfaction":"Feedback invitation queue"}</h2>
   <p className="mt-2 text-sm text-slate-700">{fr?"Une invitation email est programmée 15 minutes après le départ uniquement avec l’accord du visiteur. Un avis reçu annule automatiquement l’invitation en attente.":"An email invitation is queued 15 minutes after checkout only with explicit consent. A submitted review automatically cancels the pending invitation."}</p>

   <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"En attente":"Pending"}</div><div className="text-xl font-bold">{invitationPending}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"À traiter":"Due"}</div><div className="text-xl font-bold">{invitationDue}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"Annulées":"Cancelled"}</div><div className="text-xl font-bold">{visibleInvitationQueue.filter(x=>x.status==="cancelled").length}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"Simulées (aucun envoi)":"Simulated (not sent)"}</div><div className="text-xl font-bold">{visibleInvitationQueue.filter(x=>x.status==="simulated").length}</div></div>
   </div>
   {visibleInvitationQueue.length>0&&<div className="mt-4 space-y-2">{visibleInvitationQueue.slice(0,10).map(x=>{const visit=visitById.get(x.appointment_id);const visitSite=visit?.site_id?siteById.get(visit.site_id):null;const timeZone=visitSite?.timezone||"America/Chicago";const siteLabel=visitSite?.city||visitSite?.name||(fr?"Site":"Site");return <div key={x.id} className="rounded-lg border bg-white p-3 text-sm">
    <span className="font-semibold">{x.channel==="email"?"Email":"WhatsApp"}</span> · {fr?({pending:"En attente",cancelled:"Annulée",simulated:"Simulée — aucun envoi",sending:"Envoi en cours",sent:"Accepté par le fournisseur",failed:"Échec — vérification nécessaire"} as Record<string,string>)[x.status]||x.status:x.status} · {new Date(x.due_at).toLocaleString(fr?"fr-FR":"en-US",{timeZone})} {siteLabel}
    <span className="ml-2 text-slate-500">({map.get(visit?.visitor_id||"")?.full_name||(fr?"Visite":"Visit")})</span>
    {isSenior&&x.channel==="email"&&x.status==="pending"&&Date.parse(x.due_at)<=Date.now()&&<form action={sendCantonQaEmailTest} className="mt-2"><input type="hidden" name="id" value={x.appointment_id}/><button className="rounded border border-indigo-700 px-3 py-2 text-xs text-indigo-800">{fr?"Tester un email QA (destinataire autorisé)":"Test QA email (allowlisted recipient)"}</button></form>}
    {x.status==="sent"&&<span className="mt-1 block text-xs text-emerald-800">{fr?"Resend a accepté la demande d’envoi. Cela ne garantit pas la livraison en boîte de réception.":"Resend accepted the send request; this does not guarantee inbox delivery."}</span>}
    {x.status==="sending"&&<span className="mt-1 block text-xs text-amber-900">{fr?"État à examiner avant tout nouvel essai.":"Needs review before any retry."}</span>}
    {x.provider_error_code&&<span className="mt-1 block text-xs text-rose-800">{fr?"Erreur fournisseur":"Provider error"}: {x.provider_error_code}</span>}

   </div>})}</div>}
   {!visibleInvitationQueue.length&&<p className="mt-4 text-sm text-slate-700">{fr?"Aucune invitation programmée pour ce site.":"No invitations scheduled for this site."}</p>}
  </section>}

  <details className="rounded-xl border bg-white">
   <summary className="cursor-pointer list-none p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
     <div>
      <h2 className="text-lg font-semibold">{fr?"QR & enregistrement sur place":"QR & on-site registration"}</h2>
      <p className="mt-1 text-sm font-normal text-slate-500">{fr?"Ouvrez cette section uniquement pour créer, afficher ou gérer les QR d’arrivée et de feedback.":"Open this section only when you need to create, display, or manage arrival and feedback QR codes."}</p>
     </div>
     <span className="rounded-lg border bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{fr?"Afficher les QR":"Show QR codes"} ↓</span>
    </div>
   </summary>
   <div className="border-t p-5">
   <h2 className="text-lg font-semibold">{fr?"Deux QR Codes":"Two QR codes"}</h2><p className="mb-4 text-sm text-slate-500">{fr?"1. Le visiteur scanne le QR d’arrivée et la réception confirme. 2. Au départ, il donne son avis par QR avec son nom et quatre chiffres du téléphone, ou anonymement. Aucun code à mémoriser.":"1. Visitor scans the arrival QR and reception confirms. 2. After checkout, visitor scans the feedback QR and enters their name and last four phone digits, or responds anonymously. No visit code."}</p>
   {isSenior&&<form action={createCantonQrSite} className="mb-4 flex flex-wrap gap-2"><input type="hidden" name="returnTo" value={currentReturnPath}/><label className="min-w-[200px] flex-1 text-sm">{fr?"Nouveau point d’accueil":"New reception location"}<input required className="mt-1 w-full rounded border px-3 py-2" name="label" placeholder="Canton Main Reception"/></label><label className="min-w-[220px] flex-1 text-sm">{fr?"Site opérationnel":"Operational site"}<select required name="visitorSiteId" defaultValue={selectedSiteId==="all"?(hqSite?.id||""):selectedSiteId} className="mt-1 w-full rounded border px-3 py-2">{(allVisitorSites||[]).map(s=><option key={s.id} value={s.id}>{s.name}{s.is_hq?" · HQ":""}</option>)}</select></label><label className="min-w-[240px] flex-[2] text-sm">{fr?"Adresse physique du bureau (vérifiée)":"Verified physical office address"}<input name="streetAddress" className="mt-1 w-full rounded border px-3 py-2" placeholder={fr?"Adresse, ville, pays, code postal":"Street, city, country, postal code"}/></label><button className="self-end rounded bg-indigo-700 px-4 py-2 text-white">{fr?"Créer les QR du site":"Create site QR codes"}</button></form>}
   {(()=>{
     const visibleQrSites=(sites||[]).filter(x=>x.enabled&&(selectedSiteId==="all"||x.visitor_site_id===selectedSiteId));
     if(!visibleQrSites.length) return <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-5 text-sm text-indigo-950">
      <div className="font-semibold">{selectedSiteId==="all"?(fr?"Aucun point d’accueil QR actif.":"No active QR reception point."):(fr?"Aucun point d’accueil QR configuré pour ce site.":"No QR reception point is configured for this site.")}</div>
      {isSenior&&<p className="mt-1 text-xs text-indigo-800">{fr?"Utilisez le formulaire ci-dessus pour créer le premier point d’accueil de ce bureau.":"Use the form above to create this office’s first QR reception point."}</p>}
     </div>;
     return <div className="grid gap-4 md:grid-cols-2">{visibleQrSites.map(site=>{
      const arrivalUrl=origin+"/canton-checkin?site="+encodeURIComponent(site.id);
      const feedbackUrl=origin+"/canton-feedback-qr?site="+encodeURIComponent(site.id);
      return <div className="rounded-lg border p-4" key={site.id}>
       <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{site.label}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{siteById.get(site.visitor_site_id||"")?.name||(fr?"Site":"Site")}</span></div>
       {origin?<div className="grid gap-4 lg:grid-cols-2">
        <div><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{fr?"QR arrivée":"Arrival QR"}</p><img src={qrImage(arrivalUrl)} width={220} height={220} alt={"QR registration for "+site.label} className="mx-auto my-3"/><a href={arrivalUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-indigo-700 underline">{fr?"Ouvrir le formulaire d’arrivée":"Open registration form"}</a></div>
        <div><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{fr?"QR feedback":"Feedback QR"}</p><img src={qrImage(feedbackUrl)} width={220} height={220} alt={"QR feedback for "+site.label} className="mx-auto my-3"/><a href={feedbackUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-indigo-700 underline">{fr?"Ouvrir le formulaire d’avis":"Open feedback form"}</a></div>
       </div>:<p>{fr?"QR indisponible sur cet hôte":"QR unavailable on unknown host"}</p>}
       {origin&&<CantonQrActions locale={fr?"fr":"en"} label={site.label} arrivalUrl={arrivalUrl} feedbackUrl={feedbackUrl} posterHref={"/dashboard/canton-visitors/qr-poster?site="+encodeURIComponent(site.id)}/>}
       <p className="mt-2 text-xs text-slate-500">{fr?"Le feedback est rattaché à ce site sans exposer l’organisation au visiteur.":"Feedback is scoped to this site without exposing organization details to the visitor."}</p>
       {site.street_address&&<p className="mt-3 text-sm text-slate-600">{site.street_address}</p>}
       {isSenior&&<form action={updateCantonQrSiteAddress} className="mt-3 space-y-2 border-t pt-3"><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="site" value={site.id}/><label className="block text-sm">{fr?"Adresse du bureau pour Google Maps":"Office address for Google Maps"}<input required minLength={8} maxLength={300} name="streetAddress" defaultValue={site.street_address||""} className={input} placeholder={fr?"Adresse exacte du bureau":"Exact office address"}/></label><button className="rounded bg-indigo-700 px-3 py-2 text-sm text-white">{fr?"Enregistrer l’adresse":"Save address"}</button></form>}
      </div>;
     })}</div>;
    })()}
   </div>
  </details>
  {(isSenior||isManager||isReception)&&<section data-canton-view="reception" className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">{fr?"Arrivées QR à valider (":"QR arrivals pending approval ("}{(requests||[]).length})</h2><p className="mb-3 text-xs text-slate-500">{fr?"Vérifiez l’identité en personne avant de confirmer. Super Leader recherche automatiquement un rendez-vous existant afin d’éviter les doublons.":"Confirm identity in person before approval. Super Leader automatically looks for an existing appointment to avoid duplicate visits."}</p>
   <div className="space-y-3">{(requests||[]).map(q=>{
     const email=(q.email||"").toLowerCase();
     const phone=(q.phone||"").replace(/[^0-9+]/g,"");
     const matchingPeople=(people||[]).filter(p=>(email&&String(p.email||"").toLowerCase()===email)||(phone&&String(p.phone||"")===phone));
     const matchingIds=new Set(matchingPeople.map(p=>p.id));
     const candidateVisits=(visits||[]).filter(v=>matchingIds.has(v.visitor_id)&&v.department===q.department&&v.purpose===q.purpose&&v.status==="scheduled");
     const exact=candidateVisits.length===1?candidateVisits[0]:null;
     const ambiguous=candidateVisits.length>1;
     return <div className="rounded-xl border p-4" key={q.id}>
       <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
         <div className="font-semibold">{q.full_name} · {q.department}</div>
         <div className="text-sm text-slate-600">{q.email||q.phone||""} · {q.purpose}</div>
         {exact&&<div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><strong>{fr?"✓ Rendez-vous retrouvé":"✓ Appointment found"}</strong> · {exact.scheduled_local?.slice(0,16).replace("T"," ")||""} {exact.host_name?("· "+exact.host_name):""}<div className="mt-1 text-xs">{fr?"La validation enregistrera l’arrivée sur ce rendez-vous existant. Aucun doublon ne sera créé.":"Approval will check the visitor into this existing appointment. No duplicate visit will be created."}</div></div>}
         {!exact&&!ambiguous&&<div className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900"><strong>{fr?"Nouvelle visite":"New visit"}</strong><div className="mt-1 text-xs">{fr?"Aucun rendez-vous correspondant n’a été trouvé. La validation créera une arrivée sur place.":"No matching appointment was found. Approval will create a new walk-in visit."}</div></div>}
         {ambiguous&&<div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>{fr?"⚠ Plusieurs rendez-vous possibles":"⚠ Multiple possible appointments"}</strong><div className="mt-1 text-xs">{fr?"Ne validez pas automatiquement. Vérifiez les rendez-vous du visiteur avant de continuer.":"Do not auto-approve. Review the visitor’s appointments before continuing."}</div></div>}
        </div>
        <form action={reviewCantonQrIntake} className="flex flex-wrap gap-2">
         <input type="hidden" name="id" value={q.id}/>
         {!ambiguous&&<button className="rounded bg-green-100 px-3 py-2 font-medium text-green-900" name="decision" value="approve">{exact?(fr?"Confirmer sur le rendez-vous":"Confirm appointment arrival"):(fr?"Confirmer la nouvelle arrivée":"Confirm new arrival")}</button>}
         <button className="rounded bg-slate-100 px-3 py-2" name="decision" value="reject">{fr?"Refuser":"Reject"}</button>
        </form>
       </div>
      </div>;
   })}{!requests?.length&&<p className="py-4 text-sm text-slate-500">{fr?"Aucune arrivée QR en attente.":"No pending QR arrivals."}</p>}</div></section>}
  <section data-canton-view="appointments" className="rounded-xl border bg-white p-5">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2 className="text-lg font-semibold">{fr?"Enregistrer ou annoncer une visite":"Register or announce a visit"}</h2>
    <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-950">
     {fr?"SITE ACTIF":"ACTIVE SITE"} · {activeSite?.name||"—"}{activeSite?.city?" · "+activeSite.city:""}
    </div>
   </div>
   <p className="mb-3 rounded-lg bg-indigo-50 p-3 text-xs font-medium text-indigo-900">{fr?"Pour enregistrer une visite dans un autre bureau, changez d’abord le site actif en haut de la page.":"To register a visit at another office, first change the active site at the top of the page."}</p>
   <input form="canton-appointment-form" type="hidden" name="siteId" value={effectiveSiteId}/>
   <p className="mb-3 text-xs text-slate-500">{fr?"L’email est obligatoire pour identifier le visiteur et permettre le suivi commercial. Le téléphone reste fortement recommandé. Les doublons exacts sont bloqués.":"Email is required to identify the visitor and support commercial follow-up. Phone remains strongly recommended. Exact duplicate appointments are blocked."}</p>
   <form id="canton-appointment-form" action={createCantonAppointment} className="grid gap-3 md:grid-cols-3"><input type="hidden" name="returnTo" value={currentReturnPath}/>
    <label className="text-sm">{fr?"Nom complet *":"Full name *"}<input className={input} name="name" required maxLength={180}/></label>
    <label className="text-sm">{fr?"Téléphone":"Telephone"}<input className={input} name="phone" type="tel" placeholder="+1 555 123 4567"/></label>
    <label className="text-sm">Email *<input className={input} name="email" type="email" required/></label>
    <label className="text-sm">{fr?"Département":"Department"}<select className={input} name="department"><option value="DIG">{fr?"DIG – Terrains":"DIG – Land"}</option><option value="TCF">{fr?"TCF – Ferme":"TCF – Farm"}</option><option value="DIRECTION">Direction</option><option value="OTHER">{fr?"Autre":"Other"}</option></select></label>
    <label className="text-sm">{fr?"Motif":"Purpose"}<select className={input} name="purpose"><option value="land_tour">{fr?"Visite de terrain":"Land tour"}</option><option value="farm_tour">{fr?"Visite de ferme":"Farm tour"}</option><option value="meeting">{fr?"Rendez-vous":"Meeting"}</option><option value="other">{fr?"Autre":"Other"}</option></select></label>
    <label className="text-sm">{fr?"Arrivée prévue (heure locale du site)":"Scheduled arrival (site local time)"}<input className={input} name="scheduled" type="datetime-local"/></label>
    <label className="text-sm">{fr?"Responsable / Équipe":"Host / team member"}<select className={input} name="hostUserId" defaultValue=""><option value="">{fr?"Choisir un responsable Super Leader":"Choose a Super Leader host"}</option>{siteHostMembers.map(m=><option value={m.user_id} key={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id}</option>)}</select><input type="hidden" name="host" value=""/></label>
    <label className="text-sm md:col-span-2">{fr?"Notes (facultatif)":"Notes (optional)"}<input className={input} name="notes"/></label>
    <label className="text-sm">{fr?"Langue préférée pour l’email de satisfaction":"Preferred feedback email language"}<select name="feedbackLocale" defaultValue={locale} className={input}><option value="fr">Français</option><option value="en">English</option></select></label>
    <label className="flex items-start gap-3 rounded-lg border bg-slate-50 p-3 text-sm md:col-span-3"><input type="checkbox" name="feedbackEmailConsent" value="yes" className="mt-1 h-4 w-4"/><span><strong>{fr?"Consentement à l’email de satisfaction.":"Feedback email consent."}</strong> {fr?"À cocher uniquement si le visiteur accepte explicitement de recevoir un lien d’avis par email après son départ.":"Check only if the visitor explicitly agrees to a feedback email after checkout."}</span></label>
    <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm md:col-span-3"><input type="checkbox" name="confirmNearby" value="yes" className="mt-1 h-4 w-4"/><span><strong>{fr?"Rendez-vous distinct.":"Separate visit."}</strong> {fr?"À cocher uniquement après avoir vérifié qu’une réservation à moins de 60 minutes représente une autre visite.":"Check only after verifying a nearby booking is genuinely a separate visit."}</span></label>
    <button className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white md:col-span-3">{fr?"Enregistrer la visite":"Register visitor / appointment"}</button>
   </form></section>

  <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div><p className="text-xs font-bold uppercase tracking-wider text-amber-800">{fr?"Encadrement des prospects":"Prospect handoff"}</p><h2 className="mt-1 text-xl font-bold text-amber-950">{fr?"Debrief des visites commerciales":"Commercial visit debrief"}</h2><p className="mt-1 text-sm text-amber-900">{fr?"Après chaque visite DIG ou TCF, qualifiez immédiatement l’intérêt du visiteur et programmez la prochaine action.":"After each DIG or TCF visit, immediately qualify the visitor’s interest and schedule the next action."}</p></div>
    <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-amber-900">{(visits||[]).filter(v=>v.status==="completed"&&["DIG","TCF"].includes(v.department)&&!v.debriefed_at).length} {fr?"à traiter":"pending"}</span>
   </div>
   <div className="mt-4 space-y-4">
    {(visits||[]).filter(v=>v.status==="completed"&&["DIG","TCF"].includes(v.department)&&!v.debriefed_at&&(isSenior||isManager||v.host_user_id===user.id||v.announced_by===user.id)).map(v=><article key={v.id} className="rounded-xl border bg-white p-4">
     <div className="mb-3"><div className="font-semibold">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")} · {v.department}</div><div className="text-sm text-slate-600">{v.purpose} · {v.host_name||"—"}</div></div>
     <form action={saveCantonVisitDebrief} className="grid gap-3 md:grid-cols-2"><input type="hidden" name="returnTo" value={currentReturnPath}/>
      <input type="hidden" name="id" value={v.id}/>
      <label className="text-sm font-medium">{fr?"Niveau d’intérêt *":"Interest level *"}<select name="interest" required defaultValue="" className={input}><option value="" disabled>{fr?"Sélectionner":"Select"}</option><option value="hot">🔥 Hot</option><option value="warm">🟠 Warm</option><option value="cold">🔵 Cold</option><option value="non_commercial">{fr?"Non commercial":"Non-commercial"}</option></select></label>
      <label className="text-sm font-medium">{fr?"Résultat de la visite *":"Visit outcome *"}<select name="outcome" required defaultValue="" className={input}><option value="" disabled>{fr?"Sélectionner":"Select"}</option><option value="information_only">{fr?"Information seulement":"Information only"}</option><option value="follow_up_requested">{fr?"Suivi demandé":"Follow-up requested"}</option><option value="proposal_requested">{fr?"Proposition demandée":"Proposal requested"}</option><option value="next_appointment">{fr?"Prochain rendez-vous":"Next appointment"}</option><option value="ready_to_buy">{fr?"Prêt à acheter / avancer":"Ready to buy / proceed"}</option><option value="not_interested">{fr?"Pas intéressé":"Not interested"}</option><option value="other">{fr?"Autre":"Other"}</option></select></label>
      <label className="text-sm font-medium md:col-span-2">{fr?"Note de debrief *":"Debrief note *"}<textarea name="note" required minLength={5} maxLength={1200} rows={3} className={input} placeholder={fr?"Ce qui a été discuté, intérêt réel, objections, décision du visiteur…":"What was discussed, real interest, objections, visitor decision…"}/></label>
      <label className="text-sm font-medium">{fr?"Prochaine action":"Next action"}<input name="nextAction" minLength={5} maxLength={800} className={input} placeholder={fr?"Ex. Envoyer le contrat et rappeler lundi":"E.g. Send contract and call Monday"}/></label>
      <label className="text-sm font-medium">{fr?"Échéance":"Due date"}<input type="date" name="dueDate" className={input}/></label>
      <button className="rounded-lg bg-amber-900 px-4 py-3 font-semibold text-white md:col-span-2">{fr?"Enregistrer le debrief et la prochaine action":"Save debrief and next action"}</button>
     </form>
    </article>)}
    {!(visits||[]).some(v=>v.status==="completed"&&["DIG","TCF"].includes(v.department)&&!v.debriefed_at&&(isSenior||isManager||v.host_user_id===user.id||v.announced_by===user.id))&&<p className="rounded-lg bg-white p-4 text-sm text-slate-600">{fr?"Aucun debrief commercial en attente pour vous.":"No commercial visit debrief is pending for you."}</p>}
   </div>
  </section>
  <section data-canton-view="commercial" className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
   <h2 className="text-lg font-semibold">{fr?"Mes suivis attribués":"My assigned follow-ups"}</h2>
   <p className="mb-3 text-sm text-slate-600">{fr?"Les actions qui vous ont été confiées apparaissent ici, même si le rendez-vous a été annoncé par un autre collègue.":"Tasks assigned to you appear here, even if another colleague created the visit."}</p>
   <div className="space-y-3">{(visits||[]).filter(v=>v.follow_up_owner_id===user.id && v.follow_up_status==="open").map(v=><div key={v.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-white p-3">
    <div><div className="font-semibold">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")} · {v.department}</div><p className="text-sm">{v.follow_up_note||(fr?"Suivi à effectuer":"Follow-up needed")}</p><p className="text-xs text-slate-500">{fr?"Échéance : ":"Due: "}{v.follow_up_due_date||(fr?"Non précisée":"Unspecified")}</p></div>
    <form action={completeCantonFollowUp} className="w-full space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 md:max-w-lg">
      <input type="hidden" name="id" value={v.id}/>
      <label className="block text-sm font-medium">{fr?"Résultat du suivi *":"Follow-up outcome *"}
       <select name="outcome" className={input} required defaultValue="">
        <option value="" disabled>{fr?"Sélectionnez un résultat":"Select an outcome"}</option>
        <option value="contacted">{fr?"Contact établi":"Contacted"}</option>
        <option value="appointment_scheduled">{fr?"Rendez-vous fixé":"Appointment scheduled"}</option>
        <option value="proposal_sent">{fr?"Proposition envoyée":"Proposal sent"}</option>
        <option value="sale_closed">{fr?"Vente conclue":"Sale closed"}</option>
        <option value="no_response">{fr?"Sans réponse":"No response"}</option>
        <option value="not_interested">{fr?"Pas intéressé":"Not interested"}</option>
        <option value="other">{fr?"Autre résultat":"Other outcome"}</option>
       </select>
      </label>
      <label className="block text-sm font-medium">{fr?"Compte rendu de l’action *":"Action result notes *"}
       <textarea name="resultNote" required minLength={5} maxLength={1000} rows={2} className={input} placeholder={fr?"Ex. Appel effectué, rendez-vous confirmé pour le 23 novembre.":"E.g. Called visitor; meeting confirmed for November 23."}/>
      </label>
      <p className="text-xs text-emerald-900">{fr?"Le suivi sera clôturé uniquement après enregistrement du résultat.":"The follow-up closes only after a result is recorded."}</p>
      <button className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">{fr?"Enregistrer le résultat et clôturer":"Save outcome and close"}</button>
     </form>
   </div>)}{!(visits||[]).some(v=>v.follow_up_owner_id===user.id&&v.follow_up_status==="open")&&<p className="text-sm text-slate-600">{fr?"Aucun suivi ouvert qui vous est attribué.":"No open follow-ups assigned to you."}</p>}</div>
  </section>
  <section data-canton-view="commercial" className="rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">{fr?"Résultats commerciaux enregistrés":"Recorded commercial outcomes"}</h2>
   <p className="mt-1 text-sm text-slate-600">{fr?"Historique des suivis terminés, conservé avec le dossier de visite.":"History of completed follow-ups, linked to the visit."}</p>
   <div className="mt-3 space-y-2">{(visits||[]).filter(v=>v.follow_up_status==="completed"&&v.follow_up_outcome&&(isSenior||v.department!=="DIRECTION")).slice(0,25).map(v=><div key={v.id} className="rounded-lg border bg-slate-50 p-3 text-sm">
    <div className="font-semibold">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")} · {v.department}</div>
    <div>{fr?"Résultat : ":"Outcome: "}{({contacted:fr?"Contact établi":"Contacted",appointment_scheduled:fr?"Rendez-vous fixé":"Appointment scheduled",proposal_sent:fr?"Proposition envoyée":"Proposal sent",sale_closed:fr?"Vente conclue":"Sale closed",no_response:fr?"Sans réponse":"No response",not_interested:fr?"Pas intéressé":"Not interested",other:fr?"Autre":"Other"} as Record<string,string>)[v.follow_up_outcome]||v.follow_up_outcome}</div>
    <p className="mt-1 text-slate-700">{v.follow_up_result_note}</p>
    {(v.department==="DIG"||v.department==="TCF")&&(isSenior||isManager||v.follow_up_owner_id===user.id)&&!visibleNextActions.some(x=>x.appointment_id===v.id&&x.status==="open")&&<form action={createCantonNextAction} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-indigo-200 bg-white p-3"><input type="hidden" name="returnTo" value={currentReturnPath}/>
      <input type="hidden" name="appointmentId" value={v.id}/>
      <label className="min-w-[200px] flex-1 text-sm">{fr?"Prochaine action *":"Next action *"}<input name="actionText" required minLength={5} maxLength={800} className={input} placeholder={fr?"Ex. Relancer après lecture du contrat":"E.g. Follow up after contract review"}/></label>
      <label className="text-sm">{fr?"Date de rappel *":"Follow-up date *"}<input type="date" name="dueDate" required className={input}/></label>
      <button className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white">{fr?"Planifier":"Schedule"}</button>
    </form>}

    <p className="mt-1 text-xs text-slate-500">{v.follow_up_completed_at?new Date(v.follow_up_completed_at).toLocaleString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone}):""}</p>
   </div>)}{!(visits||[]).some(v=>v.follow_up_status==="completed"&&v.follow_up_outcome)&&<p className="text-sm text-slate-500">{fr?"Aucun résultat enregistré pour le moment.":"No completed outcomes recorded yet."}</p>}</div>
  </section>

  <section data-canton-view="commercial" className="rounded-2xl border-2 border-violet-300 bg-violet-50 p-5">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
     <p className="text-xs font-bold uppercase tracking-wider text-violet-800">{fr?"Prospects issus des visites":"Visit-generated prospects"}</p>
     <h2 className="mt-1 text-xl font-bold text-violet-950">{fr?"Pipeline commercial Canton":"Canton commercial pipeline"}</h2>
     <p className="mt-1 text-sm text-violet-900">{fr?"Les visiteurs qualifiés après leur debrief restent visibles jusqu’à leur prochaine action. Les dossiers sans action ou en retard remontent automatiquement en priorité.":"Visitors qualified after debrief stay visible until their next action. Records with no next action or overdue work automatically rise to the top."}</p>
    </div>
    <div className={"rounded-full px-3 py-1 text-sm font-bold "+(atRiskProspects.length?"bg-rose-100 text-rose-900":"bg-white text-violet-900")}>{fr?"À risque":"At risk"}: {atRiskProspects.length}</div>
   </div>
   <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
    <div className="rounded-xl bg-white p-4"><div className="text-xs font-semibold text-slate-500">🔥 Hot</div><div className="mt-1 text-2xl font-bold">{hotProspects.length}</div></div>
    <div className="rounded-xl bg-white p-4"><div className="text-xs font-semibold text-slate-500">🟠 Warm</div><div className="mt-1 text-2xl font-bold">{warmProspects.length}</div></div>
    <div className="rounded-xl bg-white p-4"><div className="text-xs font-semibold text-slate-500">🔵 Cold</div><div className="mt-1 text-2xl font-bold">{coldProspects.length}</div></div>
    <div className="rounded-xl bg-white p-4"><div className="text-xs font-semibold text-slate-500">{fr?"⚪ À qualifier":"⚪ To qualify"}</div><div className="mt-1 text-2xl font-bold">{unqualifiedProspects.length}</div></div>
    <div className={"rounded-xl p-4 "+(atRiskProspects.length?"bg-rose-100":"bg-white")}><div className="text-xs font-semibold text-slate-500">{fr?"Sans action / en retard":"No action / overdue"}</div><div className="mt-1 text-2xl font-bold">{atRiskProspects.length}</div></div>
   </div>
   {atRiskProspects.length>0&&<p role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-medium text-rose-900">{fr?"⚠️ Un prospect qualifié ne doit jamais rester sans prochaine action. Les dossiers signalés ci-dessous doivent être traités en priorité.":"⚠️ A qualified prospect should never remain without a next action. Flagged records below should be handled first."}</p>}
   <div className="mt-4 overflow-auto rounded-xl border bg-white">
    <table className="w-full min-w-[900px] text-left text-sm">
     <thead><tr className="border-b bg-slate-50 text-slate-600">{[fr?"Prospect":"Prospect",fr?"Intérêt":"Interest",fr?"Résultat":"Outcome",fr?"Responsable":"Owner",fr?"Prochaine action":"Next action",fr?"Échéance":"Due",fr?"SLA":"SLA",fr?"État":"State"].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead>
     <tbody>{prospectRows.map(row=>{
      const v=row.visit;
      const interestLabel=v.commercial_interest==="hot"?"🔥 Hot":v.commercial_interest==="warm"?"🟠 Warm":v.commercial_interest==="cold"?"🔵 Cold":fr?"⚪ À qualifier":"⚪ To qualify";
      const outcomeLabel=v.visit_outcome
       ? (fr?({
          information_only:"Information seulement",follow_up_requested:"Suivi demandé",proposal_requested:"Proposition demandée",next_appointment:"Prochain rendez-vous",ready_to_buy:"Prêt à acheter / avancer",not_interested:"Pas intéressé",other:"Autre"
         } as Record<string,string>)[v.visit_outcome]||v.visit_outcome:({
          information_only:"Information only",follow_up_requested:"Follow-up requested",proposal_requested:"Proposal requested",next_appointment:"Next appointment",ready_to_buy:"Ready to buy / proceed",not_interested:"Not interested",other:"Other"
         } as Record<string,string>)[v.visit_outcome]||v.visit_outcome)
       : (fr?({
          contacted:"Contacté",appointment_scheduled:"Rendez-vous planifié",proposal_sent:"Proposition envoyée",sale_closed:"Vente conclue",no_response:"Pas de réponse",not_interested:"Pas intéressé",other:"Autre"
         } as Record<string,string>)[v.follow_up_outcome||""]||v.follow_up_outcome:({
          contacted:"Contacted",appointment_scheduled:"Appointment scheduled",proposal_sent:"Proposal sent",sale_closed:"Sale closed",no_response:"No response",not_interested:"Not interested",other:"Other"
         } as Record<string,string>)[v.follow_up_outcome||""]||v.follow_up_outcome);
      return <tr key={v.id} className={"border-b align-top "+(row.slaLate||row.overdue||row.missingAction?"bg-rose-50/60":row.slaPlannedTooLate||row.slaApproaching?"bg-amber-50/60":"")}>
       <td className="p-3"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.person?.full_name||(fr?"Visiteur":"Visitor")}</span>{v.visit_origin==="crm_referral"&&<span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] font-bold uppercase text-cyan-900">CRM</span>}</div><div className="text-xs text-slate-500">{siteById.get(v.site_id||"")?.name||"Canton"} · {v.department} · {v.purpose}</div></td>
       <td className="p-3">{v.commercial_interest?<span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{interestLabel}</span>:<form action={qualifyCantonLegacyProspect} className="flex min-w-[180px] gap-2"><input type="hidden" name="id" value={v.id}/><select name="interest" required defaultValue="" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"><option value="" disabled>{fr?"À qualifier":"To qualify"}</option><option value="hot">🔥 Hot</option><option value="warm">🟠 Warm</option><option value="cold">🔵 Cold</option><option value="non_commercial">{fr?"Non commercial":"Non-commercial"}</option></select><button className="rounded bg-violet-700 px-2 py-1 text-xs font-semibold text-white">{fr?"Valider":"Save"}</button></form>}</td>
       <td className="p-3">{outcomeLabel||"—"}</td>
       <td className="p-3">{row.ownerId?(profileMap.get(row.ownerId)?.full_name||profileMap.get(row.ownerId)?.email||v.host_name||"—"):(v.host_name||"—")}</td>
       <td className="p-3">{row.action?.action_text||<strong className="text-rose-800">{fr?"Aucune prochaine action":"No next action"}</strong>}</td>
       <td className="p-3">{row.action?.due_date||"—"}</td>
       <td className="p-3">{row.slaHours?<div className="space-y-1"><div className="text-xs font-semibold">{row.slaHours===24?"24 h":row.slaHours===72?"3 jours":"7 jours"}</div><div className="text-[11px] text-slate-500">{fr?"Limite":"Deadline"}: {row.slaDeadline?.toLocaleString(fr?"fr-FR":"en-US",{timeZone:activeTimeZone,month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</div></div>:"—"}</td>
       <td className="p-3">{row.slaLate?<span className="rounded bg-rose-100 px-2 py-1 text-xs font-bold text-rose-900">{fr?"SLA dépassé":"SLA breached"}</span>:row.slaPlannedTooLate?<span className="rounded bg-orange-100 px-2 py-1 text-xs font-bold text-orange-900">{fr?"Action trop tardive":"Action too late"}</span>:row.overdue?<span className="rounded bg-rose-100 px-2 py-1 text-xs font-bold text-rose-900">{fr?"En retard":"Overdue"}</span>:row.dueToday?<span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{fr?"Aujourd’hui":"Today"}</span>:row.missingAction?<span className="rounded bg-rose-100 px-2 py-1 text-xs font-bold text-rose-900">{fr?"À attribuer":"Needs action"}</span>:<span className="rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900">{fr?"Dans le SLA":"Within SLA"}</span>}</td>
      </tr>;
     })}</tbody>
    </table>
    {prospectRows.length===0&&<p className="p-5 text-sm text-slate-600">{fr?"Aucun prospect qualifié pour le moment. Les visiteurs apparaîtront ici après leur debrief DIG/TCF.":"No qualified prospects yet. Visitors will appear here after their DIG/TCF debrief."}</p>}
   </div>
  </section>

  <section data-canton-view="commercial" className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
   <h2 className="text-lg font-semibold">{fr?"Prochaines actions commerciales":"Next commercial actions"}</h2>
   <p className="mt-2 text-sm text-slate-700">{fr?"Une proposition envoyée ne signifie pas que la vente est conclue. Planifiez l’étape suivante et gardez le dossier actif jusqu’à la prochaine décision.":"A proposal sent is not a closed sale. Schedule the next step and keep the opportunity visible until the next decision."}</p>
   <div className="mt-4 grid grid-cols-3 gap-2">
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"Aujourd’hui":"Today"}</div><div className="text-xl font-bold">{nextActionsToday.length}</div></div>
    <div className={"rounded-lg p-3 "+(overdueNextActions.length?"bg-rose-100":"bg-white")}><div className="text-xs text-slate-600">{fr?"En retard":"Overdue"}</div><div className="text-xl font-bold">{overdueNextActions.length}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"À venir":"Upcoming"}</div><div className="text-xl font-bold">{upcomingNextActions.length}</div></div>
   </div>
   {overdueNextActions.length>0&&<p role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-medium text-rose-900">{fr?"⚠️ Certaines actions commerciales sont en retard. Elles doivent être traitées en priorité.":"⚠️ Some commercial actions are overdue and should be handled first."}</p>}
   <div className="mt-4 space-y-3">
    {[...openNextActions].sort((a,b)=>a.due_date.localeCompare(b.due_date)).map(action=>{
     const visit=(visits||[]).find(v=>v.id===action.appointment_id);
     const visitSiteId=visit?.site_id||effectiveSiteId;
     const sameSiteIds=new Set((siteStaff||[]).filter(x=>x.site_id===visitSiteId&&x.is_active).map(x=>x.user_id));
     const reassignmentMembers=(members||[]).filter(m=>sameSiteIds.has(m.user_id)&&m.user_id!==action.assigned_to);
     const currentOwner=profileMap.get(action.assigned_to)?.full_name||profileMap.get(action.assigned_to)?.email||action.assigned_to;
     const visitSiteName=(allVisitorSites||[]).find(s=>s.id===visitSiteId)?.name||activeSite?.name||"Canton";
     return <article key={action.id} className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
       <div>
        <div className="font-semibold">{map.get(visit?.visitor_id||"")?.full_name||(fr?"Visiteur":"Visitor")} · {visit?.department}</div>
        <p className="mt-1 text-sm text-slate-700">{action.action_text}</p>
       </div>
       <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{visitSiteName}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
       <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-900">{fr?"Responsable":"Owner"}: {currentOwner}</span>
       <span>{fr?"Échéance":"Due"}: {action.due_date}</span>
       {action.due_date===today&&<span className="rounded bg-amber-100 px-2 py-1 font-semibold text-amber-900">{fr?"À faire aujourd’hui":"Due today"}</span>}
       {action.due_date<today&&<span className="rounded bg-rose-100 px-2 py-1 font-semibold text-rose-900">{fr?"En retard":"Overdue"}</span>}
       {action.due_date>today&&<span className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700">{fr?"À venir":"Upcoming"}</span>}
      </div>
      {(isSenior||isManager)&&<details className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50">
       <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-indigo-900">{fr?"Changer de responsable":"Change owner"}</summary>
       <form action={reassignCantonNextAction} className="grid gap-3 border-t border-indigo-200 p-3 md:grid-cols-[1fr_1.2fr_auto] md:items-end">
        <input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="actionId" value={action.id}/>
        <label className="text-sm">{fr?"Nouveau collaborateur — même site":"New team member — same site"}<select name="assignedTo" required className={input} defaultValue=""><option value="">{fr?"Choisir dans l’équipe locale":"Choose from local site team"}</option>{reassignmentMembers.map(m=><option value={m.user_id} key={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id}</option>)}</select></label>
        <label className="text-sm">{fr?"Motif *":"Reason *"}<input name="reason" required minLength={5} maxLength={500} className={input} placeholder={fr?"Ex. Cécile indisponible aujourd’hui":"E.g. Cécile is unavailable today"}/></label>
        <button disabled={!reassignmentMembers.length} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{fr?"Confirmer":"Confirm"}</button>
        {!reassignmentMembers.length&&<p className="text-xs text-amber-800 md:col-span-3">{fr?"Aucun autre collaborateur actif n’est affecté à ce site. Ajoutez d’abord la personne dans Administration > équipe du site.":"No other active team member is assigned to this site. Add them first in Administration > site team."}</p>}
       </form>
      </details>}
      {(isSenior||isManager||action.assigned_to===user.id)&&<form action={completeCantonNextAction} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="actionId" value={action.id}/>
       <label className="min-w-[240px] flex-1 text-sm">{fr?"Compte rendu de la nouvelle action *":"Next action completion note *"}<input required minLength={5} maxLength={1000} name="completionNote" className={input}/></label>
       <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">{fr?"Enregistrer et terminer":"Save and complete"}</button>
      </form>}
     </article>;
    })}
    {openNextActions.length===0&&<p className="text-sm text-slate-700">{fr?"Aucune prochaine action ouverte.":"No open next actions."}</p>}
   </div>
  </section>
  {(isSenior||membership.role==="manager")&&unassignedFollowUps.length>0&&<section role="status" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
   <h2 className="text-lg font-semibold text-amber-950">{fr?"⚠️ Suivis commerciaux sans responsable":"⚠️ Commercial follow-ups without owner"}</h2>
   <p className="mt-2 text-sm text-amber-900">{fr?"Ces visites DIG/TCF ont un suivi ouvert ou un avis qui demande une attention particulière, mais aucun responsable n’a été désigné. Attribuez un collaborateur et une échéance ci-dessous.":"These DIG/TCF visits have an open follow-up or feedback requiring attention, but no owner. Assign an employee and a due date below."}</p>
   <div className="mt-3 space-y-2">{unassignedFollowUps.slice(0,10).map(v=><div key={v.id} className="rounded-lg bg-white p-3 text-sm"><strong>{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")}</strong> · {v.department} · <span className="font-medium">{v.follow_up_note||(fr?"Action commerciale à attribuer":"Commercial action to assign")}</span>
     {unreviewedOpportunities.some(x=>x.id===v.id)&&<span className="ml-2 rounded bg-amber-200 px-2 py-1 text-xs">{fr?"Avis nécessitant une attention":"Feedback needs attention"}</span>}</div>)}</div>
   <a href="#canton-followup-handoff" className="mt-3 inline-block rounded-lg bg-amber-900 px-4 py-2 text-sm font-medium text-white">{fr?"Attribuer les suivis":"Assign follow-ups"}</a>
  </section>}
  {(isSenior||membership.role==="manager")&&<section id="canton-followup-handoff" className="scroll-mt-6 rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">{fr?"Suivi après visite":"Follow-up handoff"}</h2>
   <p className="mb-3 text-sm text-slate-500">{fr?"Attribuez un responsable et une échéance après la visite. Le suivi reste ouvert jusqu’à sa clôture.":"Assign a responsible employee and due date after each completed visit. Open tasks remain visible until closed."}</p>
   <div className="space-y-3">{(visits||[]).filter(v=>v.status==="completed" && (v.department!=="DIRECTION"||isSenior)).map(v=>
    <div key={v.id} className="rounded-lg border p-3">
      <p className="mb-2 font-semibold">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")} · {v.department} · {v.follow_up_status==="open"?(fr?"Ouvert":"Open"):v.follow_up_status==="completed"?(fr?"Terminé":"Completed"):(fr?"Non attribué":"Not assigned")}</p>
      <form action={assignCantonFollowUp} className="flex flex-wrap items-end gap-2"><input type="hidden" name="returnTo" value={currentReturnPath}/>
       <input type="hidden" name="id" value={v.id}/>
       <label className="flex-1 text-sm">{fr?"Collaborateur responsable":"Responsible employee"}<select name="ownerId" required className={input} defaultValue={v.follow_up_owner_id||""}><option value="">{fr?"Choisir un collaborateur":"Choose team member"}</option>{(members||[]).filter(m=>siteStaffMap.has((v.site_id||"")+":"+m.user_id)).map(m=><option value={m.user_id} key={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id}</option>)}</select></label>
       <label className="text-sm">{fr?"Échéance":"Due date"}<input name="dueDate" type="date" className={input} required defaultValue={v.follow_up_due_date||""}/></label>
       <label className="min-w-[150px] flex-1 text-sm">{fr?"Prochaine action":"Next action"}<input name="note" className={input} maxLength={1000} defaultValue={v.follow_up_note||""} placeholder={fr?"Appeler le visiteur pour la suite":"Call visitor about next steps"}/></label>
       <button className="rounded-lg bg-indigo-700 px-3 py-2 text-white">{fr?"Attribuer":"Assign"}</button>
      </form>
      {v.follow_up_status==="open"&&<form action={completeCantonFollowUp} className="mt-2"><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button className="rounded bg-green-100 px-3 py-2 text-sm">{fr?"Clôturer le suivi":"Mark follow-up completed"}</button></form>}
    </div>
   )}</div>
  </section>}
  <section data-canton-view="appointments" className="overflow-auto rounded-xl border bg-white p-4"><h2 className="mb-3 text-lg font-semibold">{fr?"Visites et rendez-vous récents (150 derniers)":"Recent visits and appointments (last 150)"}</h2><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b text-slate-500">{[fr?"Visiteur":"Visitor",fr?"Département":"Department",(fr?"Quand ("+(activeSite?.city||activeSite?.name||"site")+")":"When ("+(activeSite?.city||activeSite?.name||"site")+")"),fr?"Statut":"Status",fr?"Responsable":"Host",fr?"Actions":"Actions",fr?"Avis":"Feedback"].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead>
   <tbody>{(visits||[]).map(v=><tr className="border-b align-top" key={v.id}>
    <td className="p-2"><div className="font-medium">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")}</div><div className="text-xs text-slate-500">{map.get(v.visitor_id)?.phone}</div></td>
    <td className="p-2">{v.department}<div className="text-xs text-slate-500">{v.purpose}</div></td>
    <td className="p-2">{v.scheduled_local?.slice(0,16).replace("T"," ")||(fr?"Non programmé":"Unscheduled")}</td>
    <td className="p-2">{fr?({announced:"Annoncée",scheduled:"Prévue",arrived:"Arrivée",in_progress:"En cours",completed:"Terminée",cancelled:"Annulée",no_show:"Absent"} as Record<string,string>)[v.status]||v.status:v.status}</td><td className="p-2">{v.host_name||"—"}</td>
    <td className="p-2"><div className="flex flex-wrap gap-2">
     {["announced","scheduled"].includes(v.status)&&(isSenior||isManager||isReception||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="checkin" className="cursor-pointer rounded-lg border border-green-300 bg-green-100 px-3 py-2 font-semibold text-green-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{fr?"Enregistrer l’arrivée":"Check in"}</button></form>}
     {["arrived","in_progress"].includes(v.status)&&(isSenior||isManager||isReception||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="checkout" className="cursor-pointer rounded-lg border border-blue-300 bg-blue-100 px-3 py-2 font-semibold text-blue-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{fr?"Enregistrer le départ":"Check out"}</button></form>}
     {["announced","scheduled","no_show"].includes(v.status)&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit} className="flex gap-1"><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><input name="scheduled" type="datetime-local" aria-label={fr?"Nouvelle date et heure locale du rendez-vous":"New local appointment date and time"} className="max-w-40 rounded border p-1 text-xs" required/><button name="action" value="reschedule" className="cursor-pointer rounded-lg border border-indigo-300 bg-indigo-100 px-3 py-2 font-semibold text-indigo-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{fr?"Reprogrammer":"Reschedule"}</button></form>}
     {v.status==="scheduled"&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><button name="action" value="no_show" className="cursor-pointer rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{fr?"Absent":"No show"}</button></form>}
     {v.status==="completed"&&v.follow_up_required===null&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit} className="flex gap-1"><input type="hidden" name="returnTo" value={currentReturnPath}/><input type="hidden" name="id" value={v.id}/><input type="hidden" name="action" value="followup"/><button name="required" value="yes" className="cursor-pointer rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 font-semibold text-amber-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{fr?"Suivi nécessaire":"Follow up"}</button><button name="required" value="no" className="cursor-pointer rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{fr?"Aucun suivi":"No follow up"}</button></form>}
    </div></td>
    <td className="p-2">{v.status==="completed"?<Link className="inline-flex cursor-pointer items-center rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 font-semibold text-indigo-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" href={`/canton-feedback/${encodeURIComponent(v.feedback_token)}`} target="_blank">{fr?"Lien privé d’avis":"Private feedback link"}</Link>: (fr?"Après le départ":"After checkout")}</td>
   </tr>)}</tbody></table>
  </section>
 </main>;
}
