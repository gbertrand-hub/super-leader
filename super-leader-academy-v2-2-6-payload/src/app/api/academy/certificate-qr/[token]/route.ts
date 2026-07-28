import {getCertificateVerificationUrl} from "@/lib/academy/certificate-links";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fallbackSvg(message: string) {
  const safeMessage = message.replace(/[<>&"']/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
  <rect width="360" height="360" rx="24" fill="#ffffff"/>
  <rect x="12" y="12" width="336" height="336" rx="20" fill="none" stroke="#0f172a" stroke-width="8"/>
  <text x="180" y="166" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#0f172a">QR temporairement</text>
  <text x="180" y="198" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#0f172a">indisponible</text>
  <text x="180" y="236" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#475569">${safeMessage}</text>
</svg>`;
}

function providerUrls(verificationUrl: string): URL[] {
  const qrServer = new URL("https://api.qrserver.com/v1/create-qr-code/");
  qrServer.searchParams.set("size", "360x360");
  qrServer.searchParams.set("format", "svg");
  qrServer.searchParams.set("margin", "12");
  qrServer.searchParams.set("data", verificationUrl);

  const quickChart = new URL("https://quickchart.io/qr");
  quickChart.searchParams.set("size", "360");
  quickChart.searchParams.set("format", "svg");
  quickChart.searchParams.set("margin", "2");
  quickChart.searchParams.set("text", verificationUrl);

  return [qrServer, quickChart];
}

export async function GET(
  _request: Request,
  {params}: {params: Promise<{token: string}>},
) {
  const {token} = await params;
  if (!UUID_PATTERN.test(token)) {
    return new Response(fallbackSvg("Jeton invalide"), {
      status: 400,
      headers: {"content-type": "image/svg+xml; charset=utf-8"},
    });
  }

  const verificationUrl = getCertificateVerificationUrl(token);

  for (const providerUrl of providerUrls(verificationUrl)) {
    try {
      const upstream = await fetch(providerUrl, {
        headers: {accept: "image/svg+xml,image/*;q=0.8"},
        next: {revalidate: 604800},
      });
      if (!upstream.ok) continue;
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "image/svg+xml",
          "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      console.warn("Certificate QR provider failed", providerUrl.hostname, error);
    }
  }

  return new Response(fallbackSvg("Utilise le lien écrit"), {
    status: 503,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
