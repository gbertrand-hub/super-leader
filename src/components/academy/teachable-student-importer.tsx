"use client";

import { useState } from "react";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { importTeachableStudentsAction } from "@/app/actions/academy-teachable-import";

type SchoolOption = { id: string; name: string };
type ProgramOption = { id: string; school_id: string; name: string };
type CohortOption = { id: string; school_id: string; program_id: string | null; name: string };

export function TeachableStudentImporter({
  schoolId,
  schools = [],
  returnTo = "school",
  programs = [],
  cohorts = [],
}: {
  schoolId?: string;
  schools?: SchoolOption[];
  programs?: ProgramOption[];
  cohorts?: CohortOption[];
  returnTo?: "school" | "directory";
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [selectedSchool, setSelectedSchool] = useState(schoolId ?? "");
  const [selectedProgram, setSelectedProgram] = useState("");

  async function read(file?: File) {
    setError("");
    setRows([]);
    setName(file?.name || "");
    if (!file) return;
    try {
      let parsed: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const result = Papa.parse<Record<string, unknown>>(await file.text(), {
          header: true,
          skipEmptyLines: true,
        });
        if (result.errors.length) throw new Error(result.errors[0].message);
        parsed = result.data;
      } else {
        const sheet = await readSheet(file);
        const keys = (sheet[0] || []).map((value) =>
          String(value || "").trim(),
        );
        parsed = sheet
          .slice(1)
          .map((row) =>
            Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])),
          );
      }
      if (!parsed.length) throw new Error("Le fichier est vide.");
      if (parsed.length > 1000) throw new Error("Maximum 1 000 lignes.");
      setRows(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fichier illisible.");
    }
  }

  return (
    <form
      action={importTeachableStudentsAction}
      className="rounded-3xl border border-blue-200 bg-blue-50 p-6"
    >
      <h2 className="text-xl font-black text-blue-950">
        Importer les étudiants Teachable
      </h2>
      <p className="mt-2 text-sm font-semibold text-blue-800">
        CSV ou Excel : nom et prénom, email, téléphone, formation, date
        d’inscription. Les contacts et les inscriptions déjà présents ne sont
        pas dupliqués.
      </p>
      {schoolId ? (
        <input type="hidden" name="school_id" value={schoolId} />
      ) : (
        <label className="mt-4 block text-sm font-black text-blue-950">
          École de destination
          <select
            name="school_id"
            required
            value={selectedSchool}
            onChange={(event) => { setSelectedSchool(event.target.value); setSelectedProgram(""); }}
            className="mt-2 block w-full rounded-xl border border-blue-200 bg-white p-3"
          >
            <option value="" disabled>
              Sélectionner une école…
            </option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-black text-blue-950">
          Programme de destination
          <select name="program_id" required value={selectedProgram} onChange={(event) => setSelectedProgram(event.target.value)} className="mt-2 block w-full rounded-xl border border-blue-200 bg-white p-3">
            <option value="">Sélectionner un programme…</option>
            {programs.filter((program) => !selectedSchool || program.school_id === selectedSchool).map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-black text-blue-950">
          Cohorte de destination
          <select name="cohort_id" required defaultValue="" className="mt-2 block w-full rounded-xl border border-blue-200 bg-white p-3">
            <option value="">Sélectionner une cohorte…</option>
            {cohorts.filter((cohort) => (!selectedSchool || cohort.school_id === selectedSchool) && (!selectedProgram || !cohort.program_id || cohort.program_id === selectedProgram)).map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs font-bold text-blue-800">Le tarif homologué sera hérité automatiquement après l'import. Aucun prix étudiant n'est saisi ici.</p>
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="file_name" value={name} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <label className="mt-4 block text-sm font-black text-blue-950">
        Fichier CSV ou Excel
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => void read(event.target.files?.[0])}
          className="mt-2 block w-full rounded-xl border border-blue-200 bg-white p-3"
        />
      </label>
      {error ? (
        <p className="mt-3 rounded-xl bg-red-100 p-3 font-bold text-red-800">
          {error}
        </p>
      ) : null}
      {rows.length ? (
        <div className="mt-4 rounded-xl bg-white p-4">
          <p className="font-black">Aperçu : {rows.length} ligne(s)</p>
          <div className="mt-2 max-h-40 overflow-auto text-xs">
            {rows.slice(0, 5).map((row, index) => (
              <pre key={index} className="whitespace-pre-wrap border-t py-2">
                {JSON.stringify(row)}
              </pre>
            ))}
          </div>
        </div>
      ) : null}
      <button
        disabled={!rows.length}
        className="mt-4 rounded-xl bg-blue-700 px-5 py-3 font-black text-white disabled:opacity-40"
      >
        Analyser et importer
      </button>
    </form>
  );
}
