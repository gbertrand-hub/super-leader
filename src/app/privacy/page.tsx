import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique de confidentialité | Super Leader",
  description:
    "Politique de confidentialité de Super Leader, une plateforme d’iLEAD Global Investment Group LLC.",
};

export default function PrivacyPage() {
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

          <h1 className="mt-6 text-3xl font-black sm:text-5xl">
            Politique de confidentialité
          </h1>

          <p className="mt-4 text-sm font-semibold text-slate-500">
            Dernière mise à jour : 31 juillet 2026
          </p>
        </header>

        <div className="mt-10 space-y-9 leading-7 text-slate-700">
          <section>
            <h2 className="text-2xl font-black text-slate-950">
              1. Responsable du traitement
            </h2>
            <p className="mt-3">
              Super Leader est une plateforme exploitée par iLEAD Global
              Investment Group LLC. Cette politique décrit la manière dont nous
              collectons, utilisons, conservons et protégeons les données
              personnelles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              2. Données collectées
            </h2>
            <p className="mt-3">
              Nous pouvons traiter des informations d’identité et de contact,
              notamment le nom, l’adresse email, le numéro de téléphone et le
              numéro WhatsApp. Nous pouvons également traiter des informations
              professionnelles relatives à l’organisation, au département, au
              rôle, à l’équipe, aux activités, aux rapports, aux présences, aux
              performances, aux clients et aux feedbacks.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              3. Utilisation des données
            </h2>
            <p className="mt-3">
              Les données sont utilisées pour fournir et sécuriser la
              plateforme, gérer les comptes et autorisations, organiser les
              activités professionnelles, recueillir les feedbacks, produire
              des rapports et prévenir les abus.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              4. WhatsApp et communications
            </h2>
            <p className="mt-3">
              Lorsque l’intégration WhatsApp est utilisée, Super Leader peut
              traiter le numéro du destinataire, l’identifiant du message, le
              modèle utilisé, les statuts d’envoi, de livraison, de lecture ou
              d’échec, ainsi que les réponses reçues.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              5. Prestataires techniques
            </h2>
            <p className="mt-3">
              Certaines données peuvent être traitées par des prestataires
              nécessaires au fonctionnement de Super Leader, notamment les
              services d’hébergement, de base de données, d’authentification,
              d’email, de visioconférence et de messagerie professionnelle,
              y compris Meta et WhatsApp.
            </p>
            <p className="mt-3">
              Nous ne vendons pas les données personnelles à des annonceurs ou
              à des courtiers en données.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              6. Conservation et sécurité
            </h2>
            <p className="mt-3">
              Les données sont conservées pendant la durée nécessaire à la
              fourniture du service, à la sécurité, aux audits et au respect
              des obligations légales. Des mesures techniques et
              organisationnelles sont appliquées pour limiter les accès non
              autorisés.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              7. Vos droits
            </h2>
            <p className="mt-3">
              Selon la législation applicable, vous pouvez demander l’accès,
              la rectification, la suppression, la limitation ou la portabilité
              de vos données, ainsi que vous opposer à certains traitements.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              8. Suppression des données
            </h2>
            <p className="mt-3">
              Les demandes de suppression peuvent être adressées à iLEAD Global
              Investment Group LLC par ses canaux officiels. Une vérification
              d’identité peut être demandée avant le traitement de la demande.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              9. Modifications
            </h2>
            <p className="mt-3">
              Cette politique peut être mise à jour pour refléter les
              évolutions de Super Leader, de ses intégrations ou des exigences
              légales.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}