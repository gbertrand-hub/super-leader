"use client";

import {useMemo, useState} from "react";

export type ZoomHostSelectorOption = {
  id: string;
  email: string;
  displayName: string;
  department: string;
  isDepartmentDefault: boolean;
};

type Props = {
  hosts: ZoomHostSelectorOption[];
  departments: string[];
  defaultHostId?: string | null;
  defaultDepartment?: string | null;
  locale: string;
  compact?: boolean;
  locked?: boolean;
};

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function ZoomHostSelector({hosts, departments, defaultHostId, defaultDepartment, locale, compact = false, locked = false}: Props) {
  const fr = locale === "fr";
  const departmentOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const value of [...departments, ...hosts.map((host) => host.department)]) {
      const clean = String(value || "").trim();
      if (clean) values.set(normalized(clean), clean);
    }
    return [...values.values()].sort((a, b) => a.localeCompare(b));
  }, [departments, hosts]);

  const initialHost = hosts.find((host) => host.id === defaultHostId) ?? hosts[0] ?? null;
  const [department, setDepartment] = useState(
    String(defaultDepartment || initialHost?.department || "").trim(),
  );
  const initialDepartmentHosts = department
    ? hosts.filter((host) => normalized(host.department) === normalized(department))
    : hosts;
  const initialSelected = initialDepartmentHosts.find((host) => host.id === defaultHostId)
    ?? initialDepartmentHosts.find((host) => host.isDepartmentDefault)
    ?? initialDepartmentHosts[0]
    ?? initialHost;
  const [hostId, setHostId] = useState(initialSelected?.id || "");

  const filteredHosts = useMemo(() => {
    if (!department) return hosts;
    const matching = hosts.filter((host) => normalized(host.department) === normalized(department));
    return matching.length ? matching : hosts;
  }, [department, hosts]);

  const lockedHost = filteredHosts.find((host) => host.isDepartmentDefault)
    ?? filteredHosts.find((host) => host.id === hostId)
    ?? filteredHosts[0]
    ?? null;

  function changeDepartment(nextDepartment: string) {
    setDepartment(nextDepartment);
    const matching = nextDepartment
      ? hosts.filter((host) => normalized(host.department) === normalized(nextDepartment))
      : hosts;
    const nextHost = matching.find((host) => host.isDepartmentDefault) ?? matching[0] ?? hosts[0];
    setHostId(nextHost?.id || "");
  }

  if (!hosts.length) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
        {fr ? "Synchronise d’abord les comptes Zoom dans Intégrations." : "Sync Zoom host accounts in Integrations first."}
      </div>
    );
  }

  const fieldClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="min-w-0 rounded-2xl border-2 border-blue-200 bg-blue-50 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-black text-blue-950">
            {fr ? "Compte Zoom utilisé" : "Zoom account used"}
          </p>
          <p className="mt-1 text-xs font-semibold text-blue-800">
            {locked
              ? (fr ? "Le compte attribué à ton département sera utilisé automatiquement." : "The account assigned to your department will be used automatically.")
              : (fr ? "Choisis explicitement le compte qui créera et hébergera cette réunion." : "Explicitly choose the account that will create and host this meeting.")}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-800 shadow-sm">
          {hosts.length} {fr ? (hosts.length > 1 ? "comptes actifs" : "compte actif") : (hosts.length > 1 ? "active accounts" : "active account")}
        </span>
      </div>
      <div className={`grid min-w-0 gap-3 ${compact ? "" : "lg:grid-cols-2"}`}>
      <label className="block min-w-0 text-sm font-black text-blue-950">
        {fr ? "Département / pôle" : "Department / unit"}
        <select name="meetingDepartment" value={department} onChange={(event) => changeDepartment(event.target.value)} disabled={locked && departmentOptions.length <= 1} className={fieldClass}>
          {!locked ? <option value="">{fr ? "Général / aucun département" : "General / no department"}</option> : null}
          {departmentOptions.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {locked && departmentOptions.length <= 1 ? <input type="hidden" name="meetingDepartment" value={department} /> : null}
      </label>
      <label className="block min-w-0 text-sm font-black text-blue-950">
        {fr ? "Compte Zoom hôte" : "Zoom host account"}
        {locked ? (
          <>
            <div className={`${fieldClass} cursor-not-allowed bg-slate-100 text-slate-700`} aria-readonly="true">
              {lockedHost ? `${lockedHost.displayName} · ${lockedHost.email}` : (fr ? "Aucun compte attribué" : "No assigned account")}
            </div>
            <input type="hidden" name="zoomHostAccountId" value={lockedHost?.id || ""} />
          </>
        ) : (
          <select name="zoomHostAccountId" value={hostId} onChange={(event) => setHostId(event.target.value)} required className={fieldClass}>
            {filteredHosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.displayName} · {host.email}{host.department ? ` · ${host.department}` : ""}{host.id === defaultHostId ? (fr ? " · Par défaut" : " · Default") : ""}
              </option>
            ))}
          </select>
        )}
      </label>
      <p className={`text-xs font-semibold leading-5 text-blue-800 ${compact ? "" : "lg:col-span-2"}`}>
        {locked
          ? (fr ? "Ce compte est verrouillé selon ton affectation. Contacte l’administration pour modifier l’attribution Zoom du département." : "This account is locked to your assignment. Contact an administrator to change the department Zoom assignment.")
          : (fr ? "Le compte par défaut du département est sélectionné automatiquement. Owner, Admin et RH peuvent choisir un autre hôte actif." : "The department default is selected automatically. Owner, Admin and HR can choose another active host.")}
      </p>
      </div>
    </div>
  );
}
