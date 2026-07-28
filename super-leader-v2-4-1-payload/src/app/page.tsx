import Link from "next/link";
import {LanguageSwitcher} from "@/components/i18n/language-switcher";
import {RecoveryHashRedirect} from "@/components/auth/recovery-hash-redirect";
import {getI18n} from "@/i18n/server";
import {createClient} from "@/lib/supabase/server";

type IconName =
  | "feedback"
  | "performance"
  | "academy"
  | "growth"
  | "security"
  | "crm"
  | "people"
  | "chart"
  | "check"
  | "arrow";

function Icon({name, className = "h-6 w-6"}: {name: IconName; className?: string}) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "feedback") {
    return (
      <svg {...common}>
        <path d="M7 18.5 3.5 21v-5.2A8 8 0 1 1 7 18.5Z" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    );
  }
  if (name === "performance" || name === "chart") {
    return (
      <svg {...common}>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
        <path d="M2 19h21" />
      </svg>
    );
  }
  if (name === "academy") {
    return (
      <svg {...common}>
        <path d="m3 9 9-5 9 5-9 5-9-5Z" />
        <path d="M7 12v4.5c2.8 2 7.2 2 10 0V12M21 9v6" />
      </svg>
    );
  }
  if (name === "growth") {
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V6M16 20v-9M22 20V3" />
        <path d="m3 8 6-4 6 3 7-5" />
      </svg>
    );
  }
  if (name === "security") {
    return (
      <svg {...common}>
        <path d="M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }
  if (name === "crm") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 8h5M18.5 5.5v5" />
      </svg>
    );
  }
  if (name === "people") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M2.5 20a5.5 5.5 0 0 1 11 0M13.5 20a4.5 4.5 0 0 1 8 0" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function DashboardPreview({labels}: {labels: Record<string, string>}) {
  return (
    <div className="relative mx-auto w-full max-w-[590px]">
      <div className="absolute -inset-8 rounded-[3rem] bg-indigo-500/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.8rem] border border-white/15 bg-white shadow-2xl shadow-slate-950/35">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-[10px] font-bold text-slate-600">
            app.ileadglobal.org
          </span>
          <span className="h-6 w-6 rounded-full bg-indigo-100" />
        </div>

        <div className="grid min-h-[390px] grid-cols-[88px_1fr] bg-slate-100 sm:grid-cols-[120px_1fr]">
          <aside className="bg-slate-950 p-3 text-white sm:p-4">
            <div className="mb-7 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-400 text-xs text-slate-950">★</span>
              <span className="hidden text-[9px] font-black sm:inline">SUPER LEADER</span>
            </div>
            <div className="space-y-3">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className={`h-7 rounded-lg ${item === 1 ? "bg-indigo-600" : "bg-white/[0.07]"}`}
                />
              ))}
            </div>
          </aside>

          <div className="p-4 sm:p-5">
            <div className="rounded-2xl bg-slate-950 px-5 py-5 text-white">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-400">{labels.overview}</p>
              <p className="mt-2 text-lg font-black sm:text-xl">{labels.hello}</p>
              <p className="mt-1 text-[11px] text-slate-300">{labels.organisation}</p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [labels.feedback, "12"],
                [labels.performance, "86%"],
                [labels.training, "4"],
                [labels.growth, "+18%"],
              ].map(([label, value], index) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className={`mb-3 block h-2 w-8 rounded-full ${["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-fuchsia-500"][index]}`} />
                  <p className="text-[9px] font-bold text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1.35fr_.65fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-slate-900">{labels.progress}</p>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[8px] font-black text-emerald-700">+12%</span>
                </div>
                <div className="mt-5 flex h-24 items-end gap-2">
                  {[40, 58, 48, 72, 65, 88, 82].map((height, index) => (
                    <span
                      key={index}
                      className="flex-1 rounded-t-md bg-indigo-500/80"
                      style={{height: `${height}%`}}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-black text-slate-900">{labels.today}</p>
                <div className="mt-4 space-y-3">
                  {["bg-amber-400", "bg-indigo-500", "bg-emerald-500"].map((colour, index) => (
                    <div key={colour} className="flex items-center gap-2">
                      <span className={`h-7 w-1 rounded-full ${colour}`} />
                      <div className="flex-1">
                        <span className="block h-2 rounded bg-slate-200" />
                        <span className="mt-1 block h-1.5 w-2/3 rounded bg-slate-100" />
                      </div>
                      <span className="text-[8px] font-bold text-slate-400">0{index + 9}:00</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  const {locale, t} = await getI18n();
  const fr = locale === "fr";

  const copy = fr
    ? {
        nav: [
          ["Fonctionnalités", "#fonctionnalites"],
          ["Comment ça marche", "#fonctionnement"],
          ["Sécurité", "#securite"],
        ],
        eyebrow: "Plateforme de leadership et de performance",
        titleA: "Développez vos équipes.",
        titleB: "Transformez votre organisation.",
        subtitle:
          "Super Leader centralise le feedback, la performance, la formation continue et les plans de croissance dans une plateforme sécurisée.",
        demo: "Demander une démonstration",
        discover: "Découvrir les fonctionnalités",
        internalQuestion: "Vous êtes collaborateur iLEAD Global ?",
        internalLink: "Demander votre accès interne",
        proof: ["Feedback continu", "Performance", "Super Leader Academy", "Plans de croissance", "Sécurité par rôles"],
        preview: {
          overview: "Centre de pilotage",
          hello: "Bonjour, votre équipe progresse.",
          organisation: "Vue organisationnelle en temps réel",
          feedback: "Feedbacks",
          performance: "Performance",
          training: "Formations",
          growth: "Croissance",
          progress: "Progression mensuelle",
          today: "Priorités",
        },
        problemsEyebrow: "Une vision unifiée",
        problemsTitle: "Tout ce qu’il faut pour faire grandir les personnes et les résultats.",
        problemsSubtitle:
          "Remplacez les outils dispersés et les suivis manuels par un environnement clair, mesurable et orienté action.",
        problems: [
          ["feedback", "Un feedback qui fait progresser", "Collectez, structurez et transformez les retours des collègues et des clients en actions concrètes."],
          ["performance", "Une performance transparente", "Suivez les KPI, la présence, les rapports et les progrès sans perdre la dimension humaine."],
          ["academy", "Une culture d’apprentissage", "Planifiez les formations, suivez les présences, validez les acquis et délivrez des certificats vérifiables."],
        ],
        featureEyebrow: "Fonctionnalités principales",
        featureTitle: "Une plateforme. Un parcours complet de développement.",
        features: [
          ["feedback", "Feedback & reconnaissance", "Feedback entre collègues, reconnaissance et plans d’action personnalisés."],
          ["performance", "Performance & Employé du mois", "Scores transparents, critères configurables et historique vérifiable."],
          ["academy", "Super Leader Academy", "Formations récurrentes, Zoom, quiz, présence et certificats avec QR code."],
          ["growth", "Plans de croissance", "Heures d’impact, lectures, parcours iLEAD et compétences développées."],
          ["crm", "CRM, ventes & commissions", "Clients, contrats, tâches, recouvrement et suivi commercial dans un même espace."],
          ["security", "Rôles & confidentialité", "Owner, Admin, RH, Manager et Employé avec un périmètre strictement contrôlé."],
        ],
        howEyebrow: "Comment ça marche",
        howTitle: "Du premier accès aux résultats mesurables.",
        steps: [
          ["01", "Configurez votre organisation", "Créez les départements, équipes, rôles et règles qui correspondent à votre fonctionnement."],
          ["02", "Invitez vos collaborateurs", "Affectez chaque personne à ses équipes et à son superviseur avec un accès sécurisé."],
          ["03", "Développez et mesurez", "Centralisez le feedback, la performance, la formation et les plans de croissance."],
          ["04", "Reconnaissez les progrès", "Transformez les données en accompagnement, décisions et reconnaissance équitable."],
        ],
        pathsEyebrow: "Deux parcours, une sécurité claire",
        pathsTitle: "Choisissez l’accès qui vous correspond.",
        organisationTitle: "Pour les organisations",
        organisationText: "Découvrez comment Super Leader peut structurer le développement, la performance et l’engagement de vos équipes.",
        organisationCta: "Demander une démonstration",
        internalTitle: "Pour les collaborateurs iLEAD",
        internalText: "Vous travaillez déjà avec iLEAD Global ? Envoyez votre demande pour rejoindre l’espace interne sécurisé.",
        internalCta: "Demander un accès interne",
        securityEyebrow: "Sécurité et confidentialité",
        securityTitle: "Chaque personne voit uniquement ce qu’elle doit voir.",
        securityText:
          "Les rôles, équipes, actions serveur et politiques Supabase travaillent ensemble pour protéger les données de chaque organisation.",
        securityItems: ["Isolation complète des organisations", "Managers limités à leurs équipes", "Journal d’audit des actions sensibles", "Accès sécurisé aux documents et exports"],
        finalEyebrow: "Prêt à passer à l’action ?",
        finalTitle: "Créez une culture de leadership, de performance et de croissance.",
        finalText: "Découvrez Super Leader avec votre équipe et construisons ensemble un parcours adapté à votre organisation.",
        footer: "Super Leader — Écouter · Comprendre · Agir",
      }
    : {
        nav: [
          ["Features", "#fonctionnalites"],
          ["How it works", "#fonctionnement"],
          ["Security", "#securite"],
        ],
        eyebrow: "Leadership and performance platform",
        titleA: "Develop your people.",
        titleB: "Transform your organisation.",
        subtitle:
          "Super Leader brings feedback, performance, continuous learning and growth plans together in one secure platform.",
        demo: "Request a demo",
        discover: "Explore the platform",
        internalQuestion: "Are you an iLEAD Global team member?",
        internalLink: "Request internal access",
        proof: ["Continuous feedback", "Performance", "Super Leader Academy", "Growth plans", "Role-based security"],
        preview: {
          overview: "Leadership cockpit",
          hello: "Hello, your team is progressing.",
          organisation: "Real-time organisational view",
          feedback: "Feedback",
          performance: "Performance",
          training: "Training",
          growth: "Growth",
          progress: "Monthly progress",
          today: "Priorities",
        },
        problemsEyebrow: "One unified view",
        problemsTitle: "Everything you need to grow people and results.",
        problemsSubtitle:
          "Replace scattered tools and manual follow-up with one clear, measurable and action-oriented environment.",
        problems: [
          ["feedback", "Feedback that drives progress", "Collect, structure and turn colleague and customer feedback into practical action."],
          ["performance", "Transparent performance", "Track KPIs, attendance, reports and progress without losing the human dimension."],
          ["academy", "A learning culture", "Schedule training, track attendance, assess learning and issue verifiable certificates."],
        ],
        featureEyebrow: "Core capabilities",
        featureTitle: "One platform. A complete development journey.",
        features: [
          ["feedback", "Feedback & recognition", "Peer feedback, recognition and personalised action plans."],
          ["performance", "Performance & Employee of the Month", "Transparent scores, configurable criteria and a verifiable history."],
          ["academy", "Super Leader Academy", "Recurring training, Zoom, quizzes, attendance and QR-verified certificates."],
          ["growth", "Growth plans", "Impact hours, reading, iLEAD pathways and developed skills."],
          ["crm", "CRM, sales & commissions", "Clients, contracts, tasks, collections and commercial follow-up in one place."],
          ["security", "Roles & privacy", "Owner, Admin, HR, Manager and Employee with tightly controlled visibility."],
        ],
        howEyebrow: "How it works",
        howTitle: "From first access to measurable progress.",
        steps: [
          ["01", "Configure your organisation", "Create departments, teams, roles and rules that match how you operate."],
          ["02", "Invite your people", "Assign each person to their teams and supervisor with secure access."],
          ["03", "Develop and measure", "Bring feedback, performance, learning and growth plans together."],
          ["04", "Recognise progress", "Turn data into coaching, decisions and fair recognition."],
        ],
        pathsEyebrow: "Two pathways, clearly separated",
        pathsTitle: "Choose the access that fits you.",
        organisationTitle: "For organisations",
        organisationText: "See how Super Leader can structure the development, performance and engagement of your teams.",
        organisationCta: "Request a demo",
        internalTitle: "For iLEAD team members",
        internalText: "Already working with iLEAD Global? Submit your request to join the secure internal workspace.",
        internalCta: "Request internal access",
        securityEyebrow: "Security and privacy",
        securityTitle: "Everyone sees only what they are authorised to see.",
        securityText:
          "Roles, team scopes, server actions and Supabase policies work together to protect every organisation’s data.",
        securityItems: ["Complete organisation isolation", "Managers limited to their teams", "Audit trail for sensitive actions", "Secure documents and exports"],
        finalEyebrow: "Ready to move forward?",
        finalTitle: "Build a culture of leadership, performance and growth.",
        finalText: "Discover Super Leader with your team and let us shape a journey that fits your organisation.",
        footer: "Super Leader — Listen · Understand · Act",
      };

  return (
    <main className="min-h-screen overflow-hidden bg-slate-50 text-slate-950">
      <RecoveryHashRedirect />

      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_15%_15%,rgba(99,102,241,.35),transparent_32%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,.2),transparent_28%),radial-gradient(circle_at_75%_85%,rgba(14,165,233,.18),transparent_30%)]" />
        <div className="relative mx-auto max-w-7xl px-5 pb-24 pt-5 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl sm:px-5">
            <Link href="/" className="flex items-center gap-3" aria-label={t("brand.name")}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 font-black text-slate-950 shadow-lg shadow-amber-400/20">★</span>
              <div>
                <p className="text-sm font-black tracking-wide">{t("brand.name")}</p>
                <p className="hidden text-[10px] text-slate-400 sm:block">{t("brand.shortPromise")}</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm font-bold text-slate-300 lg:flex">
              {copy.nav.map(([label, href]) => (
                <a key={href} href={href} className="transition hover:text-white">{label}</a>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <LanguageSwitcher variant="dark" />
              {data.user ? (
                <Link className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-300" href="/dashboard">
                  {t("home.dashboard")}
                </Link>
              ) : (
                <>
                  <Link className="hidden rounded-xl border border-white/20 px-4 py-2 text-sm font-black transition hover:bg-white/10 sm:inline-flex" href="/login">
                    {t("home.login")}
                  </Link>
                  <Link className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500" href="/signup">
                    {copy.demo}
                  </Link>
                </>
              )}
            </div>
          </header>

          <div className="grid items-center gap-16 pb-4 pt-16 lg:grid-cols-[.92fr_1.08fr] lg:pt-24">
            <div>
              <p className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.19em] text-amber-300">
                {copy.eyebrow}
              </p>
              <h1 className="mt-7 text-5xl font-black leading-[.98] tracking-[-.045em] sm:text-6xl lg:text-7xl">
                {copy.titleA}
                <span className="mt-2 block bg-gradient-to-r from-amber-300 via-white to-indigo-300 bg-clip-text text-transparent">{copy.titleB}</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">{copy.subtitle}</p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 font-black shadow-xl shadow-indigo-600/25 transition hover:-translate-y-0.5 hover:bg-indigo-500">
                  {copy.demo}<Icon name="arrow" className="h-5 w-5" />
                </Link>
                <a href="#fonctionnalites" className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 py-4 font-black transition hover:bg-white/10">
                  {copy.discover}
                </a>
              </div>

              <p className="mt-5 text-sm text-slate-400">
                {copy.internalQuestion}{" "}
                <Link href="/ilead-access" className="font-black text-amber-300 underline decoration-amber-300/40 underline-offset-4 transition hover:text-amber-200">
                  {copy.internalLink}
                </Link>
              </p>

              <div className="mt-9 flex flex-wrap gap-2.5">
                {copy.proof.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300">
                    <Icon name="check" className="h-4 w-4 text-emerald-400" />{item}
                  </span>
                ))}
              </div>
            </div>

            <DashboardPreview labels={copy.preview} />
          </div>
        </div>
      </section>

      <section className="relative -mt-7 px-5 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 md:grid-cols-3 md:p-6">
          {copy.problems.map(([icon, title, text]) => (
            <article key={title} className="rounded-2xl bg-slate-50 p-6">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-100 text-indigo-700"><Icon name={icon as IconName} /></span>
              <h2 className="mt-5 text-lg font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.problemsEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">{copy.problemsTitle}</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">{copy.problemsSubtitle}</p>
          </div>
        </div>
      </section>

      <section id="fonctionnalites" className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.featureEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.featureTitle}</h2>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {copy.features.map(([icon, title, text], index) => (
              <article key={title} className="group rounded-[1.6rem] border border-slate-200 bg-slate-50 p-7 transition hover:-translate-y-1 hover:border-indigo-200 hover:bg-white hover:shadow-xl hover:shadow-indigo-950/5">
                <div className="flex items-start justify-between">
                  <span className={`grid h-12 w-12 place-items-center rounded-2xl ${["bg-indigo-100 text-indigo-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700", "bg-fuchsia-100 text-fuchsia-700", "bg-sky-100 text-sky-700", "bg-slate-200 text-slate-700"][index]}`}>
                    <Icon name={icon as IconName} />
                  </span>
                  <span className="text-xs font-black text-slate-300">0{index + 1}</span>
                </div>
                <h3 className="mt-6 text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="fonctionnement" className="bg-slate-950 px-5 py-24 text-white sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">{copy.howEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.howTitle}</h2>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-4">
            {copy.steps.map(([number, title, text]) => (
              <article key={number} className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/5 p-7">
                <p className="text-5xl font-black text-white/10">{number}</p>
                <h3 className="mt-5 text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-400">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.pathsEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">{copy.pathsTitle}</h2>
          </div>
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <article className="relative overflow-hidden rounded-[2rem] bg-indigo-600 p-8 text-white shadow-xl shadow-indigo-600/15 sm:p-10">
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><Icon name="people" className="h-7 w-7" /></span>
              <h3 className="mt-8 text-3xl font-black">{copy.organisationTitle}</h3>
              <p className="mt-4 max-w-xl text-lg leading-8 text-indigo-100">{copy.organisationText}</p>
              <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-4 font-black text-indigo-700 transition hover:bg-amber-300 hover:text-slate-950">
                {copy.organisationCta}<Icon name="arrow" className="h-5 w-5" />
              </Link>
            </article>

            <article className="relative overflow-hidden rounded-[2rem] bg-amber-400 p-8 text-slate-950 shadow-xl shadow-amber-500/15 sm:p-10">
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/25" />
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white"><Icon name="security" className="h-7 w-7" /></span>
              <h3 className="mt-8 text-3xl font-black">{copy.internalTitle}</h3>
              <p className="mt-4 max-w-xl text-lg leading-8 text-amber-950/75">{copy.internalText}</p>
              <Link href="/ilead-access" className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-4 font-black text-white transition hover:bg-indigo-700">
                {copy.internalCta}<Icon name="arrow" className="h-5 w-5" />
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section id="securite" className="bg-white px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[.9fr_1.1fr]">
          <div>
            <p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">{copy.securityEyebrow}</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">{copy.securityTitle}</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">{copy.securityText}</p>
            <div className="mt-8 space-y-3">
              {copy.securityItems.map((item) => (
                <p key={item} className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 font-bold text-slate-700">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><Icon name="check" className="h-4 w-4" /></span>
                  {item}
                </p>
              ))}
            </div>
          </div>
          <div className="rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-slate-950/15 sm:p-8">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["Owner", "100%"],
                [fr ? "Administrateur" : "Administrator", "95%"],
                [fr ? "Responsable RH" : "HR Manager", "70%"],
                ["Manager", "45%"],
                [fr ? "Employé" : "Employee", "20%"],
              ].map(([role, scope], index) => (
                <div key={role} className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${index === 4 ? "sm:col-span-2" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-black">{role}</span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-amber-300">{scope}</span>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-amber-400" style={{width: scope}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-950 px-7 py-14 text-center text-white shadow-2xl shadow-indigo-900/20 sm:px-12 sm:py-16">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-300">{copy.finalEyebrow}</p>
          <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">{copy.finalTitle}</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-indigo-100">{copy.finalText}</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-7 py-4 font-black text-slate-950 transition hover:bg-amber-300">
              {copy.demo}<Icon name="arrow" className="h-5 w-5" />
            </Link>
            <Link href="/login" className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-7 py-4 font-black transition hover:bg-white/10">
              {t("home.login")}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400 font-black text-slate-950">★</span>
            <p className="font-black">{copy.footer}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-5 text-sm font-bold text-slate-500">
            <Link href="/signup" className="hover:text-indigo-600">{copy.demo}</Link>
            <Link href="/ilead-access" className="hover:text-indigo-600">{copy.internalLink}</Link>
            <Link href="/login" className="hover:text-indigo-600">{t("home.login")}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
