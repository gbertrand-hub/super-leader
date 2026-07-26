import {redirect} from "next/navigation";
import {signUpAction} from "@/app/actions/auth";
import {AuthCard} from "@/components/auth/auth-card";
import {AuthForm} from "@/components/auth/auth-form";
import {getI18n} from "@/i18n/server";
import {createClient} from "@/lib/supabase/server";

export default async function SignupPage() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard/my-day");

  const {t} = await getI18n();

  return (
    <AuthCard title={t("auth.signup.title")} subtitle={t("auth.signup.subtitle")}>
      <AuthForm
        action={signUpAction}
        fields={[
          {name: "fullName", label: t("auth.fullName"), type: "text", autoComplete: "name"},
          {name: "email", label: t("auth.email"), type: "email", autoComplete: "email"},
          {
            name: "password",
            label: t("auth.password"),
            type: "password",
            autoComplete: "new-password",
          },
          {
            name: "confirmPassword",
            label: t("auth.confirmPassword"),
            type: "password",
            autoComplete: "new-password",
          },
        ]}
        submitLabel={t("auth.signup.submit")}
        footer={{
          text: t("auth.signup.hasAccount"),
          href: "/login",
          linkLabel: t("auth.signup.login"),
        }}
      />
    </AuthCard>
  );
}
