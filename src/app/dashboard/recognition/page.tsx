import Link from "next/link";
import { redirect } from "next/navigation";
import { sendRecognitionAction } from "@/app/actions/recognition";
import { getI18n } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const badges = [
  "leadership",
  "teamwork",
  "service",
  "innovation",
  "reliability",
  "communication",
  "courage",
  "excellence",
] as const;

const badgeIcons: Record<string, string> = {
  leadership: "🏆",
  teamwork: "🤝",
  service: "⭐",
  innovation: "💡",
  reliability: "🛡️",
  communication: "💬",
  courage: "🦁",
  excellence: "🎯",
};

type PageProps = {
  searchParams?: Promise<{ success?: string; error?: string }>;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type Recognition = {
  id: string;
  sender_id: string;
  recipient_id: string;
  badge: string;
  message: string;
  visibility: string;
  created_at: string;
};

export default async function RecognitionPage({ searchParams }: PageProps) {
  const { t, locale } = await getI18n();
  const params = (await searchParams) ?? {};
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) redirect("/dashboard/company");

  const [membersResult, profilesResult, receivedResult, sentResult] =
    await Promise.all([
      admin
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true),
      admin.from("profiles").select("id, full_name, email"),
      admin
        .from("recognitions")
        .select("id,sender_id,recipient_id,badge,message,visibility,created_at")
        .eq("organization_id", membership.organization_id)
        .eq("recipient_id", authData.user.id)
        .order("created_at", { ascending: false }),
      admin
        .from("recognitions")
        .select("id,sender_id,recipient_id,badge,message,visibility,created_at")
        .eq("organization_id", membership.organization_id)
        .eq("sender_id", authData.user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const profiles = (profilesResult.data ?? []) as Profile[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const colleagues = (membersResult.data ?? [])
    .filter((member) => member.user_id !== authData.user.id)
    .map((member) => ({ ...member, profile: profileMap.get(member.user_id) }))
    .sort((a, b) =>
      (a.profile?.full_name ?? a.profile?.email ?? "").localeCompare(
        b.profile?.full_name ?? b.profile?.email ?? "",
      ),
    );

  const received = (receivedResult.data ?? []) as Recognition[];
  const sent = (sentResult.data ?? []) as Recognition[];
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/dashboard"
          className="font-bold text-indigo-600 hover:text-indigo-800"
        >
          ← {t("common.backToDashboard")}
        </Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-wider text-amber-400">
            {t("recognition.eyebrow")}
          </p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-black">{t("recognition.title")}</h1>
              <p className="mt-2 text-slate-300">{t("recognition.subtitle")}</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-5 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-300">
                {t("recognition.receivedCount")}
              </p>
              <p className="text-3xl font-black text-amber-400">{received.length}</p>
            </div>
          </div>
        </header>

        {params.success ? (
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-800">
            {params.success}
          </p>
        ) : null}
        {params.error ? (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-700">
            {params.error}
          </p>
        ) : null}

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form
            action={sendRecognitionAction}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-2xl font-black">{t("recognition.congratulate")}</h2>

            {colleagues.length === 0 ? (
              <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                {t("recognition.inviteFirst")}
              </p>
            ) : (
              <div className="mt-5 space-y-5">
                <label className="block font-bold">
                  {t("recognition.recipient")}
                  <select
                    name="recipientId"
                    required
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
                  >
                    <option value="">{t("recognition.selectPerson")}</option>
                    {colleagues.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.profile?.full_name ||
                          member.profile?.email ||
                          t("common.member")}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset>
                  <legend className="font-bold">{t("recognition.badge")}</legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {badges.map((value) => (
                      <label key={value} className="cursor-pointer">
                        <input
                          className="peer sr-only"
                          type="radio"
                          name="badge"
                          value={value}
                          required
                        />
                        <span className="flex min-h-20 items-center gap-3 rounded-2xl border border-slate-200 p-4 peer-checked:border-amber-400 peer-checked:bg-amber-50">
                          <span className="text-2xl">{badgeIcons[value]}</span>
                          <span className="font-bold">
                            {t(`recognition.badges.${value}`)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block font-bold">
                  {t("recognition.message")}
                  <textarea
                    name="message"
                    required
                    minLength={3}
                    maxLength={600}
                    rows={5}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                    placeholder={t("recognition.messagePlaceholder")}
                  />
                </label>

                <label className="block font-bold">
                  {t("recognition.visibility")}
                  <select
                    name="visibility"
                    defaultValue="private"
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
                  >
                    <option value="private">{t("recognition.privateOption")}</option>
                    <option value="team">{t("recognition.teamOption")}</option>
                  </select>
                </label>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 hover:bg-amber-400"
                >
                  {t("recognition.send")}
                </button>
              </div>
            )}
          </form>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-black">{t("recognition.received")}</h2>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
                  {received.length}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                {received.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-5 text-slate-600">
                    {t("recognition.noneReceived")}
                  </p>
                ) : (
                  received.map((item) => {
                    const sender = profileMap.get(item.sender_id);
                    const senderName =
                      sender?.full_name || sender?.email || t("common.colleague");
                    return (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="text-3xl">
                              {badgeIcons[item.badge] ?? "⭐"}
                            </span>
                            <div>
                              <p className="font-black">
                                {t(`recognition.badges.${item.badge}`)}
                              </p>
                              <p className="text-sm text-slate-500">
                                {t("recognition.from", { name: senderName })}
                              </p>
                            </div>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase text-slate-600">
                            {item.visibility === "team"
                              ? t("common.team")
                              : t("common.private")}
                          </span>
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-slate-700">
                          {item.message}
                        </p>
                        <p className="mt-4 text-xs text-slate-400">
                          {new Date(item.created_at).toLocaleDateString(dateLocale)}
                        </p>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{t("recognition.recentSent")}</h2>
              <div className="mt-4 space-y-3">
                {sent.length === 0 ? (
                  <p className="text-slate-600">{t("recognition.noneSent")}</p>
                ) : (
                  sent.map((item) => {
                    const recipient = profileMap.get(item.recipient_id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">
                            {badgeIcons[item.badge] ?? "⭐"}
                          </span>
                          <div>
                            <p className="font-bold">
                              {recipient?.full_name ||
                                recipient?.email ||
                                t("common.colleague")}
                            </p>
                            <p className="text-sm text-slate-500">
                              {t(`recognition.badges.${item.badge}`)}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs font-semibold text-slate-400">
                          {new Date(item.created_at).toLocaleDateString(dateLocale)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
