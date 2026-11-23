import {randomUUID} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";

export {PRIVATE_ATTACHMENTS_BUCKET};
export const MAX_HR_DOCUMENT_BYTES = 30 * 1024 * 1024;

export const HR_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type PendingHrDocument = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function cleanFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 140);
  return safe || "hr-document";
}

export function validateHrDocumentFile(input: {fileName: string; mimeType: string; sizeBytes: number}) {
  if (!input.fileName.trim() || input.fileName.length > 180) throw new Error("Nom de fichier invalide.");
  if (!HR_DOCUMENT_MIME_TYPES.has(input.mimeType.toLowerCase())) throw new Error("Format de document RH non pris en charge.");
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_HR_DOCUMENT_BYTES) {
    throw new Error("Le document RH doit faire 30 Mo ou moins.");
  }
}

export function readPendingHrDocument(formData: FormData, prefix = "document"): PendingHrDocument | null {
  const storagePath = String(formData.get(`${prefix}StoragePath`) ?? "").trim();
  if (!storagePath) return null;
  const sizeBytes = Number(String(formData.get(`${prefix}SizeBytes`) ?? "0"));
  const pending = {
    storagePath,
    fileName: cleanFileName(String(formData.get(`${prefix}FileName`) ?? "hr-document")),
    mimeType: String(formData.get(`${prefix}MimeType`) ?? "").trim().toLowerCase(),
    sizeBytes: Number.isInteger(sizeBytes) ? sizeBytes : 0,
  };
  validateHrDocumentFile(pending);
  return pending;
}

export function buildHrDocumentTemporaryPath(input: {organizationId: string; userId: string; fileName: string}) {
  return `${input.organizationId}/temp/${input.userId}/hr_documents/${randomUUID()}-${cleanFileName(input.fileName)}`;
}

export async function finalizeHrDocument(input: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  documentId: string;
  pending: PendingHrDocument;
}) {
  validateHrDocumentFile(input.pending);
  const expected = `${input.organizationId}/temp/${input.userId}/hr_documents/`;
  if (!input.pending.storagePath.startsWith(expected) || input.pending.storagePath.includes("..")) {
    throw new Error("Chemin temporaire du document RH invalide.");
  }
  const bucket = input.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET);
  const {data: info, error: infoError} = await bucket.info(input.pending.storagePath);
  if (infoError || !info) throw new Error(infoError?.message ?? "Document téléversé introuvable.");
  const actual = {
    fileName: input.pending.fileName,
    mimeType: String(info.contentType ?? input.pending.mimeType).toLowerCase(),
    sizeBytes: Number(info.size ?? input.pending.sizeBytes),
  };
  validateHrDocumentFile(actual);
  const finalPath = `${input.organizationId}/hr_documents/${input.documentId}/${input.pending.storagePath.split("/").pop()}`;
  const {error: moveError} = await bucket.move(input.pending.storagePath, finalPath);
  if (moveError) throw new Error(moveError.message);
  return {...actual, storagePath: finalPath};
}

export async function removeHrDocument(admin: SupabaseClient, storagePath: string | null | undefined) {
  if (!storagePath) return;
  const {error} = await admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (error) console.error("HR document cleanup failed", error);
}

