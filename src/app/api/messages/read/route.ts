import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({error: "Unauthorized"}, {status: 401});

  let input: {conversationId?: string};
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({error: "Invalid request"}, {status: 400});
  }
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) return NextResponse.json({error: "Missing conversation"}, {status: 400});

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const {data: conversationMember} = await admin
    .from("internal_conversation_members")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("conversation_id", conversationId)
    .eq("user_id", authData.user.id)
    .is("left_at", null)
    .maybeSingle<{id: string}>();
  if (!conversationMember) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const now = new Date().toISOString();
  const [{error: receiptError}, {error: memberError}] = await Promise.all([
    admin
      .from("internal_message_receipts")
      .update({read_at: now})
      .eq("organization_id", membership.organization_id)
      .eq("conversation_id", conversationId)
      .eq("user_id", authData.user.id)
      .is("read_at", null),
    admin
      .from("internal_conversation_members")
      .update({last_read_at: now})
      .eq("organization_id", membership.organization_id)
      .eq("conversation_id", conversationId)
      .eq("user_id", authData.user.id),
  ]);

  if (receiptError || memberError) {
    return NextResponse.json({error: receiptError?.message ?? memberError?.message ?? "Unable to mark messages as read"}, {status: 500});
  }

  return NextResponse.json({success: true}, {headers: {"Cache-Control": "no-store"}});
}
