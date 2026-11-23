"use client";

import {useEffect,useId,useState} from "react";

type Enrollment={schoolId:string;programId:string|null;cohortId:string|null;status:string};
type Result={id:string;name:string;email:string|null;phone:string|null;reference:string;status:string;enrollments:Enrollment[]};
type School={id:string;name:string};
type Program={id:string;schoolId:string;name:string};
type Cohort={id:string;schoolId:string;name:string};
type Props={schools:School[];programs:Program[];cohorts:Cohort[]};
const input="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";

export function CrmStudentSearch({schools,programs,cohorts}:Props){
  const listId=useId(),[query,setQuery]=useState(""),[searchedQuery,setSearchedQuery]=useState(""),[results,setResults]=useState<Result[]>([]),[selected,setSelected]=useState<Result|null>(null),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{
    if(selected||query.trim().length<2)return;
    const controller=new AbortController(),timer=window.setTimeout(async()=>{const term=query.trim();setLoading(true);setFailed(false);try{const response=await fetch(`/api/academy/crm-students/search?q=${encodeURIComponent(term)}`,{signal:controller.signal,cache:"no-store"});if(!response.ok)throw new Error("search");const payload=await response.json() as {results?:Result[]};setResults(payload.results??[]);setSearchedQuery(term);}catch(error){if((error as Error).name!=="AbortError")setFailed(true);}finally{if(!controller.signal.aborted)setLoading(false);}},250);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[query,selected]);
  const reset=()=>{setSelected(null);setQuery("");setSearchedQuery("");setResults([]);setLoading(false);setFailed(false);};
  const existingBySchool=new Map((selected?.enrollments??[]).map(item=>[item.schoolId,item]));
  return <>
    <div className="relative text-sm font-bold text-slate-700">
      <p>Étudiant déjà présent dans le CRM</p>
      <input type="hidden" name="crm_client_id" value={selected?.id??""}/>
      {selected?<div className="mt-1 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2"><div><p className="font-black text-emerald-950">{selected.name}</p><p className="text-xs font-bold text-emerald-800">{selected.email||selected.phone||selected.reference} · {selected.enrollments.length} école(s) déjà inscrite(s)</p></div><button type="button" onClick={reset} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-rose-700">Changer</button></div>:<><input value={query} onChange={event=>{setQuery(event.target.value);setSearchedQuery("");setResults([]);setLoading(false);setFailed(false);}} placeholder="Saisir au moins 2 caractères…" autoComplete="off" role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded={results.length>0} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><p className="mt-1 text-xs font-semibold text-slate-500">Recherche serveur par nom, e-mail, téléphone ou référence · 12 résultats maximum.</p>{query.trim().length>0&&query.trim().length<2?<p className="mt-1 text-xs font-bold text-amber-700">Saisissez encore un caractère.</p>:null}{loading?<p className="mt-2 text-sm font-bold text-slate-500">Recherche…</p>:null}{failed?<p className="mt-2 text-sm font-bold text-red-700">Recherche indisponible. Réessayez.</p>:null}{!loading&&!failed&&searchedQuery===query.trim()&&searchedQuery.length>=2&&!results.length?<p className="mt-2 text-sm font-bold text-slate-500">Aucun contact trouvé.</p>:null}{results.length?<div id={listId} role="listbox" className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">{results.map(result=><button key={result.id} type="button" role="option" aria-selected="false" onClick={()=>{setSelected(result);setQuery(result.name);setSearchedQuery("");setResults([]);setLoading(false);setFailed(false);}} className="block w-full rounded-lg px-3 py-3 text-left hover:bg-violet-50 focus:bg-violet-50"><span className="block font-black text-slate-950">{result.name}</span><span className="mt-1 block text-xs font-semibold text-slate-500">{result.email||result.phone||result.reference} · {result.status} · {result.enrollments.length} école(s)</span></button>)}</div>:null}</>}
    </div>
    <fieldset className="rounded-2xl border p-4 lg:col-span-2">
      <legend className="px-2 font-black">Écoles d’inscription</legend>
      {!selected?<p className="rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-900">Sélectionnez d’abord la personne pour voir ses inscriptions actuelles.</p>:null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {schools.map(school=>{const enrolled=existingBySchool.get(school.id),program=programs.find(item=>item.id===enrolled?.programId),cohort=cohorts.find(item=>item.id===enrolled?.cohortId);return <div key={`${selected?.id??"none"}-${school.id}`} className={`rounded-xl border p-3 ${enrolled?"border-emerald-300 bg-emerald-50":"bg-slate-50"}`}>
          {enrolled?<><div className="flex items-start justify-between gap-2"><p className="font-black text-emerald-950">{school.name}</p><span className="rounded-full bg-emerald-200 px-2 py-1 text-xs font-black text-emerald-900">Déjà inscrit</span></div><p className="mt-3 text-xs font-bold text-emerald-800">Programme : {program?.name??"À régulariser"}</p><p className="mt-1 text-xs font-bold text-emerald-800">Cohorte : {cohort?.name??"À régulariser"}</p><p className="mt-1 text-xs text-emerald-700">Statut : {enrolled.status}</p></>:<><label className={`flex items-center gap-3 font-black ${selected?"":"text-slate-400"}`}><input type="checkbox" name="school_ids" value={school.id} disabled={!selected} className="h-5 w-5"/>{school.name}</label><select name={`program_${school.id}`} defaultValue="" disabled={!selected} className={`${input} mt-3 disabled:bg-slate-100`}><option value="">Programme…</option>{programs.filter(item=>item.schoolId===school.id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><select name={`cohort_${school.id}`} defaultValue="" disabled={!selected} className={`${input} mt-2 disabled:bg-slate-100`}><option value="">Cohorte…</option>{cohorts.filter(item=>item.schoolId===school.id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></>}
        </div>;})}
      </div>
    </fieldset>
  </>;
}
