import { redirect } from "next/navigation";
import { updatePasswordAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/server";

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <AuthCard title="Nouveau mot de passe" subtitle="Choisis un mot de passe sécurisé d’au moins 8 caractères.">
      <AuthForm
        action={updatePasswordAction}
        fields={[
          { name: "password", label: "Nouveau mot de passe", type: "password", autoComplete: "new-password" },
          { name: "confirmPassword", label: "Confirmer le mot de passe", type: "password", autoComplete: "new-password" },
        ]}
        submitLabel="Mettre à jour"
      />
    </AuthCard>
  );
}
