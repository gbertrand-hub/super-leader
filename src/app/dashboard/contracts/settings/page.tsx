import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createClauseLibraryItemAction,
  createContractFromTemplateAction,
  createContractTemplateAction,
  createContractTemplateVersionAction,
  createContractTypeAction,
  duplicateContractTemplateAction,
  saveContractSettingsAction,
  setContractTemplateStatusAction,
  setContractTypeStatusAction,
} from "@/app/actions/service-contract-settings";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";

const VIEW_ROLES = new Set(["owner", "admin", "executive", "hr", "manager"]);
const EDIT_ROLES = new Set(["owner", "admin"]);

function fieldClass() {
  return "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500";
}

function areaClass() {
  return `${fieldClass()} min-h-24 font-mono text-xs`;
}

function jsonLines(value: unknown, kind: "obligations" | "deliverables" | "kpis" | "compensation") {
  const rows = Array.isArray(value) ? value as any[] : [];
  if (kind === "obligations") return rows.map((r) => `${r.title ?? ""} | ${r.obligation_type ?? "activity"} | ${r.responsible_party ?? "provider"} | ${r.recurrence ?? "once"} | ${r.due_offset_days ?? 0}`).join("\n");
  if (kind === "deliverables") return rows.map((r) => `${r.title ?? ""} | ${r.due_offset_days ?? 30} | ${r.weight ?? 0}`).join("\n");
  if (kind === "kpis") return rows.map((r) => `${r.name ?? ""} | ${r.unit ?? "%"} | ${r.target_value ?? 100} | ${r.weight ?? 0} | ${r.direction ?? "higher"}`).join("\n");
  return rows.map((r) => `${r.label ?? ""} | ${r.rule_type ?? "other"} | ${r.cadence ?? "one_time"} | ${r.amount ?? ""} | ${r.percentage ?? ""}`).join("\n");
}

type SearchParams = {success?: string; error?: string};
type SettingsRow = {
  default_currency: string;
  default_performance_target: number | string;
  default_renewal_notice_days: number;
  renewal_stage_j90_days: number;
  renewal_stage_j60_days: number;
  renewal_stage_j30_days: number;
  default_non_renewal_notice_days: number;
  default_termination_notice_days: number;
  require_source_document_before_activation: boolean;
  require_internal_owner_before_activation: boolean;
  require_performance_target_before_activation: boolean;
};
type TypeRow = {id:string; code:string; name:string; description:string; is_active:boolean};
type TemplateRow = {id:string; contract_type_id:string|null; name:string; description:string; status:string; current_version:number; updated_at:string};
type VersionRow = {template_id:string; version_number:number; snapshot:any; change_reason:string; created_at:string};
type ClauseRow = {id:string; title:string; category:string; clause_text:string; status:string; version_number:number};
type ProviderRow = {id:string; legal_name:string; status:string};
type MemberRow = {user_id:string; role:string};
type ProfileRow = {id:string; full_name:string|null; email:string|null};

export default async function ContractSettingsTemplatesPage({searchParams}: {searchParams: Promise<SearchParams>}) {
  const query = await searchParams;
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const context = await requireAccessContext();
  if (!VIEW_ROLES.has(context.role)) redirect("/dashboard/my-day");
  const canEdit = EDIT_ROLES.has(context.role);

  const [settingsRes, typesRes, templatesRes, versionsRes, clausesRes, providersRes, membersRes] = await Promise.all([
    context.admin.from("service_contract_settings").select("default_currency,default_performance_target,default_renewal_notice_days,renewal_stage_j90_days,renewal_stage_j60_days,renewal_stage_j30_days,default_non_renewal_notice_days,default_termination_notice_days,require_source_document_before_activation,require_internal_owner_before_activation,require_performance_target_before_activation").eq("organization_id", context.organizationId).maybeSingle<SettingsRow>(),
    context.admin.from("service_contract_types").select("id,code,name,description,is_active").eq("organization_id", context.organizationId).order("sort_order").order("name"),
    context.admin.from("service_contract_templates").select("id,contract_type_id,name,description,status,current_version,updated_at").eq("organization_id", context.organizationId).order("updated_at", {ascending:false}),
    context.admin.from("service_contract_template_versions").select("template_id,version_number,snapshot,change_reason,created_at").eq("organization_id", context.organizationId).order("version_number", {ascending:false}),
    context.admin.from("service_contract_clause_library").select("id,title,category,clause_text,status,version_number").eq("organization_id", context.organizationId).order("updated_at", {ascending:false}),
    context.admin.from("service_providers").select("id,legal_name,status").eq("organization_id", context.organizationId).order("legal_name"),
    context.admin.from("organization_members").select("user_id,role").eq("organization_id", context.organizationId).eq("is_active", true).in("role", ["owner","admin","executive","hr","manager"]),
  ]);

  const migrationError = [settingsRes.error, typesRes.error, templatesRes.error, versionsRes.error, clausesRes.error].find(Boolean);
  if (migrationError) {
    return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6"><div className="mx-auto max-w-6xl"><section className="rounded-3xl bg-slate-950 p-7 text-white"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">SUPER LEADER OPERATIONS · V4.10.18-R1</p><h1 className="mt-3 text-3xl font-black">{fr ? "Paramètres & modèles contractuels" : "Contract settings & templates"}</h1></section><section className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-6"><h2 className="text-xl font-black">{fr ? "Migration 147 requise" : "Migration 147 required"}</h2><p className="mt-2 text-sm text-amber-900">{fr ? "Exécute supabase/147_contract_settings_templates_v4_10_18.sql dans Supabase, puis recharge cette page." : "Run supabase/147_contract_settings_templates_v4_10_18.sql in Supabase, then reload this page."}</p><p className="mt-3 rounded-xl bg-white p-3 font-mono text-xs text-slate-600">{migrationError.message}</p></section></div></main>;
  }

  const settings: SettingsRow = settingsRes.data ?? {
    default_currency:"USD", default_performance_target:80, default_renewal_notice_days:90, renewal_stage_j90_days:90, renewal_stage_j60_days:60, renewal_stage_j30_days:30,
    default_non_renewal_notice_days:30, default_termination_notice_days:30, require_source_document_before_activation:true, require_internal_owner_before_activation:true, require_performance_target_before_activation:true,
  };
  const types = (typesRes.data ?? []) as TypeRow[];
  const templates = (templatesRes.data ?? []) as TemplateRow[];
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const clauses = (clausesRes.data ?? []) as ClauseRow[];
  const providers = ((providersRes.data ?? []) as ProviderRow[]).filter((p) => p.status !== "inactive");
  const members = (membersRes.data ?? []) as MemberRow[];
  const profileIds = [...new Set(members.map((m) => m.user_id))];
  const {data: profilesData} = profileIds.length ? await context.admin.from("profiles").select("id,full_name,email").in("id", profileIds) : {data: [] as ProfileRow[]};
  const profiles = (profilesData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const currentVersionByTemplate = new Map<string, VersionRow>();
  for (const row of versions) if (!currentVersionByTemplate.has(row.template_id)) currentVersionByTemplate.set(row.template_id, row);

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <section className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">SUPER LEADER OPERATIONS · V4.10.18-R1</p>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-5"><div><h1 className="text-3xl font-black sm:text-5xl">{fr ? "Paramètres & modèles contractuels" : "Contract settings & templates"}</h1><p className="mt-3 max-w-4xl text-slate-300">{fr ? "Standardise les contrats, conserve l’historique des modèles et crée de nouveaux brouillons sans modifier rétroactivement les contrats existants." : "Standardize contracts, preserve template history and create new drafts without retroactively changing existing contracts."}</p></div><Link href="/dashboard/contracts" className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-black">← {fr ? "Contrats" : "Contracts"}</Link></div>
      </section>

      {query.success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{query.success}</p> : null}
      {query.error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{query.error}</p> : null}

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        {[{l:fr?"Types actifs":"Active types",v:types.filter((x)=>x.is_active).length},{l:fr?"Modèles actifs":"Active templates",v:templates.filter((x)=>x.status==="active").length},{l:fr?"Versions conservées":"Stored versions",v:versions.length},{l:fr?"Clauses validées":"Clause blocks",v:clauses.filter((x)=>x.status==="active").length}].map((tile)=><article key={tile.l} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{tile.l}</p><p className="mt-2 text-4xl font-black">{tile.v}</p></article>)}
      </section>

      <section id="general-settings" className="mt-7 scroll-mt-28 rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "PARAMÈTRES GÉNÉRAUX" : "GENERAL SETTINGS"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Règles par défaut de l’organisation" : "Organization defaults"}</h2>
        <form action={saveContractSettingsAction} className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-bold">{fr?"Devise par défaut":"Default currency"}<input name="defaultCurrency" defaultValue={settings.default_currency} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr?"Performance cible (%)":"Performance target (%)"}<input name="defaultPerformanceTarget" type="number" min="0" max="100" step="0.01" defaultValue={Number(settings.default_performance_target)} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr?"Préavis renouvellement (j)":"Renewal notice (days)"}<input name="defaultRenewalNoticeDays" type="number" min="0" defaultValue={settings.default_renewal_notice_days} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">J-90<input name="renewalStageJ90Days" type="number" min="1" defaultValue={settings.renewal_stage_j90_days} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">J-60<input name="renewalStageJ60Days" type="number" min="1" defaultValue={settings.renewal_stage_j60_days} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">J-30<input name="renewalStageJ30Days" type="number" min="1" defaultValue={settings.renewal_stage_j30_days} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr?"Préavis non-renouvellement":"Non-renewal notice"}<input name="defaultNonRenewalNoticeDays" type="number" min="0" defaultValue={settings.default_non_renewal_notice_days} disabled={!canEdit} className={fieldClass()} /></label>
          <label className="text-sm font-bold">{fr?"Préavis résiliation":"Termination notice"}<input name="defaultTerminationNoticeDays" type="number" min="0" defaultValue={settings.default_termination_notice_days} disabled={!canEdit} className={fieldClass()} /></label>
          <div className="rounded-2xl bg-slate-50 p-4 text-sm"><p className="font-black">{fr?"Contrôles avant activation":"Activation gates"}</p><label className="mt-3 flex gap-2"><input name="requireSourceDocumentBeforeActivation" type="checkbox" defaultChecked={settings.require_source_document_before_activation} disabled={!canEdit} />{fr?"Document source requis":"Source document required"}</label><label className="mt-2 flex gap-2"><input name="requireInternalOwnerBeforeActivation" type="checkbox" defaultChecked={settings.require_internal_owner_before_activation} disabled={!canEdit} />{fr?"Responsable interne requis":"Internal owner required"}</label><label className="mt-2 flex gap-2"><input name="requirePerformanceTargetBeforeActivation" type="checkbox" defaultChecked={settings.require_performance_target_before_activation} disabled={!canEdit} />{fr?"Cible de performance requise":"Performance target required"}</label></div>
          {canEdit ? <button className="md:col-span-3 rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr?"Enregistrer les paramètres":"Save settings"}</button> : <p className="md:col-span-3 rounded-xl bg-slate-100 p-3 text-sm font-bold text-slate-600">{fr?"Lecture seule : seuls le Propriétaire et l’Administrateur modifient ces paramètres.":"Read only: only Owner and Admin can change these settings."}</p>}
        </form>
      </section>

      <section id="contract-types" className="mt-7 rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr?"TYPES DE CONTRATS":"CONTRACT TYPES"}</p><h2 className="mt-2 text-2xl font-black">{fr?"Catégories configurables":"Configurable categories"}</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="space-y-3">{types.map((row)=><article key={row.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{row.name}</p><p className="text-xs font-mono text-slate-500">{row.code}</p><p className="mt-2 text-sm text-slate-600">{row.description || "—"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${row.is_active?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-600"}`}>{row.is_active?(fr?"ACTIF":"ACTIVE"):(fr?"INACTIF":"INACTIVE")}</span></div>{canEdit?<form action={setContractTypeStatusAction} className="mt-3"><input type="hidden" name="typeId" value={row.id}/><input type="hidden" name="active" value={row.is_active?"false":"true"}/><button className="text-xs font-black text-indigo-700">{row.is_active?(fr?"Désactiver":"Disable"):(fr?"Réactiver":"Reactivate")}</button></form>:null}</article>)}{!types.length?<p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{fr?"Aucun type configuré.":"No contract type configured."}</p>:null}</div>
          {canEdit?<form action={createContractTypeAction} className="rounded-2xl bg-cyan-50 p-5"><h3 className="font-black">{fr?"Ajouter un type":"Add a type"}</h3><label className="mt-3 block text-sm font-bold">Nom<input name="name" required className={fieldClass()}/></label><label className="mt-3 block text-sm font-bold">Code<input name="code" placeholder="service_provider" className={fieldClass()}/></label><label className="mt-3 block text-sm font-bold">Description<textarea name="description" rows={4} className={fieldClass()}/></label><button className="mt-4 rounded-xl bg-cyan-800 px-5 py-3 font-black text-white">{fr?"Ajouter":"Add"}</button></form>:null}
        </div>
      </section>

      {canEdit ? <section id="templates" className="mt-7 rounded-3xl border border-amber-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr?"BIBLIOTHÈQUE DE MODÈLES":"TEMPLATE LIBRARY"}</p><h2 className="mt-2 text-2xl font-black">{fr?"Créer un modèle contractuel":"Create a contract template"}</h2><p className="mt-2 text-sm text-slate-600">{fr?"Chaque modification crée une nouvelle version. Un modèle ne modifie jamais les contrats déjà créés.":"Each change creates a new version. A template never changes existing contracts."}</p>
        <form action={createContractTemplateAction} className="mt-5 grid gap-4 lg:grid-cols-3">
          <label className="text-sm font-bold">{fr?"Nom du modèle":"Template name"}<input name="name" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Type":"Type"}<select name="contractTypeId" className={fieldClass()}><option value="">—</option>{types.filter((x)=>x.is_active).map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="text-sm font-bold">{fr?"Durée par défaut (mois)":"Default duration (months)"}<input name="defaultDurationMonths" type="number" min="1" defaultValue="12" className={fieldClass()}/></label>
          <label className="text-sm font-bold lg:col-span-3">Description<textarea name="description" rows={2} className={fieldClass()}/></label>
          <label className="text-sm font-bold lg:col-span-2">{fr?"Périmètre de service":"Service scope"}<textarea name="serviceScope" rows={4} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Conditions de paiement":"Payment terms"}<textarea name="paymentTerms" rows={4} className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr?"Devise":"Currency"}<input name="defaultCurrency" defaultValue={settings.default_currency} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Valeur par défaut":"Default value"}<input name="defaultValueAmount" type="number" min="0" step="0.01" defaultValue="0" className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Cible performance (%)":"Performance target (%)"}<input name="performanceTarget" type="number" min="0" max="100" defaultValue={Number(settings.default_performance_target)} className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr?"Préavis renouvellement":"Renewal notice"}<input name="renewalNoticeDays" type="number" min="0" defaultValue={settings.default_renewal_notice_days} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Préavis non-renouvellement":"Non-renewal notice"}<input name="nonRenewalNoticeDays" type="number" min="0" defaultValue={settings.default_non_renewal_notice_days} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Préavis résiliation":"Termination notice"}<input name="terminationNoticeDays" type="number" min="0" defaultValue={settings.default_termination_notice_days} className={fieldClass()}/></label>
          <label className="text-sm font-bold lg:col-span-2">{fr?"Obligations — 1 ligne = Titre | type | partie | récurrence | jours après début":"Obligations — one line = Title | type | party | recurrence | days after start"}<textarea name="obligations" placeholder="Rapport mensuel | reporting | provider | monthly | 30" className={areaClass()}/></label><label className="text-sm font-bold">{fr?"Livrables — Titre | délai jours | poids":"Deliverables — Title | days offset | weight"}<textarea name="deliverables" placeholder="Rapport de campagne | 30 | 20" className={areaClass()}/></label>
          <label className="text-sm font-bold lg:col-span-2">KPI — Nom | unité | cible | poids | direction<textarea name="kpis" placeholder="Prospects générés | count | 1000 | 50 | higher" className={areaClass()}/></label><label className="text-sm font-bold">{fr?"Règles financières — Libellé | type | cadence | montant | %":"Financial rules — Label | type | cadence | amount | %"}<textarea name="compensationRules" placeholder="Forfait mensuel | fixed_periodic | monthly | 500 |" className={areaClass()}/></label>
          <label className="text-sm font-bold lg:col-span-2">{fr?"Clauses / blocs à rappeler (1 par ligne)":"Clause reminders (one per line)"}<textarea name="clauses" className={areaClass()}/></label><label className="text-sm font-bold">{fr?"Documents requis (1 par ligne)":"Required documents (one per line)"}<textarea name="requiredDocuments" placeholder="Contrat signé\nAttestation d'assurance" className={areaClass()}/></label>
          <label className="text-sm font-bold lg:col-span-3">Notes<textarea name="notes" rows={2} className={fieldClass()}/></label>
          <button className="lg:col-span-3 rounded-xl bg-amber-600 px-5 py-3 font-black text-white">{fr?"Créer le modèle V1":"Create template V1"}</button>
        </form>
      </section> : null}

      <section className="mt-7 space-y-4">
        {templates.map((template)=>{const version=currentVersionByTemplate.get(template.id); const s=version?.snapshot ?? {}; const c=s.contract ?? {}; return <article key={template.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase text-indigo-600">{typeById.get(template.contract_type_id ?? "")?.name || (fr?"Sans type":"No type")}</p><h3 className="mt-1 text-2xl font-black">{template.name} · V{template.current_version}</h3><p className="mt-2 text-sm text-slate-600">{template.description || "—"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${template.status==="active"?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-600"}`}>{template.status.toUpperCase()}</span></div>
          <div className="mt-4 grid gap-3 md:grid-cols-4 text-sm"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black text-slate-500">{fr?"DURÉE":"DURATION"}</p><p className="mt-1 font-black">{c.default_duration_months ?? 12} {fr?"mois":"months"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black text-slate-500">{fr?"OBLIGATIONS":"OBLIGATIONS"}</p><p className="mt-1 font-black">{Array.isArray(s.obligations)?s.obligations.length:0}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black text-slate-500">KPI</p><p className="mt-1 font-black">{Array.isArray(s.kpis)?s.kpis.length:0}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black text-slate-500">{fr?"FINANCE":"FINANCE"}</p><p className="mt-1 font-black">{Array.isArray(s.compensation_rules)?s.compensation_rules.length:0}</p></div></div>
          {canEdit?<div className="mt-5 grid gap-4 xl:grid-cols-2"><form action={setContractTemplateStatusAction} className="rounded-2xl border border-slate-200 p-4"><input type="hidden" name="templateId" value={template.id}/><input type="hidden" name="status" value={template.status==="active"?"archived":"active"}/><p className="font-black">{fr?"Cycle de vie":"Lifecycle"}</p><button className="mt-3 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">{template.status==="active"?(fr?"Archiver":"Archive"):(fr?"Réactiver":"Reactivate")}</button></form><form action={duplicateContractTemplateAction} className="rounded-2xl border border-slate-200 p-4"><input type="hidden" name="templateId" value={template.id}/><p className="font-black">{fr?"Dupliquer":"Duplicate"}</p><input name="newName" required placeholder={`${template.name} — Copie`} className={fieldClass()}/><button className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr?"Créer la copie":"Create copy"}</button></form></div>:null}
          {canEdit&&version?<details className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><summary className="cursor-pointer font-black text-indigo-900">{fr?"Créer une nouvelle version":"Create a new version"}</summary><form action={createContractTemplateVersionAction} className="mt-4 grid gap-4 lg:grid-cols-3"><input type="hidden" name="templateId" value={template.id}/><label className="text-sm font-bold">{fr?"Motif du changement *":"Change reason *"}<input name="changeReason" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Durée (mois)":"Duration (months)"}<input name="defaultDurationMonths" type="number" min="1" defaultValue={c.default_duration_months ?? 12} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Devise":"Currency"}<input name="defaultCurrency" defaultValue={c.currency ?? settings.default_currency} className={fieldClass()}/></label><label className="text-sm font-bold lg:col-span-2">{fr?"Périmètre":"Scope"}<textarea name="serviceScope" rows={3} defaultValue={c.service_scope ?? ""} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Conditions de paiement":"Payment terms"}<textarea name="paymentTerms" rows={3} defaultValue={c.payment_terms ?? ""} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Valeur":"Value"}<input name="defaultValueAmount" type="number" min="0" step="0.01" defaultValue={c.value_amount ?? 0} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Performance cible":"Performance target"}<input name="performanceTarget" type="number" min="0" max="100" defaultValue={c.performance_target ?? 80} className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Préavis renouvellement":"Renewal notice"}<input name="renewalNoticeDays" type="number" min="0" defaultValue={c.renewal_notice_days ?? 90} className={fieldClass()}/></label><input type="hidden" name="nonRenewalNoticeDays" value={c.non_renewal_notice_days ?? 30}/><input type="hidden" name="terminationNoticeDays" value={c.termination_notice_days ?? 30}/><label className="text-sm font-bold lg:col-span-2">Obligations<textarea name="obligations" defaultValue={jsonLines(s.obligations,"obligations")} className={areaClass()}/></label><label className="text-sm font-bold">Livrables<textarea name="deliverables" defaultValue={jsonLines(s.deliverables,"deliverables")} className={areaClass()}/></label><label className="text-sm font-bold lg:col-span-2">KPI<textarea name="kpis" defaultValue={jsonLines(s.kpis,"kpis")} className={areaClass()}/></label><label className="text-sm font-bold">Finance<textarea name="compensationRules" defaultValue={jsonLines(s.compensation_rules,"compensation")} className={areaClass()}/></label><label className="text-sm font-bold lg:col-span-2">Clauses<textarea name="clauses" defaultValue={Array.isArray(c.clauses)?c.clauses.join("\n"):""} className={areaClass()}/></label><label className="text-sm font-bold">{fr?"Documents requis":"Required documents"}<textarea name="requiredDocuments" defaultValue={Array.isArray(c.required_documents)?c.required_documents.join("\n"):""} className={areaClass()}/></label><textarea name="notes" className="hidden" defaultValue={c.notes ?? ""}/><button className="lg:col-span-3 rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr?`Créer V${template.current_version+1}`:`Create V${template.current_version+1}`}</button></form></details>:null}
          <p className="mt-4 text-xs text-slate-500">{fr?"Dernière version":"Latest version"}: {version?.change_reason || "—"}</p>
        </article>})}
        {!templates.length?<p className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-500">{fr?"Aucun modèle contractuel n’a encore été créé.":"No contract template has been created yet."}</p>:null}
      </section>

      <section id="use-template" className="mt-7 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr?"CRÉATION ASSISTÉE":"GUIDED CREATION"}</p><h2 className="mt-2 text-2xl font-black">{fr?"Créer un contrat brouillon depuis un modèle":"Create a draft contract from a template"}</h2><p className="mt-2 text-sm text-emerald-900">{fr?"Le contrat reste BROUILLON. Tu dois le vérifier avant toute activation.":"The contract remains DRAFT. Review it before activation."}</p>
        <form action={createContractFromTemplateAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3"><label className="text-sm font-bold">{fr?"Modèle *":"Template *"}<select name="templateId" required className={fieldClass()}><option value="">—</option>{templates.filter((x)=>x.status==="active").map((x)=><option key={x.id} value={x.id}>{x.name} · V{x.current_version}</option>)}</select></label><label className="text-sm font-bold">{fr?"Prestataire *":"Provider *"}<select name="providerId" required className={fieldClass()}><option value="">—</option>{providers.map((x)=><option key={x.id} value={x.id}>{x.legal_name}</option>)}</select></label><label className="text-sm font-bold">{fr?"Responsable interne *":"Internal owner *"}<select name="internalOwnerUserId" required defaultValue={context.role==="manager"?context.user.id:""} className={fieldClass()}>{context.role!=="manager"?<option value="">—</option>:null}{members.filter((m)=>context.role!=="manager"||m.user_id===context.user.id).map((m)=>{const p=profileById.get(m.user_id);return <option key={m.user_id} value={m.user_id}>{p?.full_name||p?.email||m.user_id} · {m.role}</option>})}</select></label><label className="text-sm font-bold">{fr?"Référence *":"Reference *"}<input name="contractNumber" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Titre *":"Title *"}<input name="title" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr?"Date de début *":"Start date *"}<input name="startDate" type="date" required className={fieldClass()}/></label><button className="md:col-span-2 xl:col-span-3 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{fr?"Créer le brouillon depuis le modèle":"Create draft from template"}</button></form>
      </section>

      <section id="clauses" className="mt-7 rounded-3xl border border-violet-200 bg-white p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr?"BIBLIOTHÈQUE DE CLAUSES":"CLAUSE LIBRARY"}</p><h2 className="mt-2 text-2xl font-black">{fr?"Blocs approuvés et réutilisables":"Approved reusable blocks"}</h2><p className="mt-2 text-sm text-slate-600">{fr?"Cette bibliothèque stocke des textes validés par iLEAD. Elle ne remplace pas une revue juridique.":"This library stores iLEAD-approved text. It does not replace legal review."}</p><div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="space-y-3">{clauses.map((row)=><article key={row.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><p className="font-black">{row.title} · V{row.version_number}</p><p className="text-xs font-bold uppercase text-violet-600">{row.category}</p></div><span className="text-xs font-black text-slate-500">{row.status.toUpperCase()}</span></div><p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{row.clause_text}</p></article>)}{!clauses.length?<p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{fr?"Aucune clause enregistrée.":"No clause stored."}</p>:null}</div>{canEdit?<form action={createClauseLibraryItemAction} className="rounded-2xl bg-violet-50 p-5"><label className="text-sm font-bold">Titre<input name="title" required className={fieldClass()}/></label><label className="mt-3 block text-sm font-bold">{fr?"Catégorie":"Category"}<input name="category" defaultValue="general" className={fieldClass()}/></label><label className="mt-3 block text-sm font-bold">{fr?"Texte validé":"Approved text"}<textarea name="clauseText" required rows={8} className={fieldClass()}/></label><button className="mt-4 rounded-xl bg-violet-700 px-5 py-3 font-black text-white">{fr?"Ajouter à la bibliothèque":"Add to library"}</button></form>:null}</div></section>
    </div>
  </main>;
}
