import Link from "next/link";
import { redirect } from "next/navigation";
import { submitPeerFeedbackAction } from "@/app/actions/feedback";
import { getI18n } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const categories = [
  "communication",
  "collaboration",
  "leadership",
  "fiabilite",
  "organisation",
  "qualite",
  "service_client",
  "innovation",
  "autre",
] as const;

type PageProps = {
  searchParams?: Promise<{ success?: string; error?: string }>;
};

export default async function FeedbackPage({ searchParams }: PageProps) {
  const { t, locale } = await getI18n();
  const params = (await searchParams) ?? {};
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/company");

  const admin = createAdminClient();
  const [
    { data: orgMembers },
    { data: profiles },
    { data: received },
    { data: sent },
  ] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true),
    admin.from("profiles").select("id, full_name, email"),
    admin
      .from("peer_feedback")
      .select(
        "id, sender_id, category, score, strength, improvement, is_anonymous, created_at",
      )
      .eq("organization_id", membership.organization_id)
      .eq("recipient_id", data.user.id)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
    admin
      .from("peer_feedback")
      .select("id, recipient_id, category, score, created_at")
      .eq("organization_id", membership.organization_id)
      .eq("sender_id", data.user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const colleagues = (orgMembers ?? [])
    .filter((member) => member.user_id !== data.user.id)
    .map((member) => ({ ...member, profile: profileMap.get(member.user_id) }))
    .sort((a, b) =>
      (a.profile?.full_name ?? a.profile?.email ?? "").localeCompare(
        b.profile?.full_name ?? b.profile?.email ?? "",
      ),
    );

  const average = received?.length
    ? (received.reduce((sum, item) => sum + item.score, 0) / received.length).toFixed(1)
    : "0.0";
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
            {t("feedback.eyebrow")}
          </p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-black">{t("feedback.title")}</h1>
              <p className="mt-2 text-slate-300">{t("feedback.subtitle")}</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-5 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-300">
                {t("feedback.averageReceived")}
              </p>
              <p className="text-3xl font-black text-amber-400">{average} / 5</p>
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
            action={submitPeerFeedbackAction}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-2xl font-black">{t("feedback.give")}</h2>
            {colleagues.length === 0 ? (
              <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                {t("feedback.inviteFirst")}
              </p>
            ) : (
              <div className="mt-5 space-y-5">
                <label className="block font-bold">
                  {t("feedback.colleague")}
                  <select
                    name="recipientId"
                    required
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
                  >
                    <option value="">{t("feedback.selectPerson")}</option>
                    {colleagues.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.profile?.full_name ||
                          member.profile?.email ||
                          t("common.member")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block font-bold">
                  {t("feedback.category")}
                  <select
                    name="category"
                    required
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
                  >
                    {categories.map((value) => (
                      <option key={value} value={value}>
                        {t(`feedback.categories.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset>
                  <legend className="font-bold">{t("feedback.score")}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <label key={score} className="cursor-pointer">
                        <input
                          className="peer sr-only"
                          type="radio"
                          name="score"
                          value={score}
                          required
                        />
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 font-black peer-checked:border-amber-400 peer-checked:bg-amber-400">
                          {score}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block font-bold">
                  {t("feedback.strength")}
                  <textarea
                    name="strength"
                    required
                    minLength={3}
                    maxLength={1000}
                    rows={4}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                    placeholder={t("feedback.strengthPlaceholder")}
                  />
                </label>

                <label className="block font-bold">
                  {t("feedback.improvement")} {" "}
                  <span className="font-normal text-slate-500">
                    ({t("common.optional")})
                  </span>
                  <textarea
                    name="improvement"
                    maxLength={1000}
                    rows={4}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
                    placeholder={t("feedback.improvementPlaceholder")}
                  />
                </label>

                <label className="flex items-center gap-3 rounded-xl bg-slate-100 p-4">
                  <input
                    type="checkbox"
                    name="isAnonymous"
                    value="true"
                    defaultChecked
                    className="h-5 w-5"
                  />
                  <span>
                    <strong>{t("feedback.anonymous")}</strong>
                    <br />
                    <span className="text-sm text-slate-600">
                      {t("feedback.anonymousHelp")}
                    </span>
                  </span>
                </label>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-black text-white hover:bg-indigo-700"
                >
                  {t("feedback.send")}
                </button>
              </div>
            )}
          </form>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-black">{t("feedback.received")}</h2>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">
                  {received?.length ?? 0}
                </span>
              </div>
              <div className="mt-5 space-y-4">
                {!received?.length ? (
                  <p className="rounded-xl bg-slate-50 p-5 text-slate-600">
                    {t("feedback.noneReceived")}
                  </p>
                ) : (
                  received.map((item) => {
                    const sender = profileMap.get(item.sender_id);
                    return (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-slate-200 p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black">
                              {t(`feedback.categories.${item.category}`)}
                            </p>
                            <p className="text-sm text-slate-500">
                              {item.is_anonymous
                                ? t("feedback.anonymousFeedback")
                                : sender?.full_name ||
                                  sender?.email ||
                                  t("common.colleague")}
                            </p>
                          </div>
                          <p className="text-xl font-black text-amber-500">
                            {"★".repeat(item.score)}
                            <span className="text-slate-200">
                              {"★".repeat(5 - item.score)}
                            </span>
                          </p>
                        </div>
                        <p className="mt-4 font-semibold text-emerald-800">
                          {t("feedback.strengthTitle")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-slate-700">
                          {item.strength}
                        </p>
                        {item.improvement ? (
                          <>
                            <p className="mt-4 font-semibold text-indigo-800">
                              {t("feedback.suggestion")}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-slate-700">
                              {item.improvement}
                            </p>
                          </>
                        ) : null}
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
              <h2 className="text-xl font-black">{t("feedback.recentSent")}</h2>
              <div className="mt-4 space-y-3">
                {!sent?.length ? (
                  <p className="text-slate-600">{t("feedback.noneSent")}</p>
                ) : (
                  sent.map((item) => {
                    const recipient = profileMap.get(item.recipient_id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
                      >
                        <div>
                          <p className="font-bold">
                            {recipient?.full_name ||
                              recipient?.email ||
                              t("common.colleague")}
                          </p>
                          <p className="text-sm text-slate-500">
                            {t(`feedback.categories.${item.category}`)}
                          </p>
                        </div>
                        <p className="font-black text-amber-500">{item.score}/5</p>
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
