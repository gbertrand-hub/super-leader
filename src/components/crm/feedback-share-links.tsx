"use client";

import {useMemo, useState} from "react";

type Props = {
  url: string;
  message: string;
  subject: string;
  email?: string | null;
  phone?: string | null;
  labels: {
    copy: string;
    copied: string;
    email: string;
    whatsapp: string;
    sms: string;
    open: string;
  };
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function FeedbackShareLinks({url, message, subject, email, phone, labels}: Props) {
  const [copied, setCopied] = useState(false);
  const fullMessage = `${message}\n\n${url}`;
  const links = useMemo(() => {
    const cleanedPhone = phone ? digitsOnly(phone) : "";
    return {
      email: email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullMessage)}` : "",
      whatsapp: cleanedPhone ? `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(fullMessage)}` : "",
      sms: cleanedPhone ? `sms:${cleanedPhone}?&body=${encodeURIComponent(fullMessage)}` : "",
    };
  }, [email, phone, subject, fullMessage]);

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const base = "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-black transition";

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={copyLink} className={`${base} border-slate-300 bg-white text-slate-700 hover:border-indigo-400`}>
        {copied ? labels.copied : labels.copy}
      </button>
      <a className={`${base} border-indigo-200 bg-indigo-50 text-indigo-800 hover:border-indigo-400`} href={url} target="_blank" rel="noreferrer">
        {labels.open}
      </a>
      {links.email ? <a className={`${base} border-blue-200 bg-blue-50 text-blue-800`} href={links.email}>{labels.email}</a> : null}
      {links.whatsapp ? <a className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`} href={links.whatsapp} target="_blank" rel="noreferrer">{labels.whatsapp}</a> : null}
      {links.sms ? <a className={`${base} border-violet-200 bg-violet-50 text-violet-800`} href={links.sms}>{labels.sms}</a> : null}
    </div>
  );
}
