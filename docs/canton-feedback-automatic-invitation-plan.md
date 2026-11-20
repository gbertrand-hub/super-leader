# Canton V4.10.132 — Feedback sans code et invitation automatique

**Status:** design approved in principle, delivery integrations NOT enabled. QA only, no real visitor messages.

## Goal
At departure (Completed), let a visitor answer by scanning the common satisfaction QR without asking reception for a 16-character code. If the visitor has not **submitted feedback**, invite them privately by their allowed channel after a short grace period. A QR scan alone is **not** a completed response.

## Two paths
1. **At the reception:** QR opens a friendly form. Visitor enters full name and last four digits of telephone, or chooses anonymous response. Resolve only a unique completed visit; never reveal candidate names or visit details from a public endpoint. A generic error for missing/ambiguous match, with reception assistance as fallback. Anonymous feedback is not attached to a named appointment and is rate limited.
2. **After departure:** when a visit becomes `completed`, schedule one notification for **15 minutes later**. When due, recheck `canton_visit_feedback` for that exact appointment, check current opt-in/channel preference and opt-out, and cancel if feedback exists. Email first when a verified deliverable email is available and the customer agreed to service feedback invitations. WhatsApp only when an explicit WhatsApp opt-in and a provider-approved template exist. Never assume a telephone number confers WhatsApp permission.
3. Personalized link: `/canton-feedback?token=<opaque-random-single-visit-token>` as URL, not an ID or PII. Server checks completion, expiration (e.g. 7 days), feedback not yet submitted, valid token hash or server-issued token; feedback uniqueness enforced by DB `unique(appointment_id)`. No public list of visitors. Do not expose or log tokens or phone numbers.
4. **No accidental outreach:** Use an idempotent notification outbox with unique `(appointment_id, kind)`. Send workers claim with locking/lease, do not send more than once on retries, record attempts and provider result. Failed sends visible to staff. Route to one channel only unless customer explicitly chose otherwise; no duplicate WhatsApp/email blasts.
5. **Timing:** Recommend 15 minutes after checkout for the first invitation, optionally one gentle follow-up at 24 hours only where law/consent permits, off by default. Suppress outreach after feedback submission, unsubscribe, identity uncertainty, invalid contact, or cancelled visit.

## Permission and delivery constraints
- New fields, ideally in visitor/visit preferences: `feedback_contact_consent`, `feedback_channel` (email | whatsapp | none), `whatsapp_opt_in_at` and proof of consent / source; an explicitly unchecked default.
- Message provider: existing Super Leader email service if a test-only sender/provider is configured. WhatsApp Business Platform or a verified provider + approved template required. Standard personal WhatsApp cannot be silently automated through a simple clickable link.
- Protect the application from production connections via Canton QA gate; **never send email or WhatsApp to real clients during QA**. Integration defaults to `dry-run` and uses .invalid addresses / dummy phones in QA.
- Destination in the queue is scoped to the organization, visit, and allowed channel. Enforce data retention and unsubscribe. Avoid testimonials/marketing language.

## Suggested short invitation (French)
« Bonjour, merci de votre visite chez DIG/TCF à Canton. Votre avis nous aide à améliorer notre accueil. Pouvez-vous nous donner votre impression en moins d'une minute ? [Lien sécurisé]. Si vous ne souhaitez plus recevoir de demandes d'avis, indiquez-le ici. »

## Acceptance tests
- After checkout + no feedback + permission + 15 min: exactly one queued invitation.
- Before due time: feedback arrives by common QR -> queue cancelled, no message.
- After queued but before sending: feedback arrives -> cancelled, no message.
- No phone/email consent: no message.
- WhatsApp with no approved template/provider or opt-in: no message (email only if independently permitted).
- Same visitor multiple legitimate visits: each visit independent, but no spam through provider frequency cap.
- Repeated checkout requests or worker retries: do not send duplicates.
- Two people same name: QR cannot reveal or attach other's visit.
- Returning visitors: same UUID, separate appointments.
- Test-only credentials and masked logs; no actual customer messages in staging.

## Engineering sequence
A. Replace common QR code input with name + last4 lookup and anonymous option, with server-side rate limits and privacy constraints.
B. Reuse existing visit-specific feedback token for direct links; rotate to a hash at rest before production.
C. Add consent preferences + outbox migration; enqueue on checkout (or DB trigger), cancel on feedback.
D. Add read-only QA test page; provider integration via a reviewed test-only email account first.
E. Add WhatsApp Business integration after verified provider/template and documented opt-in.
F. Only after end-to-end QA approval, consider merge to production.
