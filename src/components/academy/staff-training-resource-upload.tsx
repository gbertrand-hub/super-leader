"use client";

import {useId, useRef, useState} from "react";
import {createClient} from "@/lib/supabase/client";

const MAX_BYTES = 30 * 1024 * 1024;
const TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

export function StaffTrainingResourceUpload({
  prefix,
  label,
  help,
  uploadingLabel,
  uploadedLabel,
  removeLabel,
  errorLabel,
}: {
  prefix: string;
  label: string;
  help: string;
  uploadingLabel: string;
  uploadedLabel: string;
  removeLabel: string;
  errorLabel: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<null | {storagePath: string; fileName: string; mimeType: string; sizeBytes: number}>(null);

  async function cleanup(path: string) {
    try { await fetch("/api/academy/staff-training/upload-url", {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path})}); } catch { /* temp cleanup is best effort */ }
  }

  async function handleFile(file: File | null) {
    setError("");
    if (!file) return;
    if (!TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      setError(errorLabel);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (attachment?.storagePath) await cleanup(attachment.storagePath);
    setAttachment(null);
    setUploading(true);
    try {
      const response = await fetch("/api/academy/staff-training/upload-url", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({fileName: file.name, mimeType: file.type, sizeBytes: file.size})});
      const payload = await response.json() as {bucket?: string; path?: string; token?: string; error?: string};
      if (!response.ok || !payload.bucket || !payload.path || !payload.token) throw new Error(payload.error || "Upload authorization failed");
      const supabase = createClient();
      const {error: uploadError} = await supabase.storage.from(payload.bucket).uploadToSignedUrl(payload.path, payload.token, file, {contentType: file.type, cacheControl: "3600"});
      if (uploadError) throw uploadError;
      setAttachment({storagePath: payload.path, fileName: file.name, mimeType: file.type, sizeBytes: file.size});
    } catch (uploadError) {
      console.error(uploadError);
      setError(errorLabel);
      if (inputRef.current) inputRef.current.value = "";
    } finally { setUploading(false); }
  }

  async function remove() {
    if (attachment?.storagePath) await cleanup(attachment.storagePath);
    setAttachment(null); setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return <div className="rounded-xl border border-violet-200 bg-white p-4">
    <label htmlFor={id} className="block text-sm font-black text-slate-950">{label}</label>
    <p className="mt-1 text-xs leading-5 text-slate-500">{help}</p>
    <input ref={inputRef} id={id} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={(event) => void handleFile(event.target.files?.[0] ?? null)} className="mt-3 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-violet-700 file:px-3 file:py-2 file:font-black file:text-white" />
    {uploading ? <p className="mt-3 text-sm font-bold text-violet-700">{uploadingLabel}</p> : null}
    {attachment ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-bold">{uploadedLabel}: {attachment.fileName}</span><button type="button" onClick={() => void remove()} className="font-black underline">{removeLabel}</button></div> : null}
    {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    <input type="hidden" name={`${prefix}StoragePath`} value={attachment?.storagePath ?? ""} />
    <input type="hidden" name={`${prefix}FileName`} value={attachment?.fileName ?? ""} />
    <input type="hidden" name={`${prefix}MimeType`} value={attachment?.mimeType ?? ""} />
    <input type="hidden" name={`${prefix}SizeBytes`} value={attachment?.sizeBytes ?? ""} />
  </div>;
}
