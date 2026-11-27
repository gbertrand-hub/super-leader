/**
 * Canton visitor feedback consent updates.
 *
 * Pure business logic.
 * No database access.
 * No external communication.
 */

export type CantonFeedbackConsentInput = {
  emailConsent: boolean;
  whatsappConsent: boolean;
  email: string | null;
  phone: string | null;
  language: "fr" | "en";
  timestamp: string;
};

export function buildCantonFeedbackConsentUpdate(
  input: CantonFeedbackConsentInput
): Record<string, unknown> | null {

  if (!input.emailConsent && !input.whatsappConsent) {
    return null;
  }

  const timestamp = input.timestamp;

  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Invalid consent timestamp");
  }

  const update: Record<string, unknown> = {
    feedback_preferred_locale: input.language,
  };

  if (input.emailConsent) {
    const email = (input.email ?? "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("A valid email is required for email consent");
    }

    update.email = email;
    update.feedback_email_opt_in = true;
    update.feedback_email_opt_in_at = timestamp;

    // Legacy fields remain for existing email processors.
    update.feedback_opt_in_at = timestamp;
    update.feedback_opt_in_source = "staff_attested_at_booking";
  }

  if (input.whatsappConsent) {
    const phone = (input.phone ?? "").trim();

    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error(
        "A valid international phone number is required for WhatsApp consent"
      );
    }

    update.phone = phone;
    update.feedback_whatsapp_opt_in = true;
    update.feedback_whatsapp_opt_in_at = timestamp;
    update.feedback_whatsapp_opt_in_source =
      "staff_attested_at_booking";
  }

  return update;
}