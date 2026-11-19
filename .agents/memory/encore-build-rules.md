---
name: Encore product and design rules
description: User-confirmed source precedence, scope, and AI spending constraints for Encore
---
The supplied images and HTML references govern the look; the Encore PRD governs behavior when they disagree.

**Why:** The user explicitly confirmed, “The images are the look, the PRD is the behavior. If they disagree on behavior, follow the PRD.”

**How to apply:** Preserve the supplied Encore fonts, colors, Echo logo and layouts while implementing the PRD's behavior. Volunteers never have accounts; organizer accounts use the explicitly requested email/password and session-cookie approach.

Build all P0 requirements in PRD phase order and self-test before P1. Never build P2 or the listed non-goals. Ask at most two clarifying questions in one batch, then choose simple consistent defaults and document them.

**Why:** The user made these standing rules for this app.

**How to apply:** Read the supplied complete PRD for further Encore work and record unresolved choices in the README rather than repeatedly asking.

Keep paid AI off unless deliberately enabled. The user has a small API balance and said to be conservative.

**Why:** The user said, “i have 1 dollor here on my api key but for now i want you to be conservative iwth it.”

**How to apply:** Use no-cost templates for development and self-tests. Keep server-side calls bounded and usage-counted when enabled.

Use the user's own Anthropic account for Claude rather than switching them to Replit-billed AI access.

**Why:** The user supplied a Claude API key for Encore after the original OpenAI-only implementation. Their small provider balance and conservative-spending instruction still apply.

**How to apply:** Keep provider credentials server-side and never treat adding or replacing a key as permission to enable paid calls. Use mocked provider responses for development verification.
