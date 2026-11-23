"use client";

import {useEffect,useRef,useState,type FormEvent,type ReactNode} from "react";

type Props={
 action:(formData:FormData)=>void|Promise<void>;
 children:ReactNode;
 className?:string;
 draftKey:string;
 clearDraft?:boolean;
};

type DraftEntry=[string,string];

export function PersistentForm({action,children,className,draftKey,clearDraft=false}:Props){
 const formRef=useRef<HTMLFormElement>(null);
 const timerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
 const[status,setStatus]=useState("Brouillon automatique activé");

 useEffect(()=>{
  const form=formRef.current;
  if(!form)return;
  if(clearDraft){sessionStorage.removeItem(draftKey);setStatus("Brouillon effacé après l’enregistrement");return}
  const raw=sessionStorage.getItem(draftKey);
  if(!raw)return;
  try{
   const savedDraft=JSON.parse(raw) as {version:number;entries:DraftEntry[]};
   if(savedDraft.version!==1||!Array.isArray(savedDraft.entries))throw new Error("Format de brouillon incompatible");
   const entries=savedDraft.entries;
   const values=new Map<string,string[]>();
   entries.forEach(([name,value])=>values.set(name,[...(values.get(name)??[]),value]));
   Array.from(form.elements).forEach(element=>{
    if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement)||!element.name||element.type==="hidden"||element.type==="file"||element.type==="password")return;
    const saved=values.get(element.name);
    if(!saved)return;
    if(element instanceof HTMLInputElement&&(element.type==="checkbox"||element.type==="radio"))element.checked=saved.includes(element.value);
    else element.value=saved[0]??"";
   });
   setStatus("Brouillon restauré");
  }catch{sessionStorage.removeItem(draftKey)}
 },[draftKey,clearDraft]);

 function save(){
  const form=formRef.current;
  if(!form)return;
  const entries:DraftEntry[]=[];
  new FormData(form).forEach((value,name)=>{if(typeof value==="string"&&name!=="assessment_id"&&name!=="question_id")entries.push([name,value])});
  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach(box=>{if(!box.checked)entries.push([box.name,"__unchecked__"])});
  sessionStorage.setItem(draftKey,JSON.stringify({version:1,entries}));
  setStatus(`Brouillon enregistré à ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`);
 }

 function onInput(){
  setStatus("Enregistrement…");
  if(timerRef.current)clearTimeout(timerRef.current);
  timerRef.current=setTimeout(save,500);
 }

 function onSubmit(_event:FormEvent<HTMLFormElement>){save()}
 function resetDraft(){sessionStorage.removeItem(draftKey);formRef.current?.reset();setStatus("Brouillon effacé")}

 return <form ref={formRef} action={action} onInput={onInput} onChange={onInput} onSubmit={onSubmit} className={className}>
  {children}
  <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
   <span aria-live="polite">{status}</span>
   <button type="button" onClick={resetDraft} className="font-bold text-slate-700 underline">Effacer le brouillon</button>
  </div>
 </form>
}
