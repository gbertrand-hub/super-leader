import {randomUUID} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";

export const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type PendingProfileAvatar = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return safe || "avatar";
}

function parseSize(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function validateProfileAvatar(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  if (!input.fileName.trim() || input.fileName.length > 160) {
    throw new Error("Invalid avatar file name.");
  }
  if (!PROFILE_AVATAR_MIME_TYPES.has(input.mimeType)) {
    throw new Error("Unsupported avatar file type.");
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > PROFILE_AVATAR_MAX_BYTES
  ) {
    throw new Error("The avatar must be 2 MB or smaller.");
  }
}

export function buildTemporaryProfileAvatarPath(userId: string, fileName: string) {
  return `profiles/temp/${userId}/${randomUUID()}-${safeFileName(fileName)}`;
}

export function readPendingProfileAvatar(formData: FormData): PendingProfileAvatar | null {
  const storagePath = String(formData.get("avatarStoragePath") ?? "").trim();
  if (!storagePath) return null;
  return {
    storagePath,
    fileName: safeFileName(String(formData.get("avatarFileName") ?? "avatar")),
    mimeType: String(formData.get("avatarMimeType") ?? "").trim().toLowerCase(),
    sizeBytes: parseSize(formData.get("avatarSizeBytes")),
  };
}

export async function finalizeProfileAvatar({
  admin,
  userId,
  pending,
}: {
  admin: SupabaseClient;
  userId: string;
  pending: PendingProfileAvatar;
}) {
  validateProfileAvatar(pending);
  const prefix = `profiles/temp/${userId}/`;
  if (!pending.storagePath.startsWith(prefix) || pending.storagePath.includes("..")) {
    throw new Error("Invalid temporary avatar path.");
  }

  const bucket = admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET);
  const {data: info, error: infoError} = await bucket.info(pending.storagePath);
  if (infoError || !info) throw new Error(infoError?.message ?? "Uploaded avatar not found.");

  const actualSize = Number(info.size ?? pending.sizeBytes);
  const actualMimeType = String(info.contentType ?? pending.mimeType).toLowerCase();
  validateProfileAvatar({
    fileName: pending.fileName,
    mimeType: actualMimeType,
    sizeBytes: actualSize,
  });

  const finalPath = `profiles/${userId}/${randomUUID()}-${safeFileName(pending.fileName)}`;
  const {error: moveError} = await bucket.move(pending.storagePath, finalPath);
  if (moveError) throw new Error(moveError.message);

  return {
    storagePath: finalPath,
    fileName: pending.fileName,
    mimeType: actualMimeType,
    sizeBytes: actualSize,
  };
}

export async function removeProfileAvatar(
  admin: SupabaseClient,
  storagePath: string | null | undefined,
) {
  if (!storagePath || !storagePath.startsWith("profiles/")) return;
  const {error} = await admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (error) console.error("Profile avatar cleanup failed", error);
}

export async function createProfileAvatarSignedUrl(
  admin: SupabaseClient,
  storagePath: string | null | undefined,
  expiresIn = 3600,
) {
  if (!storagePath || !storagePath.startsWith("profiles/")) return null;
  const {data, error} = await admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
