import {randomUUID} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";

export {PRIVATE_ATTACHMENTS_BUCKET};
export const MAX_STAFF_TRAINING_BYTES = 30 * 1024 * 1024;

export const STAFF_TRAINING_MIME_TYPES = new Set([
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

export type PendingStaffTrainingResource = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function cleanFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 140);
  return safe || "training-resource";
}

function validate(input: {fileName: string; mimeType: string; sizeBytes: number}) {
  if (!input.fileName.trim() || input.fileName.length > 180) throw new Error("Invalid file name.");
  if (!STAFF_TRAINING_MIME_TYPES.has(input.mimeType.toLowerCase())) throw new Error("Unsupported staff training file type.");
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_STAFF_TRAINING_BYTES) {
    throw new Error("Training resources must be 30 MB or smaller.");
  }
}

export function readPendingStaffTrainingResource(formData: FormData, prefix: string): PendingStaffTrainingResource | null {
  const storagePath = String(formData.get(`${prefix}StoragePath`) ?? "").trim();
  if (!storagePath) return null;
  const sizeBytes = Number(String(formData.get(`${prefix}SizeBytes`) ?? "0"));
  const pending = {
    storagePath,
    fileName: cleanFileName(String(formData.get(`${prefix}FileName`) ?? "training-resource")),
    mimeType: String(formData.get(`${prefix}MimeType`) ?? "").trim().toLowerCase(),
    sizeBytes: Number.isInteger(sizeBytes) ? sizeBytes : 0,
  };
  validate(pending);
  return pending;
}

export function buildStaffTrainingTemporaryPath(input: {organizationId: string; userId: string; fileName: string}) {
  return `${input.organizationId}/temp/${input.userId}/academy_training/${randomUUID()}-${cleanFileName(input.fileName)}`;
}

export async function finalizeStaffTrainingResource(input: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  recordId: string;
  pending: PendingStaffTrainingResource;
}) {
  validate(input.pending);
  const expected = `${input.organizationId}/temp/${input.userId}/academy_training/`;
  if (!input.pending.storagePath.startsWith(expected) || input.pending.storagePath.includes("..")) {
    throw new Error("Invalid temporary training resource path.");
  }

  const bucket = input.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET);
  const {data: info, error: infoError} = await bucket.info(input.pending.storagePath);
  if (infoError || !info) throw new Error(infoError?.message ?? "Uploaded training resource not found.");

  const actual = {
    fileName: input.pending.fileName,
    mimeType: String(info.contentType ?? input.pending.mimeType).toLowerCase(),
    sizeBytes: Number(info.size ?? input.pending.sizeBytes),
  };
  validate(actual);

  const finalPath = `${input.organizationId}/academy_training/${input.recordId}/${input.pending.storagePath.split("/").pop()}`;
  const {error: moveError} = await bucket.move(input.pending.storagePath, finalPath);
  if (moveError) throw new Error(moveError.message);

  return {...actual, storagePath: finalPath};
}

export async function removeStaffTrainingResource(admin: SupabaseClient, storagePath: string | null | undefined) {
  if (!storagePath) return;
  const {error} = await admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (error) console.error("Staff training resource cleanup failed", error);
}
