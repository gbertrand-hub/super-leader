import {getI18n} from "@/i18n/server";
import {hrDailyReportsCopy} from "@/i18n/hr-daily-reports";
import {loadHrDailyReports} from "@/lib/performance/hr-daily-reports";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const allowedRoles = new Set(["owner", "admin", "hr"]);
type Membership = {organization_id: string; role: string};

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(values: Array<string | number>) {
  return values.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) return new Response("Unauthorized", {status: 401});

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError || !membership || !allowedRoles.has(membership.role)) return new Response("Forbidden", {status: 403});

  const url = new URL(request.url);
  const data = await loadHrDailyReports({
    admin,
    organizationId: membership.organization_id,
    filters: {
      date: url.searchParams.get("date"),
      status: url.searchParams.get("status"),
      team: url.searchParams.get("team"),
      department: url.searchParams.get("department"),
      manager: url.searchParams.get("manager"),
      search: url.searchParams.get("search"),
      quick: url.searchParams.get("quick"),
    },
  });
  const {locale} = await getI18n();
  const copy = hrDailyReportsCopy(locale);

  const rows = [
    csvRow([copy.title, data.date]),
    "",
    csvRow([copy.expected, data.metrics.expected]),
    csvRow([copy.submitted, data.metrics.submitted]),
    csvRow([copy.pending, data.metrics.pending]),
    csvRow([copy.missing, data.metrics.missing]),
    csvRow([copy.submittedLate, data.metrics.submittedLate]),
    csvRow([copy.reviewRequired, data.metrics.reviewRequired]),
    csvRow([copy.noPlan, data.metrics.noPlan]),
    "",
    csvRow([
      copy.employee,
      "Email",
      "Role",
      copy.department,
      copy.team,
      copy.manager,
      copy.schedule,
      copy.attendance,
      copy.priorities,
      copy.report,
      "Submitted at",
      copy.results,
    ]),
  ];

  data.rows.forEach((row) => {
    rows.push(csvRow([
      row.fullName,
      row.email,
      copy.roles[row.role as keyof typeof copy.roles] ?? row.role,
      row.departments.join(" | "),
      row.teamNames.join(" | "),
      row.managerNames.join(" | "),
      row.expected ? `${row.startTime?.slice(0, 5) ?? ""}-${row.endTime?.slice(0, 5) ?? ""}; ${copy.reportDeadline} ${row.deadline}` : (row.leaveType ? copy.leave : copy.off),
      row.attendance ? (copy.attendanceStates[row.attendance.status as keyof typeof copy.attendanceStates] ?? row.attendance.status) : copy.noAttendance,
      `${row.taskCount} ${copy.tasks}; ${row.completedTaskCount} ${copy.completed}; ${row.blockedTaskCount} ${copy.blocked}`,
      copy.reportStates[row.reportState],
      row.report?.submitted_at ?? "",
      row.report?.results ?? "",
    ]));
  });

  return new Response(`\uFEFF${rows.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="super-leader-rapports-journee-${data.date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
