"use client";

import {useId, useRef, useState} from "react";
import {createClient} from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function ProviderPortalAttachmentUpload({contractId}: {contractId: string}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<null | {
    storagePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>(null);

  async function removeTemporary(path: string) {
    try {
      await fetch("/api/provider-portal/upload-url", {
        method: "DELETE",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path}),
      });
    } catch {
      // Temporary storage is private and harmless if cleanup is interrupted.
    }
  }

  async function handleFile(file: File | null) {
    setError("");
    if (!file) return;
    if (!ACCEPTED.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      setError("PDF, image ou Word uniquement · 10 Mo max.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (attachment?.storagePath) await removeTemporary(attachment.storagePath);
    setAttachment(null);
    setUploading(true);
    try {
      const response = await fetch("/api/provider-portal/upload-url", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({contractId, fileName: file.name, mimeType: file.type, sizeBytes: file.size}),
      });
      const payload = await response.json() as {bucket?: string; path?: string; token?: string; error?: string};
      if (!response.ok || !payload.bucket || !payload.path || !payload.token) {
        throw new Error(payload.error || "Autorisation de téléversement impossible.");
      }
      const supabase = createClient();
      const {error: uploadError} = await supabase.storage
        .from(payload.bucket)
        .uploadToSignedUrl(payload.path, payload.token, file, {contentType: file.type, cacheControl: "3600"});
      if (uploadError) throw uploadError;
      setAttachment({storagePath: payload.path, fileName: file.name, mimeType: file.type, sizeBytes: file.size});
    } catch (uploadError) {
      console.error(uploadError);
      setError("Le fichier n’a pas pu être envoyé.");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (attachment?.storagePath) await removeTemporary(attachment.storagePath);
    setAttachment(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <label htmlFor={id} className="block text-xs font-black uppercase tracking-wide text-slate-700">Preuve / document</label>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx"
        disabled={uploading}
        onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
        className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:font-black file:text-white"
      />
      {uploading ? <p className="mt-2 text-xs font-bold text-indigo-700">Téléversement sécurisé…</p> : null}
      {attachment ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <span className="font-bold">Prêt : {attachment.fileName}</span>
          <button type="button" onClick={() => void remove()} className="font-black underline">Retirer</button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs font-bold text-red-700">{error}</p> : null}
      <input type="hidden" name="proofStoragePath" value={attachment?.storagePath ?? ""} />
      <input type="hidden" name="proofFileName" value={attachment?.fileName ?? ""} />
      <input type="hidden" name="proofMimeType" value={attachment?.mimeType ?? ""} />
      <input type="hidden" name="proofSizeBytes" value={attachment?.sizeBytes ?? ""} />
    </div>
  );
}
