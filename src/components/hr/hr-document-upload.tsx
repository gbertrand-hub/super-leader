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
]);

export function HrDocumentUpload({prefix = "document", fr}: {prefix?: string; fr: boolean}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<null | {storagePath: string; fileName: string; mimeType: string; sizeBytes: number}>(null);

  async function cleanup(path: string) {
    try {
      await fetch("/api/hr/documents/upload-url", {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path})});
    } catch { /* temporary cleanup is best effort */ }
  }

  async function selectFile(file: File | null) {
    setError("");
    if (!file) return;
    if (!TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      setError(fr ? "Format invalide ou fichier supérieur à 30 Mo." : "Invalid format or file larger than 30 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (attachment?.storagePath) await cleanup(attachment.storagePath);
    setAttachment(null);
    setUploading(true);
    try {
      const response = await fetch("/api/hr/documents/upload-url", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({fileName: file.name, mimeType: file.type, sizeBytes: file.size})});
      const payload = await response.json() as {bucket?: string; path?: string; token?: string; error?: string};
      if (!response.ok || !payload.bucket || !payload.path || !payload.token) throw new Error(payload.error || "Upload authorization failed");
      const supabase = createClient();
      const {error: uploadError} = await supabase.storage.from(payload.bucket).uploadToSignedUrl(payload.path, payload.token, file, {contentType: file.type, cacheControl: "3600"});
      if (uploadError) throw uploadError;
      setAttachment({storagePath: payload.path, fileName: file.name, mimeType: file.type, sizeBytes: file.size});
    } catch (uploadError) {
      console.error(uploadError);
      setError(fr ? "Le téléversement a échoué." : "Upload failed.");
      if (inputRef.current) inputRef.current.value = "";
    } finally { setUploading(false); }
  }

  async function remove() {
    if (attachment?.storagePath) await cleanup(attachment.storagePath);
    setAttachment(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return <div className="rounded-2xl border border-emerald-200 bg-white p-4">
    <label htmlFor={id} className="block text-sm font-black text-slate-950">{fr ? "Fichier sécurisé" : "Secure file"}</label>
    <p className="mt-1 text-xs text-slate-500">PDF recommandé · PDF, Word ou image · 30 Mo maximum.</p>
    <input ref={inputRef} id={id} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} className="mt-3 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-2 file:font-black file:text-white" />
    {uploading ? <p className="mt-3 text-sm font-bold text-emerald-700">{fr ? "Téléversement sécurisé…" : "Secure upload…"}</p> : null}
    {attachment ? <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-bold">{attachment.fileName}</span><button type="button" onClick={() => void remove()} className="font-black underline">{fr ? "Retirer" : "Remove"}</button></div> : null}
    {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    <input type="hidden" name={`${prefix}StoragePath`} value={attachment?.storagePath ?? ""} />
    <input type="hidden" name={`${prefix}FileName`} value={attachment?.fileName ?? ""} />
    <input type="hidden" name={`${prefix}MimeType`} value={attachment?.mimeType ?? ""} />
    <input type="hidden" name={`${prefix}SizeBytes`} value={attachment?.sizeBytes ?? ""} />
  </div>;
}

