"use client";

import {useEffect,useRef,useState,useTransition} from "react";
import {useRouter} from "next/navigation";

export function CantonAccessSearch({
  initialValue,
  placeholder,
  clearLabel,
}:{initialValue:string;placeholder:string;clearLabel:string}){
  const router=useRouter();
  const [value,setValue]=useState(initialValue);
  const [pending,startTransition]=useTransition();
  const timerRef=useRef<ReturnType<typeof setTimeout>|null>(null);

  // Browser back/forward navigation should update the input, but should
  // never trigger a new navigation by itself.
  useEffect(()=>{setValue(initialValue);},[initialValue]);
  useEffect(()=>()=>{if(timerRef.current!==null)clearTimeout(timerRef.current);},[]);

  function updateSearch(nextValue:string){
    setValue(nextValue);
    if(timerRef.current!==null)clearTimeout(timerRef.current);
    timerRef.current=window.setTimeout(()=>{
      timerRef.current=null;
      const params=new URLSearchParams(window.location.search);
      const next=nextValue.trim();
      const current=(params.get("accessQ")||"").trim();
      // Avoid a router.replace on a route that is already showing this search.
      if(next===current)return;
      if(next)params.set("accessQ",next);
      else params.delete("accessQ");
      params.delete("accessPage");
      const query=params.toString();
      const target=window.location.pathname+(query?"?"+query:"");
      startTransition(()=>router.replace(target,{scroll:false}));
    },300);
  }

  return <div className="flex flex-wrap items-center gap-2">
    <div className="relative min-w-[220px] flex-1">
      <input
        value={value}
        onChange={e=>updateSearch(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
      {pending?<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-violet-600">…</span>:null}
    </div>
    {value?<button type="button" onClick={()=>updateSearch("")} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700">{clearLabel}</button>:null}
  </div>;
}
