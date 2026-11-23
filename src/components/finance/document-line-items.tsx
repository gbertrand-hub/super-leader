"use client";

import {useState} from "react";

const field="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5";

export function DocumentLineItems(){
 const[rows,setRows]=useState([0]);
 return <fieldset><div className="flex items-center justify-between gap-3"><legend className="font-black">Produits et services</legend><button type="button" onClick={()=>setRows(current=>[...current,Math.max(...current)+1])} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-black text-indigo-700">+ Ajouter une ligne</button></div><div className="mt-3 space-y-3">{rows.map((row,index)=><div key={row} className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[1fr_90px_130px_auto]"><label className="text-xs font-bold text-slate-600">Description<input name="itemDescription" required={index===0} className={field}/></label><label className="text-xs font-bold text-slate-600">Quantité<input name="itemQuantity" type="number" min="0.01" step="0.01" required={index===0} defaultValue="1" className={field}/></label><label className="text-xs font-bold text-slate-600">Prix unitaire<input name="itemUnitPrice" type="number" min="0" step="0.01" required={index===0} defaultValue="0" className={field}/></label><button type="button" disabled={rows.length===1} onClick={()=>setRows(current=>current.filter(item=>item!==row))} className="self-end rounded-xl px-3 py-2.5 font-black text-rose-700 disabled:opacity-30" aria-label="Retirer cette ligne">×</button></div>)}</div></fieldset>
}
