import { redirect } from "next/navigation";
import { signUpAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/server";

export default async function SignupPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  return (
    <AuthCard title="Créer un compte" subtitle="Commence à développer de meilleurs leaders et de meilleures équipes.">
      <AuthForm
        action={signUpAction}
        fields={[
          { name: "fullName", label: "Nom complet", type: "text", autoComplete: "name" },
          { name: "email", label: "Adresse email", type: "email", autoComplete: "email" },
          { name: "password", label: "Mot de passe", type: "password", autoComplete: "new-password" },
          { name: "confirmPassword", label: "Confirmer le mot de passe", type: "password", autoComplete: "new-password" },
        ]}
        submitLabel="Créer mon compte"
        footer={{ text: "Tu as déjà un compte ?", href: "/login", linkLabel: "Se connecter" }}
      />
    </AuthCard>
  );
}
