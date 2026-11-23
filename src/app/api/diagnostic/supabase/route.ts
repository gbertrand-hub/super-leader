import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await createClient();
  const {data: authData, error: authError} = await session.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ok: false, status: "unauthorized"}, {status: 401});
  }

  try {
    const admin = createAdminClient();
    const {data: membership} = await admin
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{organization_id: string; role: string}>();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ok: false, status: "forbidden"}, {status: 403});
    }

    const startedAt = Date.now();
    const result = await admin
      .from("organizations")
      .select("id", {count: "exact", head: true})
      .eq("id", membership.organization_id);

    return NextResponse.json({
      ok: !result.error,
      status: result.error ? "unavailable" : "healthy",
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }, {status: result.error ? 503 : 200});
  } catch {
    return NextResponse.json({
      ok: false,
      status: "unavailable",
      checkedAt: new Date().toISOString(),
    }, {status: 503});
  }
}
