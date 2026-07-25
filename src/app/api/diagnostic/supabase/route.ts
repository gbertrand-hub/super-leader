import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import {
  getSiteUrl,
  getSupabasePublicConfig,
} from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const cause = error.cause as
    | {
        name?: string;
        message?: string;
        code?: string;
        errno?: string | number;
        syscall?: string;
        hostname?: string;
        address?: string;
        port?: number;
      }
    | undefined;

  return {
    name: error.name,
    message: error.message,
    cause: cause
      ? {
          name: cause.name,
          message: cause.message,
          code: cause.code,
          errno: cause.errno,
          syscall: cause.syscall,
          hostname: cause.hostname,
          address: cause.address,
          port: cause.port,
        }
      : null,
  };
}

export async function GET() {
  let url = "";
  let publishableKey = "";
  let hostname = "";

  try {
    const config = getSupabasePublicConfig();
    url = config.url;
    publishableKey = config.publishableKey;
    hostname = new URL(url).hostname;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "configuration",
        error: errorDetails(error),
      },
      { status: 500 },
    );
  }

  let ipv4: string[] = [];
  let ipv6: string[] = [];
  let dns4Error: ReturnType<typeof errorDetails> | null = null;
  let dns6Error: ReturnType<typeof errorDetails> | null = null;

  try {
    ipv4 = await resolve4(hostname);
  } catch (error) {
    dns4Error = errorDetails(error);
  }

  try {
    ipv6 = await resolve6(hostname);
  } catch (error) {
    dns6Error = errorDetails(error);
  }

  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Accept: "application/json",
      },
    });

    const body = (await response.text()).slice(0, 500);

    return NextResponse.json({
      ok: response.ok,
      stage: "health-fetch",
      status: response.status,
      supabaseHostname: hostname,
      supabaseProtocol: new URL(url).protocol,
      supabaseUrlLength: url.length,
      supabaseUrlStartsCorrectly: url.startsWith("https://"),
      hostnameEndsWithSupabase: hostname.endsWith(".supabase.co"),
      keyPrefix: publishableKey.slice(0, 15),
      keyLength: publishableKey.length,
      siteUrl: getSiteUrl(),
      ipv4,
      ipv6,
      dns4Error,
      dns6Error,
      response: body,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "health-fetch",
        supabaseHostname: hostname,
        supabaseProtocol: new URL(url).protocol,
        supabaseUrlLength: url.length,
        supabaseUrlStartsCorrectly: url.startsWith("https://"),
        hostnameEndsWithSupabase: hostname.endsWith(".supabase.co"),
        keyPrefix: publishableKey.slice(0, 15),
        keyLength: publishableKey.length,
        siteUrl: getSiteUrl(),
        ipv4,
        ipv6,
        dns4Error,
        dns6Error,
        error: errorDetails(error),
      },
      { status: 500 },
    );
  }
}
