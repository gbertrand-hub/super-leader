import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {getProviderPortalContext, requireProviderContract} from "@/lib/contracts/provider-portal-access";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  PRIVATE_ATTACHMENTS_BUCKET,
} from "@/lib/storage/private-attachments";

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return safe || "document";
}

export async function POST(request: Request) {
  const context = await getProviderPortalContext({redirectIfMissing: false});
  if (!context) return NextResponse.json({error: "Unauthorized"}, {status: 401});

  let input: {contractId?: string; fileName?: string; mimeType?: string; sizeBytes?: number};
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({error: "Invalid request"}, {status: 400});
  }

  const contractId = String(input.contractId ?? "").trim();
  const fileName = safeFileName(String(input.fileName ?? "").trim());
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? 0);

  if (!contractId) return NextResponse.json({error: "Missing contract"}, {status: 400});
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({error: "Unsupported file type"}, {status: 400});
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({error: "File must be 10 MB or smaller"}, {status: 400});
  }

  try {
    const contract = await requireProviderContract(context, contractId);
    const path = `${contract.organization_id}/temp/${context.userId}/provider-portal/${contract.id}/${randomUUID()}-${fileName}`;
    const {data, error} = await context.admin.storage
      .from(PRIVATE_ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(path, {upsert: false});
    if (error || !data) {
      return NextResponse.json({error: error?.message ?? "Unable to prepare upload"}, {status: 500});
    }
    return NextResponse.json({
      bucket: PRIVATE_ATTACHMENTS_BUCKET,
      path: data.path,
      token: data.token,
      maxBytes: MAX_ATTACHMENT_BYTES,
      allowedMimeTypes: [...ALLOWED_ATTACHMENT_MIME_TYPES],
    }, {status: 201, headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "Forbidden"}, {status: 403});
  }
}

export async function DELETE(request: Request) {
  const context = await getProviderPortalContext({redirectIfMissing: false});
  if (!context) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  let input: {path?: string};
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({error: "Invalid request"}, {status: 400});
  }
  const path = String(input.path ?? "").trim();
  const allowedPrefix = context.links.some((link) => path.startsWith(`${link.organization_id}/temp/${context.userId}/provider-portal/`));
  if (!allowedPrefix || path.includes("..")) return NextResponse.json({error: "Invalid path"}, {status: 400});
  await context.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([path]);
  return new NextResponse(null, {status: 204});
}
