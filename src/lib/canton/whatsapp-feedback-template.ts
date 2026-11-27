/**
 * Canton visitor WhatsApp feedback message preparation.
 *
 * No provider calls.
 * No database writes.
 * No CRM configuration changes.
 *
 * Actual outbound delivery requires a separately approved
 * Meta template, explicit visitor consent and an atomic
 * WhatsApp-specific invitation claim.
 */

export type CantonWhatsAppLanguage = "fr" | "en";

export type CantonWhatsAppFeedbackInput = {
  visitorName: string;
  siteName: string;
  feedbackUrl: string;
  language: CantonWhatsAppLanguage;
};

export type CantonWhatsAppFeedbackDraft = {
  language: CantonWhatsAppLanguage;
  text: string;
  feedbackUrl: string;
  channel: "whatsapp";
  category: "canton_visit_feedback";
};

export function buildCantonWhatsAppFeedbackDraft(
  input: CantonWhatsAppFeedbackInput
): CantonWhatsAppFeedbackDraft {
  const visitorName = input.visitorName.trim();
  const siteName = input.siteName.trim();

  if (!visitorName || !siteName) {
    throw new Error("Visitor and site names are required.");
  }

  const url = new URL(input.feedbackUrl);

  if (url.protocol !== "https:") {
    throw new Error("A secure HTTPS feedback URL is required.");
  }

  if (!/^\/canton-feedback\/[^/]+$/.test(url.pathname)) {
    throw new Error("Invalid Canton feedback URL.");
  }

  const language = input.language;

  const text =
    language === "fr"
      ? [
          `Bonjour ${visitorName},`,
          "",
          `Merci d'avoir visité ${siteName}.`,
          "",
          "Votre avis nous aidera à améliorer notre accueil.",
          "Merci de partager votre experience :",
          "",
          url.toString(),
          "",
          "ILEAD Global - Relations Visiteurs",
        ].join("\n")
      : [
          `Hello ${visitorName},`,
          "",
          `Thank you for visiting ${siteName}.`,
          "",
          "Your feedback helps us improve our visitor experience.",
          "Please share your experience:",
          "",
          url.toString(),
          "",
          "ILEAD Global - Visitor Relations",
        ].join("\n");

  return {
    language,
    text,
    feedbackUrl: url.toString(),
    channel: "whatsapp",
    category: "canton_visit_feedback",
  };
}