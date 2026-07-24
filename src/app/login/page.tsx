import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  return (
    <AuthCard title="Connexion" subtitle="Accède à ton espace Super Leader.">
      <AuthForm
        action={signInAction}
        fields={[
          { name: "email", label: "Adresse email", type: "email", autoComplete: "email" },
          { name: "password", label: "Mot de passe", type: "password", autoComplete: "current-password" },
        ]}
        submitLabel="Se connecter"
        footer={{ text: "Pas encore de compte ?", href: "/signup", linkLabel: "Créer un compte" }}
      />
      <p className="mt-5 text-center text-sm">
        <Link className="font-semibold text-slate-600 hover:text-indigo-700" href="/forgot-password">
          Mot de passe oublié ?
        </Link>
      </p>
    </AuthCard>
  );
}
