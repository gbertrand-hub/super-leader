"use client";

import {useEffect, useId, useRef, useState} from "react";
import {createClient} from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type UploadedAvatar = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export function ProfileAvatarUpload({
  currentUrl,
  initials,
  labels,
}: {
  currentUrl: string | null;
  initials: string;
  labels: {
    title: string;
    help: string;
    choose: string;
    replace: string;
    remove: string;
    uploading: string;
    ready: string;
    error: string;
  };
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<UploadedAvatar | null>(null);
  const [removeCurrent, setRemoveCurrent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function deleteTemporary(path: string) {
    try {
      await fetch("/api/profile/avatar-upload-url", {
        method: "DELETE",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path}),
      });
    } catch {
      // The object remains temporary and can be cleaned later.
    }
  }

  async function handleFile(file: File | null) {
    setError("");
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      setError(labels.error);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (uploaded?.storagePath) await deleteTemporary(uploaded.storagePath);
    setUploaded(null);
    setUploading(true);

    try {
      const response = await fetch("/api/profile/avatar-upload-url", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      const payload = await response.json() as {
        bucket?: string;
        path?: string;
        token?: string;
        error?: string;
      };
      if (!response.ok || !payload.bucket || !payload.path || !payload.token) {
        throw new Error(payload.error || "Upload authorization failed.");
      }

      const supabase = createClient();
      const {error: uploadError} = await supabase.storage
        .from(payload.bucket)
        .uploadToSignedUrl(payload.path, payload.token, file, {
          contentType: file.type,
          cacheControl: "3600",
        });
      if (uploadError) throw uploadError;

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(file);
      setPreviewUrl(objectUrlRef.current);
      setRemoveCurrent(false);
      setUploaded({
        storagePath: payload.path,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
    } catch (uploadError) {
      console.error(uploadError);
      setError(labels.error);
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    if (uploaded?.storagePath) await deleteTemporary(uploaded.storagePath);
    setUploaded(null);
    setRemoveCurrent(Boolean(currentUrl));
    setPreviewUrl(null);
    setError("");
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-indigo-600 text-2xl font-black text-white shadow-lg">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{initials || "SL"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black text-slate-950">{labels.title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{labels.help}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <label htmlFor={id} className="cursor-pointer rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">
              {previewUrl ? labels.replace : labels.choose}
            </label>
            {previewUrl || uploaded ? (
              <button type="button" onClick={() => void removeAvatar()} className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-black text-red-700 hover:bg-red-50">
                {labels.remove}
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            disabled={uploading}
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
          {uploading ? <p className="mt-3 text-sm font-bold text-indigo-700">{labels.uploading}</p> : null}
          {uploaded ? <p className="mt-3 text-sm font-bold text-emerald-700">{labels.ready}: {uploaded.fileName}</p> : null}
          {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
        </div>
      </div>
      <input type="hidden" name="avatarStoragePath" value={uploaded?.storagePath ?? ""} />
      <input type="hidden" name="avatarFileName" value={uploaded?.fileName ?? ""} />
      <input type="hidden" name="avatarMimeType" value={uploaded?.mimeType ?? ""} />
      <input type="hidden" name="avatarSizeBytes" value={uploaded?.sizeBytes ?? ""} />
      <input type="hidden" name="removeAvatar" value={removeCurrent ? "true" : "false"} />
    </div>
  );
}
