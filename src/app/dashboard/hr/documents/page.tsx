import Link from "next/link";
import {acknowledgeHrDocumentAction, changeHrDocumentStatusAction, createHrDocumentAction, createHrDocumentRequirementAction, toggleHrDocumentRequirementAction, updateHrDocumentAction} from "@/app/actions/hr-documents";
import {HrDocumentUpload} from "@/components/hr/hr-document-upload";
import {getI18n} from "@/i18n/server";
import {isPeopleAdministrator, requireAccessContext} from "@/lib/auth/access-control";

type Search = {success?: string; error?: string; q?: string; category?: string; status?: string; employee?: string; expiry?: string};
type DocumentRow = {
  id: string; title: string; description: string | null; category: string; document_scope: string;
  employee_user_id: string | null; confidential: boolean; acknowledgement_required: boolean;
  version_label: string | null; issued_on: string | null; effective_date: string | null; expires_on: string | null;
  review_due_on: string | null; status: string; file_name: string; mime_type: string;
  size_bytes: number | string; created_at: string; published_at: string | null;
};
type RecipientRow = {document_id: string; employee_user_id: string; acknowledgement_due_on: string | null; acknowledged_at: string | null};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type AuditRow = {id: string; document_id: string | null; actor_id: string | null; action: string; created_at: string; details: Record<string, unknown> | null};
type MembershipRow = {user_id:string;role:string};
type RequirementRow = {id:string;title:string;category:string;applicable_roles:string[];expiry_required:boolean;is_active:boolean};

const categoryValues = ["handbook","policy","contract","amendment","job_description","identity","diploma","certificate","evaluation","disciplinary","leave_support","other"];
const categoryLabels: Record<string, {fr: string; en: string}> = {
  handbook:{fr:"Manuel du personnel",en:"Employee handbook"}, policy:{fr:"Politique et procédure",en:"Policy and procedure"},
  contract:{fr:"Contrat",en:"Contract"}, amendment:{fr:"Avenant",en:"Amendment"}, job_description:{fr:"Fiche de poste",en:"Job description"},
  identity:{fr:"Pièce d’identité",en:"Identity document"}, diploma:{fr:"Diplôme",en:"Diploma"}, certificate:{fr:"Attestation",en:"Certificate"},
  evaluation:{fr:"Évaluation",en:"Evaluation"}, disciplinary:{fr:"Document disciplinaire",en:"Disciplinary document"},
  leave_support:{fr:"Justificatif de congé",en:"Leave supporting document"}, other:{fr:"Autre",en:"Other"},
};
const statusLabels: Record<string, {fr: string; en: string}> = {
  draft:{fr:"Brouillon",en:"Draft"}, to_review:{fr:"À vérifier",en:"To review"}, to_acknowledge:{fr:"À signer / confirmer",en:"To sign / acknowledge"},
  active:{fr:"Actif",en:"Active"}, expired:{fr:"Expiré",en:"Expired"}, archived:{fr:"Archivé",en:"Archived"},
};
const statusTones: Record<string,string> = {draft:"bg-slate-200 text-slate-800",to_review:"bg-amber-100 text-amber-800",to_acknowledge:"bg-violet-100 text-violet-800",active:"bg-emerald-100 text-emerald-800",expired:"bg-red-100 text-red-800",archived:"bg-slate-200 text-slate-700"};
const auditLabels: Record<string, {fr:string;en:string}> = {
  created:{fr:"Brouillon créé",en:"Draft created"}, created_and_published:{fr:"Document créé et publié",en:"Document created and published"},
  metadata_updated:{fr:"Informations modifiées",en:"Information updated"}, status_changed:{fr:"Statut modifié",en:"Status changed"},
  acknowledged:{fr:"Lecture confirmée",en:"Reading acknowledged"}, opened:{fr:"Document consulté",en:"Document opened"},
};

function fieldClass() { return "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950"; }
function dateLabel(value: string | null, locale: string) { return value ? new Intl.DateTimeFormat(locale, {dateStyle:"medium", timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`)) : "—"; }
function bytes(value: number | string) { const n = Number(value); return n >= 1048576 ? `${(n/1048576).toFixed(1)} Mo` : `${Math.max(1,Math.round(n/1024))} Ko`; }

export default async function HrDocumentsPage({searchParams}: {searchParams: Promise<Search>}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const params = await searchParams;
  const context = await requireAccessContext();
  const canManage = isPeopleAdministrator(context.role);

  const {data: memberships} = canManage ? await context.admin.from("organization_members").select("user_id,role").eq("organization_id", context.organizationId).eq("is_active", true).in("role", ["owner","admin","executive","hr","manager","employee"]) : {data: []};
  const membershipRows = (memberships ?? []) as MembershipRow[];
  const memberIds = membershipRows.map(row => String(row.user_id));
  const {data: profiles} = memberIds.length ? await context.admin.from("profiles").select("id,full_name,email").in("id", memberIds).order("full_name") : {data: []};
  const profileRows = (profiles ?? []) as ProfileRow[];
  const profileMap = new Map(profileRows.map(profile => [profile.id, profile.full_name || profile.email || profile.id]));

  let documentRows: DocumentRow[] = [];
  let ownRecipientRows: RecipientRow[] = [];
  if (canManage) {
    const {data} = await context.admin.from("hr_documents").select("id,title,description,category,document_scope,employee_user_id,confidential,acknowledgement_required,version_label,issued_on,effective_date,expires_on,review_due_on,status,file_name,mime_type,size_bytes,created_at,published_at").eq("organization_id", context.organizationId).order("created_at", {ascending:false});
    documentRows = (data ?? []) as DocumentRow[];
  } else {
    const {data: ownRecipients} = await context.admin.from("hr_document_recipients").select("document_id,employee_user_id,acknowledgement_due_on,acknowledged_at").eq("organization_id", context.organizationId).eq("employee_user_id", context.user.id);
    ownRecipientRows = (ownRecipients ?? []) as RecipientRow[];
    const ids = ownRecipientRows.map(row => row.document_id);
    if (ids.length) {
      const {data} = await context.admin.from("hr_documents").select("id,title,description,category,document_scope,employee_user_id,confidential,acknowledgement_required,version_label,issued_on,effective_date,expires_on,review_due_on,status,file_name,mime_type,size_bytes,created_at,published_at").eq("organization_id", context.organizationId).in("status", ["to_acknowledge","active"]).eq("confidential", false).in("id", ids).order("created_at", {ascending:false});
      documentRows = (data ?? []) as DocumentRow[];
    }
  }

  const documentIds = documentRows.map(row => row.id);
  const {data: allRecipients} = canManage && documentIds.length ? await context.admin.from("hr_document_recipients").select("document_id,employee_user_id,acknowledgement_due_on,acknowledged_at").eq("organization_id", context.organizationId).in("document_id", documentIds) : {data: ownRecipientRows};
  const recipients = (allRecipients ?? []) as RecipientRow[];
  const recipientsByDocument = new Map<string,RecipientRow[]>();
  for (const recipient of recipients) recipientsByDocument.set(recipient.document_id, [...(recipientsByDocument.get(recipient.document_id) ?? []), recipient]);

  const q = String(params.q ?? "").trim().toLocaleLowerCase(locale);
  const category = String(params.category ?? "all");
  const status = String(params.status ?? "all");
  const employee = String(params.employee ?? "all");
  const expiry = String(params.expiry ?? "all");
  const today = new Date().toISOString().slice(0,10);
  const inThirtyDays = new Date(new Date(`${today}T00:00:00Z`).getTime() + 30*86400000).toISOString().slice(0,10);
  const filtered = documentRows.filter(document => {
    const assigned = recipientsByDocument.get(document.id) ?? [];
    const matchesEmployee = employee === "all" || assigned.some(row => row.employee_user_id === employee);
    const matchesExpiry = expiry === "all" || (expiry === "soon" && Boolean(document.expires_on && document.expires_on >= today && document.expires_on <= inThirtyDays)) || (expiry === "expired" && Boolean(document.expires_on && document.expires_on < today)) || (expiry === "none" && !document.expires_on);
    return (!q || `${document.title} ${document.description ?? ""} ${document.file_name}`.toLocaleLowerCase(locale).includes(q)) && (category === "all" || document.category === category) && (status === "all" || document.status === status) && matchesEmployee && matchesExpiry;
  });
  const documentById = new Map(documentRows.map(document => [document.id, document]));
  const pendingAcknowledgements = recipients.filter(row => {
    const document = documentById.get(row.document_id);
    return !row.acknowledged_at && document?.acknowledgement_required && document.status === "to_acknowledge";
  }).length;
  const expiringSoon = documentRows.filter(document => ["active","to_acknowledge"].includes(document.status) && document.expires_on && document.expires_on >= today && document.expires_on <= inThirtyDays).length;
  const {data: requirementData} = canManage ? await context.admin.from("hr_document_requirements").select("id,title,category,applicable_roles,expiry_required,is_active").eq("organization_id",context.organizationId).order("title") : {data: []};
  const requirements = (requirementData ?? []) as RequirementRow[];
  const missingDocuments = canManage ? membershipRows.flatMap(member => requirements.filter(requirement => requirement.is_active && requirement.applicable_roles.includes(member.role)).filter(requirement => !documentRows.some(document => document.document_scope === "individual" && document.employee_user_id === member.user_id && document.category === requirement.category && document.title.trim().toLocaleLowerCase(locale) === requirement.title.trim().toLocaleLowerCase(locale) && ["active","to_acknowledge"].includes(document.status) && (!requirement.expiry_required || Boolean(document.expires_on && document.expires_on >= today)))).map(requirement => ({employeeUserId:member.user_id,requirement}))) : [];
  const {data: auditData} = canManage ? await context.admin.from("hr_document_audit_log").select("id,document_id,actor_id,action,created_at,details").eq("organization_id", context.organizationId).order("created_at", {ascending:false}).limit(30) : {data: []};
  const auditRows = (auditData ?? []) as AuditRow[];

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <header className="rounded-[2rem] bg-slate-950 p-7 text-white shadow-xl sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">{fr ? "Centre RH sécurisé" : "Secure HR centre"}</p><h1 className="mt-3 text-4xl font-black">{fr ? "Documents RH" : "HR documents"}</h1><p className="mt-3 max-w-3xl text-slate-300">{canManage ? (fr ? "Publiez les politiques collectives et gérez le dossier documentaire individuel de chaque employé." : "Publish collective policies and manage each employee’s document file.") : (fr ? "Consultez vos documents officiels et confirmez la lecture des politiques obligatoires." : "Review your official documents and acknowledge mandatory policies.")}</p></div><Link href="/dashboard/performance" className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black">{fr ? "Dashboard RH" : "HR dashboard"}</Link></div>
      </header>

      {params.success ? <p className="mt-5 rounded-2xl bg-emerald-100 p-4 font-bold text-emerald-900">{params.success}</p> : null}
      {params.error ? <p className="mt-5 rounded-2xl bg-red-100 p-4 font-bold text-red-900">{params.error}</p> : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric value={documentRows.filter(row=>["active","to_acknowledge"].includes(row.status)).length} label={fr?"Documents disponibles":"Available documents"} tone="emerald" />
        <Metric value={missingDocuments.length} label={fr?"Documents manquants":"Missing documents"} tone="red" />
        <Metric value={pendingAcknowledgements} label={fr?"Confirmations attendues":"Pending acknowledgements"} tone="amber" />
        <Metric value={expiringSoon} label={fr?"Expirent sous 30 jours":"Expiring within 30 days"} tone="red" />
        <Metric value={documentRows.filter(row=>row.confidential).length} label={fr?"Documents confidentiels":"Confidential documents"} tone="violet" />
      </section>

      {canManage ? <details className="mt-7 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm" open={documentRows.length===0}>
        <summary className="cursor-pointer text-xl font-black text-emerald-950">{fr ? "Ajouter un document RH" : "Add an HR document"}</summary>
        <p className="mt-2 text-sm text-emerald-800">{fr ? "Le formulaire est prérempli pour publier le Manuel du personnel fourni. Vous pouvez modifier tous les champs pour un autre document." : "The form is prefilled for the supplied employee handbook. You can change every field for another document."}</p>
        <form action={createHrDocumentAction} className="mt-6 grid gap-4 lg:grid-cols-2">
          <label className="text-sm font-black">{fr?"Titre":"Title"}<input name="title" required defaultValue="Manuel du personnel iLEAD Global" className={fieldClass()} /></label>
          <label className="text-sm font-black">{fr?"Catégorie":"Category"}<select name="category" defaultValue="handbook" className={fieldClass()}>{categoryValues.map(value=><option key={value} value={value}>{fr?categoryLabels[value].fr:categoryLabels[value].en}</option>)}</select></label>
          <label className="text-sm font-black">{fr?"Portée":"Scope"}<select name="scope" defaultValue="collective" className={fieldClass()}><option value="collective">{fr?"Tous les employés actifs":"All active employees"}</option><option value="individual">{fr?"Un employé":"One employee"}</option></select></label>
          <label className="text-sm font-black">{fr?"Employé (uniquement si individuel)":"Employee (individual only)"}<select name="employeeUserId" defaultValue="" className={fieldClass()}><option value="">{fr?"Aucun — document collectif":"None — collective document"}</option>{profileRows.map(profile=><option key={profile.id} value={profile.id}>{profile.full_name||profile.email||profile.id}</option>)}</select></label>
          <label className="text-sm font-black">{fr?"Version":"Version"}<input name="versionLabel" defaultValue="Septembre 2026" className={fieldClass()} /></label>
          <label className="text-sm font-black">{fr?"Date d’émission":"Issue date"}<input name="issuedOn" type="date" defaultValue="2026-09-01" className={fieldClass()} /></label>
          <label className="text-sm font-black">{fr?"Date d’entrée en vigueur":"Effective date"}<input name="effectiveDate" type="date" defaultValue="2026-09-01" className={fieldClass()} /></label>
          <label className="text-sm font-black">{fr?"Date d’expiration (facultatif)":"Expiry date (optional)"}<input name="expiresOn" type="date" className={fieldClass()} /></label>
          <label className="text-sm font-black">{fr?"Date de révision":"Review date"}<input name="reviewDueOn" type="date" defaultValue="2027-09-01" className={fieldClass()} /></label>
          <label className="text-sm font-black">{fr?"Confirmation attendue avant le":"Acknowledgement due by"}<input name="acknowledgementDueOn" type="date" className={fieldClass()} /></label>
          <label className="text-sm font-black lg:col-span-2">{fr?"Description":"Description"}<textarea name="description" rows={3} defaultValue="Document officiel présentant les politiques, droits, responsabilités et attentes applicables au personnel iLEAD Global." className={fieldClass()} /></label>
          <div className="lg:col-span-2"><HrDocumentUpload fr={fr} /></div>
          <div className="flex flex-wrap gap-5 lg:col-span-2"><label className="flex items-center gap-2 text-sm font-black"><input type="checkbox" name="acknowledgementRequired" defaultChecked />{fr?"Confirmation de lecture obligatoire":"Acknowledgement required"}</label><label className="flex items-center gap-2 text-sm font-black"><input type="checkbox" name="confidential" />{fr?"Réservé uniquement aux RH":"HR-only document"}</label><label className="flex items-center gap-2 text-sm font-black"><input type="checkbox" name="publishNow" defaultChecked />{fr?"Rendre actif immédiatement":"Activate immediately"}</label></div>
          <button className="rounded-xl bg-emerald-700 px-5 py-3 font-black text-white lg:col-span-2">{fr?"Enregistrer et attribuer le document":"Save and assign document"}</button>
        </form>
      </details> : null}

      <form className="mt-7 grid gap-3 rounded-3xl border bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-6">
        <input name="q" defaultValue={params.q??""} placeholder={fr?"Titre ou nom du fichier":"Title or file name"} className={fieldClass()} />
        <select name="category" defaultValue={category} className={fieldClass()}><option value="all">{fr?"Toutes les catégories":"All categories"}</option>{categoryValues.map(value=><option key={value} value={value}>{fr?categoryLabels[value].fr:categoryLabels[value].en}</option>)}</select>
        <select name="status" defaultValue={status} className={fieldClass()}><option value="all">{fr?"Tous les statuts":"All statuses"}</option>{Object.keys(statusLabels).map(value=><option key={value} value={value}>{fr?statusLabels[value].fr:statusLabels[value].en}</option>)}</select>
        {canManage?<select name="employee" defaultValue={employee} className={fieldClass()}><option value="all">{fr?"Tous les employés":"All employees"}</option>{profileRows.map(profile=><option key={profile.id} value={profile.id}>{profile.full_name||profile.email||profile.id}</option>)}</select>:null}
        <select name="expiry" defaultValue={expiry} className={fieldClass()}><option value="all">{fr?"Toutes les validités":"All validity dates"}</option><option value="soon">{fr?"Expire sous 30 jours":"Expires within 30 days"}</option><option value="expired">{fr?"Date dépassée":"Past expiry date"}</option><option value="none">{fr?"Sans expiration":"No expiry"}</option></select>
        <button className="mt-1 rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white">{fr?"Rechercher":"Search"}</button>
      </form>

      {canManage && employee!=="all" ? <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-6"><p className="text-xs font-black uppercase tracking-[.18em] text-indigo-600">{fr?"Dossier de l’employé":"Employee file"}</p><h2 className="mt-2 text-2xl font-black">{profileMap.get(employee) || employee}</h2><p className="mt-2 text-sm text-indigo-800">{filtered.length} {fr?"document(s) retrouvé(s), y compris les documents collectifs qui lui sont attribués.":"document(s) found, including assigned collective documents."}</p></section> : null}

      {canManage && missingDocuments.length ? <details className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6"><summary className="cursor-pointer text-lg font-black text-red-950">{fr?`Voir les ${missingDocuments.length} document(s) manquant(s)`:`View ${missingDocuments.length} missing document(s)`}</summary><div className="mt-4 grid gap-2 sm:grid-cols-2">{missingDocuments.map(item=><p key={`${item.employeeUserId}-${item.requirement.id}`} className="rounded-xl bg-white p-3 text-sm"><b>{profileMap.get(item.employeeUserId)||item.employeeUserId}</b> · {item.requirement.title}</p>)}</div></details> : null}

      <section className="mt-7 space-y-5">
        {filtered.length ? filtered.map(document => {
          const assigned = recipientsByDocument.get(document.id) ?? [];
          const acknowledged = assigned.filter(row=>row.acknowledged_at).length;
          const own = assigned.find(row=>row.employee_user_id===context.user.id);
          const overdue = own?.acknowledgement_due_on && !own.acknowledged_at && own.acknowledgement_due_on < today;
          return <article key={document.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTones[document.status]??statusTones.draft}`}>{fr?statusLabels[document.status]?.fr:statusLabels[document.status]?.en}</span><span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">{fr?categoryLabels[document.category]?.fr:categoryLabels[document.category]?.en}</span>{document.confidential?<span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">{fr?"Confidentiel":"Confidential"}</span>:null}</div><h2 className="mt-3 text-2xl font-black">{document.title}</h2><p className="mt-1 text-sm text-slate-500">{`Version ${document.version_label || "—"}`} · {document.file_name} · {bytes(document.size_bytes)}</p>{document.description?<p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">{document.description}</p>:null}</div><a href={`/api/hr/documents/${document.id}`} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{fr?"Consulter / télécharger":"Open / download"}</a></div>
            <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-5"><p><b>{fr?"Portée":"Scope"}:</b> {document.document_scope==="collective"?(fr?"Tous les employés":"All employees"):(profileMap.get(document.employee_user_id??"") || (fr?"Employé":"Employee"))}</p><p><b>{fr?"Émis le":"Issued"}:</b> {dateLabel(document.issued_on,locale)}</p><p><b>{fr?"En vigueur":"Effective"}:</b> {dateLabel(document.effective_date,locale)}</p><p><b>{fr?"Expiration":"Expiry"}:</b> {dateLabel(document.expires_on,locale)}</p><p><b>{fr?"Révision":"Review"}:</b> {dateLabel(document.review_due_on,locale)}</p></div>
            {document.acknowledgement_required ? <div className={`mt-4 rounded-2xl p-4 ${overdue?"bg-red-50 text-red-900":"bg-amber-50 text-amber-900"}`}><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-black">{canManage ? `${acknowledged}/${assigned.length} ${fr?"confirmation(s) reçue(s)":"acknowledgement(s) received"}` : own?.acknowledged_at ? (fr?"Lecture confirmée":"Reading acknowledged") : (fr?"Votre confirmation est attendue":"Your acknowledgement is required")}</p>{!canManage && own && !own.acknowledged_at?<form action={acknowledgeHrDocumentAction}><input type="hidden" name="documentId" value={document.id}/><button className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-slate-950">{fr?"J’ai lu et compris":"I have read and understood"}</button></form>:null}</div>{canManage&&assigned.some(row=>!row.acknowledged_at)?<details className="mt-3"><summary className="cursor-pointer text-sm font-black underline">{fr?"Voir les confirmations manquantes":"View missing acknowledgements"}</summary><p className="mt-2 text-sm">{assigned.filter(row=>!row.acknowledged_at).map(row=>profileMap.get(row.employee_user_id)||row.employee_user_id).join(" · ")}</p></details>:null}</div> : null}
            {canManage ? <div className="mt-5 flex flex-wrap gap-3">
              {document.status==="draft"?<StatusButton id={document.id} status="to_review" label={fr?"Envoyer à vérifier":"Send for review"} tone="amber"/>:null}
              {["draft","to_review"].includes(document.status)?<StatusButton id={document.id} status={document.acknowledgement_required?"to_acknowledge":"active"} label={document.acknowledgement_required?(fr?"Demander confirmation":"Request acknowledgement"):(fr?"Activer":"Activate")} tone="emerald"/>:null}
              {["active","to_acknowledge"].includes(document.status)?<StatusButton id={document.id} status="expired" label={fr?"Marquer expiré":"Mark expired"} tone="amber"/>:null}
              {document.status!=="archived"?<StatusButton id={document.id} status="archived" label={fr?"Archiver":"Archive"} tone="slate"/>:null}
              <details className="w-full rounded-2xl border border-slate-200 p-4"><summary className="cursor-pointer font-black text-indigo-700">{fr?"Modifier les informations":"Edit information"}</summary><form action={updateHrDocumentAction} className="mt-4 grid gap-3 md:grid-cols-2"><input type="hidden" name="documentId" value={document.id}/><label className="text-sm font-black">{fr?"Titre":"Title"}<input name="title" required defaultValue={document.title} className={fieldClass()}/></label><label className="text-sm font-black">{fr?"Catégorie":"Category"}<select name="category" defaultValue={document.category} className={fieldClass()}>{categoryValues.map(value=><option key={value} value={value}>{fr?categoryLabels[value].fr:categoryLabels[value].en}</option>)}</select></label><label className="text-sm font-black">{fr?"Version":"Version"}<input name="versionLabel" defaultValue={document.version_label??""} className={fieldClass()}/></label><label className="text-sm font-black">{fr?"Date d’émission":"Issue date"}<input name="issuedOn" type="date" defaultValue={document.issued_on??""} className={fieldClass()}/></label><label className="text-sm font-black">{fr?"En vigueur":"Effective"}<input name="effectiveDate" type="date" defaultValue={document.effective_date??""} className={fieldClass()}/></label><label className="text-sm font-black">{fr?"Expiration":"Expiry"}<input name="expiresOn" type="date" defaultValue={document.expires_on??""} className={fieldClass()}/></label><label className="text-sm font-black">{fr?"Révision":"Review"}<input name="reviewDueOn" type="date" defaultValue={document.review_due_on??""} className={fieldClass()}/></label><label className="text-sm font-black">{fr?"Échéance de confirmation":"Acknowledgement due"}<input name="acknowledgementDueOn" type="date" defaultValue={assigned[0]?.acknowledgement_due_on??""} className={fieldClass()}/></label><label className="text-sm font-black md:col-span-2">{fr?"Commentaire / description":"Comment / description"}<textarea name="description" rows={3} defaultValue={document.description??""} className={fieldClass()}/></label><div className="flex gap-4 md:col-span-2"><label className="flex items-center gap-2 text-sm font-black"><input type="checkbox" name="acknowledgementRequired" defaultChecked={document.acknowledgement_required}/>{fr?"Confirmation obligatoire":"Acknowledgement required"}</label><label className="flex items-center gap-2 text-sm font-black"><input type="checkbox" name="confidential" defaultChecked={document.confidential}/>{fr?"Réservé uniquement aux RH":"HR only"}</label></div><button className="rounded-xl bg-indigo-700 px-4 py-3 font-black text-white md:col-span-2">{fr?"Enregistrer les modifications":"Save changes"}</button></form></details>
            </div> : null}
          </article>;
        }) : <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">{fr?"Aucun document ne correspond à ces critères.":"No documents match these filters."}</div>}
      </section>

      {canManage ? <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.18em] text-red-600">{fr?"Contrôle des dossiers":"File compliance"}</p><h2 className="mt-2 text-2xl font-black">{fr?"Documents obligatoires":"Required documents"}</h2><p className="mt-2 text-sm text-slate-500">{fr?"Définissez les pièces attendues. Super Leader signalera automatiquement celles qui manquent dans chaque dossier.":"Define expected records. Super Leader will automatically flag missing items in each employee file."}</p></div><span className="rounded-full bg-red-100 px-4 py-2 text-sm font-black text-red-800">{missingDocuments.length} {fr?"manquant(s)":"missing"}</span></div>
        <form action={createHrDocumentRequirementAction} className="mt-5 grid gap-3 lg:grid-cols-3">
          <label className="text-sm font-black">{fr?"Nom du document obligatoire":"Required document name"}<input name="title" required placeholder={fr?"Ex. Contrat de travail":"E.g. Employment contract"} className={fieldClass()}/></label>
          <label className="text-sm font-black">{fr?"Catégorie":"Category"}<select name="category" className={fieldClass()}>{categoryValues.map(value=><option key={value} value={value}>{fr?categoryLabels[value].fr:categoryLabels[value].en}</option>)}</select></label>
          <label className="flex items-center gap-2 self-end rounded-xl bg-amber-50 px-4 py-3 text-sm font-black"><input type="checkbox" name="expiryRequired"/>{fr?"Une date d’expiration valide est obligatoire":"A valid expiry date is required"}</label>
          <fieldset className="rounded-xl border border-slate-200 p-4 lg:col-span-3"><legend className="px-2 text-sm font-black">{fr?"Employés concernés":"Applicable roles"}</legend><div className="flex flex-wrap gap-4">{[["employee",fr?"Employés":"Employees"],["manager",fr?"Managers":"Managers"],["executive",fr?"Direction":"Executives"],["hr","RH"],["admin",fr?"Administrateurs":"Administrators"]].map(([value,label])=><label key={value} className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="applicableRoles" value={value} defaultChecked={value==="employee"||value==="manager"}/>{label}</label>)}</div></fieldset>
          <button className="rounded-xl bg-red-700 px-4 py-3 font-black text-white lg:col-span-3">{fr?"Ajouter cette exigence":"Add requirement"}</button>
        </form>
        <div className="mt-5 grid gap-3 md:grid-cols-2">{requirements.length?requirements.map(requirement=><div key={requirement.id} className={`rounded-2xl border p-4 ${requirement.is_active?"border-emerald-200 bg-emerald-50":"border-slate-200 bg-slate-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-black">{requirement.title}</p><p className="mt-1 text-xs text-slate-500">{fr?categoryLabels[requirement.category]?.fr:categoryLabels[requirement.category]?.en} · {requirement.applicable_roles.join(", ")}{requirement.expiry_required?` · ${fr?"expiration obligatoire":"expiry required"}`:""}</p></div><form action={toggleHrDocumentRequirementAction}><input type="hidden" name="requirementId" value={requirement.id}/><input type="hidden" name="active" value={String(!requirement.is_active)}/><button className="text-sm font-black text-indigo-700 underline">{requirement.is_active?(fr?"Désactiver":"Disable"):(fr?"Réactiver":"Enable")}</button></form></div></div>):<p className="text-sm text-slate-500">{fr?"Aucune exigence configurée. Ajoutez les documents que chaque dossier doit contenir.":"No requirements configured. Add the records each employee file must contain."}</p>}</div>
      </section> : null}

      {canManage ? <details className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-xl font-black">{fr?"Historique et traçabilité":"History and audit trail"}</summary>
        <p className="mt-2 text-sm text-slate-500">{fr?"Les 30 activités les plus récentes liées aux documents RH.":"The 30 most recent HR document activities."}</p>
        <div className="mt-5 divide-y divide-slate-100">
          {auditRows.length ? auditRows.map(event => {
            const document = event.document_id ? documentById.get(event.document_id) : null;
            const actor = event.actor_id ? profileMap.get(event.actor_id) : null;
            return <div key={event.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
              <p><b>{(fr?auditLabels[event.action]?.fr:auditLabels[event.action]?.en) || event.action}</b>{document?` · ${document.title}`:""}{actor?` · ${actor}`:""}</p>
              <time className="text-slate-500">{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(event.created_at))}</time>
            </div>;
          }) : <p className="py-4 text-sm text-slate-500">{fr?"Aucune activité enregistrée.":"No activity recorded."}</p>}
        </div>
      </details> : null}

      <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-slate-100 p-6"><p className="font-black text-slate-700">{fr?"À venir":"Coming soon"}</p><p className="mt-2 text-sm text-slate-500">{fr?"Signature électronique avancée, génération depuis des modèles, OCR et intégrations DocuSign/Adobe Sign.":"Advanced e-signature, template generation, OCR, and DocuSign/Adobe Sign integrations."}</p></section>
    </div>
  </main>;
}

function Metric({value,label,tone}:{value:number;label:string;tone:"emerald"|"amber"|"red"|"violet"}) {
  const styles={emerald:"border-emerald-200 bg-emerald-50 text-emerald-900",amber:"border-amber-200 bg-amber-50 text-amber-900",red:"border-red-200 bg-red-50 text-red-900",violet:"border-violet-200 bg-violet-50 text-violet-900"};
  return <div className={`rounded-3xl border p-5 ${styles[tone]}`}><p className="text-3xl font-black">{value}</p><p className="mt-1 text-sm font-bold">{label}</p></div>;
}

function StatusButton({id,status,label,tone}:{id:string;status:string;label:string;tone:"emerald"|"amber"|"slate"}) {
  const styles={emerald:"bg-emerald-600 text-white",amber:"bg-amber-400 text-slate-950",slate:"bg-slate-200 text-slate-800"};
  return <form action={changeHrDocumentStatusAction}><input type="hidden" name="documentId" value={id}/><input type="hidden" name="status" value={status}/><button className={`rounded-xl px-4 py-2 text-sm font-black ${styles[tone]}`}>{label}</button></form>;
}
