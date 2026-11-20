import {cantonLiveEnabled} from "@/lib/canton/feature-gate";
import {getI18n} from "@/i18n/server";
import {CantonLanguageSwitch} from "@/components/canton/canton-language-switch";
import Link from "next/link";
import {headers} from "next/headers";
import {createCantonQrSite,reviewCantonQrIntake} from "@/app/actions/canton-qr";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createCantonAppointment,updateCantonVisit,manageCantonReceptionStaff,assignCantonFollowUp,completeCantonFollowUp,simulateCantonFeedbackInvitations} from "@/app/actions/canton-visitors";
export const dynamic="force-dynamic";
export default async function CantonVisitorPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {error,success}=await searchParams;
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
  .select("id,visitor_id,department,purpose,status,scheduled_local,host_name,check_in_at,check_out_at,feedback_token,feedback_code,follow_up_required,follow_up_owner_id,follow_up_status,follow_up_due_date,follow_up_note,created_at,announced_by")
  .eq("organization_id",membership.organization_id);
 if(!isSenior) {
  visitQuery = (isManager || isReception)
   ? visitQuery.neq("department","DIRECTION")
   : visitQuery.or(`announced_by.eq.${user.id},follow_up_owner_id.eq.${user.id}`).neq("department","DIRECTION");
 }
 const {data:visits,error:queryError}=await visitQuery.order("created_at",{ascending:false}).limit(150);
 const {data:sites}=(isSenior||isManager||isReception)?await db.from("canton_qr_sites").select("id,label,enabled").eq("organization_id",membership.organization_id).order("created_at",{ascending:false}):{data:[]};
 const {data:requests}=isSenior||isManager||isReception?await db.from("canton_intake_requests").select("id,full_name,department,purpose,email,phone,created_at").eq("organization_id",membership.organization_id).eq("status","pending").order("created_at",{ascending:true}).limit(100):{data:[]};
 const visitorIds=[...new Set((visits||[]).map(v=>v.visitor_id))];
 const {data:people}=visitorIds.length?await db.from("canton_visitors").select("id,full_name,phone").eq("organization_id",membership.organization_id).in("id",visitorIds):{data:[]};
 const map=new Map((people||[]).map(p=>[p.id,p]));
 const visitIds=(visits||[]).map(v=>v.id);
 const {data:feedback}=visitIds.length?await db.from("canton_visit_feedback")
  .select("appointment_id,rating,contact_requested,submitted_at").in("appointment_id",visitIds):{data:[]};
 const {data:invitationQueue}=(isSenior||isManager)
  ?await db.from("canton_feedback_invitation_outbox")
   .select("id,appointment_id,channel,status,due_at,created_at,reason")
   .eq("organization_id",membership.organization_id)
   .order("created_at",{ascending:false}).limit(100)
  :{data:[]};
 const invitationPending=(invitationQueue||[]).filter(x=>x.status==="pending").length;
 const invitationDue=(invitationQueue||[]).filter(x=>x.status==="pending"&&Date.parse(x.due_at)<=Date.now()).length;
 const completedCount=(visits||[]).filter(v=>v.status==="completed").length;
 const feedbackResponseRate=completedCount?Math.round(100*(feedback||[]).length/completedCount)+"%":"—";
 const pendingFeedback=(feedback||[]).filter(x=>x.rating<=2||x.contact_requested).length;
 const pendingHandoffs=(visits||[]).filter(v=>v.follow_up_status==="open").length;
 const ratingAverage=(feedback||[]).length
  ? ((feedback||[]).reduce((total,f)=>total+f.rating,0)/(feedback||[]).length).toFixed(1):"—";
 const cantonDay=(stamp:string)=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(stamp));const val=(type:string)=>parts.find(p=>p.type===type)?.value||"";return val("year")+"-"+val("month")+"-"+val("day");};
 const today=cantonDay(new Date().toISOString());
 const todayRows=(visits||[]).filter(v=>{
  if(v.check_in_at) return cantonDay(v.check_in_at)===today;
  if(v.scheduled_local) return v.scheduled_local.slice(0,10)===today;
  return cantonDay(v.created_at)===today;
 });
 const count=(p:(v:(typeof todayRows)[number])=>boolean)=>todayRows.filter(p).length;
 const input="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
 return <main className="space-y-6 p-4 md:p-8">
  <div className="flex justify-end"><CantonLanguageSwitch locale={locale} returnPath="/canton-pilot"/></div>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Canton Visitor Center</h1><p className="text-sm text-slate-500">{fr?"Rendez-vous, arrivées, départs et satisfaction · Canton, Texas (heure locale)":"Appointments, check-in, check-out and visitor experience · Canton, Texas (Central Time)"}</p></div><span className="text-sm text-slate-500">{fr?"TEST · données fictives":"QA · fictitious data"}</span></div>
  {error&&<p role="alert" className="rounded bg-red-100 p-3 text-red-800">{error}</p>}
  {success&&<p role="status" className="rounded bg-green-100 p-3 text-green-800">{success}</p>}
  {queryError&&<p role="alert" className="rounded bg-yellow-100 p-3">{fr?"Base de données non initialisée. Appliquez les migrations Canton.":"Database not initialized. Apply the Canton migration before using this module."}</p>}
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
   [fr?"Aujourd’hui":"Today",todayRows.length],[fr?"Attendus":"Expected",count(v=>v.status==="scheduled")],[fr?"Sur place":"On site",count(v=>["arrived","in_progress"].includes(v.status))],[fr?"Terminées":"Completed",count(v=>v.status==="completed")],[fr?"Avis":"Feedback", (feedback||[]).length],[fr?"Taux de réponse":"Response rate",feedbackResponseRate],[fr?"Note moyenne":"Avg. rating",ratingAverage],[fr?"Attention requise":"Attention needed",pendingFeedback],[fr?"Suivis ouverts":"Follow-ups open",pendingHandoffs]
  ].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">{label}</div><div className="text-2xl font-bold">{value}</div></div>)}</div>
  {isSenior&&<section className="rounded-xl border bg-white p-5"><h2 className="mb-2 text-lg font-semibold">{fr?"Accès réception":"Reception access"}</h2><p className="mb-3 text-sm text-slate-500">{fr?"Autorisez les employés à enregistrer les arrivées et départs. Les visites de direction restent confidentielles.":"Assign staff to check in and check out standard visits. Confidential direction visits remain restricted."}</p>
  <div className="space-y-2">{(members||[]).map(m=><div className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm" key={m.user_id}><span>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id} <span className="text-xs text-slate-500">({m.role})</span></span><form action={manageCantonReceptionStaff}><input type="hidden" name="userId" value={m.user_id}/><button name="operation" value={assignedIds.has(m.user_id)?"revoke":"grant"} className={assignedIds.has(m.user_id)?"rounded bg-red-100 px-3 py-1":"rounded bg-emerald-100 px-3 py-1"}>{assignedIds.has(m.user_id)?(fr?"Retirer l’accès réception":"Remove reception access"):(fr?"Autoriser la réception":"Grant reception access")}</button></form></div>)}</div></section>}


  {(isSenior||isManager)&&<section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
   <h2 className="text-lg font-semibold">{fr?"Invitations de satisfaction (TEST)":"Feedback invitation queue (QA)"}</h2>
   <p className="mt-2 text-sm text-slate-700">{fr?"Une invitation email est programmée 15 minutes après le départ uniquement avec l’accord du visiteur. Un avis reçu annule l’invitation en attente. ":"An email invitation is queued 15 minutes after checkout only with explicit consent. A submitted review cancels pending invitations. "}<strong>{fr?"Mode test : aucun email ni WhatsApp n’est envoyé.":"Test mode: no email or WhatsApp is sent."}</strong></p>
   <form action={simulateCantonFeedbackInvitations} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="limit" value="20"/><button className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white">{fr?"Simuler les invitations à envoyer":"Simulate due invitations"}</button><span className="text-xs text-slate-700">{fr?"Simulation sécurisée : aucun message n’est envoyé.":"Safe simulation: no messages are sent."}</span></form>
   <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"En attente":"Pending"}</div><div className="text-xl font-bold">{invitationPending}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"À traiter":"Due"}</div><div className="text-xl font-bold">{invitationDue}</div></div>
    <div className="rounded-lg bg-white p-3"><div className="text-xs text-slate-600">{fr?"Annulées":"Cancelled"}</div><div className="text-xl font-bold">{(invitationQueue||[]).filter(x=>x.status==="cancelled").length}</div></div>
   </div>
   {(invitationQueue||[]).length>0&&<div className="mt-4 space-y-2">{(invitationQueue||[]).slice(0,10).map(x=><div key={x.id} className="rounded-lg border bg-white p-3 text-sm">
    <span className="font-semibold">{x.channel==="email"?"Email":"WhatsApp"}</span> · {x.status} · {new Date(x.due_at).toLocaleString("en-US",{timeZone:"America/Chicago"})} Canton
    <span className="ml-2 text-slate-500">({map.get((visits||[]).find(v=>v.id===x.appointment_id)?.visitor_id||"")?.full_name||"Visite"})</span>
   </div>)}</div>}
   {!invitationQueue?.length&&<p className="mt-4 text-sm text-slate-700">{fr?"Aucune invitation programmée.":"No invitations scheduled."}</p>}
  </section>}

  <section className="rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">{fr?"Deux QR Codes":"Two QR codes"}</h2><p className="mb-4 text-sm text-slate-500">{fr?"1. Le visiteur scanne le QR d’arrivée et la réception confirme. 2. Au départ, il donne son avis par QR avec son nom et quatre chiffres du téléphone, ou anonymement. Aucun code à mémoriser.":"1. Visitor scans the arrival QR and reception confirms. 2. After checkout, visitor scans the feedback QR and enters their name and last four phone digits, or responds anonymously. No visit code."}</p>
   {isSenior&&<form action={createCantonQrSite} className="mb-4 flex flex-wrap gap-2"><label className="min-w-[200px] flex-1 text-sm">{fr?"Nouveau point d’accueil":"New reception location"}<input required className="mt-1 w-full rounded border px-3 py-2" name="label" placeholder="Canton Main Reception"/></label><button className="self-end rounded bg-indigo-700 px-4 py-2 text-white">{fr?"Créer le QR d’arrivée":"Create arrival QR"}</button></form>}
   <div className="grid gap-4 md:grid-cols-2">{(sites||[]).filter(x=>x.enabled).map(site=>{
     const url=origin+"/canton-checkin?site="+encodeURIComponent(site.id);
     return <div className="rounded-lg border p-4" key={site.id}><h3 className="font-semibold">{site.label}</h3>{origin?<><img src={qrImage(url)} width={220} height={220} alt={"QR registration for "+site.label} className="mx-auto my-3"/><a href={url} target="_blank" rel="noreferrer" className="break-all text-sm text-indigo-700 underline">{fr?"Ouvrir le formulaire d’arrivée":"Open registration form"}</a></>:<p>{fr?"QR indisponible sur cet hôte":"QR unavailable on unknown host"}</p>}</div>;
   })}
   <div className="rounded-lg border p-4"><h3 className="font-semibold">{fr?"Satisfaction des visiteurs":"Visitor feedback"}</h3>{origin?<><img src={qrImage(origin+"/canton-feedback-qr")} width={220} height={220} alt="QR feedback for Canton visits" className="mx-auto my-3"/><a className="text-sm text-indigo-700 underline" href="/canton-feedback-qr" target="_blank">{fr?"Ouvrir le formulaire d’avis":"Open feedback form"}</a></>:<p>{fr?"QR indisponible sur cet hôte":"QR unavailable on unknown host"}</p>}<p className="mt-2 text-xs text-slate-500">{fr?"Sans code. Le visiteur peut identifier sa visite terminée ou donner un avis anonyme.":"No code needed. Visitors can identify their completed visit or leave anonymous feedback."}</p></div>
   </div>
  </section>
  {(isSenior||isManager||isReception)&&<section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">{fr?"Arrivées QR à valider (":"QR arrivals pending approval ("}{(requests||[]).length})</h2><p className="mb-3 text-xs text-slate-500">{fr?"Vérifiez l’identité en personne avant de confirmer l’arrivée.":"Confirm identity in person before approving. QR registration does not automatically check in a visitor."}</p>
   <div className="space-y-3">{(requests||[]).map(q=><div className="flex flex-wrap items-center justify-between gap-3 border-b py-3" key={q.id}><div><div className="font-semibold">{q.full_name} · {q.department}</div><div className="text-sm">{q.email||q.phone||""} · {q.purpose}</div></div><form action={reviewCantonQrIntake} className="flex gap-2"><input type="hidden" name="id" value={q.id}/><button className="rounded bg-green-100 px-3 py-2" name="decision" value="approve">{fr?"Confirmer l’arrivée":"Confirm arrival"}</button><button className="rounded bg-slate-100 px-3 py-2" name="decision" value="reject">{fr?"Refuser":"Reject"}</button></form></div>)}{!requests?.length&&<p className="py-4 text-sm text-slate-500">{fr?"Aucune arrivée QR en attente.":"No pending QR arrivals."}</p>}</div></section>}
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
    <form action={completeCantonFollowUp}><input type="hidden" name="id" value={v.id}/><button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">{fr?"Marquer terminé":"Mark completed"}</button></form>
   </div>)}{!(visits||[]).some(v=>v.follow_up_owner_id===user.id&&v.follow_up_status==="open")&&<p className="text-sm text-slate-600">{fr?"Aucun suivi ouvert qui vous est attribué.":"No open follow-ups assigned to you."}</p>}</div>
  </section>
  {(isSenior||membership.role==="manager")&&<section className="rounded-xl border bg-white p-5">
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
    <td className="p-2">{v.status==="completed"?<Link className="text-indigo-700 underline" href={`/canton-feedback?token=${v.feedback_token}`} target="_blank">{fr?"Lien privé d’avis":"Private feedback link"}</Link>: (fr?"Après le départ":"After checkout")}</td>
   </tr>)}</tbody></table>
  </section>
 </main>;
}
