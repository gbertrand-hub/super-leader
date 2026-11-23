"use client";

import {useState,useTransition} from "react";
import {searchCantonCrmProspects} from "@/app/actions/canton-visitors";

type Prospect={id:string;reference:string|null;full_name:string;email:string|null;phone:string|null};

export function CantonCrmProspectPicker({locale}:{locale:"fr"|"en"}){
 const fr=locale==="fr";
 const [query,setQuery]=useState("");
 const [results,setResults]=useState<Prospect[]>([]);
 const [selected,setSelected]=useState<Prospect|null>(null);
 const [searched,setSearched]=useState(false);
 const [pending,startTransition]=useTransition();

 function runSearch(){
  const q=query.trim();
  if(q.length<2){setResults([]);setSearched(true);return}
  startTransition(async()=>{
   const rows=await searchCantonCrmProspects(q);
   setResults(rows as Prospect[]);
   setSearched(true);
  });
 }

 return <div className="space-y-2">
  <input type="hidden" name="clientId" value={selected?.id||""}/>
  <div className="flex gap-2">
   <input
    value={query}
    onChange={e=>{setQuery(e.target.value);setSelected(null)}}
    onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();runSearch()}}}
    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
    placeholder={fr?"Nom, email, téléphone ou référence CRM…":"Name, email, phone or CRM reference…"}
   />
   <button type="button" onClick={runSearch} disabled={pending||query.trim().length<2} className="rounded-lg bg-cyan-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
    {pending?(fr?"Recherche…":"Searching…"):(fr?"Rechercher":"Search")}
   </button>
  </div>
  {selected&&<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
   <strong>{selected.full_name}</strong>
   <div className="text-xs">{[selected.reference,selected.email,selected.phone].filter(Boolean).join(" · ")}</div>
  </div>}
  {!selected&&results.length>0&&<div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border bg-white p-2">
   {results.map(p=><button key={p.id} type="button" onClick={()=>{setSelected(p);setQuery(p.full_name)}} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-cyan-50">
    <div className="font-medium">{p.full_name}</div>
    <div className="text-xs text-slate-500">{[p.reference,p.email,p.phone].filter(Boolean).join(" · ")}</div>
   </button>)}
  </div>}
  {!selected&&searched&&!pending&&results.length===0&&<div className="text-xs text-slate-500">{fr?"Aucun prospect trouvé. Vérifiez le nom, l’email, le téléphone ou la référence.":"No prospect found. Check name, email, phone, or reference."}</div>}
  <p className="text-xs text-slate-500">{fr?"La recherche interroge le CRM à la demande et n’affiche qu’un petit nombre de résultats, même avec des milliers de prospects.":"Search queries the CRM on demand and only returns a small result set, even with thousands of prospects."}</p>
 </div>;
}
