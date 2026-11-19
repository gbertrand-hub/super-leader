import {assertCantonLive, cantonLiveEnabled} from "@/lib/canton/feature-gate";
import Link from "next/link";
import {headers} from "next/headers";
import {createCantonQrSite,reviewCantonQrIntake} from "@/app/actions/canton-qr";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createCantonAppointment,updateCantonVisit,manageCantonReceptionStaff,assignCantonFollowUp,completeCantonFollowUp} from "@/app/actions/canton-visitors";
export const dynamic="force-dynamic";
export default async function CantonVisitorPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {error,success}=await searchParams;
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
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Canton Visitor Center</h1><p className="text-sm text-slate-500">Appointments, check-in, check-out and visitor experience · Canton, Texas (Central Time)</p></div><span className="text-sm text-slate-500">QA · données fictives</span></div>
  {error&&<p role="alert" className="rounded bg-red-100 p-3 text-red-800">{error}</p>}
  {success&&<p role="status" className="rounded bg-green-100 p-3 text-green-800">{success}</p>}
  {queryError&&<p role="alert" className="rounded bg-yellow-100 p-3">Database not initialized. Apply the Canton migration before using this module.</p>}
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
   ["Today",todayRows.length],["Expected",count(v=>v.status==="scheduled")],["On site",count(v=>["arrived","in_progress"].includes(v.status))],["Completed",count(v=>v.status==="completed")],["Feedback", (feedback||[]).length],["Avg. rating",ratingAverage],["Attention needed",pendingFeedback],["Follow-ups open",pendingHandoffs]
  ].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">{label}</div><div className="text-2xl font-bold">{value}</div></div>)}</div>
  {isSenior&&<section className="rounded-xl border bg-white p-5"><h2 className="mb-2 text-lg font-semibold">Reception access</h2><p className="mb-3 text-sm text-slate-500">Assign staff to check in and check out standard visits. Confidential direction visits remain restricted.</p>
  <div className="space-y-2">{(members||[]).map(m=><div className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm" key={m.user_id}><span>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id} <span className="text-xs text-slate-500">({m.role})</span></span><form action={manageCantonReceptionStaff}><input type="hidden" name="userId" value={m.user_id}/><button name="operation" value={assignedIds.has(m.user_id)?"revoke":"grant"} className={assignedIds.has(m.user_id)?"rounded bg-red-100 px-3 py-1":"rounded bg-emerald-100 px-3 py-1"}>{assignedIds.has(m.user_id)?"Remove reception access":"Grant reception access"}</button></form></div>)}</div></section>}

  <section className="rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">Two QR codes / Deux QR codes</h2><p className="mb-4 text-sm text-slate-500">1. Visitor scans arrival QR to request check-in. Reception approves the request. 2. After checkout, visitor scans feedback QR and enters the code given by reception.</p>
   {isSenior&&<form action={createCantonQrSite} className="mb-4 flex flex-wrap gap-2"><label className="min-w-[200px] flex-1 text-sm">New reception location<input required className="mt-1 w-full rounded border px-3 py-2" name="label" placeholder="Canton Main Reception"/></label><button className="self-end rounded bg-indigo-700 px-4 py-2 text-white">Create arrival QR</button></form>}
   <div className="grid gap-4 md:grid-cols-2">{(sites||[]).filter(x=>x.enabled).map(site=>{
     const url=origin+"/canton-checkin?site="+encodeURIComponent(site.id);
     return <div className="rounded-lg border p-4" key={site.id}><h3 className="font-semibold">{site.label}</h3>{origin?<><img src={qrImage(url)} width={220} height={220} alt={"QR registration for "+site.label} className="mx-auto my-3"/><a href={url} target="_blank" rel="noreferrer" className="break-all text-sm text-indigo-700 underline">Open registration form</a></>:<p>QR unavailable on unknown host</p>}</div>;
   })}
   <div className="rounded-lg border p-4"><h3 className="font-semibold">Visitor feedback / Satisfaction</h3>{origin?<><img src={qrImage(origin+"/canton-feedback-qr")} width={220} height={220} alt="QR feedback for Canton visits" className="mx-auto my-3"/><a className="text-sm text-indigo-700 underline" href="/canton-feedback-qr" target="_blank">Open feedback form</a></>:<p>QR unavailable on unknown host</p>}<p className="mt-2 text-xs text-slate-500">Reception provides the one-time visit code after check-out. Only generic public form URLs are sent to the QR image provider.</p></div>
   </div>
  </section>
  {(isSenior||isManager||isReception)&&<section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">QR arrivals pending reception approval ({(requests||[]).length})</h2><p className="mb-3 text-xs text-slate-500">Confirm identity in person before approving. QR registration does not automatically check in a visitor.</p>
   <div className="space-y-3">{(requests||[]).map(q=><div className="flex flex-wrap items-center justify-between gap-3 border-b py-3" key={q.id}><div><div className="font-semibold">{q.full_name} · {q.department}</div><div className="text-sm">{q.email||q.phone||""} · {q.purpose}</div></div><form action={reviewCantonQrIntake} className="flex gap-2"><input type="hidden" name="id" value={q.id}/><button className="rounded bg-green-100 px-3 py-2" name="decision" value="approve">Confirm arrival</button><button className="rounded bg-slate-100 px-3 py-2" name="decision" value="reject">Reject</button></form></div>)}{!requests?.length&&<p className="py-4 text-sm text-slate-500">No pending QR arrivals.</p>}</div></section>}
  <section className="rounded-xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Register or announce a visit</h2>
   <p className="mb-3 text-xs text-slate-500">A phone or email identifies returning visitors. Existing appointments with the same visitor, time, department and purpose are rejected. Date/time is Canton local time.</p>
   <form action={createCantonAppointment} className="grid gap-3 md:grid-cols-3">
    <label className="text-sm">Full name *<input className={input} name="name" required maxLength={180}/></label>
    <label className="text-sm">Telephone<input className={input} name="phone" type="tel" placeholder="+1 555 123 4567"/></label>
    <label className="text-sm">Email<input className={input} name="email" type="email"/></label>
    <label className="text-sm">Department<select className={input} name="department"><option value="DIG">DIG – Land</option><option value="TCF">TCF – Farm</option><option value="DIRECTION">Direction</option><option value="OTHER">Other</option></select></label>
    <label className="text-sm">Purpose<select className={input} name="purpose"><option value="land_tour">Land tour</option><option value="farm_tour">Farm tour</option><option value="meeting">Meeting</option><option value="other">Other</option></select></label>
    <label className="text-sm">Scheduled arrival (Canton time)<input className={input} name="scheduled" type="datetime-local"/></label>
    <label className="text-sm">Host / team member<input className={input} name="host"/></label>
    <label className="text-sm md:col-span-2">Notes (optional)<input className={input} name="notes"/></label>
    <button className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white md:col-span-3">Register visitor / appointment</button>
   </form></section>

  <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
   <h2 className="text-lg font-semibold">Mes suivis / My assigned follow-ups</h2>
   <p className="mb-3 text-sm text-slate-600">Les actions qui vous ont été confiées apparaissent ici, même si le rendez-vous a été annoncé par un autre collègue.</p>
   <div className="space-y-3">{(visits||[]).filter(v=>v.follow_up_owner_id===user.id && v.follow_up_status==="open").map(v=><div key={v.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-white p-3">
    <div><div className="font-semibold">{map.get(v.visitor_id)?.full_name||"Visiteur"} · {v.department}</div><p className="text-sm">{v.follow_up_note||"Suivi à effectuer"}</p><p className="text-xs text-slate-500">Échéance : {v.follow_up_due_date||"Non précisée"}</p></div>
    <form action={completeCantonFollowUp}><input type="hidden" name="id" value={v.id}/><button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">Marquer terminé</button></form>
   </div>)}{!(visits||[]).some(v=>v.follow_up_owner_id===user.id&&v.follow_up_status==="open")&&<p className="text-sm text-slate-600">Aucun suivi ouvert qui vous est attribué.</p>}</div>
  </section>
  {(isSenior||membership.role==="manager")&&<section className="rounded-xl border bg-white p-5">
   <h2 className="text-lg font-semibold">Follow-up handoff / Suivi après visite</h2>
   <p className="mb-3 text-sm text-slate-500">Assign a responsible employee and due date after each completed visit. Open tasks remain visible until closed.</p>
   <div className="space-y-3">{(visits||[]).filter(v=>v.status==="completed" && (v.department!=="DIRECTION"||isSenior)).map(v=>
    <div key={v.id} className="rounded-lg border p-3">
      <p className="mb-2 font-semibold">{map.get(v.visitor_id)?.full_name||"Visitor"} · {v.department} · {v.follow_up_status==="open"?"Open":v.follow_up_status==="completed"?"Completed":"Not assigned"}</p>
      <form action={assignCantonFollowUp} className="flex flex-wrap items-end gap-2">
       <input type="hidden" name="id" value={v.id}/>
       <label className="flex-1 text-sm">Responsible employee<select name="ownerId" required className={input} defaultValue={v.follow_up_owner_id||""}><option value="">Choose team member</option>{(members||[]).map(m=><option value={m.user_id} key={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id}</option>)}</select></label>
       <label className="text-sm">Due date<input name="dueDate" type="date" className={input} required defaultValue={v.follow_up_due_date||""}/></label>
       <label className="min-w-[150px] flex-1 text-sm">Next action<input name="note" className={input} maxLength={1000} defaultValue={v.follow_up_note||""} placeholder="Call visitor about next steps"/></label>
       <button className="rounded-lg bg-indigo-700 px-3 py-2 text-white">Assign</button>
      </form>
      {v.follow_up_status==="open"&&<form action={completeCantonFollowUp} className="mt-2"><input type="hidden" name="id" value={v.id}/><button className="rounded bg-green-100 px-3 py-2 text-sm">Mark follow-up completed</button></form>}
    </div>
   )}</div>
  </section>}
  <section className="overflow-auto rounded-xl border bg-white p-4"><h2 className="mb-3 text-lg font-semibold">Recent visits and appointments (last 150)</h2><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b text-slate-500">{["Visitor","Department","When (Canton)","Status","Host","Actions","Feedback"].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead>
   <tbody>{(visits||[]).map(v=><tr className="border-b align-top" key={v.id}>
    <td className="p-2"><div className="font-medium">{map.get(v.visitor_id)?.full_name||"Visitor"}</div><div className="text-xs text-slate-500">{map.get(v.visitor_id)?.phone}</div></td>
    <td className="p-2">{v.department}<div className="text-xs text-slate-500">{v.purpose}</div></td>
    <td className="p-2">{v.scheduled_local?.slice(0,16).replace("T"," ")||"Unscheduled"}</td>
    <td className="p-2">{v.status}</td><td className="p-2">{v.host_name||"—"}</td>
    <td className="p-2"><div className="flex flex-wrap gap-2">
     {["announced","scheduled"].includes(v.status)&&(isSenior||isManager||isReception||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="checkin" className="rounded bg-green-100 px-2 py-1">Check in</button></form>}
     {["arrived","in_progress"].includes(v.status)&&(isSenior||isManager||isReception||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="checkout" className="rounded bg-blue-100 px-2 py-1">Check out</button></form>}
     {["announced","scheduled","no_show"].includes(v.status)&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit} className="flex gap-1"><input type="hidden" name="id" value={v.id}/><input name="scheduled" type="datetime-local" aria-label="New Canton appointment time" className="max-w-40 rounded border p-1 text-xs" required/><button name="action" value="reschedule" className="rounded bg-indigo-100 px-2 py-1">Reschedule</button></form>}
     {v.status==="scheduled"&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit}><input type="hidden" name="id" value={v.id}/><button name="action" value="no_show" className="rounded bg-slate-100 px-2 py-1">No show</button></form>}
     {v.status==="completed"&&v.follow_up_required===null&&(isSenior||membership.role==="manager"||v.announced_by===user.id)&&<form action={updateCantonVisit} className="flex gap-1"><input type="hidden" name="id" value={v.id}/><input type="hidden" name="action" value="followup"/><button name="required" value="yes" className="rounded bg-amber-100 px-2 py-1">Follow up</button><button name="required" value="no" className="rounded bg-slate-100 px-2 py-1">No follow up</button></form>}
    </div></td>
    <td className="p-2">{v.status==="completed"?<Link className="text-indigo-700 underline" href={`/canton-feedback?token=${v.feedback_token}`} target="_blank">Private feedback link</Link>: "After checkout"}{v.status==="completed"&&<div className="mt-1 text-xs font-semibold">QR visit code: {v.feedback_code}</div>}</td>
   </tr>)}</tbody></table>
  </section>
 </main>;
}
