"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/env";

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

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { error: authErrorMessage(error) };
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
  redirect("/dashboard");
}

export async function signUpAction(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!fullName || !email || !password || !confirmPassword) {
    return { error: "Tous les champs sont obligatoires." };
  }

  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }

  if (password !== confirmPassword) {
    return { error: "Les mots de passe ne correspondent pas." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      return { error: authErrorMessage(error) };
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
    success: "Compte créé. Consulte ton email pour confirmer ton inscription.",
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

  revalidatePath("/", "layout");
  redirect("/dashboard");
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
