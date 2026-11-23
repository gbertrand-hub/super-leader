import Link from "next/link";
import {submitCustomerFeedbackAction} from "@/app/actions/customer-feedback";
import {createAdminClient} from "@/lib/supabase/admin";

type PageProps = {
  params: Promise<{token: string}>;
  searchParams?: Promise<{submitted?: string; error?: string}>;
};

type RequestRow = {
  id: string;
  client_id: string;
  employee_id: string;
  locale: "fr" | "en";
  message: string;
  status: string;
  expires_at: string;
  organizations: {name: string} | {name: string}[] | null;
  crm_clients: {full_name: string} | {full_name: string}[] | null;
};

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

const copy = {
  fr: {
    eyebrow: "Votre expérience compte",
    title: "Comment s'est passé votre échange ?",
    subtitle: "Votre réponse est confidentielle et prend moins d'une minute.",
    interactionWith: "Échange avec {name}",
    rating: "Votre note",
    labels: ["Très insatisfait", "Insatisfait", "Neutre", "Satisfait", "Très satisfait"],
    comment: "Commentaire",
    commentPlaceholder: "Qu'avons-nous bien fait ? Que pouvons-nous améliorer ?",
    contact: "J'accepte d'être contacté au sujet de cette réponse.",
    submit: "Envoyer mon avis",
    thanksTitle: "Merci pour votre avis !",
    thanksText: "Votre réponse a bien été enregistrée et aidera notre équipe à progresser.",
    expiredTitle: "Cette demande a expiré",
    expiredText: "Le lien n'est plus actif. Vous pouvez contacter directement l'organisation si nécessaire.",
    invalidTitle: "Lien de feedback invalide",
    invalidText: "Cette demande est introuvable, a été annulée ou n'est plus disponible.",
    errorTitle: "Envoi impossible",
    errorText: "Votre réponse n'a pas pu être enregistrée. Réessayez dans quelques instants.",
    home: "Retour à l'accueil",
    powered: "Collecté avec Super Leader",
  },
  en: {
    eyebrow: "Your experience matters",
    title: "How did your interaction go?",
    subtitle: "Your response is confidential and takes less than a minute.",
    interactionWith: "Interaction with {name}",
    rating: "Your rating",
    labels: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"],
    comment: "Comment",
    commentPlaceholder: "What did we do well? What could we improve?",
    contact: "I agree to be contacted about this response.",
    submit: "Send my feedback",
    thanksTitle: "Thank you for your feedback!",
    thanksText: "Your response has been recorded and will help our team improve.",
    expiredTitle: "This request has expired",
    expiredText: "This link is no longer active. You can contact the organisation directly if needed.",
    invalidTitle: "Invalid feedback link",
    invalidText: "This request could not be found, was cancelled, or is no longer available.",
    errorTitle: "Unable to submit",
    errorText: "Your response could not be saved. Please try again in a moment.",
    home: "Back to home",
    powered: "Collected with Super Leader",
  },
} as const;

function StatusPage({locale, title, text}: {locale: "fr" | "en"; title: string; text: string}) {
  const t = copy[locale];
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-950">
      <section className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-2xl">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-400 text-2xl font-black">★</span>
        <h1 className="mt-5 text-3xl font-black">{title}</h1>
        <p className="mt-3 leading-7 text-slate-600">{text}</p>
        <Link className="mt-7 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-bold text-white" href="/">
          {t.home}
        </Link>
        <p className="mt-8 text-xs font-semibold text-slate-400">{t.powered}</p>
      </section>
    </main>
  );
}

export default async function CustomerFeedbackPage({params, searchParams}: PageProps) {
  const {token} = await params;
  const query = (await searchParams) ?? {};
  const admin = createAdminClient();
  const currentTimestamp = new Date().getTime();
  const {data: request} = await admin
    .from("crm_feedback_requests")
    .select("id, client_id, employee_id, locale, message, status, expires_at, organizations(name), crm_clients(full_name)")
    .eq("public_token", token)
    .maybeSingle<RequestRow>();

  const locale = request?.locale === "en" ? "en" : "fr";
  const t = copy[locale];

  if (query.submitted === "1" || request?.status === "completed") {
    return <StatusPage locale={locale} title={t.thanksTitle} text={t.thanksText} />;
  }
  if (!request || ["cancelled", "expired"].includes(request.status)) {
    return <StatusPage locale={locale} title={t.invalidTitle} text={t.invalidText} />;
  }
  if (new Date(request.expires_at).getTime() < currentTimestamp || query.error === "expired") {
    return <StatusPage locale={locale} title={t.expiredTitle} text={t.expiredText} />;
  }
  if (query.error) {
    return <StatusPage locale={locale} title={t.errorTitle} text={t.errorText} />;
  }

  const organization = first(request.organizations)?.name || "Super Leader";
  const clientName = first(request.crm_clients)?.full_name || (locale === "fr" ? "Client" : "Customer");
  const {data: employee} = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", request.employee_id)
    .maybeSingle<{full_name: string | null; email: string | null}>();
  const employeeName = employee?.full_name?.trim() || employee?.email || "Super Leader";

  if (["ready", "pending", "sent", "delivered"].includes(request.status)) {
    await admin.from("crm_feedback_requests").update({
      status: "opened",
      opened_at: new Date().toISOString(),
      last_provider_status: "feedback_form_opened",
      last_delivery_at: new Date().toISOString(),
    }).eq("id", request.id);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-950">
      <section className="mx-auto max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="bg-gradient-to-br from-indigo-700 to-slate-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">{t.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-black">{t.title}</h1>
          <p className="mt-3 leading-7 text-indigo-100">{t.subtitle}</p>
        </header>

        <div className="p-8">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
            <p className="font-black text-indigo-950">{organization}</p>
            <p className="mt-1 text-sm text-indigo-800">{t.interactionWith.replace("{name}", employeeName)}</p>
            <p className="mt-3 text-sm leading-6 text-indigo-900">{request.message}</p>
          </div>

          <form action={submitCustomerFeedbackAction} className="mt-8 space-y-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="clientName" value={clientName} />
            <fieldset>
              <legend className="text-sm font-black text-slate-700">{t.rating}</legend>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {t.labels.map((label, index) => {
                  const value = index + 1;
                  return (
                    <label key={label} className="group cursor-pointer text-center">
                      <input className="peer sr-only" type="radio" name="rating" value={value} required />
                      <span className="grid h-14 place-items-center rounded-xl border-2 border-slate-200 text-xl font-black text-slate-500 transition group-hover:border-indigo-300 peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-checked:text-white">
                        {value}
                      </span>
                      <span className="mt-2 block text-[10px] font-semibold leading-4 text-slate-500">{label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-sm font-black text-slate-700">{t.comment}</span>
              <textarea className="mt-2 min-h-32 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" name="comment" placeholder={t.commentPlaceholder} maxLength={5000} />
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
              <input className="mt-1 h-4 w-4" type="checkbox" name="consentToContact" defaultChecked />
              <span>{t.contact}</span>
            </label>

            <button className="w-full rounded-xl bg-slate-950 px-5 py-4 text-base font-black text-white hover:bg-indigo-700" type="submit">
              {t.submit}
            </button>
          </form>

          <p className="mt-8 text-center text-xs font-semibold text-slate-400">{t.powered}</p>
        </div>
      </section>
    </main>
  );
}
