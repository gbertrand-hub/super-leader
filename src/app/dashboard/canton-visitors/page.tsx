import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import Link from "next/link";
import {headers} from "next/headers";
import {createCantonQrSite,reviewCantonQrIntake,updateCantonQrSiteAddress} from "@/app/actions/canton-qr";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createCantonAppointment,updateCantonVisit,manageCantonReceptionStaff,assignCantonFollowUp,completeCantonFollowUp,createCantonNextAction,completeCantonNextAction,simulateCantonFeedbackInvitations,sendCantonQaEmailTest} from "@/app/actions/canton-visitors";
export const dynamic="force-dynamic";
export default async function CantonVisitorPage({searchParams}:{searchParams:Promise<{error?:string;success?:string;q?:string}>}){
 const {error,success,q=""}=await searchParams;
 const {locale}=await getI18n();const fr=locale==="fr";
 if (!cantonLiveEnabled()) return <main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Canton Visitor Center</h1><p className="mt-3 rounded-lg bg-amber-50 p-4 text-amber-900">Real operations are disabled in this preview until the separate QA database, authentication, and access controls pass end-to-end testing.</p><a href="/canton-demo" className="mt-4 inline-block underline">Open the simulation</a></main>;
 const host=(await headers()).get("host")||"";
 const origin=/^(localhost(:\d+)?|app\.ileadglobal\.org|[a-z0-9-]+\.vercel\.app)$/.test(host)?`${host.startsWith("localhost")?"http":"https"}://${host}`:"";
 const qrImage=(url:string)=>"https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data="+encodeURIComponent(url);
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect("/canton-pilot/login");
 const db=createAdminClient();
 const {data:membership}=await db.from("organization_members").select("organization_id,role")
 .eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(!membership) return <main className="p-8">Access denied.</main>;
 const isSenior=["owner","admin"].includes(membership.role);
 const {data:reception}=await db.from("canton_reception_staff").select("user_id").eq("organization_id",membership.organization_id).eq("user_id",user.id).maybeSingle();
 const isReception=!!reception;
 const {data:members}=(isSenior||membership.role==="manager")?await db.from("organization_members").select("user_id,role").eq("organization_id",membership.organization_id).eq("is_active",true).limit(200):{data:[]};
 const {data:staffAssignments}=isSenior?await db.from("canton_reception_staff").select("user_id").eq("organization_id",membership.organization_id):{data:[]};
 const memberIds=(members||[]).map(m=>m.user_id);
 const {data:memberProfiles}=memberIds.length?await db.from("profiles").select("id,full_name,email").in("id",memberIds):{data:[]};
 const profileMap=new Map((memberProfiles||[]).map(p=>[p.id,p]));
 const assignedIds=new Set((staffAssignments||[]).map(p=>p.user_id));

 const isManager=membership.role==="manager" || membership.role==="hr";
 let visitQuery=db.from("canton_appointments")
  .select("id,visitor_id,department,purpose,status,scheduled_local,host_name,check_in_at,check_out_at,feedback_token,feedback_code,follow_up_required,follow_up_owner_id,follow_up_status,follow_up_due_date,follow_up_note,follow_up_outcome,follow_up_result_note,follow_up_completed_at,created_at,announced_by")
  .eq("organization_id",membership.organization_id);
 if(!isSenior) {
  visitQuery = (isManager || isReception)
   ? visitQuery.neq("department","DIRECTION")
   : visitQuery.or(`announced_by.eq.${user.id},follow_up_owner_id.eq.${user.id}`).neq("department","DIRECTION");
 }
 const {data:visits,error:queryError}=await visitQuery.order("created_at",{ascending:false}).limit(150);
 const {data:sites}=(isSenior||isManager||isReception)?await db.from("canton_qr_sites").select("id,label,enabled,street_address").eq("organization_id",membership.organization_id).order("created_at",{ascending:false}):{data:[]};
 const {data:requests}=isSenior||isManager||isReception?await db.from("canton_intake_requests").select("id,full_name,department,purpose,email,phone,created_at").eq("organization_id",membership.organization_id).eq("status","pending").order("created_at",{ascending:true}).limit(100):{data:[]};
 const visitorIds=[...new Set((visits||[]).map(v=>v.visitor_id))];
 const {data:people}=visitorIds.length?await db.from("canton_visitors").select("id,full_name,phone,email").eq("organization_id",membership.organization_id).in("id",visitorIds):{data:[]};
 const map=new Map((people||[]).map(p=>[p.id,p]));
 const visitIds=(visits||[]).map(v=>v.id);
 const {data:feedback}=visitIds.length?await db.from("canton_visit_feedback")
  .select("appointment_id,rating,contact_requested,submitted_at").in("appointment_id",visitIds):{data:[]};
 const {data:nextActions}=await db.from("canton_next_actions")
  .select("id,appointment_id,assigned_to,action_text,due_date,status,created_at,completion_note,completed_at")
  .eq("organization_id",membership.organization_id)
  .order("created_at",{ascending:false}).limit(150);
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
 const invitationPending=(invitationQueue||[]).filter(x=>x.status==="pending").length;
 const invitationDue=(invitationQueue||[]).filter(x=>x.status==="pending"&&Date.parse(x.due_at)<=Date.now()).length;
 const completedCount=(visits||[]).filter(v=>v.status==="completed").length;
 const feedbackResponseRate=completedCount?Math.round(100*(feedback||[]).length/completedCount)+"%":"—";
 const pendingFeedback=(feedback||[]).filter(x=>x.rating<=2||x.contact_requested).length;
 const pendingHandoffs=(visits||[]).filter(v=>v.follow_up_status==="open").length;
 const flaggedFeedbackVisits=new Set((feedback||[]).filter(f=>f.contact_requested||f.rating<=2).map(f=>f.appointment_id));
 const unassignedFollowUps=(visits||[]).filter(v=>v.status==="completed"&&!v.follow_up_owner_id&&(v.department==="DIG"||v.department==="TCF")&&(v.follow_up_status==="open"||flaggedFeedbackVisits.has(v.id))&&v.follow_up_status!=="completed");
 const unreviewedOpportunities=unassignedFollowUps.filter(v=>flaggedFeedbackVisits.has(v.id));

 const ratingAverage=(feedback||[]).length
  ? ((feedback||[]).reduce((total,f)=>total+f.rating,0)/(feedback||[]).length).toFixed(1):"—";
 const cantonDay=(stamp:string)=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(stamp));const val=(type:string)=>parts.find(p=>p.type===type)?.value||"";return val("year")+"-"+val("month")+"-"+val("day");};
 const today=cantonDay(new Date().toISOString());
 const openNextActions=visibleNextActions.filter(x=>x.status==="open");
 const nextActionsToday=openNextActions.filter(x=>x.due_date===today);
 const overdueNextActions=openNextActions.filter(x=>x.due_date<today);
 const upcomingNextActions=openNextActions.filter(x=>x.due_date>today);

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
 return <main className="space-y-6 p-4 md:p-8">
  <div className="flex justify-end"><CantonLanguageSwitch locale={locale} returnPath="/canton-pilot"/></div>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Canton Visitor Center</h1><p className="text-sm text-slate-500">{fr?"Rendez-vous, arrivées, départs et satisfaction · Canton, Texas (heure locale)":"Appointments, check-in, check-out and visitor experience · Canton, Texas (Central Time)"}</p></div><span className="text-sm text-slate-500">{fr?"TEST · données fictives":"QA · fictitious data"}</span></div>
  {error&&<p role="alert" className="rounded bg-red-100 p-3 text-red-800">{error}</p>}
  {success&&<p role="status" className="rounded bg-green-100 p-3 text-green-800">{success}</p>}
  {queryError&&<p role="alert" className="rounded bg-yellow-100 p-3">{fr?"Base de données non initialisée. Appliquez les migrations Canton.":"Database not initialized. Apply the Canton migration before using this module."}</p>}
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
   [fr?"Aujourd’hui":"Today",todayRows.length],[fr?"Attendus":"Expected",count(v=>v.status==="scheduled")],[fr?"Sur place":"On site",count(v=>["arrived","in_progress"].includes(v.status))],[fr?"Terminées":"Completed",count(v=>v.status==="completed")],[fr?"Avis":"Feedback", (feedback||[]).length],[fr?"Taux de réponse":"Response rate",feedbackResponseRate],[fr?"Note moyenne":"Avg. rating",ratingAverage],[fr?"Attention requise":"Attention needed",pendingFeedback],[fr?"Suivis ouverts":"Follow-ups open",pendingHandoffs],[fr?"Sans responsable":"Unassigned follow-ups",unassignedFollowUps.length],[fr?"Prochaines actions":"Next actions",openNextActions.length],[fr?"À faire aujourd’hui":"Due today",nextActionsToday.length],[fr?"En retard":"Overdue",overdueNextActions.length]
  ].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">{label}</div><div className="text-2xl font-bold">{value}</div></div>)}</div>
  {(isSenior||isManager||isReception)&&<section className="rounded-2xl border-2 border-indigo-200 bg-white p-5 shadow-sm">
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
   <form method="get" action="/canton-pilot" className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row">
    <label className="sr-only" htmlFor="canton-reception-search">{fr?"Rechercher un visiteur":"Search for a visitor"}</label>
    <input id="canton-reception-search" name="q" defaultValue={q} className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-4 text-base" placeholder={fr?"Rechercher : nom, téléphone, email ou responsable…":"Search: name, phone, email or host…"}/>
    <button className="min-h-11 rounded-lg bg-slate-900 px-5 font-semibold text-white">{fr?"Rechercher":"Search"}</button>
    {receptionSearch&&<Link href="/canton-pilot" className="min-h-11 rounded-lg border bg-white px-4 py-3 text-center text-sm font-medium">{fr?"Effacer":"Clear"}</Link>}
   </form>
   {receptionSearch&&<p className="mt-2 text-xs text-slate-600">{receptionRows.length} {fr?"résultat(s) aujourd’hui pour":"result(s) today for"} <strong>“{q}”</strong></p>}
   <div className="mt-4 grid gap-3">
    {[...receptionRows].sort((a,b)=>{
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
        <div className="flex flex-wrap items-center gap-2"><strong className="text-base">{person?.full_name||(fr?"Visiteur":"Visitor")}</strong><span className={"rounded-full px-2 py-1 text-xs font-semibold "+statusClass}>{statusLabel}</span></div>
        <p className="mt-1 text-sm text-slate-600">{v.department} · {v.purpose}</p>
        {person?.phone&&<p className="mt-1 text-xs text-slate-500">{person.phone}</p>}
       </div>
       <div className="text-sm">
        <div><span className="text-slate-500">{fr?"Heure":"Time"}:</span> <strong>{v.scheduled_local?.slice(11,16)||(v.check_in_at?new Date(v.check_in_at).toLocaleTimeString(fr?"fr-FR":"en-US",{timeZone:"America/Chicago",hour:"2-digit",minute:"2-digit"}):fr?"Non programmée":"Unscheduled")}</strong></div>
        <div className="mt-1"><span className="text-slate-500">{fr?"Responsable":"Host"}:</span> {v.host_name||"—"}</div>
       </div>
       <div className="flex flex-wrap gap-2 md:justify-end">
        {["announced","scheduled"].includes(v.status)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="checkin" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{fr?"✓ Enregistrer l’arrivée":"✓ Check in"}</button></form>}
        {["arrived","in_progress"].includes(v.status)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="checkout" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">{fr?"Enregistrer le départ":"Check out"}</button></form>}
        {v.status==="scheduled"&&(isSenior||membership.role==="manager")&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="no_show" className="rounded-lg border bg-white px-3 py-2 text-sm">{fr?"Absent":"No show"}</button></form>}
        {v.status==="completed"&&<span className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-700">{fr?"Visite clôturée":"Visit closed"}</span>}
       </div>
      </article>;
    })}
    {receptionRows.length===0&&<div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">{receptionSearch?(fr?"Aucun visiteur du jour ne correspond à cette recherche.":"No visitor today matches this search."):(fr?"Aucune visite prévue ou enregistrée aujourd’hui.":"No visits scheduled or recorded today.")}</div>}
   </div>
  </section>}
  {isSenior&&<section className="rounded-xl border bg-white p-5"><h2 className="mb-2 text-lg font-semibold">{fr?"Accès réception":"Reception access"}</h2><p className="mb-3 text-sm text-slate-500">{fr?"Autorisez les employés à enregistrer les arrivées et départs. Les visites de direction restent confidentielles.":"Assign staff to check in and check out standard visits. Confidential direction visits remain restricted."}</p>
  <div className="space-y-2">{(members||[]).map(m=><div className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm" key={m.user_id}><span>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id} <span className="text-xs text-slate-500">({m.role})</span></span><form action={manageCantonReceptionStaff}><input type="hidden" name="userId" value={m.user_id}/><button name="operation" value={assignedIds.has(m.user_id)?"revoke":"grant"} className={assignedIds.has(m.user_id)?"rounded bg-red-100 px-3 py-1":"rounded bg-emerald-100 px-3 py-1"}>{assignedIds.has(m.user_id)?(fr?"Retirer l’accès réception":"Remove reception access"):(fr?"Autoriser la réception":"Grant reception access")}</button></form></div>)}</div></section>}


  {(isSenior||isManager)&&<section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
   <h2 className="text-lg font-semibold">{fr?"Invitations de satisfaction (TEST)":"Feedback invitation queue (QA)"}</h2>
   <p className="mt-2 text-sm text-slate-700">{fr?"Une invitation email est programmée 15 minutes après le départ uniquement avec l’accord du visiteur. Un avis reçu annule l’invitation en attente. ":"An email invitation is queued 15 minutes after checkout only with explicit consent. A submitted review cancels pending invitations. "}<strong>{fr?"La simulation n’envoie rien. Seul le test email autorisé par un administrateur peut expédier un vrai message à l’adresse QA. WhatsApp reste désactivé.":"Simulation sends nothing. Only an admin-approved email test may send a real message to the allowlisted QA address. WhatsApp remains disabled."}</strong></p>
   <form action={simulateCantonFeedbackInvitations} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="limit" value="20"/><button className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">{fr?"Simuler les invitations à envoyer":"Simulate due invitations"}</button><span className="text-xs text-slate-700">{fr?"Simulation sécurisée : aucun message n’est envoyé.":"Safe simulation: no messages are sent."}</span></form>
   {isSenior&&<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{fr?"Envoi email réel vers un destinataire QA explicitement autorisé uniquement. Désactivé tant que les paramètres QA ne sont pas configurés. Aucun envoi WhatsApp.":"Real email sending allowed only to one explicitly allowlisted QA recipient. Disabled until QA settings are configured. No WhatsApp sending."}</p>}
   <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"En attente":"Pending"}</div><div className="text-xl font-bold">{invitationPending}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"À traiter":"Due"}</div><div className="text-xl font-bold">{invitationDue}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"Annulées":"Cancelled"}</div><div className="text-xl font-bold">{(invitationQueue||[]).filter(x=>x.status==="cancelled").length}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"Simulées (aucun envoi)":"Simulated (not sent)"}</div><div className="text-xl font-bold">{(invitationQueue||[]).filter(x=>x.status==="simulated").length}</div></div>
   </div>
   {(invitationQueue||[]).length>0&&<div className="mt-4 space-y-2">{(invitationQueue||[]).slice(0,10).map(x=><div key={x.id} className="rounded-lg border bg-white p-3 text-sm">
    <span className="font-semibold">{x.channel==="email"?"Email":"WhatsApp"}</span> · {fr?({pending:"En attente",cancelled:"Annulée",simulated:"Simulée — aucun envoi",sending:"Envoi en cours",sent:"Accepté par le fournisseur",failed:"Échec — vérification nécessaire"} as Record<string,string>)[x.status]||x.status:x.status} · {new Date(x.due_at).toLocaleString("en-US",{timeZone:"America/Chicago"})} Canton
    <span className="ml-2 text-slate-500">({map.get((visits||[]).find(v=>v.id===x.appointment_id)?.visitor_id||"")?.full_name||"Visite"})</span>
    {isSenior&&x.channel==="email"&&x.status==="pending"&&Date.parse(x.due_at)<=Date.now()&&<form action={sendCantonQaEmailTest} className="mt-2"><input type="hidden" name="id" value={x.appointment_id}/><button className="rounded border border-indigo-700 px-3 py-2 text-xs text-indigo-800">{fr?"Tester un email QA (destinataire autorisé)":"Test QA email (allowlisted recipient)"}</button></form>}
    {x.status==="sent"&&<span className="mt-1 block text-xs text-emerald-800">{fr?"Resend a accepté la demande d’envoi. Cela ne garantit pas la livraison en boîte de réception.":"Resend accepted the send request; this does not guarantee inbox delivery."}</span>}
    {x.status==="sending"&&<span className="mt-1 block text-xs text-amber-900">{fr?"État à examiner avant tout nouvel essai.":"Needs review before any retry."}</span>}
    {x.provider_error_code&&<span className="mt-1 block text-xs text-rose-800">{fr?"Erreur fournisseur":"Provider error"}: {x.provider_error_code}</span>}

   </div>)}</div>}
   {!invitationQueue?.length&&<p className="mt-4 text-sm text-slate-700">{fr?"Aucune invitation programmée.":"No invitations scheduled."}</p>}
  </section>}

  <section className="rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">{fr?"Deux QR Codes":"Two QR codes"}</h2><p className="mb-4 text-sm text-slate-500">{fr?"1. Le visiteur scanne le QR d’arrivée et la réception confirme. 2. Au départ, il donne son avis par QR avec son nom et quatre chiffres du téléphone, ou anonymement. Aucun code à mémoriser.":"1. Visitor scans the arrival QR and reception confirms. 2. After checkout, visitor scans the feedback QR and enters their name and last four phone digits, or responds anonymously. No visit code."}</p>
   {isSenior&&<form action={createCantonQrSite} className="mb-4 flex flex-wrap gap-2"><label className="min-w-[200px] flex-1 text-sm">{fr?"Nouveau point d’accueil":"New reception location"}<input required className="mt-1 w-full rounded border px-3 py-2" name="label" placeholder="Canton Main Reception"/></label><label className="min-w-[240px] flex-[2] text-sm">{fr?"Adresse physique du bureau (vérifiée)":"Verified physical office address"}<input name="streetAddress" className="mt-1 w-full rounded border px-3 py-2" placeholder={fr?"Adresse, ville, Texas, code postal":"Street, city, Texas, ZIP"}/></label><button className="self-end rounded bg-indigo-700 px-4 py-2 text-white">{fr?"Créer le QR d’arrivée":"Create arrival QR"}</button></form>}
   <div className="grid gap-4 md:grid-cols-2">{(sites||[]).filter(x=>x.enabled).map(site=>{
     const url=origin+"/canton-checkin?site="+encodeURIComponent(site.id);
     return <div className="rounded-lg border p-4" key={site.id}><h3 className="font-semibold">{site.label}</h3>{origin?<><img src={qrImage(url)} width={220} height={220} alt={"QR registration for "+site.label} className="mx-auto my-3"/><a href={url} target="_blank" rel="noreferrer" className="break-all text-sm text-indigo-700 underline">{fr?"Ouvrir le formulaire d’arrivée":"Open registration form"}</a></>:<p>{fr?"QR indisponible sur cet hôte":"QR unavailable on unknown host"}</p>}{site.street_address&&<p className="mt-3 text-sm text-slate-600">{site.street_address}</p>}{isSenior&&<form action={updateCantonQrSiteAddress} className="mt-3 space-y-2 border-t pt-3"><input type="hidden" name="site" value={site.id}/><label className="block text-sm">{fr?"Adresse du bureau pour Google Maps":"Office address for Google Maps"}<input required minLength={8} maxLength={300} name="streetAddress" defaultValue={site.street_address||""} className={input} placeholder={fr?"Adresse exacte du bureau":"Exact office address"}/></label><button className="rounded bg-indigo-700 px-3 py-2 text-sm text-white">{fr?"Enregistrer l’adresse":"Save address"}</button></form>}</div>;
   })}
   <div className="rounded-lg border p-4"><h3 className="font-semibold">{fr?"Satisfaction des visiteurs":"Visitor feedback"}</h3>{origin?<><img src={qrImage(origin+"/canton-feedback-qr")} width={220} height={220} alt="QR feedback for Canton visits" className="mx-auto my-3"/><a className="text-sm text-indigo-700 underline" href="/canton-feedback-qr" target="_blank">{fr?"Ouvrir le formulaire d’avis":"Open feedback form"}</a></>:<p>{fr?"QR indisponible sur cet hôte":"QR unavailable on unknown host"}</p>}<p className="mt-2 text-xs text-slate-500">{fr?"Sans code. Le visiteur peut identifier sa visite terminée ou donner un avis anonyme.":"No code needed. Visitors can identify their completed visit or leave anonymous feedback."}</p></div>
   </div>
  </section>
  {(isSenior||isManager||isReception)&&<section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">{fr?"Arrivées QR à valider (":"QR arrivals pending approval ("}{(requests||[]).length})</h2><p className="mb-3 text-xs text-slate-500">{fr?"Vérifiez l’identité en personne avant de confirmer. Super Leader recherche automatiquement un rendez-vous existant afin d’éviter les doublons.":"Confirm identity in person before approval. Super Leader automatically looks for an existing appointment to avoid duplicate visits."}</p>
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
  <section className="rounded-xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">{fr?"Enregistrer ou annoncer une visite":"Register or announce a visit"}</h2>
   <p className="mb-3 text-xs text-slate-500">{fr?"Le téléphone ou l’email permet de retrouver le visiteur. Les doublons exacts sont bloqués. Deux rendez-vous rapprochés à moins de 60 minutes nécessitent une confirmation. Heure locale de Canton.":"Phone or email identifies an existing visitor. Exact duplicate appointments are blocked. Bookings for the same visitor, department and purpose within 60 minutes require explicit confirmation. Time is local to Canton."}</p>
   <form action={createCantonAppointment} className="grid gap-3 md:grid-cols-3">
    <label className="text-sm">{fr?"Nom complet *":"Full name *"}<input className={input} name="name" required maxLength={180}/></label>
    <label className="text-sm">{fr?"Téléphone":"Telephone"}<input className={input} name="phone" type="tel" placeholder="+1 555 123 4567"/></label>
    <label className="text-sm">Email<input className={input} name="email" type="email"/></label>
    <label className="text-sm">{fr?"Département":"Department"}<select className={input} name="department"><option value="DIG">{fr?"DIG – Terrains":"DIG – Land"}</option><option value="TCF">{fr?"TCF – Ferme":"TCF – Farm"}</option><option value="DIRECTION">Direction</option><option value="OTHER">{fr?"Autre":"Other"}</option></select></label>
    <label className="text-sm">{fr?"Motif":"Purpose"}<select className={input} name="purpose"><option value="land_tour">{fr?"Visite de terrain":"Land tour"}</option><option value="farm_tour">{fr?"Visite de ferme":"Farm tour"}</option><option value="meeting">{fr?"Rendez-vous":"Meeting"}</option><option value="other">{fr?"Autre":"Other"}</option></select></label>
    <label className="text-sm">{fr?"Arrivée prévue (heure de Canton)":"Scheduled arrival (Canton time)"}<input className={input} name="scheduled" type="datetime-local"/></label>
    <label className="text-sm">{fr?"Responsable / Équipe":"Host / team member"}<input className={input} name="host"/></label>
    <label className="text-sm md:col-span-2">{fr?"Notes (facultatif)":"Notes (optional)"}<input className={input} name="notes"/></label>
    <label className="text-sm">{fr?"Langue préférée pour l’email de satisfaction":"Preferred feedback email language"}<select name="feedbackLocale" defaultValue={locale} className={input}><option value="fr">Français</option><option value="en">English</option></select></label>
    <label className="flex items-start gap-3 rounded-lg border bg-slate-50 p-3 text-sm md:col-span-3"><input type="checkbox" name="feedbackEmailConsent" value="yes" className="mt-1 h-4 w-4"/><span><strong>{fr?"Consentement à l’email de satisfaction.":"Feedback email consent."}</strong> {fr?"À cocher uniquement si le visiteur accepte explicitement de recevoir un lien d’avis par email après son départ.":"Check only if the visitor explicitly agrees to a feedback email after checkout."}</span></label>
    <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm md:col-span-3"><input type="checkbox" name="confirmNearby" value="yes" className="mt-1 h-4 w-4"/><span><strong>{fr?"Rendez-vous distinct.":"Separate visit."}</strong> {fr?"À cocher uniquement après avoir vérifié qu’une réservation à moins de 60 minutes représente une autre visite.":"Check only after verifying a nearby booking is genuinely a separate visit."}</span></label>
    <button className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white md:col-span-3">{fr?"Enregistrer la visite":"Register visitor / appointment"}</button>
   </form></section>

  <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
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
  <section className="rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">{fr?"Résultats commerciaux enregistrés":"Recorded commercial outcomes"}</h2>
   <p className="mt-1 text-sm text-slate-600">{fr?"Historique des suivis terminés, conservé avec le dossier de visite.":"History of completed follow-ups, linked to the visit."}</p>
   <div className="mt-3 space-y-2">{(visits||[]).filter(v=>v.follow_up_status==="completed"&&v.follow_up_outcome&&(isSenior||v.department!=="DIRECTION")).slice(0,25).map(v=><div key={v.id} className="rounded-lg border bg-slate-50 p-3 text-sm">
    <div className="font-semibold">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")} · {v.department}</div>
    <div>{fr?"Résultat : ":"Outcome: "}{({contacted:fr?"Contact établi":"Contacted",appointment_scheduled:fr?"Rendez-vous fixé":"Appointment scheduled",proposal_sent:fr?"Proposition envoyée":"Proposal sent",sale_closed:fr?"Vente conclue":"Sale closed",no_response:fr?"Sans réponse":"No response",not_interested:fr?"Pas intéressé":"Not interested",other:fr?"Autre":"Other"} as Record<string,string>)[v.follow_up_outcome]||v.follow_up_outcome}</div>
    <p className="mt-1 text-slate-700">{v.follow_up_result_note}</p>
    {(v.department==="DIG"||v.department==="TCF")&&(isSenior||isManager||v.follow_up_owner_id===user.id)&&!visibleNextActions.some(x=>x.appointment_id===v.id&&x.status==="open")&&<form action={createCantonNextAction} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-indigo-200 bg-white p-3">
      <input type="hidden" name="appointmentId" value={v.id}/>
      <label className="min-w-[200px] flex-1 text-sm">{fr?"Prochaine action *":"Next action *"}<input name="actionText" required minLength={5} maxLength={800} className={input} placeholder={fr?"Ex. Relancer après lecture du contrat":"E.g. Follow up after contract review"}/></label>
      <label className="text-sm">{fr?"Date de rappel *":"Follow-up date *"}<input type="date" name="dueDate" required className={input}/></label>
      <button className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white">{fr?"Planifier":"Schedule"}</button>
    </form>}

    <p className="mt-1 text-xs text-slate-500">{v.follow_up_completed_at?new Date(v.follow_up_completed_at).toLocaleString(fr?"fr-FR":"en-US",{timeZone:"America/Chicago"}):""}</p>
   </div>)}{!(visits||[]).some(v=>v.follow_up_status==="completed"&&v.follow_up_outcome)&&<p className="text-sm text-slate-500">{fr?"Aucun résultat enregistré pour le moment.":"No completed outcomes recorded yet."}</p>}</div>
  </section>

  <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
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
     return <article key={action.id} className="rounded-lg border bg-white p-4">
      <div className="font-semibold">{map.get(visit?.visitor_id||"")?.full_name||(fr?"Visiteur":"Visitor")} · {visit?.department}</div>
      <p className="mt-1 text-sm">{action.action_text}</p>
      <p className="mt-1 text-xs text-slate-700">{fr?"Échéance":"Due"}: {action.due_date} {action.due_date<today?"⚠️":""}
       {action.due_date===today&&<span className="ml-2 rounded bg-amber-100 px-2 py-1 font-semibold text-amber-900">{fr?"À faire aujourd’hui":"Due today"}</span>}
       {action.due_date<today&&<span className="ml-2 rounded bg-rose-100 px-2 py-1 font-semibold text-rose-900">{fr?"En retard":"Overdue"}</span>}
       {action.due_date>today&&<span className="ml-2 rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700">{fr?"À venir":"Upcoming"}</span>}
      </p>
      {(isSenior||isManager||action.assigned_to===user.id)&&<form action={completeCantonNextAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="actionId" value={action.id}/>
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
      <form action={assignCantonFollowUp} className="flex flex-wrap items-end gap-2">
       <input type="hidden" name="id" value={v.id}/>
       <label className="flex-1 text-sm">{fr?"Collaborateur responsable":"Responsible employee"}<select name="ownerId" required className={input} defaultValue={v.follow_up_owner_id||""}><option value="">{fr?"Choisir un collaborateur":"Choose team member"}</option>{(members||[]).map(m=><option value={m.user_id} key={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id}</option>)}</select></label>
       <label className="text-sm">{fr?"Échéance":"Due date"}<input name="dueDate" type="date" className={input} required defaultValue={v.follow_up_due_date||""}/></label>
       <label className="min-w-[150px] flex-1 text-sm">{fr?"Prochaine action":"Next action"}<input name="note" className={input} maxLength={1000} defaultValue={v.follow_up_note||""} placeholder={fr?"Appeler le visiteur pour la suite":"Call visitor about next steps"}/></label>
       <button className="rounded-lg bg-indigo-700 px-3 py-2 text-white">{fr?"Attribuer":"Assign"}</button>
      </form>
      {v.follow_up_status==="open"&&<form action={completeCantonFollowUp} className="mt-2"><input type="hidden" name="id" value={v.id}/><button className="rounded bg-green-100 px-3 py-2 text-sm">{fr?"Clôturer le suivi":"Mark follow-up completed"}</button></form>}
    </div>
   )}</div>
  </section>}
  <section className="overflow-auto rounded-xl border bg-white p-4"><h2 className="mb-3 text-lg font-semibold">{fr?"Visites et rendez-vous récents (150 derniers)":"Recent visits and appointments (last 150)"}</h2><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b text-slate-500">{[fr?"Visiteur":"Visitor",fr?"Département":"Department",fr?"Quand (Canton)":"When (Canton)",fr?"Statut":"Status",fr?"Responsable":"Host",fr?"Actions":"Actions",fr?"Avis":"Feedback"].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead>
   <tbody>{(visits||[]).map(v=><tr className="border-b align-top" key={v.id}>
    <td className="p-2"><div className="font-medium">{map.get(v.visitor_id)?.full_name||(fr?"Visiteur":"Visitor")}</div><div className="text-xs text-slate-500">{map.get(v.visitor_id)?.phone}</div></td>
    <td className="p-2">{v.department}<div className="text-xs text-slate-500">{v.purpose}</div></td>
    <td className="p-2">{v.scheduled_local?.slice(0,16).replace("T"," ")||(fr?"Non programmé":"Unscheduled")}</td>
    <td className="p-2">{fr?({announced:"Annoncée",scheduled:"Prévue",arrived:"Arrivée",in_progress:"En cours",completed:"Terminée",cancelled:"Annulée",no_show:"Absent"} as Record<string,string>)[v.status]||v.status:v.status}</td><td className="p-2">{v.host_name||"—"}</td>
    <td className="p-2"><div className="flex flex-wrap gap-2">
     {["announced","scheduled"].includes(v.status)&&(isSenior||isManager||isReception||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="checkin" className="rounded bg-green-100 px-2 py-1">{fr?"Enregistrer l’arrivée":"Check in"}</button></form>}
     {["arrived","in_progress"].includes(v.status)&&(isSenior||isManager||isReception||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="checkout" className="rounded bg-blue-100 px-2 py-1">{fr?"Enregistrer le départ":"Check out"}</button></form>}
     {["announced","scheduled","no_show"].includes(v.status)&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit} className="flex gap-1"><input type="hidden" name="id" value={v.id}/><input name="scheduled" type="datetime-local" aria-label={fr?"Nouvelle date du rendez-vous à Canton":"New Canton appointment time"} className="max-w-40 rounded border p-1 text-xs" required/><button name="action" value="reschedule" className="rounded bg-indigo-100 px-2 py-1">{fr?"Reprogrammer":"Reschedule"}</button></form>}
     {v.status==="scheduled"&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="no_show" className="rounded bg-slate-100 px-2 py-1">{fr?"Absent":"No show"}</button></form>}
     {v.status==="completed"&&v.follow_up_required===null&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit} className="flex gap-1"><input type="hidden" name="id" value={v.id}/><input type="hidden" name="action" value="followup"/><button name="required" value="yes" className="rounded bg-amber-100 px-2 py-1">{fr?"Suivi nécessaire":"Follow up"}</button><button name="required" value="no" className="rounded bg-slate-100 px-2 py-1">{fr?"Aucun suivi":"No follow up"}</button></form>}
    </div></td>
    <td className="p-2">{v.status==="completed"?<Link className="text-indigo-700 underline" href={`/canton-feedback/${encodeURIComponent(v.feedback_token)}`} target="_blank">{fr?"Lien privé d’avis":"Private feedback link"}</Link>: (fr?"Après le départ":"After checkout")}</td>
   </tr>)}</tbody></table>
  </section>
 </main>;
}
