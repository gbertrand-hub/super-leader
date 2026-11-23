import {NextResponse} from "next/server";
import {canViewStaffTrainingResults, loadStaffTrainingResults} from "@/lib/academy/staff-training-results";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string; is_active: boolean};

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const courseId = url.searchParams.get("course")?.trim() || "";
  const search = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const requestedStatus = url.searchParams.get("status") || "all";
  const statusFilter = new Set(["validated", "in_progress", "not_started"]).has(requestedStatus) ? requestedStatus : "all";
  if (!courseId) return NextResponse.json({error: "course-required"}, {status: 400});

  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({error: "unauthorized"}, {status: 401});

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership || !canViewStaffTrainingResults(membership.role)) return NextResponse.json({error: "forbidden"}, {status: 403});

  const data = await loadStaffTrainingResults({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role, courseId});
  if (!data) return NextResponse.json({error: "training-not-found"}, {status: 404});

  const participants = data.participants.filter((participant) => {
    if (statusFilter !== "all" && participant.status !== statusFilter) return false;
    if (!search) return true;
    return `${participant.fullName} ${participant.email} ${participant.role}`.toLowerCase().includes(search);
  });

  const headers = ["Participant", "Email", "Role", "Status", "Progression (%)"];
  for (const quiz of data.quizzes) headers.push(`${quiz.module_label} - meilleur score (%)`, `${quiz.module_label} - tentatives`, `${quiz.module_label} - reussi`);
  headers.push("Tentatives totales", "Derniere tentative (UTC)");

  const rows = participants.map((participant) => {
    const cells: Array<string | number> = [participant.fullName, participant.email, participant.role, participant.status, participant.progressPercent];
    for (const result of participant.quizResults) cells.push(result.bestScore ?? "", result.attempts, result.passed ? "OUI" : "NON");
    cells.push(participant.totalAttempts, participant.lastAttemptAt ?? "");
    return cells;
  });
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const safeTitle = data.course.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "staff-training";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle}-quiz-results.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
