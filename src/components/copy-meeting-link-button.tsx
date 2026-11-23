"use client";

import {useState} from "react";

export function CopyMeetingLinkButton({url, locale = "fr"}: {url: string; locale?: string}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-800 hover:bg-indigo-50"
    >
      {copied ? (locale === "fr" ? "Copié ✓" : "Copied ✓") : (locale === "fr" ? "Copier le lien" : "Copy link")}
    </button>
  );
}
