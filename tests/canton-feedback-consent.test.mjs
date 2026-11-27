import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCantonFeedbackConsentUpdate,
} from "../src/lib/canton/feedback-consent.ts";

const timestamp = "2026-11-27T09:00:00.000Z";

const base = {
  emailConsent: false,
  whatsappConsent: false,
  email: "visitor@example.com",
  phone: "+17375004840",
  language: "fr",
  timestamp,
};

test("No consent creates no update", () => {
  assert.equal(buildCantonFeedbackConsentUpdate(base), null);
});

test("Email consent receives an independent timestamp", () => {
  const update = buildCantonFeedbackConsentUpdate({
    ...base,
    emailConsent: true,
  });

  assert.equal(update.feedback_email_opt_in, true);
  assert.equal(update.feedback_email_opt_in_at, timestamp);
  assert.equal(update.feedback_opt_in_at, timestamp);
  assert.equal(update.feedback_whatsapp_opt_in_at, undefined);
});

test("WhatsApp consent receives an independent timestamp", () => {
  const update = buildCantonFeedbackConsentUpdate({
    ...base,
    whatsappConsent: true,
  });

  assert.equal(update.feedback_whatsapp_opt_in, true);
  assert.equal(update.feedback_whatsapp_opt_in_at, timestamp);
  assert.equal(update.feedback_whatsapp_consent_phone, "+17375004840");
  assert.equal(
    update.feedback_whatsapp_opt_in_source,
    "staff_attested_at_booking"
  );
});

test("WhatsApp consent does not modify legacy email timestamp", () => {
  const update = buildCantonFeedbackConsentUpdate({
    ...base,
    whatsappConsent: true,
  });

  assert.equal(update.feedback_opt_in_at, undefined);
  assert.equal(update.feedback_email_opt_in_at, undefined);
  assert.equal(update.feedback_email_opt_in, undefined);
});

test("Both channels can be authorized independently", () => {
  const update = buildCantonFeedbackConsentUpdate({
    ...base,
    emailConsent: true,
    whatsappConsent: true,
  });

  assert.equal(update.feedback_email_opt_in_at, timestamp);
  assert.equal(update.feedback_whatsapp_opt_in_at, timestamp);
});

test("Invalid WhatsApp number is rejected", () => {
  assert.throws(() =>
    buildCantonFeedbackConsentUpdate({
      ...base,
      whatsappConsent: true,
      phone: "12345",
    })
  );
});

test("Missing email is rejected when email consent is requested", () => {
  assert.throws(() =>
    buildCantonFeedbackConsentUpdate({
      ...base,
      emailConsent: true,
      email: null,
    })
  );
});

test("Missing consent does not revoke existing permissions", () => {
  const update = buildCantonFeedbackConsentUpdate({
    ...base,
    emailConsent: false,
    whatsappConsent: false,
  });

  assert.equal(update, null);
});

test("Invalid consent timestamp is rejected", () => {
  assert.throws(() =>
    buildCantonFeedbackConsentUpdate({
      ...base,
      emailConsent: true,
      timestamp: "invalid",
    })
  );
});