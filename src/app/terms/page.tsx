import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions d’utilisation | Super Leader",
  description:
    "Conditions d’utilisation de la plateforme Super Leader exploitée par iLEAD Global Investment Group LLC.",
  robots: {
    index: true,
    follow: true,
  },
};

const contactEmail = "guybenim2@gmail.com";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
      <article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <header className="border-b border-slate-200 pb-8">
          <a
            href="/"
            className="inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white"
          >
            Super Leader
          </a>

          <h1 className="mt-6 text-3xl font-black tracking-tight sm:text-5xl">
            Conditions d’utilisation
          </h1>

          <p className="mt-4 text-sm font-semibold text-slate-500">
            Dernière mise à jour : 31 juillet 2026
          </p>
        </header>

        <div className="mt-10 space-y-10 leading-7 text-slate-700">
          <section>
            <h2 className="text-2xl font-black text-slate-950">
              1. Objet
            </h2>
            <p className="mt-3">
              Les présentes conditions régissent l’accès et l’utilisation de
              Super Leader, une plateforme exploitée par iLEAD Global Investment
              Group LLC pour la gestion des équipes, activités, performances,
              communications, clients, feedbacks et opérations professionnelles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              2. Acceptation des conditions
            </h2>
            <p className="mt-3">
              En accédant à Super Leader ou en utilisant ses fonctionnalités,
              vous acceptez les présentes conditions ainsi que notre politique
              de confidentialité. Si vous n’acceptez pas ces conditions, vous
              ne devez pas utiliser la plateforme.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              3. Comptes et sécurité
            </h2>
            <p className="mt-3">
              Chaque utilisateur doit fournir des informations exactes, protéger
              ses identifiants et informer rapidement son administrateur de tout
              accès non autorisé. Un compte est personnel et ne doit pas être
              partagé avec une autre personne.
            </p>
            <p className="mt-3">
              Les utilisateurs doivent changer tout mot de passe temporaire lors
              de leur première connexion et respecter les règles de sécurité
              définies par leur organisation.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              4. Rôles et autorisations
            </h2>
            <p className="mt-3">
              L’accès aux informations et fonctionnalités dépend du rôle, de
              l’organisation, du département, de l’équipe et des autorisations
              attribuées. Toute tentative de contourner ces contrôles est
              interdite.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              5. Utilisation acceptable
            </h2>
            <p className="mt-3">
              Super Leader doit être utilisé uniquement à des fins
              professionnelles légitimes et autorisées. Il est notamment
              interdit d’utiliser la plateforme pour frauder, harceler,
              diffuser du contenu illégal, compromettre la sécurité, accéder
              sans autorisation à des données ou perturber le service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              6. Communications
            </h2>
            <p className="mt-3">
              La plateforme peut envoyer des communications professionnelles
              par email, SMS, WhatsApp ou d’autres canaux autorisés. Ces
              communications peuvent concerner les accès, rapports, réunions,
              demandes de feedback, absences, suivis clients ou opérations
              administratives.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              7. Contenus et informations
            </h2>
            <p className="mt-3">
              Les utilisateurs restent responsables des informations qu’ils
              saisissent ou transmettent. Ils doivent s’assurer qu’ils disposent
              du droit de traiter et de partager ces informations dans le cadre
              de leurs activités professionnelles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              8. Services tiers
            </h2>
            <p className="mt-3">
              Super Leader peut utiliser des services tiers, notamment pour
              l’hébergement, l’authentification, les bases de données, les
              emails, les visioconférences et les communications WhatsApp. Ces
              services peuvent être soumis à leurs propres conditions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              9. Disponibilité et évolution
            </h2>
            <p className="mt-3">
              Nous cherchons à maintenir la plateforme disponible et sécurisée,
              sans garantir une disponibilité ininterrompue. Certaines
              fonctionnalités peuvent être modifiées, suspendues ou remplacées
              pour des raisons techniques, opérationnelles ou réglementaires.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              10. Suspension ou résiliation
            </h2>
            <p className="mt-3">
              Un accès peut être suspendu ou supprimé en cas de départ de
              l’organisation, de violation des présentes conditions, de risque
              de sécurité, d’utilisation abusive ou à la demande d’un
              administrateur autorisé.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              11. Propriété intellectuelle
            </h2>
            <p className="mt-3">
              Super Leader, sa marque, son interface, ses textes, éléments
              graphiques, logiciels et fonctionnalités sont protégés par les
              droits applicables. Aucun droit de propriété n’est transféré à
              l’utilisateur par le simple accès à la plateforme.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              12. Limitation de responsabilité
            </h2>
            <p className="mt-3">
              Dans les limites autorisées par la loi, iLEAD Global Investment
              Group LLC ne pourra être tenue responsable des pertes indirectes,
              interruptions, erreurs provenant de services tiers ou utilisations
              non autorisées de la plateforme.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              13. Modifications des conditions
            </h2>
            <p className="mt-3">
              Les présentes conditions peuvent être mises à jour afin de
              refléter l’évolution de la plateforme, de ses services ou des
              exigences légales. La date de mise à jour sera indiquée sur cette
              page.
            </p>
          </section>

          <section className="rounded-2xl bg-slate-950 p-6 text-white">
            <h2 className="text-2xl font-black">14. Contact</h2>
            <p className="mt-3 text-slate-300">
              Pour toute question concernant les présentes conditions :
            </p>
            <a
              href={`mailto:${contactEmail}`}
              className="mt-4 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950"
            >
              {contactEmail}
            </a>
          </section>

          <p className="text-sm text-slate-500">
            Consultez également notre{" "}
            <a href="/privacy" className="font-bold text-slate-950 underline">
              politique de confidentialité
            </a>.
          </p>
        </div>
      </article>
    </main>
  );
}