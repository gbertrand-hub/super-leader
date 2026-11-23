"use server";

import {cookies} from "next/headers";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {localeCookieName, normalizeLocale} from "@/i18n/config";
import {getI18n} from "@/i18n/server";
import {
  finalizeProfileAvatar,
  readPendingProfileAvatar,
  removeProfileAvatar,
} from "@/lib/profile/avatar";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {isValidTimeZone, normalizeTimeZone} from "@/lib/timezone";

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function go(kind: "success" | "error", message: string, section = "identity"): never {
  const query = new URLSearchParams({section, [kind]: message});
  redirect(`/dashboard/profile?${query.toString()}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const translate = (fr: string, en: string) => locale === "fr" ? fr : en;
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

  return {supabase, admin, user: authData.user, membership, translate};
}

async function audit({
  admin,
  userId,
  organizationId,
  action,
  details,
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  organizationId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("profile_audit_log").insert({
    organization_id: organizationId ?? null,
    user_id: userId,
    actor_id: userId,
    action,
    details: details ?? {},
  });
  if (error) console.error("Profile audit failed", error);
}

export async function saveMyProfileAction(formData: FormData) {
  const {admin, user, membership, translate} = await getContext();
  const fullName = text(formData.get("fullName"), 120);
  const phone = text(formData.get("phone"), 40) || null;
  const country = text(formData.get("country"), 120) || null;
  const city = text(formData.get("city"), 120) || null;
  const preferredLocale = normalizeLocale(text(formData.get("preferredLocale"), 8));
  const rawTimeZone = text(formData.get("timeZone"), 100);
  const timeZone = normalizeTimeZone(rawTimeZone);
  const bio = text(formData.get("bio"), 800) || null;
  const pendingAvatar = readPendingProfileAvatar(formData);
  const removeAvatarRequested = formData.get("removeAvatar") === "true";

  if (fullName.length < 2) {
    go("error", translate("Le nom doit contenir au moins 2 caractères.", "The name must contain at least 2 characters."));
  }
  if (rawTimeZone && !isValidTimeZone(rawTimeZone)) {
    go("error", translate("Le fuseau horaire n’est pas valide.", "The time zone is invalid."));
  }

  const {data: current, error: loadError} = await admin
    .from("profiles")
    .select("full_name,phone,country,city,preferred_locale,time_zone,bio,avatar_storage_path")
    .eq("id", user.id)
    .maybeSingle<{
      full_name: string | null;
      phone: string | null;
      country: string | null;
      city: string | null;
      preferred_locale: string | null;
      time_zone: string | null;
      bio: string | null;
      avatar_storage_path: string | null;
    }>();
  if (loadError) go("error", translate("Le profil n’a pas pu être chargé : ", "The profile could not be loaded: ") + loadError.message);

  let finalizedAvatar: Awaited<ReturnType<typeof finalizeProfileAvatar>> | null = null;
  try {
    if (pendingAvatar) {
      finalizedAvatar = await finalizeProfileAvatar({admin, userId: user.id, pending: pendingAvatar});
    }
  } catch (error) {
    go("error", translate("La photo n’a pas pu être enregistrée : ", "The photo could not be saved: ") + (error instanceof Error ? error.message : ""));
  }

  const nextAvatarPath = finalizedAvatar
    ? finalizedAvatar.storagePath
    : removeAvatarRequested
      ? null
      : current?.avatar_storage_path ?? null;
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    full_name: fullName,
    phone,
    country,
    city,
    preferred_locale: preferredLocale,
    time_zone: timeZone,
    bio,
    avatar_storage_path: nextAvatarPath,
    updated_at: now,
  };
  if (finalizedAvatar) {
    payload.avatar_file_name = finalizedAvatar.fileName;
    payload.avatar_mime_type = finalizedAvatar.mimeType;
    payload.avatar_size_bytes = finalizedAvatar.sizeBytes;
    payload.avatar_updated_at = now;
  } else if (removeAvatarRequested) {
    payload.avatar_file_name = null;
    payload.avatar_mime_type = null;
    payload.avatar_size_bytes = null;
    payload.avatar_updated_at = now;
  }

  const {data: savedProfile, error: updateError} = await admin
    .from("profiles")
    .update(payload)
    .eq("id", user.id)
    .select("time_zone")
    .maybeSingle<{time_zone: string | null}>();
  if (updateError) {
    if (finalizedAvatar) await removeProfileAvatar(admin, finalizedAvatar.storagePath);
    go("error", translate("Le profil n’a pas pu être enregistré : ", "The profile could not be saved: ") + updateError.message);
  }
  if (savedProfile?.time_zone !== timeZone) {
    if (finalizedAvatar) await removeProfileAvatar(admin, finalizedAvatar.storagePath);
    go("error", translate(
      "Le fuseau horaire n’a pas été conservé. Réessaie ou contacte un administrateur.",
      "The time zone was not retained. Try again or contact an administrator.",
    ));
  }

  const oldAvatarPath = current?.avatar_storage_path ?? null;
  if ((finalizedAvatar || removeAvatarRequested) && oldAvatarPath && oldAvatarPath !== nextAvatarPath) {
    await removeProfileAvatar(admin, oldAvatarPath);
  }

  const metadata = user.user_metadata ?? {};
  const {error: metadataError} = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...metadata,
      full_name: fullName,
      preferred_locale: preferredLocale,
      time_zone: timeZone,
    },
  });
  if (metadataError) console.error("Profile metadata sync failed", metadataError);

  const changedFields = [
    ["full_name", current?.full_name, fullName],
    ["phone", current?.phone, phone],
    ["country", current?.country, country],
    ["city", current?.city, city],
    ["preferred_locale", current?.preferred_locale, preferredLocale],
    ["time_zone", current?.time_zone, timeZone],
    ["bio", current?.bio, bio],
  ].filter(([, before, after]) => String(before ?? "") !== String(after ?? "")).map(([name]) => name);
  if (finalizedAvatar) changedFields.push("avatar_replaced");
  if (removeAvatarRequested && oldAvatarPath) changedFields.push("avatar_removed");

  await audit({
    admin,
    userId: user.id,
    organizationId: membership?.organization_id,
    action: "profile_updated",
    details: {changed_fields: changedFields},
  });

  const cookieStore = await cookies();
  cookieStore.set(localeCookieName, preferredLocale, {
    path: "/",
    maxAge: 31536000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/profile/badge");
  revalidatePath("/dashboard/badges/manage");
  go("success", translate("Ton profil a été mis à jour.", "Your profile has been updated."));
}

export async function saveMyNotificationPreferencesAction(formData: FormData) {
  const {admin, user, membership, translate} = await getContext();
  if (!membership) {
    go("error", translate("Aucune organisation active n’est associée à ce compte.", "No active organisation is associated with this account."), "notifications");
  }

  const frequency = text(formData.get("emailFrequency"), 20);
  const locale = normalizeLocale(text(formData.get("notificationLocale"), 8));
  if (!["instant", "daily", "off"].includes(frequency)) {
    go("error", translate("Fréquence d’e-mail invalide.", "Invalid email frequency."), "notifications");
  }

  const payload = {
    organization_id: membership.organization_id,
    user_id: user.id,
    email_enabled: checked(formData, "emailEnabled") && frequency !== "off",
    email_frequency: frequency,
    locale,
    report_reminders: checked(formData, "reportReminders"),
    absence_updates: checked(formData, "absenceUpdates"),
    meeting_reminders: checked(formData, "meetingReminders"),
    sales_updates: checked(formData, "salesUpdates"),
    collection_updates: checked(formData, "collectionUpdates"),
    feedback_alerts: checked(formData, "feedbackAlerts"),
    performance_updates: checked(formData, "performanceUpdates"),
    crm_updates: checked(formData, "crmUpdates"),
    finance_updates: checked(formData, "financeUpdates"),
    updated_at: new Date().toISOString(),
  };
  const {error} = await admin
    .from("notification_preferences")
    .upsert(payload, {onConflict: "organization_id,user_id"});
  if (error) {
    go("error", translate("Les préférences n’ont pas pu être enregistrées : ", "The preferences could not be saved: ") + error.message, "notifications");
  }

  await audit({
    admin,
    userId: user.id,
    organizationId: membership.organization_id,
    action: "notification_preferences_updated",
    details: {email_frequency: frequency, locale},
  });
  revalidatePath("/dashboard/profile");
  go("success", translate("Tes préférences de notification ont été enregistrées.", "Your notification preferences have been saved."), "notifications");
}

export async function changeMyPasswordAction(formData: FormData) {
  const {supabase, admin, user, membership, translate} = await getContext();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 10) {
    go("error", translate("Le mot de passe doit contenir au moins 10 caractères.", "The password must contain at least 10 characters."), "security");
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    go("error", translate("Ajoute au moins une majuscule, une minuscule et un chiffre.", "Add at least one uppercase letter, one lowercase letter and one number."), "security");
  }
  if (password !== confirmPassword) {
    go("error", translate("Les mots de passe ne correspondent pas.", "The passwords do not match."), "security");
  }

  const {error} = await supabase.auth.updateUser({password});
  if (error) go("error", translate("Le mot de passe n’a pas pu être modifié : ", "The password could not be changed: ") + error.message, "security");

  const now = new Date().toISOString();
  await admin.from("profiles").update({password_changed_at: now, updated_at: now}).eq("id", user.id);
  await audit({
    admin,
    userId: user.id,
    organizationId: membership?.organization_id,
    action: "password_changed",
  });
  revalidatePath("/dashboard/profile");
  go("success", translate("Ton mot de passe a été modifié.", "Your password has been changed."), "security");
}
