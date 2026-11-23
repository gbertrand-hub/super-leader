import {HelpGuideBrowser} from "@/components/help-center/help-guide-browser";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";
import {guidesForRole} from "@/lib/help-center/guides";

export default async function HelpCenterPage() {
  const [{locale, t}, context] = await Promise.all([getI18n(), requireAccessContext()]);
  const fr = locale === "fr";
  const guides = guidesForRole(context.role);
  const isAdmin = ["owner", "admin"].includes(context.role);
  const [{data: progressData}, {data: feedbackData}, adminProgress, adminFeedback] = await Promise.all([
    context.admin.from("help_guide_progress").select("guide_id,status").eq("organization_id", context.organizationId).eq("user_id", context.user.id),
    context.admin.from("help_guide_feedback").select("guide_id,helpful,comment").eq("organization_id", context.organizationId).eq("user_id", context.user.id),
    isAdmin ? context.admin.from("help_guide_progress").select("guide_id,status,user_id").eq("organization_id", context.organizationId) : Promise.resolve({data: []}),
    isAdmin ? context.admin.from("help_guide_feedback").select("guide_id,helpful,comment,user_id,updated_at").eq("organization_id", context.organizationId).order("updated_at", {ascending: false}).limit(20) : Promise.resolve({data: []}),
  ]);
  const progress = (progressData ?? []) as Array<{guide_id: string; status: "in_progress" | "completed"}>;
  const feedback = (feedbackData ?? []) as Array<{guide_id: string; helpful: boolean; comment: string | null}>;
  const completed = progress.filter(row => row.status === "completed").length;
  const percent = guides.length ? Math.round((completed / guides.length) * 100) : 0;
  const allProgress = adminProgress.data ?? [];
  const allFeedback = adminFeedback.data ?? [];
  const positive = allFeedback.filter(row => row.helpful).length;

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 p-7 text-white shadow-xl sm:p-9">
        <div className="max-w-4xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">{fr ? "Assistance intégrée · V4.8.3" : "Built-in assistance · V4.8.3"}</p><h1 className="mt-3 text-3xl font-black sm:text-4xl">{fr ? "Centre d’aide à l’utilisateur" : "User help centre"}</h1><p className="mt-3 max-w-3xl leading-7 text-indigo-100">{fr ? "Des tutoriels courts et concrets pour accomplir correctement les tâches dans Super Leader. Le contenu affiché est adapté à ton rôle et à tes responsabilités." : "Short, practical tutorials for completing tasks correctly in Super Leader. The displayed content is tailored to your role and responsibilities."}</p></div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/15 bg-white/10 p-4"><p className="text-2xl font-black">{guides.length}</p><p className="mt-1 text-xs font-bold text-indigo-100">{fr ? "tutoriels pour ton rôle" : "tutorials for your role"}</p></div><div className="rounded-2xl border border-white/15 bg-white/10 p-4"><p className="text-sm font-black">{t(`roles.${context.role}`)}</p><p className="mt-1 text-xs font-bold text-indigo-100">{fr ? "parcours personnalisé" : "personalised path"}</p></div><div className="rounded-2xl border border-white/15 bg-white/10 p-4"><p className="text-2xl font-black">{percent} %</p><p className="mt-1 text-xs font-bold text-indigo-100">{completed}/{guides.length} {fr ? "tutoriels terminés" : "tutorials completed"}</p></div></div>
      </header>

      <section className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950"><p className="font-black">{fr ? "Centre d’aide ≠ Super Leader Academy" : "Help centre ≠ Super Leader Academy"}</p><p className="mt-1 text-sm leading-6">{fr ? "Ce centre explique comment utiliser le logiciel. Super Leader Academy reste l’espace consacré aux formations professionnelles, évaluations et certificats." : "This centre explains how to use the software. Super Leader Academy remains the space for professional training, assessments and certificates."}</p></section>

      <HelpGuideBrowser guides={guides} locale={locale} progress={progress} feedback={feedback} />
      {isAdmin ? <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{fr ? "Administration" : "Administration"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Pilotage du Centre d’aide" : "Help centre oversight"}</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-indigo-50 p-4"><p className="text-2xl font-black text-indigo-950">{new Set(allProgress.map(row => row.user_id)).size}</p><p className="text-xs font-bold text-indigo-700">{fr ? "utilisateurs engagés" : "engaged users"}</p></div><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-2xl font-black text-emerald-950">{allProgress.filter(row => row.status === "completed").length}</p><p className="text-xs font-bold text-emerald-700">{fr ? "tutoriels terminés" : "tutorials completed"}</p></div><div className="rounded-2xl bg-amber-50 p-4"><p className="text-2xl font-black text-amber-950">{allFeedback.length ? Math.round((positive / allFeedback.length) * 100) : 0} %</p><p className="text-xs font-bold text-amber-700">{fr ? "avis positifs" : "positive feedback"}</p></div></div><h3 className="mt-6 font-black">{fr ? "Retours récents" : "Recent feedback"}</h3><div className="mt-3 space-y-2">{allFeedback.filter(row => row.comment).slice(0, 8).map((row, index) => <div key={`${row.user_id}-${row.guide_id}-${index}`} className="rounded-xl bg-slate-50 p-3 text-sm"><span className="font-black">{row.helpful ? "👍" : "👎"} {row.guide_id}</span><p className="mt-1 text-slate-600">{row.comment}</p></div>)}{!allFeedback.some(row => row.comment) ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{fr ? "Aucun commentaire reçu pour le moment." : "No comments received yet."}</p> : null}</div></section> : null}
      <section className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-lg font-black text-amber-950">{fr ? "Une aide qui évolue avec le produit" : "Help that evolves with the product"}</h2><p className="mt-2 text-sm leading-6 text-amber-900">{fr ? "La progression et les retours sont maintenant enregistrés. Les vidéos et visites guidées dans les écrans restent prévues pour une prochaine phase." : "Progress and feedback are now saved. Videos and in-screen walkthroughs remain planned for a future phase."}</p></section>
    </div>
  </main>;
}
