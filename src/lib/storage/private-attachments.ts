import {randomUUID} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";

export const PRIVATE_ATTACHMENTS_BUCKET = "super-leader-private";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type AttachmentPurpose = "leave" | "sale" | "payment";

export type PendingAttachment = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type FinalizedAttachment = PendingAttachment;

function cleanFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return safe || "document";
}

function parseSize(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function readPendingAttachment(formData: FormData, prefix: string): PendingAttachment | null {
  const storagePath = String(formData.get(`${prefix}StoragePath`) ?? "").trim();
  if (!storagePath) return null;

  return {
    storagePath,
    fileName: cleanFileName(String(formData.get(`${prefix}FileName`) ?? "document")),
    mimeType: String(formData.get(`${prefix}MimeType`) ?? "").trim().toLowerCase(),
    sizeBytes: parseSize(formData.get(`${prefix}SizeBytes`)),
  };
}

export function validateAttachmentInput({
  fileName,
  mimeType,
  sizeBytes,
}: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  if (!fileName.trim() || fileName.length > 180) {
    throw new Error("Invalid file name.");
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new Error("Unsupported file type.");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error("The file must be 10 MB or smaller.");
  }
}

export function buildTemporaryAttachmentPath({
  organizationId,
  userId,
  purpose,
  fileName,
}: {
  organizationId: string;
  userId: string;
  purpose: AttachmentPurpose;
  fileName: string;
}) {
  const safeName = cleanFileName(fileName);
  return `${organizationId}/temp/${userId}/${purpose}/${randomUUID()}-${safeName}`;
}

function expectedTemporaryPrefix(organizationId: string, userId: string, purpose: AttachmentPurpose) {
  return `${organizationId}/temp/${userId}/${purpose}/`;
}

export async function finalizeTemporaryAttachment({
  admin,
  organizationId,
  userId,
  purpose,
  recordId,
  pending,
}: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  purpose: AttachmentPurpose;
  recordId: string;
  pending: PendingAttachment;
}): Promise<FinalizedAttachment> {
  validateAttachmentInput(pending);

  const prefix = expectedTemporaryPrefix(organizationId, userId, purpose);
  if (!pending.storagePath.startsWith(prefix) || pending.storagePath.includes("..")) {
    throw new Error("Invalid temporary attachment path.");
  }

  const bucket = admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET);
  const {data: info, error: infoError} = await bucket.info(pending.storagePath);
  if (infoError || !info) {
    throw new Error(infoError?.message ?? "Uploaded file not found.");
  }

  const actualSize = Number(info.size ?? pending.sizeBytes);
  const actualMimeType = String(info.contentType ?? pending.mimeType).toLowerCase();
  validateAttachmentInput({fileName: pending.fileName, mimeType: actualMimeType, sizeBytes: actualSize});

  const finalPath = `${organizationId}/${purpose}/${recordId}/${pending.storagePath.split("/").pop()}`;
  const {error: moveError} = await bucket.move(pending.storagePath, finalPath);
  if (moveError) throw new Error(moveError.message);

  return {
    storagePath: finalPath,
    fileName: pending.fileName,
    mimeType: actualMimeType,
    sizeBytes: actualSize,
  };
}

export async function removePrivateAttachment(admin: SupabaseClient, storagePath: string | null | undefined) {
  if (!storagePath) return;
  const {error} = await admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (error) console.error("Attachment cleanup failed", error);
}
