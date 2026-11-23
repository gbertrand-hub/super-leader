"use client";

import { useMemo, useState } from "react";

export type MeetingParticipantOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  departments: string[];
};

type Props = {
  participants: MeetingParticipantOption[];
  locale: string;
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function MeetingParticipantSelector({ participants, locale }: Props) {
  const fr = locale === "fr";
  const allIds = useMemo(() => participants.map((participant) => participant.id), [participants]);
  const departments = useMemo(() => {
    const values = new Map<string, string>();
    for (const participant of participants) {
      for (const department of participant.departments) {
        const clean = department.trim();
        if (clean) values.set(normalize(clean), clean);
      }
    }
    return [...values.values()].sort((a, b) => a.localeCompare(b));
  }, [participants]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(allIds));
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");

  const visibleParticipants = useMemo(() => {
    const query = normalize(search);
    return participants.filter((participant) => {
      const inDepartment = !department || participant.departments.some(
        (value) => normalize(value) === normalize(department),
      );
      const matchesSearch = !query || normalize(
        `${participant.name} ${participant.email} ${participant.role} ${participant.roleLabel} ${participant.departments.join(" ")}`,
      ).includes(query);
      return inDepartment && matchesSearch;
    });
  }, [department, participants, search]);

  function replaceSelection(ids: string[]) {
    setSelectedIds(new Set(ids));
  }

  function selectDepartment() {
    if (!department) return;
    replaceSelection(participants
      .filter((participant) => participant.departments.some(
        (value) => normalize(value) === normalize(department),
      ))
      .map((participant) => participant.id));
  }

  function toggleParticipant(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <fieldset className="min-w-0 lg:col-span-2">
      {[...selectedIds].map((id) => (
        <input key={id} name="participantIds" type="hidden" value={id} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-black">
          {fr ? "Participants" : "Participants"}
        </legend>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
          {selectedIds.size} {fr ? "sélectionné(s)" : "selected"} / {participants.length}
        </span>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => replaceSelection(allIds)} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-black text-white">
            {fr ? "Tout sélectionner" : "Select all"}
          </button>
          <button type="button" onClick={() => replaceSelection([])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">
            {fr ? "Tout désélectionner" : "Clear all"}
          </button>
          <button
            type="button"
            onClick={() => replaceSelection(participants.filter((participant) => participant.role === "manager").map((participant) => participant.id))}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900"
          >
            {fr ? "Managers uniquement" : "Managers only"}
          </button>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="min-w-0 text-xs font-black text-slate-700">
            {fr ? "Sélectionner un département" : "Select a department"}
            <select value={department} onChange={(event) => setDepartment(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">{fr ? "Choisir un département…" : "Choose a department…"}</option>
              {departments.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button type="button" disabled={!department} onClick={selectDepartment} className="self-end rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
            {fr ? "Sélectionner ce département" : "Select this department"}
          </button>
        </div>

        <label className="mt-3 block text-xs font-black text-slate-700">
          {fr ? "Rechercher une personne" : "Search for a person"}
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder={fr ? "Nom, e-mail, rôle ou département…" : "Name, email, role or department…"} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3">
        {visibleParticipants.map((participant) => (
          <label key={participant.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selectedIds.has(participant.id)}
              onChange={() => toggleParticipant(participant.id)}
              className="mt-0.5"
            />
            <span className="min-w-0 text-sm font-semibold">
              <span className="block truncate">{participant.name} · {participant.roleLabel}</span>
              {participant.departments.length ? <span className="block truncate text-xs font-medium text-slate-500">{participant.departments.join(" · ")}</span> : null}
            </span>
          </label>
        ))}
        {!visibleParticipants.length ? (
          <p className="px-2 py-5 text-center text-sm font-semibold text-slate-500">
            {fr ? "Aucun collaborateur ne correspond à ce filtre." : "No team member matches this filter."}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
