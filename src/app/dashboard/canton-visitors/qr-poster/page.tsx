import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getI18n} from "@/i18n/server";

export const dynamic="force-dynamic";

const qrImage=(url:string)=>"https://api.qrserver.com/v1/create-qr-code/?size=700x700&margin=20&data="+encodeURIComponent(url);

export default async function CantonQrPoster({searchParams}:{searchParams:Promise<{site?:string}>}){
 const {site=""}=await searchParams;
 const {locale}=await getI18n();
 const fr=locale==="fr";
 const sb=await createClient();
 const {data:{user}}=await sb.auth.getUser();
 if(!user) redirect("/login?next=/dashboard/canton-visitors");
 const db=createAdminClient();
 const {data:m}=await db.from("organization_members").select("organization_id,role").eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
 if(!m || !["owner","admin"].includes(m.role)) redirect("/dashboard");
 const {data:qrSite}=await db.from("canton_qr_sites")
  .select("id,label,street_address,visitor_site_id,enabled")
  .eq("id",site).eq("organization_id",m.organization_id).eq("enabled",true).maybeSingle();
 if(!qrSite) redirect("/dashboard/canton-visitors");
 const {data:visitorSite}=qrSite.visitor_site_id?await db.from("visitor_sites").select("name,city,country_code,street_address").eq("id",qrSite.visitor_site_id).eq("organization_id",m.organization_id).maybeSingle():{data:null};
  const headersList=await headers();
 const host=headersList.get("host")||"";
 const allowedHost=/^(localhost(:\d+)?|app\.ileadglobal\.org|[a-z0-9-]+\.vercel\.app)$/;
 if(!allowedHost.test(host)) redirect("/dashboard/canton-visitors");
 const origin=`${host.startsWith("localhost")?"http":"https"}://${host}`;
 const arrivalUrl=origin+"/canton-checkin?site="+encodeURIComponent(qrSite.id);
 const feedbackUrl=origin+"/canton-feedback-qr?site="+encodeURIComponent(qrSite.id);
 return <main className="mx-auto min-h-screen max-w-5xl bg-white p-10 text-slate-950 print:max-w-none print:p-4">
  <div className="mb-8 text-center">
   <div className="text-sm font-black uppercase tracking-[0.25em] text-amber-600">iLEAD GLOBAL ┬À SUPER LEADER</div>
   <h1 className="mt-2 text-4xl font-black">{visitorSite?.name||qrSite.label}</h1>
   <p className="mt-2 text-lg text-slate-600">{qrSite.label}</p>
   {(qrSite.street_address||visitorSite?.street_address)&&<p className="mt-1 text-sm text-slate-500">{qrSite.street_address||visitorSite?.street_address}</p>}
  </div>
  <div className="grid gap-8 md:grid-cols-2">
   <section className="rounded-3xl border-2 border-slate-900 p-6 text-center">
    <h2 className="text-2xl font-black">{fr?"QR ARRIV├ëE":"ARRIVAL QR"}</h2>
    <p className="mt-2 text-sm text-slate-600">{fr?"Scannez ici ├á votre arriv├®e.":"Scan here when you arrive."}</p>
    <img src={qrImage(arrivalUrl)} width={520} height={520} alt={fr?"QR arriv├®e":"Arrival QR"} className="mx-auto mt-5 w-full max-w-[520px]"/>
   </section>
   <section className="rounded-3xl border-2 border-slate-900 p-6 text-center">
    <h2 className="text-2xl font-black">{fr?"QR FEEDBACK":"FEEDBACK QR"}</h2>
    <p className="mt-2 text-sm text-slate-600">{fr?"Donnez votre avis apr├¿s votre visite.":"Share your feedback after your visit."}</p>
    <img src={qrImage(feedbackUrl)} width={520} height={520} alt={fr?"QR feedback":"Feedback QR"} className="mx-auto mt-5 w-full max-w-[520px]"/>
   </section>
  </div>
  <div className="mt-8 text-center text-sm text-slate-500 print:hidden">
   {fr?"La fen├¬tre dÔÇÖimpression sÔÇÖouvre automatiquement. Sinon, utilisez Ctrl+P.":"The print dialog opens automatically. If not, use Ctrl+P."}
  </div>
  <script dangerouslySetInnerHTML={{__html:"window.addEventListener('load',()=>setTimeout(()=>window.print(),250));"}}/>
 </main>;
}
