"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type AuthState } from "@/app/actions/auth";
import { useI18n } from "@/i18n/client";

const initialState: AuthState = {};

const modules = [
  ["feedback", "Feedback & reconnaissance"],
  ["performance", "Performance & employé du mois"],
  ["academy", "Super Leader Academy"],
  ["crm", "CRM, ventes & recouvrement"],
  ["planning", "Planning & rapports"],
  ["growth", "Plans de croissance"],
];

export function OrganizationSignupForm({ selectedPlan = "" }: { selectedPlan?: string }) {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const { locale, t } = useI18n();
  const fr = locale === "fr";

  return (
    <form action={formAction} className="space-y-7">
      <input type="hidden" name="selectedPlan" value={selectedPlan} />
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {selectedPlan === "free" ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
          <p className="font-black">{fr ? "Plan Free sélectionné" : "Free plan selected"}</p>
          <p className="mt-1 text-sm leading-6">
            {fr
              ? "Jusqu’à 5 utilisateurs actifs, propriétaire inclus. Votre demande sera vérifiée avant l’activation de l’espace gratuit."
              : "Up to 5 active users, including the owner. Your request will be reviewed before the free workspace is activated."}
          </p>
        </div>
      ) : null}

      <section>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
          1. {fr ? "Votre compte" : "Your account"}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field name="fullName" label={t("auth.fullName")} autoComplete="name" />
          <Field name="email" label={fr ? "Email professionnel" : "Work email"} type="email" autoComplete="email" />
          <Field name="password" label={t("auth.password")} type="password" autoComplete="new-password" />
          <Field name="confirmPassword" label={t("auth.confirmPassword")} type="password" autoComplete="new-password" />
          <Field name="phone" label={fr ? "Téléphone" : "Phone"} autoComplete="tel" />
          <Field name="whatsapp" label="WhatsApp" autoComplete="tel" required={false} />
        </div>
      </section>

      <section className="border-t border-slate-200 pt-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
          2. {fr ? "Votre organisation" : "Your organization"}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field name="organizationName" label={fr ? "Nom de l’organisation" : "Organization name"} />
          <Field name="country" label={fr ? "Pays" : "Country"} />
          <Field name="sector" label={fr ? "Secteur d’activité" : "Industry"} />
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              {fr ? "Nombre d’employés" : "Number of employees"}
            </span>
            <select
              name="employeeCountRange"
              required
              defaultValue={selectedPlan === "free" ? "1-5" : ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            >
              <option value="">{fr ? "Choisir" : "Select"}</option>
              <option value="1-5">1 - 5</option>
              {selectedPlan !== "free" ? (
                <>
                  <option value="6-10">6 - 10</option>
                  <option value="11-50">11 - 50</option>
                  <option value="51-200">51 - 200</option>
                  <option value="201-500">201 - 500</option>
                  <option value="501+">501+</option>
                </>
              ) : null}
            </select>
          </label>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            {fr ? "Quels problèmes souhaitez-vous résoudre ?" : "What challenges would you like to solve?"}
          </span>
          <textarea name="needs" required minLength={10} rows={4} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
        </label>
      </section>

      <section className="border-t border-slate-200 pt-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
          3. {selectedPlan === "free"
            ? fr
              ? "Activation gratuite"
              : "Free activation"
            : fr
              ? "Démonstration"
              : "Demo request"}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {selectedPlan === "free"
            ? fr
              ? "Choisissez les modules prioritaires. Ces informations nous aideront à préparer correctement votre espace Free."
              : "Choose your priority modules. This information will help us prepare your Free workspace correctly."
            : fr
              ? "Choisissez les modules prioritaires. Notre équipe préparera une démonstration adaptée à votre organisation."
              : "Choose your priority modules. Our team will prepare a demo tailored to your organization."}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {modules.map(([value, label]) => (
            <label key={value} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold">
              <input type="checkbox" name="interestedModules" value={value} className="h-4 w-4" />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-4 block max-w-sm">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            {fr ? "Date souhaitée pour la démonstration" : "Preferred demo date"}
          </span>
          <input name="preferredDemoDate" type="date" className="w-full rounded-xl border border-slate-300 px-4 py-3" />
        </label>
      </section>

      <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <input name="contactConsent" type="checkbox" required className="mt-1 h-4 w-4" />
        <span>
          {selectedPlan === "free"
            ? fr
              ? "J’accepte d’être contacté au sujet de ma demande d’activation gratuite et je confirme l’exactitude des informations fournies."
              : "I agree to be contacted about my free activation request and confirm that the information provided is accurate."
            : fr
              ? "J’accepte d’être contacté au sujet de ma demande de démonstration et je confirme l’exactitude des informations fournies."
              : "I agree to be contacted about my demo request and confirm that the information provided is accurate."}
        </span>
      </label>

      {state.error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p> : null}
      {state.success ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{state.success}</p> : null}

      <button disabled={pending} className="w-full rounded-xl bg-indigo-600 px-5 py-4 font-black text-white transition hover:bg-indigo-700 disabled:opacity-60">
        {pending
          ? t("common.processing")
          : fr
            ? selectedPlan === "free"
              ? "Créer mon compte et demander l’activation gratuite"
              : "Créer mon compte et demander une démonstration"
            : selectedPlan === "free"
              ? "Create my account and request free activation"
              : "Create my account and request a demo"}
      </button>

      <div className="grid gap-2 text-center text-sm text-slate-600 sm:grid-cols-2">
        <p>
          {fr ? "Vous avez déjà un compte ?" : "Already have an account?"}{" "}
          <Link href="/login" className="font-bold text-indigo-700 hover:underline">{fr ? "Se connecter" : "Sign in"}</Link>
        </p>
        <p>
          {fr ? "Vous faites partie d’iLEAD Global ?" : "Are you part of iLEAD Global?"}{" "}
          <Link href="/ilead-access" className="font-bold text-indigo-700 hover:underline">{fr ? "Demander l’accès interne" : "Request internal access"}</Link>
        </p>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  autoComplete,
  required = true,
}: {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
      />
    </label>
  );
}
