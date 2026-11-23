"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { saveDemoRequest } from "@/lib/acquisition/requests";
import { readTemporaryAccessState } from "@/lib/auth/temporary-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  success?: string;
};

function authErrorMessage(error: {
  message?: string;
  code?: string;
  status?: number;
}): string {
  console.error("Supabase authentication error", {
    message: error.message,
    code: error.code,
    status: error.status,
  });

  switch (error.code) {
    case "invalid_credentials":
      return "Adresse email ou mot de passe incorrect.";
    case "email_not_confirmed":
      return "Ton adresse email n’a pas encore été confirmée.";
    case "over_email_send_rate_limit":
      return "Trop de demandes ont été envoyées. Réessaie dans quelques minutes.";
    case "user_already_exists":
      return "Un compte existe déjà avec cette adresse email.";
    case "weak_password":
      return "Le mot de passe choisi n’est pas suffisamment sécurisé.";
    default:
      return error.message || "Une erreur d’authentification est survenue.";
  }
}

export async function signInAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email et mot de passe obligatoires." };
  }

  let destination = "/dashboard/my-day";

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: authErrorMessage(error) };
    }

    const signedInUser = data.user;
    const now = new Date();
    const admin = createAdminClient();
    const { data: securityProfile } = await admin
      .from("profiles")
      .select("must_change_password,temporary_password_expires_at")
      .eq("id", signedInUser.id)
      .maybeSingle();
    const temporaryAccess = readTemporaryAccessState(
      securityProfile ?? signedInUser.user_metadata,
      now.getTime(),
    );

    if (temporaryAccess.mustChangePassword) {
      if (temporaryAccess.expired) {
        await admin.from("temporary_access_audit_log").insert({
          user_id: signedInUser.id,
          event_type: "expired_login_blocked",
          actor_user_id: signedInUser.id,
          metadata: { expires_at: temporaryAccess.expiresAt },
        });
        await supabase.auth.signOut();
        const { t } = await getI18n();
        return { error: t("auth.temporary.expired") };
      }

      await admin
        .from("profiles")
        .update({ first_login_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", signedInUser.id)
        .is("first_login_at", null);

      const { data: membership } = await admin
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", signedInUser.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      await admin.from("temporary_access_audit_log").insert({
        organization_id: membership?.organization_id ?? null,
        user_id: signedInUser.id,
        event_type: "first_login",
        actor_user_id: signedInUser.id,
        metadata: {},
      });

      destination = "/change-password-required";
    }
  } catch (error) {
    console.error("Supabase sign-in network/configuration error", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de joindre le service d’authentification.",
    };
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signUpAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (String(formData.get("website") ?? "").trim()) {
    return { success: "Demande reçue. Notre équipe vous contactera prochainement." };
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const employeeCountRange = String(formData.get("employeeCountRange") ?? "").trim();
  const needs = String(formData.get("needs") ?? "").trim();
  const interestedModules = formData.getAll("interestedModules").map(String).filter(Boolean);
  const preferredDemoDate = String(formData.get("preferredDemoDate") ?? "").trim();
  const rawSelectedPlan = String(formData.get("selectedPlan") ?? "").trim();
  const selectedPlan = ["free", "starter", "growth", "enterprise"].includes(rawSelectedPlan)
    ? rawSelectedPlan
    : null;
  const contactConsent = formData.get("contactConsent") === "on";

  if (
    !fullName ||
    !email ||
    !password ||
    !confirmPassword ||
    !phone ||
    !organizationName ||
    !country ||
    !employeeCountRange ||
    needs.length < 10
  ) {
    return { error: "Complète tous les champs obligatoires de la demande de démonstration." };
  }

  if (!contactConsent) {
    return { error: "Le consentement à être contacté est obligatoire." };
  }

  if (selectedPlan === "free" && employeeCountRange !== "1-5") {
    return {
      error: "Le plan Free est réservé aux organisations comptant au maximum 5 utilisateurs actifs, propriétaire inclus.",
    };
  }

  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }

  if (password !== confirmPassword) {
    return { error: "Les mots de passe ne correspondent pas." };
  }

  let requestId: string;
  try {
    requestId = await saveDemoRequest({
      fullName,
      email,
      phone,
      whatsapp,
      organizationName,
      country,
      sector,
      employeeCountRange,
      needs,
      interestedModules,
      preferredDemoDate: preferredDemoDate || null,
      requestedPlanCode: selectedPlan,
      contactConsent,
    });
  } catch (error) {
    console.error("Demo request creation failed", error);
    return {
      error:
        error instanceof Error
          ? `La demande de démonstration n’a pas pu être enregistrée : ${error.message}`
          : "La demande de démonstration n’a pas pu être enregistrée.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          organization_name: organizationName,
          account_purpose: selectedPlan === "free" ? "free_plan_request" : "demo_request",
          requested_plan_code: selectedPlan,
        },
        emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      if (error.code === "user_already_exists") {
        return {
          success:
            "Votre demande de démonstration est enregistrée. Un compte existe déjà avec cet email : connectez-vous pour suivre la demande.",
        };
      }
      return { error: authErrorMessage(error) };
    }

    if (data.user) {
      const admin = createAdminClient();
      await admin
        .from("demo_requests")
        .update({ requester_user_id: data.user.id, updated_at: new Date().toISOString() })
        .eq("id", requestId);
    }
  } catch (error) {
    console.error("Supabase sign-up network/configuration error", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de joindre le service d’authentification.",
    };
  }

  return {
    success: selectedPlan === "free"
      ? "Compte créé et demande d’activation gratuite enregistrée. Confirmez votre email ; notre équipe vérifiera les informations avant d’activer votre espace Free."
      : "Compte créé et demande de démonstration enregistrée. Confirmez votre email ; notre équipe vous contactera avant l’activation de votre espace.",
  };
}

export async function forgotPasswordAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return { error: "Entre ton adresse email." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/update-password`,
    });

    if (error) {
      return { error: authErrorMessage(error) };
    }
  } catch (error) {
    console.error("Supabase password reset network/configuration error", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de joindre le service d’authentification.",
    };
  }

  return { success: "Lien envoyé. Consulte ta boîte email." };
}

export async function updatePasswordAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!password || !confirmPassword) {
    return { error: "Les deux champs sont obligatoires." };
  }

  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }

  if (password !== confirmPassword) {
    return { error: "Les mots de passe ne correspondent pas." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: authErrorMessage(error) };
  }

  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        must_change_password: false,
        temporary_password_issued_at: null,
        temporary_password_expires_at: null,
        temporary_password_issued_by: null,
        password_changed_at: now,
        updated_at: now,
      })
      .eq("id", authData.user.id);

    if (profileError) {
      return {
        error:
          "Le mot de passe a été modifié, mais la finalisation du profil a échoué. Contacte ton administrateur.",
      };
    }

    const currentMetadata = authData.user.user_metadata ?? {};
    await admin.auth.admin.updateUserById(authData.user.id, {
      user_metadata: {
        ...currentMetadata,
        must_change_password: false,
        temporary_password_expires_at: null,
      },
    });

    const { data: membership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    await admin.from("temporary_access_audit_log").insert({
      organization_id: membership?.organization_id ?? null,
      user_id: authData.user.id,
      event_type: "password_changed",
      actor_user_id: authData.user.id,
      metadata: { method: "recovery_link" },
    });
  }

  revalidatePath("/", "layout");
  redirect("/dashboard/my-day");
}

export async function changeTemporaryPasswordAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const { t } = await getI18n();

  if (!password || !confirmPassword) {
    return { error: t("auth.temporary.bothRequired") };
  }

  if (password.length < 10) {
    return { error: t("auth.temporary.minLength") };
  }

  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return { error: t("auth.temporary.complexity") };
  }

  if (password !== confirmPassword) {
    return { error: t("auth.temporary.mismatch") };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return { error: t("auth.temporary.sessionMissing") };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("must_change_password,temporary_password_expires_at")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.must_change_password) {
    redirect("/dashboard/my-day");
  }

  const now = new Date();
  const expiryMs = profile.temporary_password_expires_at
    ? new Date(profile.temporary_password_expires_at).getTime()
    : Number.NaN;

  if (Number.isFinite(expiryMs) && expiryMs <= now.getTime()) {
    await supabase.auth.signOut();
    redirect("/login?temporaryExpired=1");
  }

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) {
    return { error: authErrorMessage(passwordError) };
  }

  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update({
      must_change_password: false,
      temporary_password_issued_at: null,
      temporary_password_expires_at: null,
      temporary_password_issued_by: null,
      password_changed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", authData.user.id);

  if (profileUpdateError) {
    return { error: t("auth.temporary.finalizeFailed") };
  }

  const currentMetadata = authData.user.user_metadata ?? {};
  const { error: metadataError } = await admin.auth.admin.updateUserById(
    authData.user.id,
    {
      user_metadata: {
        ...currentMetadata,
        must_change_password: false,
        temporary_password_expires_at: null,
      },
    },
  );

  if (metadataError) {
    return { error: t("auth.temporary.finalizeFailed") };
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  await admin.from("temporary_access_audit_log").insert({
    organization_id: membership?.organization_id ?? null,
    user_id: authData.user.id,
    event_type: "password_changed",
    actor_user_id: authData.user.id,
    metadata: {},
  });

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login?passwordChanged=1");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Supabase sign-out error", error.message);
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
