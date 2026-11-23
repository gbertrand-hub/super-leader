"use client";

import {useEffect, useId, useRef, useState} from "react";

import {
  searchAcademyCrmStudentsAction,
  type AcademyCrmStudentSearchResult,
} from "@/app/actions/academy-students-directory";

const searchInputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200";

function identityLine(student: AcademyCrmStudentSearchResult) {
  return student.email || student.phone || student.status || "Aucun contact renseigné";
}

export function AcademyCrmStudentSearch() {
  const listboxId = useId();
  const requestId = useRef(0);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<AcademyCrmStudentSearchResult[]>([]);
  const [selected, setSelected] = useState<AcademyCrmStudentSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalized = term.trim();
    if (selected || normalized.length < 2) {
      requestId.current += 1;
      return;
    }

    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      setError("");
      try {
        const response = await searchAcademyCrmStudentsAction(normalized);
        if (currentRequest !== requestId.current) return;
        setResults(response.results);
        setError(response.error || "");
      } catch {
        if (currentRequest !== requestId.current) return;
        setResults([]);
        setError("La recherche est momentanément indisponible.");
      } finally {
        if (currentRequest === requestId.current) setIsSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [selected, term]);

  function chooseStudent(student: AcademyCrmStudentSearchResult) {
    requestId.current += 1;
    setSelected(student);
    setTerm(student.fullName);
    setResults([]);
    setError("");
    setIsSearching(false);
  }

  function clearSelection() {
    setSelected(null);
    setTerm("");
    setResults([]);
  }

  const showResults = !selected && term.trim().length >= 2;

  return (
    <div className="relative">
      <label htmlFor={`${listboxId}-input`} className="font-bold">
        Étudiant déjà présent dans le CRM
      </label>
      <input
        id={`${listboxId}-input`}
        type="search"
        value={term}
        onChange={(event) => {
          requestId.current += 1;
          setSelected(null);
          setTerm(event.target.value);
          setResults([]);
          setError("");
          setIsSearching(false);
        }}
        placeholder="Rechercher par nom, email ou téléphone…"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={showResults}
        className={searchInputClass}
      />
      <input type="hidden" name="crm_client_id" value={selected?.id || ""} />

      {selected ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-emerald-950">{selected.fullName}</p>
            <p className="truncate text-xs text-emerald-800">{identityLine(selected)}</p>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="shrink-0 rounded-lg border border-emerald-400 bg-white px-3 py-1 text-xs font-bold text-emerald-900"
          >
            Changer
          </button>
        </div>
      ) : null}

      {showResults ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-300 bg-white p-1 shadow-xl"
        >
          {isSearching ? (
            <p className="px-3 py-3 text-sm text-slate-600">Recherche en cours…</p>
          ) : error ? (
            <p className="px-3 py-3 text-sm font-semibold text-red-700">{error}</p>
          ) : results.length ? (
            results.map((student) => (
              <button
                key={student.id}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => chooseStudent(student)}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50 focus:bg-violet-50 focus:outline-none"
              >
                <span className="block truncate text-sm font-black text-slate-950">{student.fullName}</span>
                <span className="block truncate text-xs text-slate-600">{identityLine(student)}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-slate-600">Aucun étudiant trouvé.</p>
          )}
        </div>
      ) : null}
      {!selected && term.trim().length < 2 ? (
        <p className="mt-1 text-xs text-slate-500">Saisis au moins 2 caractères. Jusqu’à 12 résultats seront proposés.</p>
      ) : null}
    </div>
  );
}
