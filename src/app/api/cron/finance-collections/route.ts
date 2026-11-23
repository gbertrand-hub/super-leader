import {NextResponse} from "next/server";
import {verifyCronRequest} from "@/lib/crm/webhook-security";
import {processFinanceCollectionAutomation} from "@/lib/finance/collection-automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ok: false, error: "Unauthorized"}, {status: 401});
  }

  try {
    const result = await processFinanceCollectionAutomation();
    return NextResponse.json({ok: true, ...result});
  } catch (error) {
    console.error("Finance collection automation cron failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Finance collection automation failed.",
    }, {status: 500});
  }
}
