"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {isValidTimeZone, normalizeTimeZone} from "@/lib/timezone";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const ADMIN_ROLES = new Set(["owner", "admin"]);
const DATE_FORMATS = new Set(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]);
const TIME_FORMATS = new Set(["24h", "12h"]);
const LOCALES = new Set(["fr", "en"]);

function text(value: FormDataEntryValue | null, max = 100) {
  return String(value ?? "").trim().slice(0, max);
}

function go(message: string, kind: "success" | "error"): never {
  redirect(`/dashboard/settings?${kind}=${encodeURIComponent(message)}`);
}

export async function saveGeneralSettingsAction(formData: FormData) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership || !ADMIN_ROLES.has(membership.role)) go("Accès refusé.", "error");

  const rawTimezone = text(formData.get("timezone"));
  if (!isValidTimeZone(rawTimezone)) go("Le fuseau horaire sélectionné est invalide.", "error");
  const timezone = normalizeTimeZone(rawTimezone);
  const dateFormat = text(formData.get("dateFormat"));
  const timeFormat = text(formData.get("timeFormat"));
  const locale = text(formData.get("locale"));
  const currency = text(formData.get("currency"), 3).toUpperCase();
  const weekStartsOn = Number(formData.get("weekStartsOn"));
  const workDays = formData.getAll("workDays").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  if (!DATE_FORMATS.has(dateFormat) || !TIME_FORMATS.has(timeFormat) || !LOCALES.has(locale)) go("Certains paramètres sont invalides.", "error");
  if (!/^[A-Z]{3}$/.test(currency)) go("La devise doit utiliser un code ISO à trois lettres.", "error");
  if (![0, 1, 6].includes(weekStartsOn) || workDays.length === 0) go("Sélectionne au moins un jour ouvrable.", "error");

  const payload = {
    organization_id: membership.organization_id,
    timezone,
    date_format: dateFormat,
    time_format: timeFormat,
    default_locale: locale,
    currency_code: currency,
    week_starts_on: weekStartsOn,
    work_days: [...new Set(workDays)].sort(),
    updated_by: authData.user.id,
    updated_at: new Date().toISOString(),
  };
  const {error: settingsError} = await admin.from("organization_general_settings").upsert(payload, {onConflict: "organization_id"});
  if (settingsError) go(`Enregistrement impossible : ${settingsError.message}`, "error");

  const {error: performanceError} = await admin.from("performance_settings").upsert({
    organization_id: membership.organization_id,
    timezone,
    updated_at: new Date().toISOString(),
  }, {onConflict: "organization_id"});
  if (performanceError) go(`Fuseau horaire non synchronisé : ${performanceError.message}`, "error");

  await admin.from("performance_audit_log").insert({
    organization_id: membership.organization_id,
    actor_id: authData.user.id,
    entity_type: "organization_general_settings",
    action: "general_settings_updated",
    details: {timezone, date_format: dateFormat, time_format: timeFormat, default_locale: locale, currency_code: currency, week_starts_on: weekStartsOn, work_days: payload.work_days},
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard", "layout");
  go("Paramètres généraux enregistrés.", "success");
}
