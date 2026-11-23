import {redirect} from "next/navigation";

export default function DailyReportAutoRemindersLegacyPage() {
  redirect("/dashboard/performance?view=settings#daily-report-reminders");
}
