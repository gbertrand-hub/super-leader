import { NextResponse } from "next/server";
import { getSupabasePublicConfig, getSiteUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { url, publishableKey } = getSupabasePublicConfig();
    const parsed = new URL(url);

    const response = await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: publishableKey,
      },
    });

    const body = (await response.text()).slice(0, 300);

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      supabaseHostname: parsed.hostname,
      supabaseProtocol: parsed.protocol,
      supabaseUrlLength: url.length,
      keyPrefix: publishableKey.slice(0, 15),
      keyLength: publishableKey.length,
      siteUrl: getSiteUrl(),
      response: body,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
