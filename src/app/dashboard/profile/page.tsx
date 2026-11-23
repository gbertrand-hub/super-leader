import Link from "next/link";
import {redirect} from "next/navigation";
import {
  changeMyPasswordAction,
  saveMyNotificationPreferencesAction,
  saveMyProfileAction,
} from "@/app/actions/profile";
import {CountrySelect} from "@/components/forms/country-select";
import {TimeZoneSelect} from "@/components/forms/time-zone-select";
import {ProfileAvatarUpload} from "@/components/profile/avatar-upload";
import {getI18n} from "@/i18n/server";
import {createProfileAvatarSignedUrl} from "@/lib/profile/avatar";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ProfileRow = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  preferred_locale: "fr" | "en" | null;
  time_zone: string | null;
  bio: string | null;
  avatar_storage_path: string | null;
  password_changed_at: string | null;
  created_at: string;
};
type MembershipRow = {
  organization_id: string;
  role: string;
  created_at: string;
  organizations: {name?: string | null} | {name?: string | null}[] | null;
};
type PreferenceRow = {
  email_enabled: boolean;
  email_frequency: "instant" | "daily" | "off";
  locale: "fr" | "en";
  report_reminders: boolean;
  absence_updates: boolean;
  meeting_reminders: boolean;
  sales_updates: boolean;
  collection_updates: boolean;
  feedback_alerts: boolean;
  performance_updates: boolean;
  crm_updates: boolean;
  finance_updates: boolean;
};

type TeamRow = {id: string; name: string; department: string | null; manager_id: string | null};
type ManagerProfile = {id: string; full_name: string | null; email: string | null};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function firstOrganization(value: MembershipRow["organizations"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function Field({label, help, children}: {label: string; help?: string; children: React.ReactNode}) {
  return <label className="block"><span className="text-sm font-black text-slate-800">{label}</span>{help ? <span className="mt-1 block text-xs leading-5 text-slate-500">{help}</span> : null}<span className="mt-2 block">{children}</span></label>;
}

function Toggle({name, label, help, checked}: {name: string; label: string; help: string; checked: boolean}) {
  return <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><input type="checkbox" name={name} defaultChecked={checked} className="mt-1 h-5 w-5 rounded border-slate-300" /><span><span className="block font-black text-slate-900">{label}</span><span className="mt-1 block text-sm leading-5 text-slate-500">{help}</span></span></label>;
}

export default async function ProfilePage({searchParams}: {searchParams: SearchParams}) {
  const {locale, t} = await getI18n();
  const fr = locale === "fr";
  const c = fr ? copy.fr : copy.en;
  const params = await searchParams;
  const success = first(params.success);
  const errorMessage = first(params.error);
  const section = first(params.section) || "identity";

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const [profileResult, membershipResult] = await Promise.all([
    admin.from("profiles").select("full_name,email,phone,country,city,preferred_locale,time_zone,bio,avatar_storage_path,password_changed_at,created_at").eq("id", authData.user.id).maybeSingle<ProfileRow>(),
    admin.from("organization_members").select("organization_id,role,created_at,organizations(name)").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<MembershipRow>(),
  ]);

  if (profileResult.error) {
    const missing = ["42703", "PGRST204"].includes(String(profileResult.error.code ?? ""));
    if (missing) return <MigrationRequired fr={fr} />;
    throw new Error(profileResult.error.message);
  }
  const profile = profileResult.data;
  if (!profile) redirect("/login");
  const membership = membershipResult.data;
  const organizationName = firstOrganization(membership?.organizations ?? null)?.name ?? c.noOrganization;
  const avatarUrl = await createProfileAvatarSignedUrl(admin, profile.avatar_storage_path, 3600);

  let preferences: PreferenceRow | null = null;
  let teams: TeamRow[] = [];
  let supervisorNames: string[] = [];
  let vipMember: {id: string; member_number: string; status: string} | null = null;
  let vipCard: {id: string; card_number: string; status: string; valid_until: string} | null = null;

  if (membership) {
    const [preferencesResult, teamMembershipResult, scheduleResult, vipMemberResult] = await Promise.all([
      admin.from("notification_preferences").select("email_enabled,email_frequency,locale,report_reminders,absence_updates,meeting_reminders,sales_updates,collection_updates,feedback_alerts,performance_updates,crm_updates,finance_updates").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).maybeSingle<PreferenceRow>(),
      admin.from("team_members").select("team_id").eq("user_id", authData.user.id),
      admin.from("member_work_schedules").select("supervisor_id").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("is_active", true).maybeSingle<{supervisor_id: string | null}>(),
      admin.from("vip_members").select("id,member_number,status").eq("organization_id", membership.organization_id).eq("linked_user_id", authData.user.id).neq("status", "withdrawn").limit(1).maybeSingle<{id: string; member_number: string; status: string}>(),
    ]);
    preferences = preferencesResult.data ?? null;
    vipMember = vipMemberResult.data ?? null;

    const teamIds = (teamMembershipResult.data ?? []).map((row) => String(row.team_id));
    if (teamIds.length) {
      const {data: teamRows} = await admin.from("teams").select("id,name,department,manager_id").in("id", teamIds).eq("organization_id", membership.organization_id);
      teams = (teamRows ?? []) as TeamRow[];
    }

    const supervisorIds = new Set<string>();
    if (scheduleResult.data?.supervisor_id) supervisorIds.add(scheduleResult.data.supervisor_id);
    for (const team of teams) if (team.manager_id) supervisorIds.add(team.manager_id);
    if (supervisorIds.size) {
      const {data: managerRows} = await admin.from("profiles").select("id,full_name,email").in("id", [...supervisorIds]);
      const managerMap = new Map(((managerRows ?? []) as ManagerProfile[]).map((manager) => [manager.id, manager]));
      supervisorNames = [...supervisorIds].map((id) => managerMap.get(id)?.full_name?.trim() || managerMap.get(id)?.email || c.unknown).filter(Boolean);
    }

    if (vipMember) {
      const {data: card} = await admin.from("vip_cards").select("id,card_number,status,valid_until").eq("organization_id", membership.organization_id).eq("member_id", vipMember.id).order("issue_number", {ascending: false}).limit(1).maybeSingle<{id: string; card_number: string; status: string; valid_until: string}>();
      vipCard = card ?? null;
    }
  }

  const fullName = profile.full_name?.trim() || authData.user.user_metadata?.full_name || c.leader;
  const preferredLocale = profile.preferred_locale ?? (fr ? "fr" : "en");
  const timeZone = normalizeTimeZone(profile.time_zone);
  const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";
  const roleLabel = membership ? t(`roles.${membership.role}`) : c.noRole;
  const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(value)) : "—";

  const tabs = [
    ["identity", c.identityTab],
    ["professional", c.professionalTab],
    ["notifications", c.notificationsTab],
    ["security", c.securityTab],
  ] as const;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Super Leader · V3.3.0</p><h1 className="mt-2 text-3xl font-black">{c.title}</h1><p className="mt-2 max-w-3xl text-slate-300">{c.subtitle}</p></div>
            <Link href="/dashboard/my-day" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-black text-white hover:bg-white/10">← {c.back}</Link>
          </div>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{errorMessage}</div> : null}

        <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map(([value, label]) => <Link key={value} href={`/dashboard/profile?section=${value}`} className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${section === value ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>)}
          <Link href="/dashboard/profile/badge" className="rounded-xl px-4 py-2.5 text-sm font-black text-cyan-700 transition hover:bg-cyan-50">{c.badgeTab}</Link>
        </nav>

        {section === "identity" ? (
          <form action={saveMyProfileAction} className="mt-6 space-y-6">
            <ProfileAvatarUpload currentUrl={avatarUrl} initials={initials(fullName)} labels={{title: c.avatarTitle, help: c.avatarHelp, choose: c.avatarChoose, replace: c.avatarReplace, remove: c.avatarRemove, uploading: c.avatarUploading, ready: c.avatarReady, error: c.avatarError}} />
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div><h2 className="text-2xl font-black">{c.personalInfo}</h2><p className="mt-2 text-slate-600">{c.personalInfoHelp}</p></div>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <Field label={c.fullName}><input name="fullName" required minLength={2} maxLength={120} defaultValue={fullName} className={inputClass} /></Field>
                <Field label={c.email} help={c.emailLocked}><input value={authData.user.email ?? profile.email ?? ""} readOnly className={`${inputClass} bg-slate-100 text-slate-500`} /></Field>
                <Field label={c.phone}><input name="phone" maxLength={40} defaultValue={profile.phone ?? ""} className={inputClass} /></Field>
                <Field label={c.city}><input name="city" maxLength={120} defaultValue={profile.city ?? ""} className={inputClass} /></Field>
                <Field label={c.country}><CountrySelect name="country" locale={fr ? "fr" : "en"} defaultValue={profile.country} className={inputClass} /></Field>
                <Field label={c.language}><select name="preferredLocale" defaultValue={preferredLocale} className={inputClass}><option value="fr">Français</option><option value="en">English</option></select></Field>
                <Field label={c.timeZone} help={c.timeZoneHelp}><TimeZoneSelect name="timeZone" defaultValue={timeZone} locale={fr ? "fr" : "en"} className={inputClass} /></Field>
                <div className="md:col-span-2"><Field label={c.bio} help={c.bioHelp}><textarea name="bio" rows={5} maxLength={800} defaultValue={profile.bio ?? ""} className={inputClass} /></Field></div>
              </div>
              <button type="submit" className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-black text-white hover:bg-indigo-700">{c.saveProfile}</button>
            </section>
          </form>
        ) : null}

        {section === "professional" ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{c.professionalInfo}</h2><p className="mt-2 text-slate-600">{c.professionalHelp}</p><dl className="mt-6 space-y-4 text-sm">{[[c.organization, organizationName],[c.role, roleLabel],[c.memberSince, date(membership?.created_at ?? profile.created_at)]].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-5 border-b border-slate-100 pb-4"><dt className="font-bold text-slate-500">{label}</dt><dd className="text-right font-black text-slate-900">{value}</dd></div>)}</dl></section>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{c.teamsAndSupervision}</h2><div className="mt-5 space-y-3">{teams.length ? teams.map((team) => <div key={team.id} className="rounded-2xl bg-slate-50 p-4"><p className="font-black">{team.name}</p><p className="mt-1 text-sm text-slate-500">{team.department || c.departmentNotSet}</p></div>) : <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">{c.noTeams}</p>}</div><h3 className="mt-6 font-black">{c.supervisors}</h3><p className="mt-2 text-slate-600">{supervisorNames.length ? supervisorNames.join(", ") : c.noSupervisor}</p></section>
            {vipMember ? <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm lg:col-span-2"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">Super Leader VIP</p><h2 className="mt-2 text-2xl font-black">{c.vipMember}</h2><p className="mt-2 text-slate-700">{vipMember.member_number} · {vipMember.status}</p>{vipCard ? <p className="mt-1 text-sm text-slate-600">{vipCard.card_number} · {c.validUntil} {date(vipCard.valid_until)}</p> : null}</div>{vipCard ? <Link href={`/dashboard/vip/card/${vipCard.id}`} className="rounded-xl bg-rose-700 px-5 py-3 text-center font-black text-white hover:bg-rose-800">{c.viewVipCard}</Link> : null}</div></section> : null}
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 lg:col-span-2"><p className="font-black text-amber-900">{c.controlledInfo}</p><p className="mt-2 text-sm leading-6 text-amber-800">{c.controlledInfoHelp}</p></section>
          </div>
        ) : null}

        {section === "notifications" ? (
          <form action={saveMyNotificationPreferencesAction} className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{c.notificationPreferences}</h2><p className="mt-2 text-slate-600">{c.notificationHelp}</p>
            {!membership ? <p className="mt-5 rounded-xl bg-amber-50 p-4 font-bold text-amber-800">{c.notificationsRequireOrganization}</p> : <>
              <div className="mt-6 grid gap-5 md:grid-cols-3"><Field label={c.emailFrequency}><select name="emailFrequency" defaultValue={preferences?.email_frequency ?? "daily"} className={inputClass}><option value="instant">{c.instant}</option><option value="daily">{c.daily}</option><option value="off">{c.off}</option></select></Field><Field label={c.notificationLanguage}><select name="notificationLocale" defaultValue={preferences?.locale ?? preferredLocale} className={inputClass}><option value="fr">Français</option><option value="en">English</option></select></Field><Toggle name="emailEnabled" label={c.emailNotifications} help={c.emailNotificationsHelp} checked={preferences?.email_enabled ?? true} /></div>
              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Toggle name="reportReminders" label={c.reportReminders} help={c.reportRemindersHelp} checked={preferences?.report_reminders ?? true} />
                <Toggle name="absenceUpdates" label={c.absenceUpdates} help={c.absenceUpdatesHelp} checked={preferences?.absence_updates ?? true} />
                <Toggle name="meetingReminders" label={c.meetingReminders} help={c.meetingRemindersHelp} checked={preferences?.meeting_reminders ?? true} />
                <Toggle name="salesUpdates" label={c.salesUpdates} help={c.salesUpdatesHelp} checked={preferences?.sales_updates ?? true} />
                <Toggle name="collectionUpdates" label={c.collectionUpdates} help={c.collectionUpdatesHelp} checked={preferences?.collection_updates ?? true} />
                <Toggle name="feedbackAlerts" label={c.feedbackAlerts} help={c.feedbackAlertsHelp} checked={preferences?.feedback_alerts ?? true} />
                <Toggle name="performanceUpdates" label={c.performanceUpdates} help={c.performanceUpdatesHelp} checked={preferences?.performance_updates ?? true} />
                <Toggle name="crmUpdates" label={c.crmUpdates} help={c.crmUpdatesHelp} checked={preferences?.crm_updates ?? true} />
                <Toggle name="financeUpdates" label={c.financeUpdates} help={c.financeUpdatesHelp} checked={preferences?.finance_updates ?? true} />
              </div>
              <button type="submit" className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-black text-white hover:bg-indigo-700">{c.saveNotifications}</button>
            </>}
          </form>
        ) : null}

        {section === "security" ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_.8fr]">
            <form action={changeMyPasswordAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{c.changePassword}</h2><p className="mt-2 text-slate-600">{c.passwordHelp}</p><div className="mt-6 space-y-5"><Field label={c.newPassword}><input type="password" name="password" required minLength={10} autoComplete="new-password" className={inputClass} /></Field><Field label={c.confirmPassword}><input type="password" name="confirmPassword" required minLength={10} autoComplete="new-password" className={inputClass} /></Field></div><button type="submit" className="mt-6 rounded-xl bg-slate-950 px-6 py-3 font-black text-white hover:bg-slate-800">{c.updatePassword}</button></form>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{c.accountSecurity}</h2><dl className="mt-5 space-y-4 text-sm"><div className="border-b border-slate-100 pb-4"><dt className="font-bold text-slate-500">{c.accountEmail}</dt><dd className="mt-1 break-all font-black">{authData.user.email}</dd></div><div className="border-b border-slate-100 pb-4"><dt className="font-bold text-slate-500">{c.lastPasswordChange}</dt><dd className="mt-1 font-black">{date(profile.password_changed_at)}</dd></div><div><dt className="font-bold text-slate-500">{c.accountCreated}</dt><dd className="mt-1 font-black">{date(profile.created_at)}</dd></div></dl><p className="mt-6 rounded-xl bg-indigo-50 p-4 text-sm leading-6 text-indigo-800">{c.securityAdvice}</p></section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function MigrationRequired({fr}: {fr: boolean}) {
  return <main className="min-h-screen bg-slate-50 px-5 py-10"><div className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-2xl font-black text-amber-950">{fr ? "Migration Mon profil requise" : "My profile migration required"}</h1><p className="mt-3 text-amber-900">{fr ? "Exécute la migration Supabase suivante avant d’ouvrir cette page :" : "Run the following Supabase migration before opening this page:"}</p><code className="mt-4 block rounded-xl bg-slate-950 p-4 text-sm font-bold text-white">049_my_profile_personal_settings_v3_2_9.sql</code></div></main>;
}

const copy = {
  fr: {
    title: "Mon profil", subtitle: "Mets à jour tes informations personnelles, ta photo, tes préférences et la sécurité de ton compte.", back: "Ma journée", identityTab: "Profil personnel", professionalTab: "Informations professionnelles", notificationsTab: "Notifications", securityTab: "Sécurité", badgeTab: "Mon badge officiel", avatarTitle: "Photo de profil", avatarHelp: "JPG, PNG ou WEBP · 2 Mo maximum. La photo est conservée dans un espace privé.", avatarChoose: "Ajouter une photo", avatarReplace: "Remplacer la photo", avatarRemove: "Retirer", avatarUploading: "Téléversement sécurisé en cours…", avatarReady: "Nouvelle photo prête", avatarError: "Photo invalide. Utilise un JPG, PNG ou WEBP de 2 Mo maximum.", personalInfo: "Informations personnelles", personalInfoHelp: "Ces informations te suivent dans Super Leader. Ton rôle et tes affectations restent contrôlés par l’organisation.", fullName: "Nom complet", email: "Adresse e-mail professionnelle", emailLocked: "L’adresse principale est protégée. Contacte un administrateur pour la modifier.", phone: "Téléphone", city: "Ville", country: "Pays", language: "Langue préférée", timeZone: "Fuseau horaire", timeZoneHelp: "Utilise un identifiant IANA, par exemple Europe/Dublin ou America/Chicago.", bio: "Courte biographie", bioHelp: "800 caractères maximum.", saveProfile: "Enregistrer mon profil", professionalInfo: "Informations professionnelles", professionalHelp: "Ces informations sont en lecture seule dans ton espace personnel.", organization: "Organisation", role: "Rôle", memberSince: "Membre depuis", teamsAndSupervision: "Équipes et supervision", departmentNotSet: "Département non défini", noTeams: "Aucune équipe active ne t’est encore attribuée.", supervisors: "Responsable(s)", noSupervisor: "Aucun responsable officiel n’est encore défini.", controlledInfo: "Informations contrôlées par l’organisation", controlledInfoHelp: "Le rôle, les permissions, l’adresse e-mail principale, les équipes, le responsable et le statut du compte sont modifiés uniquement par Owner, Admin ou RH.", vipMember: "Mon statut VIP", validUntil: "Valable jusqu’au", viewVipCard: "Voir ma carte VIP", notificationPreferences: "Préférences de notification", notificationHelp: "Choisis les informations que tu souhaites recevoir et la fréquence des e-mails.", notificationsRequireOrganization: "Les préférences sont disponibles après l’activation de ton appartenance à une organisation.", emailFrequency: "Fréquence des e-mails", notificationLanguage: "Langue des notifications", instant: "Immédiate", daily: "Résumé quotidien", off: "Désactivée", emailNotifications: "Notifications par e-mail", emailNotificationsHelp: "Autoriser l’envoi d’e-mails opérationnels.", reportReminders: "Rappels de rapports", reportRemindersHelp: "Échéances et rapports journaliers.", absenceUpdates: "Absences et congés", absenceUpdatesHelp: "Décisions et changements sur les absences.", meetingReminders: "Réunions", meetingRemindersHelp: "Rappels et modifications des réunions.", salesUpdates: "Ventes", salesUpdatesHelp: "Nouvelles ventes et paiements initiaux.", collectionUpdates: "Recouvrement", collectionUpdatesHelp: "Échéances et suivi des soldes.", feedbackAlerts: "Feedback", feedbackAlertsHelp: "Nouveaux feedbacks et actions associées.", performanceUpdates: "Performance", performanceUpdatesHelp: "Évaluations, scores et reconnaissances.", crmUpdates: "CRM", crmUpdatesHelp: "Clients, tâches et suivis commerciaux.", financeUpdates: "Finance et paie", financeUpdatesHelp: "Documents financiers et bulletins disponibles.", saveNotifications: "Enregistrer mes préférences", changePassword: "Changer mon mot de passe", passwordHelp: "Utilise au moins 10 caractères avec une majuscule, une minuscule et un chiffre.", newPassword: "Nouveau mot de passe", confirmPassword: "Confirmer le mot de passe", updatePassword: "Modifier mon mot de passe", accountSecurity: "Sécurité du compte", accountEmail: "E-mail du compte", lastPasswordChange: "Dernier changement de mot de passe", accountCreated: "Compte créé le", securityAdvice: "Ne partage jamais ton mot de passe. Déconnecte-toi des appareils partagés et signale immédiatement toute activité inhabituelle.", noOrganization: "Aucune organisation", noRole: "Aucun rôle actif", unknown: "Utilisateur", leader: "Leader",
  },
  en: {
    title: "My profile", subtitle: "Update your personal information, photo, preferences and account security.", back: "My day", identityTab: "Personal profile", professionalTab: "Professional information", notificationsTab: "Notifications", securityTab: "Security", badgeTab: "My official badge", avatarTitle: "Profile photo", avatarHelp: "JPG, PNG or WEBP · 2 MB maximum. The photo is stored privately.", avatarChoose: "Add a photo", avatarReplace: "Replace photo", avatarRemove: "Remove", avatarUploading: "Secure upload in progress…", avatarReady: "New photo ready", avatarError: "Invalid photo. Use a JPG, PNG or WEBP file of 2 MB or less.", personalInfo: "Personal information", personalInfoHelp: "These details follow you across Super Leader. Your role and assignments remain controlled by the organisation.", fullName: "Full name", email: "Professional email address", emailLocked: "The primary address is protected. Contact an administrator to change it.", phone: "Phone", city: "City", country: "Country", language: "Preferred language", timeZone: "Time zone", timeZoneHelp: "Use an IANA identifier, such as Europe/Dublin or America/Chicago.", bio: "Short biography", bioHelp: "800 characters maximum.", saveProfile: "Save my profile", professionalInfo: "Professional information", professionalHelp: "This information is read-only in your personal space.", organization: "Organisation", role: "Role", memberSince: "Member since", teamsAndSupervision: "Teams and supervision", departmentNotSet: "Department not set", noTeams: "No active team is assigned to you yet.", supervisors: "Supervisor(s)", noSupervisor: "No official supervisor is defined yet.", controlledInfo: "Organisation-controlled information", controlledInfoHelp: "Role, permissions, primary email, teams, supervisor and account status can only be changed by Owner, Admin or HR.", vipMember: "My VIP status", validUntil: "Valid until", viewVipCard: "View my VIP card", notificationPreferences: "Notification preferences", notificationHelp: "Choose what you want to receive and how often emails are sent.", notificationsRequireOrganization: "Preferences become available after your organisation membership is activated.", emailFrequency: "Email frequency", notificationLanguage: "Notification language", instant: "Instant", daily: "Daily digest", off: "Off", emailNotifications: "Email notifications", emailNotificationsHelp: "Allow operational emails to be sent.", reportReminders: "Report reminders", reportRemindersHelp: "Deadlines and daily reports.", absenceUpdates: "Absence and leave", absenceUpdatesHelp: "Decisions and changes concerning leave.", meetingReminders: "Meetings", meetingRemindersHelp: "Meeting reminders and updates.", salesUpdates: "Sales", salesUpdatesHelp: "New sales and initial payments.", collectionUpdates: "Collections", collectionUpdatesHelp: "Instalments and outstanding balance follow-up.", feedbackAlerts: "Feedback", feedbackAlertsHelp: "New feedback and related actions.", performanceUpdates: "Performance", performanceUpdatesHelp: "Reviews, scores and recognition.", crmUpdates: "CRM", crmUpdatesHelp: "Customers, tasks and commercial follow-up.", financeUpdates: "Finance and payroll", financeUpdatesHelp: "Financial documents and available payslips.", saveNotifications: "Save my preferences", changePassword: "Change my password", passwordHelp: "Use at least 10 characters with an uppercase letter, a lowercase letter and a number.", newPassword: "New password", confirmPassword: "Confirm password", updatePassword: "Change my password", accountSecurity: "Account security", accountEmail: "Account email", lastPasswordChange: "Last password change", accountCreated: "Account created", securityAdvice: "Never share your password. Sign out of shared devices and report unusual activity immediately.", noOrganization: "No organisation", noRole: "No active role", unknown: "User", leader: "Leader",
  },
} as const;
