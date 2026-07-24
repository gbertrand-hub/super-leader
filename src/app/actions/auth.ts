"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function getBaseUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (siteUrl) {
    return siteUrl.replace(/\/+$/, "");
  }

  return "http://localhost:3002";
}

function getSafeAuthError(error: {
  message?: string;
  code?: string;
  status?: number;
}): string {
  console.error("Erreur Supabase Auth :", {
    message: error.message,
    code: error.code,
    status: error.status,
  });

  switch (error.code) {
    case "invalid_credentials":
      return "Adresse email ou mot de passe incorrect.";

    case "email_not_confirmed":
      return "Ton adresse email n’a pas encore été confirmée.";

    case "user_not_found":
      return "Aucun compte ne correspond à cette adresse email.";

    case "over_email_send_rate_limit":
      return "Trop de demandes ont été envoyées. Réessaie dans quelques minutes.";

    case "weak_password":
      return "Le mot de passe choisi n’est pas suffisamment sécurisé.";

    case "user_already_exists":
      return "Un compte existe déjà avec cette adresse email.";

    default:
      return error.message || "Une erreur d’authentification est survenue.";
  }
}

export type AuthState = {
  error?: string;
  success?: string;
};

export async function signInAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return {
      error: "Email et mot de passe obligatoires.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      error: getSafeAuthError(error),
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUpAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const fullName = String(formData.get("fullName") ?? "").trim();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!fullName || !email || !password || !confirmPassword) {
    return {
      error: "Tous les champs sont obligatoires.",
    };
  }

  if (password.length < 8) {
    return {
      error: "Le mot de passe doit contenir au moins 8 caractères.",
    };
  }

  if (password !== confirmPassword) {
    return {
      error: "Les mots de passe ne correspondent pas.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${getBaseUrl()}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    return {
      error: getSafeAuthError(error),
    };
  }

  return {
    success:
      "Compte créé. Consulte ton email pour confirmer ton inscription.",
  };
}

export async function forgotPasswordAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return {
      error: "Entre ton adresse email.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getBaseUrl()}/auth/callback?next=/update-password`,
  });

  if (error) {
    return {
      error: getSafeAuthError(error),
    };
  }

  return {
    success: "Lien envoyé. Consulte ta boîte email.",
  };
}

export async function updatePasswordAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!password || !confirmPassword) {
    return {
      error: "Les deux champs sont obligatoires.",
    };
  }

  if (password.length < 8) {
    return {
      error: "Le mot de passe doit contenir au moins 8 caractères.",
    };
  }

  if (password !== confirmPassword) {
    return {
      error: "Les mots de passe ne correspondent pas.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    return {
      error: getSafeAuthError(error),
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Erreur lors de la déconnexion :", {
      message: error.message,
      code: error.code,
      status: error.status,
    });
  }

  revalidatePath("/", "layout");
  redirect("/login");
}