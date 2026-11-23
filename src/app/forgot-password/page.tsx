import {forgotPasswordAction} from "@/app/actions/auth";
import {AuthCard} from "@/components/auth/auth-card";
import {AuthForm} from "@/components/auth/auth-form";
import {getI18n} from "@/i18n/server";

export default async function ForgotPasswordPage() {
  const {t} = await getI18n();

  return (
    <AuthCard title={t("auth.forgot.title")} subtitle={t("auth.forgot.subtitle")}>
      <AuthForm
        action={forgotPasswordAction}
        fields={[
          {name: "email", label: t("auth.email"), type: "email", autoComplete: "email"},
        ]}
        submitLabel={t("auth.forgot.submit")}
        footer={{
          text: t("auth.forgot.backText"),
          href: "/login",
          linkLabel: t("auth.forgot.login"),
        }}
      />
    </AuthCard>
  );
}
