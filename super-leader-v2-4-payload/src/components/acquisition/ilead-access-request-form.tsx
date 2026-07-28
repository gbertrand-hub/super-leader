"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  submitInternalAccessRequestAction,
  type PublicRequestState,
} from "@/app/actions/acquisition";
import { useI18n } from "@/i18n/client";

const initialState: PublicRequestState = {};

export function IleadAccessRequestForm() {
  const [state, formAction, pending] = useActionState(
    submitInternalAccessRequestAction,
    initialState,
  );
  const { locale, t } = useI18n();
  const fr = locale === "fr";

  return (
    <form action={formAction} className="space-y-5">
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="fullName" label={fr ? "Nom complet" : "Full name"} />
        <Field name="email" label={fr ? "Adresse email" : "Email address"} type="email" />
        <Field name="phone" label={fr ? "Téléphone / WhatsApp" : "Phone / WhatsApp"} />
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">{fr ? "Entité iLEAD" : "iLEAD entity"}</span>
          <select name="entityName" required className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
            <option value="">{fr ? "Choisir" : "Select"}</option>
            <option>iLEAD Global Institute</option>
            <option>iLEAD Global Youth</option>
            <option>iLEAD Global Exchange</option>
            <option>iLEAD Global Foundation</option>
            <option>Texas Community Farm</option>
            <option>Dispensation Investment Group</option>
            <option value="Autre">{fr ? "Autre" : "Other"}</option>
          </select>
        </label>
        <Field name="department" label={fr ? "Département" : "Department"} required={false} />
        <Field name="positionTitle" label={fr ? "Poste ou fonction" : "Job title or function"} />
        <Field name="supervisorName" label={fr ? "Nom du responsable" : "Supervisor name"} required={false} />
        <Field name="requestedTeam" label={fr ? "Équipe concernée" : "Requested team"} required={false} />
        <Field name="employeeReference" label={fr ? "Matricule ou référence interne" : "Employee/reference number"} required={false} />
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">{fr ? "Motif de la demande" : "Reason for request"}</span>
        <textarea name="reason" minLength={10} required rows={4} className="w-full rounded-xl border border-slate-300 px-4 py-3" />
      </label>
      <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
        <input name="consent" type="checkbox" required className="mt-1 h-4 w-4" />
        <span>{fr ? "Je confirme que ces informations sont exactes. Je comprends que le rôle et les équipes seront attribués uniquement après validation par Owner, Admin ou RH." : "I confirm that this information is accurate. I understand that roles and teams are assigned only after approval by the Owner, Admin or HR."}</span>
      </label>

      {state.status === "error" ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.message}</p> : null}
      {state.status === "success" ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{state.message}</p> : null}

      <button disabled={pending} className="w-full rounded-xl bg-slate-950 px-5 py-4 font-black text-white disabled:opacity-60">
        {pending ? t("common.processing") : fr ? "Envoyer ma demande d’accès" : "Submit my access request"}
      </button>
      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-bold text-indigo-700 hover:underline">{fr ? "Retour à la connexion" : "Back to sign in"}</Link>
      </p>
    </form>
  );
}

function Field({ name, label, type = "text", required = true }: { name: string; label: string; type?: "text" | "email"; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      <input name={name} type={type} required={required} className="w-full rounded-xl border border-slate-300 px-4 py-3" />
    </label>
  );
}
