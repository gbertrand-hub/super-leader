import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCantonWhatsAppEligibility,
} from "../src/lib/canton/whatsapp-eligibility.ts";

const valid = {
  visitStatus: "completed",
  checkedOutAt: "2026-11-27T12:00:00Z",
  phone: "+17375004840",
  whatsappOptIn: true,
  optedInAt: "2026-11-27T09:00:00Z",
  feedbackAlreadyReceived: false,
  invitationAlreadyProcessed: false,
  automationEnabled: true,
};

function check(changes, expected) {
  const result = evaluateCantonWhatsAppEligibility({
    ...valid,
    ...changes,
  });

  assert.equal(result.reason, expected);
}

test("eligible completed visit", () => {
  const result = evaluateCantonWhatsAppEligibility(valid);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "eligible");
});

test("automation disabled blocks invitation", () => {
  check({automationEnabled: false}, "automation_disabled");
});

test("unfinished visit blocks invitation", () => {
  check({visitStatus: "scheduled"}, "visit_not_completed");
});

test("missing checkout blocks invitation", () => {
  check({checkedOutAt: null}, "visit_not_completed");
});

test("missing consent blocks invitation", () => {
  check({whatsappOptIn: false}, "missing_whatsapp_consent");
});

test("missing consent timestamp blocks invitation", () => {
  check({optedInAt: null}, "missing_whatsapp_consent");
});

test("invalid phone blocks invitation", () => {
  check({phone: "12345"}, "invalid_phone");
});

test("existing feedback blocks invitation", () => {
  check({feedbackAlreadyReceived: true}, "feedback_already_received");
});

test("processed invitation blocks duplicate", () => {
  check({invitationAlreadyProcessed: true}, "invitation_already_processed");
});