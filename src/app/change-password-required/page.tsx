import { redirect } from "next/navigation";
import { changeTemporaryPasswordAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { getI18n } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function ChangePasswordRequiredPage() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("must_change_password,temporary_password_expires_at")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (!profile?.must_change_password) {
    redirect("/dashboard/my-day");
  }

  const expiryMs = profile.temporary_password_expires_at
    ? new Date(profile.temporary_password_expires_at).getTime()
    : Number.NaN;
  if (Number.isFinite(expiryMs) && expiryMs <= new Date().getTime()) {
    redirect("/auth/temporary-access-expired");
  }

  const { t, locale } = await getI18n();
  const expiresAt = profile.temporary_password_expires_at
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(profile.temporary_password_expires_at))
    : null;

  return (
    <AuthCard
      title={t("auth.temporary.title")}
      subtitle={t("auth.temporary.subtitle")}
    >
      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <p className="font-black">{t("auth.temporary.requiredNotice")}</p>
        <p className="mt-1">{t("auth.temporary.securityNotice")}</p>
        {expiresAt ? (
          <p className="mt-2 text-xs font-bold uppercase tracking-wide text-amber-800">
            {t("auth.temporary.expiresAt", { date: expiresAt })}
          </p>
        ) : null}
      </div>

      <AuthForm
        action={changeTemporaryPasswordAction}
        fields={[
          {
            name: "password",
            label: t("auth.temporary.newPassword"),
            type: "password",
            autoComplete: "new-password",
          },
          {
            name: "confirmPassword",
            label: t("auth.temporary.confirmPassword"),
            type: "password",
            autoComplete: "new-password",
          },
        ]}
        submitLabel={t("auth.temporary.submit")}
      />

      <p className="mt-5 text-xs leading-5 text-slate-500">
        {t("auth.temporary.passwordRules")}
      </p>
    </AuthCard>
  );
}
