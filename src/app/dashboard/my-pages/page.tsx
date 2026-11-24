import Link from "next/link";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getOrganizationEntitlements} from "@/lib/billing/entitlements";
import {isPlatformOrganization} from "@/lib/acquisition/platform";
import {getPaymentReconciliationAccess} from "@/lib/auth/payment-reconciliation-access";
import {canManageAmbassadors} from "@/lib/crm/ambassador-access";
import {canVerifySalesForFinance} from "@/lib/auth/sensitive-finance-access";
import {getFinanceCustomerAccountAccess} from "@/lib/auth/finance-customer-account-access";
import {
  getNavigationSourceSections, navigationItemDecision, resolveDashboardNavigation,
  CANTON_VISITORS_LINK, type NavigationAccess,
} from "@/lib/navigation/resolve-dashboard-navigation";
import inventory from "@/lib/navigation/route-inventory.json";
import {getI18n} from "@/i18n/server";

export const dynamic="force-dynamic";
type Params={user?:string|string[];q?:string|string[]};
type Member={user_id:string;role:string;organization_id:string;is_active:boolean};
type Profile={id:string;full_name:string|null;email:string|null};
type OrgRelation={name?:string|null}|{name?:string|null}[]|null;
const one=(s:string|string[]|undefined)=>Array.isArray(s)?s[0]||"":s||"";
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export default async function MyPages({searchParams}:{searchParams:Promise<Params>}){
  const {locale,t}=await getI18n();
  const fr=locale==="fr";
  const params=await searchParams;
  const q=one(params.q).trim().toLocaleLowerCase().slice(0,100);
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect("/login");
  const db=createAdminClient();
  const {data:membership}=await db.from("organization_members")
    .select("organization_id,role,is_active,organizations(name)")
    .eq("user_id",user.id).eq("is_active",true).limit(1).maybeSingle();
  if(!membership)return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-bold">{fr?"Mes pages":"My pages"}</h1><p className="mt-3">{fr?"Aucun espace organisationnel actif.":"No active organization workspace."}</p></main>;
  const org=Array.isArray(membership.organizations)?membership.organizations[0]:membership.organizations as OrgRelation;
  const organizationName=(org && !Array.isArray(org)?org.name:"")||"";
  const organizationId=String(membership.organization_id);
  const isAdmin=["owner","admin"].includes(membership.role);
  const requestedUser=one(params.user);
  const targetUserId=isAdmin&&uuid(requestedUser)?requestedUser:user.id;
  const {data:targetMembership}=await db.from("organization_members").select("user_id,role,organization_id,is_active")
    .eq("organization_id",organizationId).eq("user_id",targetUserId).eq("is_active",true)
    .maybeSingle<Member>();
  // Even administrators cannot probe users outside their own organization.
  if(!targetMembership)return <main className="p-8" role="alert">{fr?"Utilisateur non autorisé ou introuvable.":"User not found or not authorized."}</main>;
  const targetRole=targetMembership.role;
  const [entitlements, paymentAccess, financeVerification, customerAccess, ambassadorAccess, vipRow, academyRows, siteStaff, legacyReception] = await Promise.all([
    getOrganizationEntitlements(organizationId),
    getPaymentReconciliationAccess(db,organizationId,targetUserId,targetRole),
    canVerifySalesForFinance(db,organizationId,targetUserId,targetRole),
    getFinanceCustomerAccountAccess(db,organizationId,targetUserId,targetRole),
    canManageAmbassadors(db,organizationId,targetUserId,targetRole),
    db.from("vip_program_settings").select("vip_growth_membership_manager_user_id").eq("organization_id",organizationId).maybeSingle(),
    ["owner","admin","hr"].includes(targetRole)
      ? Promise.resolve({data:[{id:"role"}]})
      : db.from("academy_staff_assignments").select("id").eq("organization_id",organizationId).eq("user_id",targetUserId).eq("is_active",true).in("assignment_role",["director","academic_coordinator","finance","follow_up","data_analyst","observer"]).limit(1),
    db.from("visitor_site_staff").select("site_id,access_role").eq("user_id",targetUserId).eq("is_active",true),
    db.from("canton_reception_staff").select("user_id").eq("organization_id",organizationId).eq("user_id",targetUserId).maybeSingle(),
  ]);
  const access:NavigationAccess={
    role:targetRole,organizationId,hasOrganization:true,
    isPlatformWorkspace:isPlatformOrganization({organizationId,organizationName}),
    enabledFeatures:entitlements.enabledFeatures,
    canReconcilePayments:paymentAccess.allowed,
    canVerifySalesForFinance:financeVerification,
    canAccessFinanceCustomerAccounts:customerAccess.allowed,
    canManageAmbassadors:ambassadorAccess,
    canAccessAcademyFinanceControl:Boolean(academyRows.data?.length),
    hasVipGrowthMembershipAssignment:vipRow.data?.vip_growth_membership_manager_user_id===targetUserId,
  };
  const allowed=resolveDashboardNavigation(access);
  const canSeeCanton=["owner","admin","manager","hr"].includes(targetRole) || Boolean(siteStaff.data?.length) || Boolean(legacyReception.data);
  const resolved=canSeeCanton?[...allowed,{
    id:"canton",labelKey:"navigation.cantonVisitors",icon:"schedule" as const,accent:"sky" as const,
    items:[{...CANTON_VISITORS_LINK,resolvedHref:CANTON_VISITORS_LINK.href,lockedByPlan:false}],
  }]:allowed;
  const visible=resolved.map(section=>({
    ...section, items:section.items.filter(item=>{
      const label=item.label?fr?item.label.fr:item.label.en:t(item.labelKey);
      return !q || (label+" "+item.href+" "+t(section.labelKey)).toLocaleLowerCase().includes(q);
    }),
  })).filter(section=>section.items.length>0);
  const {data:members}=isAdmin?await db.from("organization_members").select("user_id,role")
    .eq("organization_id",organizationId).eq("is_active",true).order("user_id").limit(200):{data:[]};
  const memberIds=(members||[]).map(x=>x.user_id);
  const {data:profiles}=isAdmin&&memberIds.length?await db.from("profiles").select("id,full_name,email").in("id",memberIds):{data:[]};
  const profileMap=new Map(((profiles||[]) as Profile[]).map(x=>[x.id,x]));
  const allSources=getNavigationSourceSections().flatMap(s=>s.items.map(item=>({...item,section:s.id})));
  const links=new Set(allSources.map(x=>x.href.split("?")[0]));
  links.add("/dashboard/canton-visitors");links.add("/dashboard/my-pages");
  const urlIsKnown=(path:string)=>links.has(path)||[...links].some(link=>path.startsWith(link+"/"));
  const orphanRoutes=inventory.routes.filter(x=>x.kind==="static"&&!urlIsKnown(x.path));
  const missingRoutes=allSources.filter(x=>{
    const p=x.href.split("?")[0];
    return !inventory.routes.some(r=>r.path===p||r.kind==="dynamic"&&new RegExp("^"+r.path.replace(/\[[^/]+\]/g,"[^/]+")+"$").test(p));
  }).filter(x=>!x.comingSoon && !x.href.startsWith("/dashboard/coming-soon/"));
  // Inventory is a development snapshot, not a runtime authorization oracle.
  const selected=targetUserId!==user.id;
  const selectedLabel=profileMap.get(targetUserId)?.full_name||profileMap.get(targetUserId)?.email||targetRole;
  const allItems=allSources.filter(x=>{
    if(!q)return true;
    const label=x.label?fr?x.label.fr:x.label.en:t(x.labelKey);
    return (label+" "+x.href).toLocaleLowerCase().includes(q);
  });
  const reasonLabels:Record<string,string>=fr?{
    allowed:"Visible selon le menu",subscription:"Fonction du plan non activée",
    role:"Rôle insuffisant",reconciliation:"Autorisation de rapprochement absente",
    ambassadors:"Autorisation ambassadeurs absente",academy_finance:"Affectation Academy Finance absente",
    platform_only:"Réservé à la plateforme",no_organization:"Organisation absente",
  }:{
    allowed:"Visible in navigation",subscription:"Plan feature not enabled",
    role:"Role not allowed",reconciliation:"Reconciliation grant missing",
    ambassadors:"Ambassador grant missing",academy_finance:"Academy Finance assignment missing",
    platform_only:"Platform only",no_organization:"No organization",
  };
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <div className="rounded-2xl bg-slate-950 p-6 text-white">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">Super Leader · Smart Sitemap</p>
      <h1 className="mt-2 text-3xl font-black">{fr?"Mes pages et plan du site":"My pages and site map"}</h1>
      <p className="mt-2 text-sm text-slate-200">{fr?"Retrouvez vos pages autorisées. Les accès sont contrôlés à nouveau par chaque module.":"Find your available pages. Each module independently enforces its permissions."}</p>
      <p className="mt-2 text-xs text-amber-200">{fr?"Inventaire technique de référence : V4.10.138 Golden.":"Route inventory reference: V4.10.138 Golden."}</p>
    </div>
    <form method="get" className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
      {isAdmin && requestedUser?<input type="hidden" name="user" value={requestedUser}/>:null}
      <input name="q" defaultValue={one(params.q)} className="min-w-[240px] flex-1 rounded-lg border p-3" placeholder={fr?"Rechercher une page ou un module...":"Search for a page or module..."}/>
      <button className="rounded-lg bg-indigo-700 px-5 py-2 font-semibold text-white">{fr?"Rechercher":"Search"}</button>
      <Link href="/dashboard/my-pages" className="rounded-lg border px-5 py-2">{fr?"Réinitialiser":"Reset"}</Link>
    </form>
    {isAdmin?<div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <p className="font-bold text-indigo-950">{fr?"Diagnostic de visibilité (lecture seule)":"Visibility diagnostics (read-only)"}</p>
      <p className="mt-1 text-sm text-indigo-800">{fr?"L'inventaire ne modifie jamais les permissions. Choisir un utilisateur n'ouvre pas une session à sa place.":"This inventory never changes access rights. Selecting a user does not impersonate them."}</p>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        {q?<input type="hidden" name="q" value={q}/>:null}
        <select name="user" defaultValue={targetUserId} className="min-w-[260px] flex-1 rounded-lg border bg-white p-3">
          {(members||[]).map(m=><option key={m.user_id} value={m.user_id}>{profileMap.get(m.user_id)?.full_name||profileMap.get(m.user_id)?.email||m.user_id} · {m.role}</option>)}
        </select>
        <button className="rounded-lg bg-indigo-700 px-5 py-3 font-semibold text-white">{fr?"Diagnostiquer":"Diagnose"}</button>
      </form>
      <p className="mt-2 text-xs text-indigo-700">{fr?"Affichage basé sur les règles du menu. Les accès détaillés sont toujours vérifiés par le serveur.":"Based on menu rules. Actual module permissions are always enforced on the server."}</p>
    </div>:null}
    {selected?<p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{fr?"Diagnostic des menus de ":"Menu diagnosis for "}{selectedLabel}. {fr?"Les liens sont inspectés, pas ouverts sous cette identité.":"Links are inspected, not opened using their identity."}</p>:null}
    <div className="grid gap-4 md:grid-cols-2">
      {visible.map(section=><section key={section.id} className="rounded-xl border bg-white p-5">
        <h2 className="border-b pb-3 text-lg font-bold">{section.id==="canton"?(fr?"Gestion des visiteurs":"Visitor management"):t(section.labelKey)}</h2>
        <div className="mt-3 space-y-2">{section.items.map(item=>{
          const title=item.label?fr?item.label.fr:item.label.en:t(item.labelKey);
          return <div key={item.href} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-3">
            {selected?<span className="font-semibold text-slate-800">{title}</span>:<Link href={item.resolvedHref} className="font-semibold text-indigo-800 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-950">{title} ↗</Link>}
            {item.lockedByPlan?<span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">{fr?"Plan requis":"Plan required"}</span>:null}
          </div>;
        })}</div>
      </section>)}
    </div>
    {!visible.length?<p className="rounded-xl border bg-white p-6">{fr?"Aucune page dans vos accès ne correspond à cette recherche.":"No accessible page matches your search."}</p>:null}
    {isAdmin?<section className="space-y-4 rounded-xl border border-slate-300 bg-white p-5">
      <h2 className="text-xl font-bold">{fr?"Audit du plan du site · administrateurs":"Site map audit · administrators"}</h2>
      <p className="text-sm text-slate-600">{inventory.routes.length} {fr?"pages recensées dans le code Golden, dont":"page routes found in Golden source, including"} {inventory.routes.filter(r=>r.kind==="dynamic").length} {fr?"routes dynamiques. L'audit statique n'est pas un test HTTP et ne prouve pas qu'une page est fonctionnelle.":"dynamic routes. Static inventory is not a runtime HTTP or functional test."}</p>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-semibold">{fr?"Pages techniques ou absentes du menu":"Routes not directly referenced by navigation"} ({orphanRoutes.length})</summary>
        <div className="mt-3 max-h-80 space-y-1 overflow-auto">{orphanRoutes.map(r=><div className="break-all rounded bg-slate-50 p-2 text-xs" key={r.path}>{r.path}</div>)}</div>
        <p className="mt-2 text-xs text-amber-800">{fr?"Une page non référencée peut être un détail interne légitime. Audit humain requis avant d'ajouter un lien.":"An unreferenced route may be an intentional detail page. Review before adding a shortcut."}</p>
      </details>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">{fr?"Liens déclarés à examiner":"Registered links to review"} ({missingRoutes.length})</summary>
        <div className="mt-3 max-h-80 space-y-1 overflow-auto">{missingRoutes.map(x=><div className="break-all rounded bg-amber-50 p-2 text-xs" key={x.href}>{x.href}</div>)}</div>
        <p className="mt-2 text-xs text-amber-800">{fr?"Les liens avec paramètres, réécritures et pages partagées nécessitent une vérification manuelle.":"Aliases, rewrites and shared paths require manual verification."}</p>
      </details>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">{fr?"Diagnostic des restrictions par page":"Page visibility reasons"} ({allItems.length})</summary>
        <div className="mt-3 max-h-96 space-y-1 overflow-auto">{allItems.map(x=>{
          const decision=navigationItemDecision(x,access);
          return <div className="flex flex-wrap justify-between gap-2 rounded bg-slate-50 p-2 text-xs" key={x.href}>
            <span className="break-all">{x.label?(fr?x.label.fr:x.label.en):t(x.labelKey)} · {x.href}</span>
            <span className={decision.visible?"font-semibold text-emerald-700":"font-semibold text-amber-900"}>{decision.visible&&decision.lockedByPlan?(fr?"Visible · plan requis":"Visible · upgrade needed"):reasonLabels[decision.reason]}</span>
          </div>;
        })}</div>
      </details>
      <p className="text-xs text-slate-500">{fr?"Cet outil est un diagnostic de navigation. Il ne teste ni les droits internes de chaque API ni les accès site par site.":"This is a navigation audit, not an API or site-by-site authorization scan."}</p>
    </section>:null}
  </main>;
}
