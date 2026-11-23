"use client";

import {useState} from "react";
import Papa from "papaparse";
import {readSheet} from "read-excel-file/browser";
import {importHistoricalClientsAction} from "@/app/actions/historical-clients";

export function HistoricalClientImporter({members}:{members:{id:string;name:string}[]}){
  const [fileName,setFileName]=useState(""); const [rows,setRows]=useState<Record<string,unknown>[]>([]); const [error,setError]=useState("");
  async function read(file:File|undefined){setError("");setRows([]);setFileName(file?.name??"");if(!file)return;try{let parsed:Record<string,unknown>[];if(file.name.toLowerCase().endsWith(".csv")){const result=Papa.parse<Record<string,unknown>>(await file.text(),{header:true,skipEmptyLines:true});if(result.errors.length)throw new Error(result.errors[0].message);parsed=result.data;}else{const sheetRows=await readSheet(file);const headers=sheetRows[0]??[];const keys=headers.map(header=>String(header??"").trim());parsed=sheetRows.slice(1).map(row=>Object.fromEntries(keys.map((key,index)=>[key,row[index]??""])));}if(!parsed.length)throw new Error("Le fichier ne contient aucune ligne.");if(parsed.length>1000)throw new Error("Maximum 1 000 lignes par import.");setRows(parsed);}catch(reason){setError(reason instanceof Error?reason.message:"Fichier illisible.");}}
  const preview=rows.slice(0,5);
  return <form action={importHistoricalClientsAction} className="rounded-3xl border border-violet-200 bg-violet-50 p-6">
    <h2 className="text-xl font-black text-violet-950">Importer des anciens clients</h2><p className="mt-2 text-sm font-semibold text-violet-800">CSV ou Excel. Le nom et au moins un téléphone ou e-mail sont obligatoires. Aucun import ne crée de vente ou de commission.</p>
    <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-black">Fichier CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={e=>void read(e.target.files?.[0])} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3"/></label><label className="text-sm font-black">Responsable de suivi par défaut<select name="follow_up_owner_id" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"><option value="">Non attribué</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>
    <input type="hidden" name="fileName" value={fileName}/><input type="hidden" name="rows" value={JSON.stringify(rows)}/>{error?<p className="mt-4 rounded-xl bg-red-100 p-3 font-bold text-red-800">{error}</p>:null}
    {rows.length?<div className="mt-4 overflow-x-auto rounded-xl bg-white p-4"><p className="font-black text-violet-900">Prévisualisation — {rows.length} ligne(s)</p><table className="mt-3 min-w-full text-xs"><thead><tr>{Object.keys(preview[0]??{}).slice(0,6).map(key=><th key={key} className="border-b p-2 text-left">{key}</th>)}</tr></thead><tbody>{preview.map((row,i)=><tr key={i}>{Object.keys(preview[0]??{}).slice(0,6).map(key=><td key={key} className="border-b p-2">{String(row[key]??"").slice(0,60)}</td>)}</tr>)}</tbody></table></div>:null}
    <button disabled={!rows.length} className="mt-5 rounded-xl bg-violet-700 px-5 py-3 font-black text-white disabled:opacity-40">Importer après vérification</button>
  </form>;
}
