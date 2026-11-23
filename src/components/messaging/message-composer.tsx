"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {sendInternalMessageAction} from "@/app/actions/internal-messaging";
import {createClient} from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_SECONDS = 300;
const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

export type MentionCandidate = {id: string; name: string};

type UploadedAttachment = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  voiceDurationSeconds?: number;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function audioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function chooseRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function MessageComposer({
  conversationId,
  locale,
  mentionCandidates,
}: {
  conversationId: string;
  locale: "fr" | "en";
  mentionCandidates: MentionCandidate[];
}) {
  const fr = locale === "fr";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingSecondsRef = useRef(0);

  const [body, setBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedAttachment | null>(null);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [selectedMentions, setSelectedMentions] = useState<Record<string, string>>({});
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  useEffect(() => () => {
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [voicePreviewUrl]);

  const activeMentionIds = useMemo(() => Object.entries(selectedMentions)
    .filter(([, name]) => body.includes(`@${name}`))
    .map(([id]) => id), [body, selectedMentions]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLocaleLowerCase(locale === "fr" ? "fr" : "en");
    return mentionCandidates
      .filter((candidate) => candidate.name.toLocaleLowerCase(locale === "fr" ? "fr" : "en").includes(query))
      .slice(0, 8);
  }, [locale, mentionCandidates, mentionQuery]);

  async function deleteTemporary(path: string) {
    try {
      await fetch("/api/attachments/upload-url", {
        method: "DELETE",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path}),
      });
    } catch {
      // A maintenance task can clean abandoned temporary files.
    }
  }

  async function handleFile(file: File | null, voiceDurationSeconds?: number) {
    setError("");
    if (!file) return;
    const normalizedMime = file.type.split(";")[0]?.toLowerCase() || file.type.toLowerCase();
    if (!ACCEPTED_TYPES.has(normalizedMime) || file.size < 1 || file.size > MAX_BYTES) {
      setError(fr ? "Format non autorisé ou fichier supérieur à 10 Mo." : "Unsupported format or file larger than 10 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (normalizedMime.startsWith("audio/") && (!voiceDurationSeconds || voiceDurationSeconds > MAX_VOICE_SECONDS)) {
      setError(fr ? "Le message vocal doit durer entre 1 seconde et 5 minutes." : "Voice messages must be between 1 second and 5 minutes.");
      return;
    }

    if (uploaded?.storagePath) await deleteTemporary(uploaded.storagePath);
    setUploaded(null);
    setUploading(true);

    try {
      const response = await fetch("/api/attachments/upload-url", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          purpose: "message",
          fileName: file.name,
          mimeType: normalizedMime,
          sizeBytes: file.size,
        }),
      });
      const payload = await response.json() as {bucket?: string; path?: string; token?: string; error?: string};
      if (!response.ok || !payload.bucket || !payload.path || !payload.token) {
        throw new Error(payload.error || "Upload authorization failed.");
      }

      const supabase = createClient();
      const {error: uploadError} = await supabase.storage
        .from(payload.bucket)
        .uploadToSignedUrl(payload.path, payload.token, file, {
          contentType: normalizedMime,
          cacheControl: "3600",
        });
      if (uploadError) throw uploadError;

      setUploaded({
        storagePath: payload.path,
        fileName: file.name,
        mimeType: normalizedMime,
        sizeBytes: file.size,
        voiceDurationSeconds,
      });
    } catch (uploadError) {
      console.error(uploadError);
      setError(fr ? "La pièce jointe n’a pas pu être téléversée." : "The attachment could not be uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment() {
    if (uploaded?.storagePath) await deleteTemporary(uploaded.storagePath);
    setUploaded(null);
    setError("");
    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
      setVoicePreviewUrl("");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updateMentionQuery(value: string, cursor: number | null) {
    if (cursor === null) {
      setMentionQuery(null);
      return;
    }
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([^@\n]{0,60})$/);
    setMentionQuery(match ? match[1].trimStart() : null);
  }

  function insertMention(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? body.length;
    const beforeCursor = body.slice(0, cursor);
    const atIndex = beforeCursor.lastIndexOf("@");
    if (atIndex < 0) return;
    const nextBody = `${body.slice(0, atIndex)}@${candidate.name} ${body.slice(cursor)}`;
    setBody(nextBody);
    setSelectedMentions((current) => ({...current, [candidate.id]: candidate.name}));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const nextCursor = atIndex + candidate.name.length + 2;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(fr ? "L’enregistrement vocal n’est pas pris en charge par ce navigateur." : "Voice recording is not supported by this browser.");
      return;
    }
    try {
      if (uploaded) await removeAttachment();
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      streamRef.current = stream;
      const mimeType = chooseRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        const duration = Math.max(1, recordingSecondsRef.current);
        const recorderMime = (recorder.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, {type: recorderMime});
        if (!blob.size) {
          setError(fr ? "Aucun son n’a été enregistré." : "No audio was recorded.");
          return;
        }
        if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
        const preview = URL.createObjectURL(blob);
        setVoicePreviewUrl(preview);
        const file = new File([blob], `message-vocal-${Date.now()}.${audioExtension(recorderMime)}`, {type: recorderMime});
        void handleFile(file, duration);
      };

      recorder.start(500);
      setRecording(true);
      timerRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        const next = recordingSecondsRef.current;
        setRecordingSeconds(next);
        if (next >= MAX_VOICE_SECONDS && recorder.state === "recording") recorder.stop();
      }, 1000);
    } catch (recordError) {
      console.error(recordError);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(fr ? "Impossible d’accéder au microphone. Vérifie l’autorisation du navigateur." : "Unable to access the microphone. Check your browser permission.");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }

  return (
    <form action={sendInternalMessageAction} className="shrink-0 border-t border-slate-200 bg-white p-2.5 sm:p-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="attachmentStoragePath" value={uploaded?.storagePath ?? ""} />
      <input type="hidden" name="attachmentFileName" value={uploaded?.fileName ?? ""} />
      <input type="hidden" name="attachmentMimeType" value={uploaded?.mimeType ?? ""} />
      <input type="hidden" name="attachmentSizeBytes" value={uploaded?.sizeBytes ?? ""} />
      <input type="hidden" name="voiceDurationSeconds" value={uploaded?.voiceDurationSeconds ?? ""} />
      <input type="hidden" name="mentionUserIds" value={activeMentionIds.join(",")} />

      {recording ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <div>
            <p className="font-black text-red-800">● {fr ? "Enregistrement en cours" : "Recording"}</p>
            <p className="text-sm text-red-700">{durationLabel(recordingSeconds)} / 5:00</p>
          </div>
          <button type="button" onClick={stopRecording} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-700">
            {fr ? "Arrêter" : "Stop"}
          </button>
        </div>
      ) : null}

      {uploaded ? (
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="truncate font-black text-indigo-950">{uploaded.voiceDurationSeconds ? (fr ? "Message vocal" : "Voice message") : uploaded.fileName}</p>
            <p className="text-xs text-indigo-700">{uploaded.voiceDurationSeconds ? `${durationLabel(uploaded.voiceDurationSeconds)} · ${sizeLabel(uploaded.sizeBytes)}` : sizeLabel(uploaded.sizeBytes)}</p>
            {uploaded.voiceDurationSeconds && voicePreviewUrl ? <audio controls preload="metadata" src={voicePreviewUrl} className="mt-2 w-full max-w-md" /> : null}
          </div>
          <button type="button" onClick={() => void removeAttachment()} className="shrink-0 rounded-lg px-3 py-1.5 font-black text-red-700 hover:bg-red-50">
            {fr ? "Retirer" : "Remove"}
          </button>
        </div>
      ) : null}

      {mentionQuery !== null && mentionSuggestions.length ? (
        <div className="mb-2 max-h-48 overflow-y-auto rounded-2xl border border-indigo-200 bg-white p-2 shadow-lg">
          <p className="px-2 pb-1 text-xs font-black uppercase tracking-wide text-indigo-700">{fr ? "Mentionner un collaborateur" : "Mention a colleague"}</p>
          {mentionSuggestions.map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => insertMention(candidate)} className="block w-full rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-indigo-50">
              @{candidate.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-[48px_48px_minmax(0,1fr)] items-end gap-2 sm:flex sm:gap-3">
        <label className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-300 bg-slate-50 text-xl text-slate-700 hover:bg-slate-100" title={fr ? "Ajouter une pièce jointe" : "Add an attachment"}>
          <span aria-hidden="true">＋</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx"
            disabled={uploading || recording}
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>
        <button
          type="button"
          onClick={() => recording ? stopRecording() : void startRecording()}
          disabled={uploading}
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border text-xl ${recording ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
          title={fr ? "Enregistrer un message vocal" : "Record a voice message"}
        >
          🎙️
        </button>
        <textarea
          ref={textareaRef}
          name="body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            updateMentionQuery(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => updateMentionQuery(body, event.currentTarget.selectionStart)}
          rows={2}
          maxLength={5000}
          placeholder={fr ? "Écris ton message… Utilise @ pour mentionner quelqu’un" : "Write your message… Use @ to mention someone"}
          className="order-first col-span-3 min-h-12 min-w-0 w-full resize-y rounded-2xl border border-slate-300 bg-white px-3 py-3 text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 sm:order-none sm:col-span-1 sm:flex-1 sm:px-4"
        />
        <button
          type="submit"
          disabled={uploading || recording}
          className="min-h-12 w-full shrink-0 rounded-xl bg-indigo-600 px-3 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5 sm:text-base"
        >
          {uploading ? (fr ? "Chargement…" : "Uploading…") : (fr ? "Envoyer" : "Send")}
        </button>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 break-words text-[11px] text-slate-500 sm:text-xs">
        <span>{fr ? "@ mentions · 🎙️ vocal jusqu’à 5 min · PDF, images et Word · 10 Mo max" : "@ mentions · 🎙️ voice up to 5 min · PDF, images and Word · 10 MB max"}</span>
        {error ? <span className="font-bold text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
