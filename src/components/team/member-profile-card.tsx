"use client";

import Image from "next/image";
import {Children, useEffect, useRef, useState} from "react";

type MemberProfileCardProps = {
  name: string;
  email: string;
  role: string;
  team: string;
  avatarUrl: string | null;
  initials: string;
  labels: {
    open: string;
    close: string;
    profile: string;
    email: string;
    role: string;
    team: string;
  };
  actions?: React.ReactNode;
};

function Avatar({avatarUrl, name, initials, large = false}: {avatarUrl: string | null; name: string; initials: string; large?: boolean}) {
  const size = large ? "h-24 w-24 text-2xl" : "h-12 w-12 text-sm";
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-950 font-black text-white ring-2 ring-white shadow ${size}`}>
      {avatarUrl ? <Image src={avatarUrl} alt={name} fill sizes={large ? "96px" : "48px"} unoptimized className="object-cover" /> : initials}
    </span>
  );
}

export function MemberProfileCard({name, email, role, team, avatarUrl, initials, labels, actions}: MemberProfileCardProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const actionItems = Children.toArray(actions);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40">
        <button type="button" onClick={() => setOpen(true)} className="group flex min-w-0 items-center gap-3 text-left" aria-label={`${labels.open}: ${name}`}>
          <Avatar avatarUrl={avatarUrl} name={name} initials={initials} />
          <span className="min-w-0">
            <span className="block truncate font-black text-slate-950 underline-offset-4 group-hover:text-indigo-700 group-hover:underline">{name}</span>
            <span className="block truncate text-sm text-slate-500">{email} · {role}</span>
          </span>
        </button>
        {actionItems}
      </div>

      <dialog ref={dialogRef} onClose={() => setOpen(false)} onCancel={() => setOpen(false)} className="w-[calc(100%-2rem)] max-w-lg rounded-3xl p-0 shadow-2xl backdrop:bg-slate-950/60">
        <div className="overflow-hidden rounded-3xl bg-white">
          <div className="bg-slate-950 p-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <Avatar avatarUrl={avatarUrl} name={name} initials={initials} large />
              <button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl font-black hover:bg-white/20" aria-label={labels.close}>×</button>
            </div>
            <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-indigo-300">{labels.profile}</p>
            <h2 className="mt-1 text-2xl font-black">{name}</h2>
          </div>
          <dl className="grid gap-4 p-6 text-sm">
            <div className="rounded-2xl bg-slate-50 p-4"><dt className="font-black text-slate-500">{labels.email}</dt><dd className="mt-1 break-all font-bold text-slate-900">{email}</dd></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4"><dt className="font-black text-slate-500">{labels.role}</dt><dd className="mt-1 font-bold text-slate-900">{role}</dd></div>
              <div className="rounded-2xl bg-slate-50 p-4"><dt className="font-black text-slate-500">{labels.team}</dt><dd className="mt-1 font-bold text-slate-900">{team}</dd></div>
            </div>
          </dl>
          <div className="border-t border-slate-100 p-6 pt-4"><button type="button" onClick={() => setOpen(false)} className="w-full rounded-xl bg-slate-950 px-4 py-3 font-black text-white hover:bg-slate-800">{labels.close}</button></div>
        </div>
      </dialog>
    </>
  );
}
