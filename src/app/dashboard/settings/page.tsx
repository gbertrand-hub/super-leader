import type {ReactNode} from "react";
import {redirect} from "next/navigation";
import {saveGeneralSettingsAction} from "@/app/actions/general-settings";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {commonTimeZones, normalizeTimeZone} from "@/lib/timezone";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Settings = {timezone: string; date_format: string; time_format: string; default_locale: string; currency_code: string; week_starts_on: number; work_days: number[]};
const ADMIN_ROLES = new Set(["owner", "admin"]);
const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100";

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function Field({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return <label className="block"><span className="text-sm font-black text-slate-800">{label}</span>{hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}<div className="mt-2">{children}</div></label>;
}

export default async function GeneralSettingsPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const params = await searchParams;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  if (!ADMIN_ROLES.has(membership.role)) redirect("/dashboard");

  const schema = await admin.from("organization_general_settings").select("organization_id", {head: true, count: "exact"}).limit(1);
  if (schema.error) return <main className="min-h-screen bg-slate-50 px-5 py-8"><section className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-2xl font-black text-amber-950">Migration requise</h1><p className="mt-3 text-amber-900">Exécute ce fichier dans Supabase SQL Editor :</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/066_general_settings_timezone_v4_6.sql</code></section></main>;

  const [{data: general}, {data: performance}] = await Promise.all([
    admin.from("organization_general_settings").select("timezone,date_format,time_format,default_locale,currency_code,week_starts_on,work_days").eq("organization_id", membership.organization_id).maybeSingle<Settings>(),
    admin.from("performance_settings").select("timezone").eq("organization_id", membership.organization_id).maybeSingle<{timezone: string}>(),
  ]);
  const settings: Settings = general ?? {timezone: normalizeTimeZone(performance?.timezone, "America/Chicago"), date_format: "MM/DD/YYYY", time_format: "12h", default_locale: "fr", currency_code: "USD", week_starts_on: 1, work_days: [1,2,3,4,5]};
  const days = fr ? ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"] : ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-6xl">
    <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl"><p className="text-sm font-black uppercase tracking-[0.18em] text-indigo-300">Super Leader V4.6</p><h1 className="mt-2 text-4xl font-black">{fr ? "Paramètres généraux" : "General settings"}</h1><p className="mt-3 max-w-3xl leading-7 text-slate-300">{fr ? "Définis la référence horaire et les conventions de l’organisation. Les horodatages historiques restent stockés en UTC." : "Set the organization time reference and conventions. Historical timestamps remain stored in UTC."}</p></header>
    {first(params.success) ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-900">{first(params.success)}</p> : null}
    {first(params.error) ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-900">{first(params.error)}</p> : null}
    <form action={saveGeneralSettingsAction} className="mt-6 space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{fr ? "Localisation et affichage" : "Localization and display"}</h2><div className="mt-5 grid gap-5 md:grid-cols-2">
        <Field label={fr ? "Fuseau horaire de l’organisation" : "Organization time zone"} hint={fr ? "Dallas et le Texas utilisent America/Chicago." : "Dallas and Texas use America/Chicago."}><select name="timezone" defaultValue={normalizeTimeZone(settings.timezone, "America/Chicago")} className={inputClass}>{commonTimeZones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></Field>
        <Field label={fr ? "Devise par défaut" : "Default currency"}><select name="currency" defaultValue={settings.currency_code} className={inputClass}>{["USD","CAD","EUR","GBP","XAF","NGN"].map(code => <option key={code}>{code}</option>)}</select></Field>
        <Field label={fr ? "Format de date" : "Date format"}><select name="dateFormat" defaultValue={settings.date_format} className={inputClass}><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></Field>
        <Field label={fr ? "Format de l’heure" : "Time format"}><select name="timeFormat" defaultValue={settings.time_format} className={inputClass}><option value="12h">12 h (2:30 PM)</option><option value="24h">24 h (14:30)</option></select></Field>
        <Field label={fr ? "Langue par défaut" : "Default language"}><select name="locale" defaultValue={settings.default_locale} className={inputClass}><option value="fr">Français</option><option value="en">English</option></select></Field>
        <Field label={fr ? "Premier jour de la semaine" : "First day of week"}><select name="weekStartsOn" defaultValue={settings.week_starts_on} className={inputClass}><option value={1}>{days[1]}</option><option value={0}>{days[0]}</option><option value={6}>{days[6]}</option></select></Field>
      </div></section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{fr ? "Jours ouvrables" : "Business days"}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Ces jours servent de référence générale; un horaire individuel peut toujours les remplacer." : "These are the organization defaults; an individual schedule may override them."}</p><div className="mt-5 flex flex-wrap gap-3">{days.map((day,index) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold"><input type="checkbox" name="workDays" value={index} defaultChecked={settings.work_days.includes(index)} className="h-4 w-4 rounded border-slate-300 text-indigo-700 focus:ring-indigo-500" />{day}</label>)}</div></section>
      <section className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-6 text-sky-950"><strong>{fr ? "Sécurité des dates :" : "Date safety:"}</strong> {fr ? "ce changement modifie l’interprétation et l’affichage futurs. Il ne déplace ni ne réécrit les horodatages existants dans Supabase." : "this changes future interpretation and display. It never shifts or rewrites existing timestamps in Supabase."}</section>
      <button type="submit" className="w-full rounded-2xl bg-indigo-700 px-6 py-4 text-lg font-black text-white shadow-lg hover:bg-indigo-800">{fr ? "Enregistrer les paramètres" : "Save settings"}</button>
    </form>
  </div></main>;
}
