"use client";

import {useState} from "react";
import Papa from "papaparse";
import {readSheet} from "read-excel-file/browser";
import {importProspectsAction} from "@/app/actions/crm-leads";

type Member = {id: string; name: string};
type Ambassador = {id: string; code: string; full_name: string};

export function ProspectImporter({members, ambassadors, locale}: {members: Member[]; ambassadors: Ambassador[]; locale: string}) {
  const fr = locale === "fr";
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");

  async function readFile(file: File | undefined) {
    setError(""); setRows([]); setFileName(file?.name ?? "");
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
        const sheetRows = await readSheet(file);
        const headers = sheetRows[0] ?? [];
        const dataRows = sheetRows.slice(1);
        const keys = headers.map((header) => String(header ?? "").trim());
        parsed = dataRows.map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
      }
      if (!parsed.length) throw new Error(fr ? "Le fichier ne contient aucune ligne." : "The file contains no rows.");
      if (parsed.length > 1000) throw new Error(fr ? "Maximum 1 000 lignes par import." : "Maximum 1,000 rows per import.");
      setRows(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (fr ? "Fichier illisible." : "Unreadable file."));
    }
  }

  return (
    <form action={importProspectsAction} className="rounded-3xl border border-sky-200 bg-sky-50 p-6">
      <h2 className="text-xl font-black text-sky-950">{fr ? "Importer des prospects" : "Import prospects"}</h2>
      <p className="mt-2 text-sm font-semibold text-sky-800">{fr ? "CSV ou Excel (.xlsx). Colonnes reconnues : full_name/nom, phone/téléphone, email, whatsapp, country/pays, city/ville, source, campaign, ambassador/ambassadeur, product/produit, budget, currency, priority, notes." : "CSV or Excel (.xlsx). Recognized columns: full_name/name, phone, email, whatsapp, country, city, source, campaign, ambassador, product, budget, currency, priority, notes."}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-black text-slate-700">{fr ? "Fichier CSV / Excel" : "CSV / Excel file"}<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readFile(event.target.files?.[0])} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3" /></label>
        <label className="text-sm font-black text-slate-700">{fr ? "Source par défaut" : "Default source"}<select name="sourceDetail" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"><option value="campaign">{fr ? "Campagne publicitaire" : "Advertising campaign"}</option><option value="ambassador">{fr ? "Ambassadeur" : "Ambassador"}</option><option value="website">{fr ? "Site web" : "Website"}</option><option value="referral">{fr ? "Recommandation" : "Referral"}</option><option value="event">{fr ? "Événement" : "Event"}</option><option value="other">{fr ? "Autre" : "Other"}</option></select></label>
        <label className="text-sm font-black text-slate-700">{fr ? "Campagne par défaut" : "Default campaign"}<input name="campaignName" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3" /></label>
        <label className="text-sm font-black text-slate-700">{fr ? "Ambassadeur par défaut" : "Default ambassador"}<select name="ambassadorId" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"><option value="">{fr?"Aucun":"None"}</option>{ambassadors.map(item=><option key={item.id} value={item.id}>{item.code} — {item.full_name}</option>)}</select></label>
        <label className="text-sm font-black text-slate-700 md:col-span-2">{fr ? "Attribuer au commercial" : "Assign to salesperson"}<select name="ownerId" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"><option value="">{fr ? "Non attribué" : "Unassigned"}</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      </div>
      <input type="hidden" name="fileName" value={fileName} /><input type="hidden" name="rows" value={JSON.stringify(rows)} />
      {error ? <p className="mt-4 rounded-xl bg-red-100 px-4 py-3 font-bold text-red-800">{error}</p> : null}
      {rows.length ? <p className="mt-4 rounded-xl bg-white px-4 py-3 font-bold text-sky-900">{rows.length} {fr ? "ligne(s) prête(s). Les doublons seront ignorés automatiquement." : "row(s) ready. Duplicates will be skipped automatically."}</p> : null}
      <button disabled={!rows.length} className="mt-5 rounded-xl bg-sky-700 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{fr ? "Importer les prospects" : "Import prospects"}</button>
    </form>
  );
}
