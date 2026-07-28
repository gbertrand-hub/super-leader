"use client";

import { useActionState } from "react";
import {
  approveInternalAccessRequestAction,
  type InternalApprovalState,
} from "@/app/actions/acquisition";

type Option = { id: string; label: string };

const initialState: InternalApprovalState = {};

export function InternalAccessApprovalForm({
  requestId,
  teams,
  supervisors,
  allowedRoles = ["employee", "manager", "hr", "admin"],
}: {
  requestId: string;
  teams: Option[];
  supervisors: Option[];
  allowedRoles?: string[];
}) {
  const [state, formAction, pending] = useActionState(
    approveInternalAccessRequestAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
      <input type="hidden" name="requestId" value={requestId} />
      <h4 className="font-black text-emerald-950">Approuver et activer le compte</h4>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold">
          Rôle système
          <select name="role" required className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5">
            {allowedRoles.includes("employee") ? <option value="employee">Employé</option> : null}
            {allowedRoles.includes("manager") ? <option value="manager">Manager</option> : null}
            {allowedRoles.includes("hr") ? <option value="hr">Responsable RH</option> : null}
            {allowedRoles.includes("admin") ? <option value="admin">Administrateur</option> : null}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-bold">
          Superviseur officiel
          <select name="supervisorId" className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5">
            <option value="">Affecter plus tard</option>
            {supervisors.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-bold">
          Équipe à diriger (si Manager)
          <select name="managerTeamId" className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5">
            <option value="">Aucune</option>
            {teams.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-bold">
          Langue de l’email
          <select name="locale" className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5">
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-black">Équipes auxquelles rattacher le collaborateur</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {teams.length ? teams.map((option) => (
            <label key={option.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold">
              <input type="checkbox" name="teamIds" value={option.id} />
              {option.label}
            </label>
          )) : <p className="text-sm text-slate-500">Aucune équipe active.</p>}
        </div>
      </fieldset>

      <label className="mt-4 grid gap-2 text-sm font-bold">
        Note interne
        <textarea name="reviewNote" rows={2} className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5" />
      </label>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="sendEmail" defaultChecked />
        Envoyer immédiatement le mot de passe temporaire par email
      </label>

      {state.message ? (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${state.status === "error" ? "bg-red-100 text-red-800" : state.status === "warning" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
          <p>{state.message}</p>
          {state.temporaryPassword ? (
            <div className="mt-3 rounded-lg bg-white p-3 text-slate-950">
              <p><strong>Connexion :</strong> {state.loginUrl}</p>
              <p className="mt-1"><strong>Mot de passe temporaire :</strong> <code>{state.temporaryPassword}</code></p>
            </div>
          ) : null}
        </div>
      ) : null}

      <button disabled={pending} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 font-black text-white disabled:opacity-60">
        {pending ? "Activation..." : "Approuver et activer"}
      </button>
    </form>
  );
}
