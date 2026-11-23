import Link from "next/link";
import {
  acknowledgeOfficialAnnouncementAction,
  archiveOfficialAnnouncementAction,
  markOfficialAnnouncementReadAction,
  publishOfficialAnnouncementAction,
  saveOfficialAnnouncementAction,
  updateOfficialAnnouncementAction,
} from "@/app/actions/official-announcements";
import {SecureAttachmentUpload} from "@/components/forms/secure-attachment-upload";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";

type Announcement = {
  id: string;
  title: string;
  body: string;
  title_fr: string | null;
  body_fr: string | null;
  title_en: string | null;
  body_en: string | null;
  category: string;
  priority: string;
  audience_scope: string;
  audience_values: string[];
  acknowledgement_required: boolean;
  status: string;
  publish_at: string | null;
  expires_at: string | null;
  published_at: string | null;
  attachment_storage_path: string | null;
  attachment_file_name: string | null;
  created_at: string;
};

type Recipient = {announcement_id: string; user_id: string; first_opened_at: string | null; acknowledged_at: string | null};

const categoryNames: Record<string, {fr: string; en: string}> = {
  direction: {fr: "Direction", en: "Leadership"}, hr: {fr: "Ressources humaines", en: "Human resources"},
  finance: {fr: "Finance", en: "Finance"}, platform: {fr: "Plateforme", en: "Platform"},
  event: {fr: "Événement", en: "Event"}, recognition: {fr: "Reconnaissance", en: "Recognition"}, urgent: {fr: "Alerte", en: "Alert"},
};

function tone(priority: string) {
  if (priority === "urgent") return "border-red-300 bg-red-50 text-red-950";
  if (priority === "important") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-slate-200 bg-white text-slate-950";
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function localizedAnnouncement(item: Announcement, locale: "fr" | "en") {
  if (locale === "en") {
    return {
      title: item.title_en?.trim() || item.title_fr?.trim() || item.title,
      body: item.body_en?.trim() || item.body_fr?.trim() || item.body,
    };
  }
  return {
    title: item.title_fr?.trim() || item.title,
    body: item.body_fr?.trim() || item.body,
  };
}

export default async function OfficialAnnouncementsPage({searchParams}: {searchParams: Promise<{success?: string; error?: string; edit?: string}>}) {
  const [{locale}, context, query] = await Promise.all([getI18n(), requireAccessContext(), searchParams]);
  const fr = locale === "fr";
  const canPublish = ["owner", "admin", "hr"].includes(context.role);
  const now = new Date();

  const [recipientResult, teamsResult] = await Promise.all([
    context.admin.from("official_announcement_recipients").select("announcement_id,user_id,first_opened_at,acknowledged_at").eq("organization_id", context.organizationId),
    canPublish ? context.admin.from("teams").select("id,name,department").eq("organization_id", context.organizationId).eq("is_active", true).order("name") : Promise.resolve({data: []}),
  ]);
  const allRecipients = (recipientResult.data ?? []) as Recipient[];
  const ownRecipients = allRecipients.filter((row) => row.user_id === context.user.id);
  const ownIds = ownRecipients.map((row) => row.announcement_id);

  let announcements: Announcement[] = [];
  if (canPublish) {
    const {data} = await context.admin.from("official_announcements").select("*").eq("organization_id", context.organizationId).order("created_at", {ascending: false});
    announcements = (data ?? []) as Announcement[];
  } else if (ownIds.length) {
    const {data} = await context.admin.from("official_announcements").select("*").eq("organization_id", context.organizationId).in("id", ownIds).eq("status", "published").order("published_at", {ascending: false});
    announcements = (data ?? []) as Announcement[];
  }

  const visible = announcements.filter((item) => canPublish || (
    item.status === "published"
    && (!item.publish_at || new Date(item.publish_at) <= now)
    && (!item.expires_at || new Date(item.expires_at) > now)
  ));
  const teams = (teamsResult.data ?? []) as Array<{id: string; name: string; department: string | null}>;
  const departments = [...new Set(teams.map((team) => team.department).filter((item): item is string => Boolean(item)))].sort();
  const recipientByAnnouncement = new Map(ownRecipients.map((row) => [row.announcement_id, row]));
  const counts = new Map<string, {total: number; read: number; acknowledged: number}>();
  for (const row of allRecipients) {
    const count = counts.get(row.announcement_id) ?? {total: 0, read: 0, acknowledged: 0};
    count.total += 1;
    if (row.first_opened_at) count.read += 1;
    if (row.acknowledged_at) count.acknowledged += 1;
    counts.set(row.announcement_id, count);
  }
  const editing = canPublish && query.edit ? announcements.find((item) => item.id === query.edit && item.status !== "archived") : undefined;

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-7 text-white shadow-xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">{fr ? "Communication institutionnelle · V4.8.6" : "Institutional communication · V4.8.6"}</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">{fr ? "Annonces officielles" : "Official announcements"}</h1>
        <p className="mt-3 max-w-3xl leading-7 text-indigo-100">{fr ? "Le registre officiel et traçable des communications importantes de l’organisation." : "The official, traceable record of important organisational communications."}</p>
      </header>

      {query.success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900">{query.success}</p> : null}
      {query.error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-900">{query.error}</p> : null}

      {editing ? <section id="edit-announcement" className="mt-7 scroll-mt-6 rounded-3xl border-2 border-indigo-300 bg-indigo-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "Correction officielle" : "Official correction"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Modifier l’annonce publiée" : "Edit the published announcement"}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{fr ? "Les lectures et confirmations sont conservées, sauf si tu demandes explicitement une nouvelle confirmation." : "Reads and acknowledgements are preserved unless you explicitly request a new acknowledgement."}</p></div><Link href="/dashboard/announcements" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">{fr ? "Annuler" : "Cancel"}</Link></div>
        <form action={updateOfficialAnnouncementAction} className="mt-6 grid gap-4 lg:grid-cols-2">
          <input type="hidden" name="announcementId" value={editing.id} />
          <div className="rounded-2xl border border-blue-200 bg-white p-4 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-700">Français</p>
            <label className="mt-3 block text-sm font-black">Titre français<input name="titleFr" required minLength={3} maxLength={220} defaultValue={editing.title_fr ?? editing.title} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
            <label className="mt-4 block text-sm font-black">Contenu français<textarea name="bodyFr" required minLength={10} maxLength={12000} rows={6} defaultValue={editing.body_fr ?? editing.body} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-white p-4 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-indigo-700">English</p>
            <label className="mt-3 block text-sm font-black">English title<input name="titleEn" required minLength={3} maxLength={220} defaultValue={editing.title_en ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
            <label className="mt-4 block text-sm font-black">English content<textarea name="bodyEn" required minLength={10} maxLength={12000} rows={6} defaultValue={editing.body_en ?? ""} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
          </div>
          <label className="text-sm font-black">{fr ? "Catégorie" : "Category"}<select name="category" defaultValue={editing.category} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3">{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{fr ? label.fr : label.en}</option>)}</select></label>
          <label className="text-sm font-black">{fr ? "Priorité" : "Priority"}<select name="priority" defaultValue={editing.priority} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"><option value="normal">{fr ? "Normale" : "Normal"}</option><option value="important">{fr ? "Importante" : "Important"}</option><option value="urgent">{fr ? "Urgente" : "Urgent"}</option></select></label>
          <label className="text-sm font-black lg:col-span-2">{fr ? "Nouvelle date d’expiration" : "New expiry date"}<input name="expiresAt" type="datetime-local" defaultValue={localDateTime(editing.expires_at)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /><span className="mt-1 block text-xs font-normal text-slate-500">{fr ? "Laisse vide pour supprimer l’expiration." : "Leave blank to remove the expiry."}</span></label>
          <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold lg:col-span-2"><input name="acknowledgementRequired" type="checkbox" defaultChecked={editing.acknowledgement_required} className="mt-1" /><span>{fr ? "Exiger la confirmation « J’ai lu et compris »." : "Require an “I have read and understood” acknowledgement."}</span></label>
          {editing.status === "published" ? <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-950 lg:col-span-2"><input name="resetAcknowledgements" type="checkbox" className="mt-1" /><span>{fr ? "Modification importante : annuler les anciennes confirmations et demander à tous les destinataires de confirmer de nouveau." : "Material change: clear previous acknowledgements and require every recipient to acknowledge again."}</span></label> : null}
          <button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white lg:col-span-2">{fr ? "Enregistrer les modifications" : "Save changes"}</button>
        </form>
      </section> : null}

      {canPublish ? <section className="mt-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{fr ? "Publication" : "Publishing"}</p>
        <h2 className="mt-2 text-2xl font-black">{fr ? "Créer une annonce" : "Create an announcement"}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{fr ? "L’annonce est d’abord enregistrée en brouillon. Rédige les versions française et anglaise : chaque collaborateur verra automatiquement celle correspondant à la langue choisie dans son profil." : "The announcement is first saved as a draft. Write both French and English versions: each employee automatically sees the version matching the language selected in their profile."}</p>
        <form action={saveOfficialAnnouncementAction} className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-black uppercase tracking-[0.14em] text-blue-700">Version française</p><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-800">FR</span></div>
            <label className="mt-3 block text-sm font-black">Titre français<input name="titleFr" required minLength={3} maxLength={220} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
            <label className="mt-4 block text-sm font-black">Contenu français<textarea name="bodyFr" required minLength={10} maxLength={12000} rows={6} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-black uppercase tracking-[0.14em] text-indigo-700">English version</p><span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-800">EN</span></div>
            <label className="mt-3 block text-sm font-black">English title<input name="titleEn" required minLength={3} maxLength={220} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
            <label className="mt-4 block text-sm font-black">English content<textarea name="bodyEn" required minLength={10} maxLength={12000} rows={6} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label>
          </div>
          <label className="text-sm font-black">{fr ? "Catégorie" : "Category"}<select name="category" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3">{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{fr ? label.fr : label.en}</option>)}</select></label>
          <label className="text-sm font-black">{fr ? "Priorité" : "Priority"}<select name="priority" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"><option value="normal">{fr ? "Normale" : "Normal"}</option><option value="important">{fr ? "Importante" : "Important"}</option><option value="urgent">{fr ? "Urgente" : "Urgent"}</option></select></label>
          <label className="text-sm font-black">{fr ? "Audience" : "Audience"}<select name="audienceScope" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"><option value="organization">{fr ? "Toute l’organisation" : "Entire organisation"}</option><option value="role">{fr ? "Rôles sélectionnés" : "Selected roles"}</option><option value="department">{fr ? "Départements sélectionnés" : "Selected departments"}</option><option value="team">{fr ? "Équipes sélectionnées" : "Selected teams"}</option></select></label>
          <label className="text-sm font-black">{fr ? "Valeurs de ciblage" : "Target values"}<select name="audienceValues" multiple className="mt-2 h-36 w-full rounded-xl border border-slate-300 px-4 py-3"><optgroup label={fr ? "Rôles" : "Roles"}>{["owner","admin","executive","hr","manager","employee"].map((role) => <option key={role} value={role}>{role}</option>)}</optgroup><optgroup label={fr ? "Départements" : "Departments"}>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</optgroup><optgroup label={fr ? "Équipes" : "Teams"}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</optgroup></select><span className="mt-1 block text-xs font-normal text-slate-500">{fr ? "À utiliser uniquement pour le type d’audience choisi. Ctrl/Cmd permet plusieurs choix." : "Use only for the selected audience type. Ctrl/Cmd allows multiple selections."}</span></label>
          <label className="text-sm font-black">{fr ? "Publication à partir de" : "Publish from"}<input name="publishAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
          <label className="text-sm font-black">{fr ? "Expiration" : "Expiry"}<input name="expiresAt" type="datetime-local" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
          <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold lg:col-span-2"><input name="acknowledgementRequired" type="checkbox" className="mt-1" /><span>{fr ? "Exiger la confirmation « J’ai lu et compris »." : "Require an “I have read and understood” acknowledgement."}</span></label>
          <div className="lg:col-span-2"><SecureAttachmentUpload purpose="announcement" prefix="announcementAttachment" label={fr ? "Pièce jointe facultative" : "Optional attachment"} help={fr ? "PDF, image ou document Word · 10 Mo maximum · accès privé." : "PDF, image or Word document · 10 MB maximum · private access."} chooseLabel={fr ? "Choisir un fichier" : "Choose a file"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Fichier prêt" : "File ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Fichier non valide." : "Invalid file."} /></div>
          <button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white lg:col-span-2">{fr ? "Enregistrer le brouillon" : "Save draft"}</button>
        </form>
      </section> : null}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{fr ? "Registre" : "Register"}</p><h2 className="mt-2 text-2xl font-black">{canPublish ? (fr ? "Toutes les annonces" : "All announcements") : (fr ? "Mes annonces" : "My announcements")}</h2></div><p className="rounded-full bg-slate-200 px-4 py-2 text-sm font-black">{visible.length}</p></div>
        <div className="mt-5 space-y-4">
          {visible.map((item) => {
            const recipient = recipientByAnnouncement.get(item.id);
            const stats = counts.get(item.id) ?? {total: 0, read: 0, acknowledged: 0};
            const localized = localizedAnnouncement(item, fr ? "fr" : "en");
            return <article id={`announcement-${item.id}`} key={item.id} className={`scroll-mt-6 rounded-3xl border p-6 shadow-sm ${tone(item.priority)}`}>
              <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">{fr ? categoryNames[item.category]?.fr : categoryNames[item.category]?.en}</span><span className="rounded-full border border-current px-3 py-1 text-xs font-black">{item.status === "draft" ? (fr ? "Brouillon" : "Draft") : item.status === "archived" ? (fr ? "Archivée" : "Archived") : item.priority === "urgent" ? (fr ? "Urgente" : "Urgent") : item.priority === "important" ? (fr ? "Importante" : "Important") : (fr ? "Publiée" : "Published")}</span>{item.acknowledgement_required ? <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">{fr ? "Confirmation requise" : "Acknowledgement required"}</span> : null}{canPublish ? <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-800">{item.title_en && item.body_en ? "FR + EN" : (fr ? "FR historique" : "Legacy FR")}</span> : null}</div><h3 className="mt-4 text-xl font-black">{localized.title}</h3></div><p className="text-xs font-bold opacity-70">{new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short"}).format(new Date(item.publish_at ?? item.created_at))}</p></div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 opacity-90">{localized.body}</p>
              {item.attachment_storage_path ? <Link href={`/api/attachments/announcement/${item.id}`} target="_blank" className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">📎 {item.attachment_file_name ?? (fr ? "Ouvrir la pièce jointe" : "Open attachment")}</Link> : null}
              {canPublish ? <div className="mt-5 rounded-2xl bg-white/70 p-4"><div className="grid gap-3 text-center sm:grid-cols-3"><div><p className="text-2xl font-black">{stats.total}</p><p className="text-xs font-bold opacity-70">{fr ? "destinataires" : "recipients"}</p></div><div><p className="text-2xl font-black">{stats.read}</p><p className="text-xs font-bold opacity-70">{fr ? "lectures" : "reads"}</p></div><div><p className="text-2xl font-black">{stats.acknowledged}</p><p className="text-xs font-bold opacity-70">{fr ? "confirmations" : "acknowledgements"}</p></div></div><div className="mt-4 flex flex-wrap gap-2">{item.status === "draft" ? <form action={publishOfficialAnnouncementAction}><input type="hidden" name="announcementId" value={item.id} /><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">{fr ? "Publier" : "Publish"}</button></form> : null}{item.status !== "archived" ? <Link href={`/dashboard/announcements?edit=${item.id}#edit-announcement`} className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white">{fr ? "Modifier" : "Edit"}</Link> : null}{item.status !== "archived" ? <form action={archiveOfficialAnnouncementAction}><input type="hidden" name="announcementId" value={item.id} /><button className="rounded-xl border border-slate-400 px-4 py-2 text-sm font-black">{fr ? "Archiver" : "Archive"}</button></form> : null}</div></div> : <div className="mt-5 flex flex-wrap items-center gap-3">{!recipient?.first_opened_at ? <form action={markOfficialAnnouncementReadAction}><input type="hidden" name="announcementId" value={item.id} /><button className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white">{fr ? "Marquer comme lue" : "Mark as read"}</button></form> : <span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-900">✓ {fr ? "Lue" : "Read"}</span>}{item.acknowledgement_required && !recipient?.acknowledged_at ? <form action={acknowledgeOfficialAnnouncementAction}><input type="hidden" name="announcementId" value={item.id} /><button className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-amber-950">{fr ? "J’ai lu et compris" : "I have read and understood"}</button></form> : null}{recipient?.acknowledged_at ? <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-black text-amber-950">✓ {fr ? "Confirmation enregistrée" : "Acknowledgement recorded"}</span> : null}</div>}
            </article>;
          })}
          {!visible.length ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="text-lg font-black">{fr ? "Aucune annonce à afficher" : "No announcements to display"}</p><p className="mt-2 text-sm text-slate-500">{fr ? "Les communications qui te sont destinées apparaîtront ici." : "Communications intended for you will appear here."}</p></div> : null}
        </div>
      </section>
    </div>
  </main>;
}
