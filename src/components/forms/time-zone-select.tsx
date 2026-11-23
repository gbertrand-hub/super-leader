"use client";

import {useEffect, useId, useMemo, useState} from "react";
import {commonTimeZones} from "@/lib/timezone";

const zoneLabels: Record<string, {fr: string; en: string; search: string}> = {
  "Africa/Douala": {fr: "Douala / Yaoundé — Cameroun", en: "Douala / Yaoundé — Cameroon", search: "cameroun cameroon douala yaounde yaoundé"},
  "America/Chicago": {fr: "Dallas / Chicago — États-Unis", en: "Dallas / Chicago — United States", search: "dallas texas chicago etats-unis united states usa"},
  "Europe/Dublin": {fr: "Dublin — Irlande", en: "Dublin — Ireland", search: "dublin irlande ireland"},
  "Europe/London": {fr: "Londres — Royaume-Uni", en: "London — United Kingdom", search: "londres london royaume-uni united kingdom uk"},
  "Europe/Paris": {fr: "Paris — France", en: "Paris — France", search: "paris france"},
  "Europe/Brussels": {fr: "Bruxelles — Belgique", en: "Brussels — Belgium", search: "bruxelles brussels belgique belgium"},
};

function fold(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

export function TimeZoneSelect({name, defaultValue, locale, className}: {name: string; defaultValue: string; locale: "fr" | "en"; className?: string}) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone || null), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const zones = useMemo(() => {
    const all = new Set<string>(commonTimeZones); all.add(defaultValue); if (detected) all.add(detected);
    return [...all].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [defaultValue, detected]);
  const filtered = zones.filter((zone) => fold(`${zone} ${zoneLabels[zone]?.search ?? ""}`).includes(fold(query)));
  const display = (zone: string) => `${zoneLabels[zone]?.[locale] ?? zone.replaceAll("_", " ")} · ${zone}`;
  return <div className="space-y-2">
    <input type="hidden" name={name} value={value} />
    {detected ? <button type="button" onClick={() => { setValue(detected); setQuery(""); setOpen(false); }} className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-left text-sm font-bold text-indigo-800 hover:bg-indigo-100">{locale === "fr" ? "Utiliser le fuseau détecté" : "Use detected time zone"}: {detected}</button> : null}
    <input role="combobox" aria-label={locale === "fr" ? "Rechercher une ville, un pays ou un fuseau" : "Search a city, country or time zone"} aria-controls={listId} aria-expanded={open} aria-haspopup="listbox" value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setOpen(false); } }} placeholder={locale === "fr" ? "Rechercher : Dallas, Douala, Dublin…" : "Search: Dallas, Douala, Dublin…"} className={className} />
    {open ? <div id={listId} role="listbox" className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
      {filtered.map((zone) => <button key={zone} type="button" role="option" aria-selected={value === zone} onClick={() => { setValue(zone); setQuery(""); setOpen(false); }} className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm ${value === zone ? "bg-indigo-600 font-black text-white" : "font-semibold text-slate-700 hover:bg-slate-100"}`}>{display(zone)}</button>)}
      {!filtered.length ? <p className="px-3 py-4 text-sm text-slate-500">{locale === "fr" ? "Aucun fuseau trouvé." : "No time zone found."}</p> : null}
    </div> : null}
    <p className="text-xs font-bold text-slate-600">{locale === "fr" ? "Sélection actuelle" : "Current selection"}: {display(value)}</p>
  </div>;
}
