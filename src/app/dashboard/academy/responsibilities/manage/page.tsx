import Link from "next/link";
import {redirect} from "next/navigation";
import {
  resetAcademyResponsibilityProfileAction,
  updateAcademyResponsibilityProfileAction,
} from "@/app/actions/academy-responsibilities";
import {
  ACADEMY_RESPONSIBILITY_PROFILES,
  buildEffectiveAcademyResponsibilityProfiles,
  getAcademyResponsibilityProfileFrom,
  type AcademyResponsibilityProfileOverrideRow,
  type LocalizedText,
} from "@/lib/academy/responsibilities";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type Locale = "fr" | "en";
type HistoryRow = {
  id: string;
  role_code: string;
  previous_revision: number;
  new_revision: number;
  change_reason: string;
  changed_by: string | null;
  changed_at: string;
};
type ActorProfile = {id: string; full_name: string | null; email: string | null};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function label(value: LocalizedText, locale: Locale) {
  return locale === "fr" ? value.fr : value.en;
}

function listText(items: LocalizedText[] | undefined, locale: Locale) {
  return (items ?? []).map((item) => label(item, locale)).join("\n");
}

function dateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function TextareaField({
  name,
  title,
  value,
  rows = 5,
  hint,
}: {
  name: string;
  title: string;
  value: string;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="block text-sm font-black text-slate-700">
      {title}
      {hint ? <span className="ml-2 font-semibold text-slate-400">{hint}</span> : null}
      <textarea
        name={name}
        rows={rows}
        defaultValue={value}
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-indigo-500"
      />
    </label>
  );
}

export default async function AcademyResponsibilityManagePage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const success = first(params.success);
  const errorMessage = first(params.error);
  const selectedRole = first(params.role) || ACADEMY_RESPONSIBILITY_PROFILES[0].code;
  const {locale: rawLocale} = await getI18n();
  const locale: Locale = rawLocale === "fr" ? "fr" : "en";

  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  if (!["owner", "admin"].includes(membership.role)) redirect("/dashboard/academy/responsibilities");

  const schemaCheck = await admin
    .from("academy_responsibility_profile_overrides")
    .select("id", {head: true, count: "exact"})
    .limit(1);

  if (schemaCheck.error) {
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-5xl">
          <Link href="/dashboard/academy/responsibilities" className="font-bold text-indigo-700">
            ← {locale === "fr" ? "Retour à Mes responsabilités" : "Back to My responsibilities"}
          </Link>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h1 className="text-2xl font-black text-amber-950">{locale === "fr" ? "Activation requise" : "Setup required"}</h1>
            <p className="mt-3 leading-7 text-amber-900">
              {locale === "fr"
                ? "Exécutez la migration V4.8.87 avant de rendre les fiches de responsabilités administrables."
                : "Run the V4.8.87 migration before making responsibility profiles editable."}
            </p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/125_academy_responsibility_editable_profiles_v4_8_87.sql</code>
          </section>
        </div>
      </main>
    );
  }

  const [{data: overrideRows, error: overrideError}, {data: historyRows, error: historyError}] = await Promise.all([
    admin
      .from("academy_responsibility_profile_overrides")
      .select("role_code, profile_json, revision, is_customized")
      .eq("organization_id", membership.organization_id),
    admin
      .from("academy_responsibility_profile_history")
      .select("id, role_code, previous_revision, new_revision, change_reason, changed_by, changed_at")
      .eq("organization_id", membership.organization_id)
      .order("changed_at", {ascending: false})
      .limit(20),
  ]);
  if (overrideError) throw new Error(overrideError.message);
  if (historyError) throw new Error(historyError.message);

  const effectiveProfiles = buildEffectiveAcademyResponsibilityProfiles(
    (overrideRows ?? []) as AcademyResponsibilityProfileOverrideRow[],
  );
  const selectedProfile = getAcademyResponsibilityProfileFrom(effectiveProfiles, selectedRole) ?? effectiveProfiles[0];

  const history = (historyRows ?? []) as HistoryRow[];
  const actorIds = [...new Set(history.map((row) => row.changed_by).filter((value): value is string => Boolean(value)))];
  let actors: ActorProfile[] = [];
  if (actorIds.length) {
    const {data, error} = await admin.from("profiles").select("id, full_name, email").in("id", actorIds);
    if (error) throw new Error(error.message);
    actors = (data ?? []) as ActorProfile[];
  }
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const selectedHistory = history.filter((row) => row.role_code === selectedProfile.code).slice(0, 8);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/academy/responsibilities" className="font-bold text-indigo-700">
            ← {locale === "fr" ? "Retour à Mes responsabilités" : "Back to My responsibilities"}
          </Link>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-violet-700">V4.8.87</span>
        </div>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white shadow-xl shadow-slate-950/10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">Super Leader Académie</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">{locale === "fr" ? "Référentiel des responsabilités" : "Responsibility catalogue"}</h1>
          <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-300">
            {locale === "fr"
              ? "Les 9 fiches officielles peuvent maintenant évoluer sans modifier le code. Chaque modification est historisée et s’applique aux personnes qui occupent ce poste."
              : "The 9 official profiles can now evolve without code changes. Every modification is audited and applies to people holding that role."}
          </p>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="px-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">{locale === "fr" ? "Postes" : "Roles"}</p>
            <nav className="mt-3 space-y-1">
              {effectiveProfiles.map((profile) => (
                <Link
                  key={profile.code}
                  href={`/dashboard/academy/responsibilities/manage?role=${profile.code}`}
                  className={`block rounded-xl px-3 py-3 text-sm font-black transition ${profile.code === selectedProfile.code ? "bg-violet-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                >
                  <span>{label(profile.title, locale)}</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] ${profile.code === selectedProfile.code ? "bg-white/15 text-white" : profile.customized ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                    {profile.customized ? (locale === "fr" ? `Modifié · R${profile.revision}` : `Custom · R${profile.revision}`) : (locale === "fr" ? "Initial" : "Default")}
                  </span>
                </Link>
              ))}
            </nav>
          </aside>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">{locale === "fr" ? "Modification contrôlée" : "Controlled editing"}</p>
                <h2 className="mt-1 text-2xl font-black">{label(selectedProfile.title, locale)}</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {locale === "fr" ? `Révision ${selectedProfile.revision}. Une ligne = une responsabilité, action ou KPI.` : `Revision ${selectedProfile.revision}. One line = one responsibility, action or KPI.`}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${selectedProfile.customized ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                {selectedProfile.customized ? (locale === "fr" ? "Fiche personnalisée" : "Customized profile") : (locale === "fr" ? "Référentiel initial" : "Default profile")}
              </span>
            </div>

            <form action={updateAcademyResponsibilityProfileAction} className="mt-6 space-y-6">
              <input type="hidden" name="roleCode" value={selectedProfile.code} />
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="text-sm font-black text-slate-700">
                  Titre FR
                  <input name="titleFr" maxLength={160} defaultValue={selectedProfile.title.fr} required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500" />
                </label>
                <label className="text-sm font-black text-slate-700">
                  Title EN
                  <input name="titleEn" maxLength={160} defaultValue={selectedProfile.title.en} required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500" />
                </label>
                <TextareaField name="missionFr" title="Mission FR" value={selectedProfile.mission.fr} rows={4} />
                <TextareaField name="missionEn" title="Mission EN" value={selectedProfile.mission.en} rows={4} />
                <TextareaField name="responsibilitiesFr" title="Responsabilités principales FR" value={listText(selectedProfile.responsibilities, "fr")} rows={10} hint="1 ligne = 1 élément" />
                <TextareaField name="responsibilitiesEn" title="Main responsibilities EN" value={listText(selectedProfile.responsibilities, "en")} rows={10} hint="1 line = 1 item" />
                <TextareaField name="dailyFr" title="Actions quotidiennes FR" value={listText(selectedProfile.daily, "fr")} rows={6} />
                <TextareaField name="dailyEn" title="Daily actions EN" value={listText(selectedProfile.daily, "en")} rows={6} />
                <TextareaField name="weeklyFr" title="Actions hebdomadaires FR" value={listText(selectedProfile.weekly, "fr")} rows={6} />
                <TextareaField name="weeklyEn" title="Weekly actions EN" value={listText(selectedProfile.weekly, "en")} rows={6} />
                <TextareaField name="monthlyFr" title="Actions mensuelles FR" value={listText(selectedProfile.monthly, "fr")} rows={6} />
                <TextareaField name="monthlyEn" title="Monthly actions EN" value={listText(selectedProfile.monthly, "en")} rows={6} />
                <TextareaField name="beforeSessionFr" title="Avant session FR" value={listText(selectedProfile.beforeSession, "fr")} rows={5} />
                <TextareaField name="beforeSessionEn" title="Before session EN" value={listText(selectedProfile.beforeSession, "en")} rows={5} />
                <TextareaField name="afterSessionFr" title="Après session FR" value={listText(selectedProfile.afterSession, "fr")} rows={5} />
                <TextareaField name="afterSessionEn" title="After session EN" value={listText(selectedProfile.afterSession, "en")} rows={5} />
                <TextareaField name="kpisFr" title="KPI FR" value={listText(selectedProfile.kpis, "fr")} rows={7} />
                <TextareaField name="kpisEn" title="KPI EN" value={listText(selectedProfile.kpis, "en")} rows={7} />
                <TextareaField name="restrictionsFr" title="Restrictions FR" value={listText(selectedProfile.restrictions, "fr")} rows={5} />
                <TextareaField name="restrictionsEn" title="Restrictions EN" value={listText(selectedProfile.restrictions, "en")} rows={5} />
              </div>

              <label className="block text-sm font-black text-slate-700">
                {locale === "fr" ? "Raison de la modification" : "Reason for change"}
                <input
                  name="changeReason"
                  maxLength={400}
                  minLength={5}
                  required
                  placeholder={locale === "fr" ? "Ex. Clarifier le rapport hebdomadaire attendu" : "e.g. Clarify the expected weekly report"}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-700">
                  {locale === "fr" ? "Enregistrer la nouvelle révision" : "Save new revision"}
                </button>
                <Link href={`/dashboard/academy/responsibilities?role=${selectedProfile.code}`} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700">
                  {locale === "fr" ? "Voir la fiche utilisateur" : "View user profile"}
                </Link>
              </div>
            </form>

            {selectedProfile.customized ? (
              <details className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
                <summary className="cursor-pointer font-black text-red-800">{locale === "fr" ? "Restaurer la fiche initiale" : "Restore default profile"}</summary>
                <form action={resetAcademyResponsibilityProfileAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input type="hidden" name="roleCode" value={selectedProfile.code} />
                  <input name="changeReason" minLength={5} maxLength={400} required placeholder={locale === "fr" ? "Raison du retour à la version initiale" : "Reason for restoring the default"} className="min-w-0 flex-1 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold" />
                  <button type="submit" className="rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white">{locale === "fr" ? "Restaurer" : "Restore"}</button>
                </form>
              </details>
            ) : null}
          </section>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Audit</p>
          <h2 className="mt-1 text-xl font-black">{locale === "fr" ? "Historique récent de cette fiche" : "Recent history for this profile"}</h2>
          <div className="mt-4 space-y-3">
            {selectedHistory.map((row) => {
              const actor = row.changed_by ? actorById.get(row.changed_by) : null;
              return (
                <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-slate-800">R{row.previous_revision} → R{row.new_revision}</p>
                    <p className="text-xs font-bold text-slate-400">{dateLabel(row.changed_at, locale)}</p>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{row.change_reason}</p>
                  <p className="mt-2 text-xs font-bold text-slate-400">{actor?.full_name || actor?.email || row.changed_by || "—"}</p>
                </div>
              );
            })}
            {selectedHistory.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm font-semibold text-slate-400">{locale === "fr" ? "Aucune modification enregistrée pour cette fiche." : "No recorded changes for this profile."}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
