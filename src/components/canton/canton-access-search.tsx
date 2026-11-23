"use client";

import {useEffect,useRef,useState,useTransition} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";

export function CantonAccessSearch({
  initialValue,
  placeholder,
  clearLabel,
}:{initialValue:string;placeholder:string;clearLabel:string}){
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const [value,setValue]=useState(initialValue);
  const [pending,startTransition]=useTransition();
  const first=useRef(true);

  useEffect(()=>{
    if(first.current){first.current=false;return;}
    const timer=window.setTimeout(()=>{
      const params=new URLSearchParams(searchParams.toString());
      const next=value.trim();
      if(next) params.set("accessQ",next);
      else params.delete("accessQ");
      params.delete("accessPage");
      startTransition(()=>router.replace(pathname+"?"+params.toString(),{scroll:false}));
    },300);
    return ()=>window.clearTimeout(timer);
  },[value,pathname,router,searchParams]);

  return <div className="flex flex-wrap items-center gap-2">
    <div className="relative min-w-[220px] flex-1">
      <input
        value={value}
        onChange={e=>setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
      {pending?<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-violet-600">…</span>:null}
    </div>
    {value?<button type="button" onClick={()=>setValue("")} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700">{clearLabel}</button>:null}
  </div>;
}
