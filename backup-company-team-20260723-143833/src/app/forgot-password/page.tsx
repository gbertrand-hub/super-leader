import { forgotPasswordAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Mot de passe oublié" subtitle="Nous t’enverrons un lien sécurisé pour choisir un nouveau mot de passe.">
      <AuthForm
        action={forgotPasswordAction}
        fields={[{ name: "email", label: "Adresse email", type: "email", autoComplete: "email" }]}
        submitLabel="Envoyer le lien"
        footer={{ text: "Retour à", href: "/login", linkLabel: "la connexion" }}
      />
    </AuthCard>
  );
}
