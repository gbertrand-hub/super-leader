import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suppression des données | Super Leader",
  description:
    "Instructions permettant de demander la suppression de données personnelles traitées par Super Leader.",
  robots: {
    index: true,
    follow: true,
  },
};

const contactEmail = "guybenim2@gmail.com";

export default function DataDeletionPage() {
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
            Suppression des données
          </h1>

          <p className="mt-4 text-sm font-semibold text-slate-500">
            Dernière mise à jour : 31 juillet 2026
          </p>
        </header>

        <div className="mt-10 space-y-10 leading-7 text-slate-700">
          <section>
            <h2 className="text-2xl font-black text-slate-950">
              Comment demander la suppression de vos données
            </h2>
            <p className="mt-3">
              Vous pouvez demander la suppression des données personnelles
              associées à votre utilisation de Super Leader en envoyant une
              demande à l’adresse indiquée ci-dessous.
            </p>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-xl font-black text-slate-950">
              Étapes à suivre
            </h2>

            <ol className="mt-4 list-decimal space-y-3 pl-6">
              <li>
                Envoyez un email à{" "}
                <a
                  href={`mailto:${contactEmail}`}
                  className="font-bold text-slate-950 underline"
                >
                  {contactEmail}
                </a>.
              </li>
              <li>
                Utilisez comme objet :{" "}
                <strong>Demande de suppression des données Super Leader</strong>.
              </li>
              <li>
                Indiquez votre nom complet, votre adresse email, votre
                organisation et, si applicable, le numéro de téléphone ou
                WhatsApp associé à votre compte.
              </li>
              <li>
                Précisez si vous demandez la suppression de votre compte, de vos
                données de communication ou de toutes les données pouvant être
                supprimées.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              Vérification de l’identité
            </h2>
            <p className="mt-3">
              Afin de protéger les utilisateurs, nous pouvons demander des
              informations complémentaires permettant de vérifier l’identité du
              demandeur et son lien avec le compte concerné.
            </p>
            <p className="mt-3">
              Ne transmettez jamais votre mot de passe, votre jeton d’accès ou
              tout autre secret de connexion dans votre demande.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              Traitement de la demande
            </h2>
            <p className="mt-3">
              Après vérification, les données pouvant légalement être supprimées
              seront effacées ou anonymisées dans les délais prévus par la
              législation applicable.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              Données pouvant être conservées
            </h2>
            <p className="mt-3">
              Certaines informations peuvent devoir être conservées lorsqu’elles
              sont nécessaires à la sécurité, à la prévention de la fraude, aux
              audits, à l’exercice de droits légaux ou au respect d’obligations
              comptables, contractuelles, réglementaires ou judiciaires.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              Suppression d’un accès professionnel
            </h2>
            <p className="mt-3">
              Lorsqu’un compte a été créé par une organisation, certaines
              demandes peuvent nécessiter la participation de l’administrateur
              autorisé de cette organisation. La désactivation d’un accès ne
              signifie pas nécessairement la suppression immédiate de tous les
              enregistrements professionnels ou d’audit.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-slate-950">
              Données Meta et WhatsApp
            </h2>
            <p className="mt-3">
              Une demande peut inclure les informations WhatsApp enregistrées
              par Super Leader, telles que le numéro du destinataire,
              l’identifiant du message, les statuts de livraison et les réponses
              reçues. Les données conservées directement par Meta ou WhatsApp
              restent également soumises à leurs propres politiques.
            </p>
          </section>

          <section className="rounded-2xl bg-slate-950 p-6 text-white">
            <h2 className="text-2xl font-black">
              Envoyer une demande
            </h2>
            <p className="mt-3 text-slate-300">
              Cliquez ci-dessous pour préparer votre demande par email.
            </p>
            <a
              href={`mailto:${contactEmail}?subject=Demande%20de%20suppression%20des%20donn%C3%A9es%20Super%20Leader`}
              className="mt-4 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950"
            >
              Demander la suppression
            </a>
          </section>

          <p className="text-sm text-slate-500">
            Pour en savoir plus, consultez notre{" "}
            <a href="/privacy" className="font-bold text-slate-950 underline">
              politique de confidentialité
            </a>.
          </p>
        </div>
      </article>
    </main>
  );
}