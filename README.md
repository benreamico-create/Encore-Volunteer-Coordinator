# Encore

Plan the night. Remember it next time.

Encore is a TypeScript/React/Express/PostgreSQL app for organizing recurring community events. Organizers have accounts. Volunteers use a public sign-up page and a private, account-free checklist link.

## Setup

1. Install dependencies with `pnpm install`.
2. Use the Replit-managed PostgreSQL database already attached to this project. `DATABASE_URL` is supplied by Replit; do not commit a connection string.
3. Add `SESSION_SECRET` in Replit Secrets. Use a long random secret, not a password. It is already configured in the current project.
4. For a fresh **development** database, run:
   ```sh
   pnpm --filter @workspace/api-server run db:setup:dev
   ```
   SQL source files live at `lib/db/schema-phase0.sql` through `schema-phase5.sql`. Do not run schema setup in production. Replit Publish manages the production schema diff.
5. Start the existing managed workflows:
   - `artifacts/api-server: API Server`
   - `artifacts/encore: web`
6. Open the app, create an organizer account, then choose **Load demo data** or create a series. No AI or email credentials are required.

The frontend runs at `/`; API requests use `/api`. All data persists in PostgreSQL, including login sessions, monthly AI counters and public endpoint rate limits. No background scheduler or in-memory source of truth is required.

## Secrets and configuration

| Variable | Required | Behavior |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Signs organizer session cookies. Keep secret. Changing it logs out existing sessions. |
| `DATABASE_URL` | Managed | Provided by Replit-managed PostgreSQL; server-side only. |
| `LLM_API_KEY` | No | Optional OpenAI key, read only by the server. Never bundled into the frontend. |
| `CLAUDE_API_KEY` | No | Optional Anthropic key, server-side only. Claude is selected when this is present, including when both keys exist. |
| `LLM_MODEL` | No | Optional override for the selected provider. Defaults to `claude-haiku-4-5` for Claude, or `gpt-4o-mini` for OpenAI. Use a model belonging to the selected provider. |
| `AI_ENABLED` | No | Defaults off. Only the literal value `true`, together with a configured provider key, enables paid calls. Keep off for no-cost demos. |
| `AI_MONTHLY_LIMIT` | No | Default 150 provider attempts per organizer per UTC calendar month. Set to a much smaller number, or 0, for tighter spending control. This is a request count, not a dollar cap. |
| `RESEND_API_KEY` | No | Reserved for P1 email sending; not used by the P0 implementation. |
| `EMAIL_FROM` | No | Reserved for P1; must be an address on a domain you own and verify with Resend. |
| `GOOGLE_CLIENT_ID` | No | Reserved for Tier 4 Google sign-in; email/password remains available. |
| `GOOGLE_CLIENT_SECRET` | No | Server-side OAuth secret paired with `GOOGLE_CLIENT_ID`. |

Never paste credentials into chat, source code, screenshots or README files.

### No-cost mode

The plan drafter, helper and next-event starter use editable, explicitly accepted templates when paid AI is disabled, missing, capped, times out, or returns invalid output. The exact PRD plan template is used. Reminder drafts use the PRD text template. No paid AI calls are made by the self-tests.

The Claude/OpenAI wrapper has a 30-second total deadline, validates JSON, and retries invalid JSON once. Each provider attempt is counted atomically before it starts. Provider and network failures do not get automatic retries. Output is limited to 1,800 tokens per attempt to conserve the API balance. There is no automatic application of AI results. Adding a key does not enable paid calls. Adapter tests use fake keys and mocked responses, never paid requests.

Email sending is off in this P0 build. Reminders can be copied or opened in the organizer's email app. Each personalized draft includes only that volunteer's private link. The general draft intentionally contains no private links; do not paste multiple volunteers' private links into a shared message.

## Main flows

- `/` — organizer signup/login and logout through the app shell.
- `/app` — series switcher, events/progress, fictional demo loader, carried-forward context and a **Create next event** action on finished event cards.
- `/app/series/:id/events/new` — event details, description and purpose wizard.
- `/app/events/:id/plan` — editable draft plan and, after acceptance, saved event details, tasks and roles. Date changes offer an explicit due-date shift; role capacity cannot be reduced below sign-ups.
- `/app/events/:id/tasks` — three-column task board with cards draggable from the whole card body by mouse, highlighted drop columns, keyboard controls, visible per-card Status selectors and Move to menus, assignment and recurring work. On phones, drag from the title handle so normal page scrolling remains easy.
- `/app/events/:id/volunteers` — role management, link/toggles, volunteers, day-of details and reminder drafts.
- `/app/events/:id/chat` — persistent organizer-only event chat and one-way volunteer announcements. Chat polls every five seconds, is rate-limited per organizer, and supports deleting your own messages. Volunteer pages receive only the newest announcement; they never receive chat, organizer account details, or other volunteers' private links.
- `/app/events/:id/wrapup` — notes, reusable resources and next-event starter; old `/app/events/:id/recap` links redirect here. Legacy count and rating columns remain stored, are hidden from this screen, and retain their values when notes are saved.
- `/app/events/:id/next` — selected-only wrap-up carry-over.
- `/join/:slug` — public volunteer signup without login.
- `/v/:token` — private confirmation and checklist; event-day view on the event's date or by organizer toggle.

All demo data is fictional. **Load demo data** creates Calgary Builder Nights with Fall Kickoff, Winter Jam and Spring Mixer, complete recaps for the first two events, four Spring Mixer roles, six fictional volunteers and eight tasks across all three columns. Repeated clicks do not duplicate the series.

## Verification

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run self-test
pnpm --filter @workspace/scripts run encore:check
```

The API self-test runs phase checks in order and deletes its own randomized fictional test accounts and their data afterwards. It covers:

- Signup, logout, login, wrong passwords, hashing, independent sessions and CSRF rejection.
- Organizer isolation, event validation/purpose fields, draft edits/deletion, explicit/idempotent acceptance and progress counts.
- Task/role create-edit-delete, status and ordering changes on tasks with persisted due dates, organizer/volunteer assignment; real calendar-date validation including leap years and clearing a date.
- Event overview editing and persistence, invalid fields, cross-organizer protection, and stable public signup links.
- Public signup, honeypot, simultaneous capacity submissions, closed/full roles, email consent and private-token isolation.
- Event-day mode and checklist-to-board sync; volunteer removal and automatic task cleanup.
- Recap persistence, computed show rate, template starter, selected carry-over, fresh volunteer tokens and ask-again/email consent rules.
- Blueprint map CRUD, percentage bounds, organizer isolation, direct private PNG upload and validation, organizer/linked-volunteer image access, immediate unsharing, cleanup and selected map carry-over.
- Private reminder drafts with sending off and idempotent fictional demo loading.
- Organizer chat polling cursors, message-length and ownership checks, soft-delete updates, cross-session persistence and per-user rate limits; announcement length, history/latest replacement, and the private volunteer/map response shape.

The browser check uses Playwright and a locally installed Chromium (`CHROMIUM_PATH` overrides `/repl/tools/bin/chromium`), against the running preview (`ENCORE_TEST_URL` overrides `http://localhost:80`). It uses real authentication, randomized fictional accounts and ordinary UI interactions. It deletes only those accounts and their fixtures in `finally`. Both suites refuse to run with `AI_ENABLED=true`. Screenshots are written to the ignored `generated-artifacts/core-check/` directory.

### Core release verification

The API suite passed phases 0–4. The browser suite verifies signup/logout/login, the event wizard and purpose fields, editing/deleting template suggestions and accepting the plan, accepted-event edits and due-date confirmation, inline task/role edits, organizer/volunteer assignment, full-card dragging through all three columns, the “Move to…” menu, public signup/full capacity, private event-day checklist sync, reminder copy fallback, Blueprint editing/zoom/pan/responsive positions, sharing revocation, latest-only announcements and chat polling. It checks Dashboard, New event, Plan, Tasks, Volunteers, Blueprint, Chat, Wrap-up and Next event at 375px and 1280px, including the mobile sidebar drawer. Public signup/private/map screens are checked at both widths too.

Fixed during verification: next-event creation no longer requires a wrap-up; its dashboard action is available for every event. Existing selections carry forward without inventing lessons. Dashboard/Volunteers/Wrap-up no longer overflow at phone width. The sidebar chevron manually collapses/expands; clicking the primary logo goes to the dashboard and persists the collapsed state.

**Gate limitation — do not treat owner sessions as two different organizers:** §0.6 item 11 asks for two organizer accounts in the same event, but F-3 assigns teammate invitations/permissions to P1. The existing owner-only authorization correctly denies unrelated accounts. Chat polling passed between two independently authenticated browser sessions of the same owner, and unrelated-account/volunteer access was denied; collaboration between two distinct organizer accounts is **not verified or available**. The literal full P0 gate is therefore not cleared. Resolve this prerequisite before starting the queued P1 work, rather than weakening organizer isolation. No paid AI requests or emails were sent.

### v2.1 Tier 1 status

Tier 1 updated the existing app in place. The 72px desktop rail and mobile bottom tabs are live; Chat and Sponsors remain marked as coming soon. The saved Plan view edits existing records and adds suggestions without replacing accepted work. The new plan suggestion endpoint applies selected additions in one transaction.

To check this tier, use the `/app` series dashboard, open a finished event and select **Create next event**; open a planned event and edit its Plan; edit a due-date task, then change the event date and choose whether to shift unfinished task deadlines; lower role capacity below existing sign-ups and confirm it is blocked; open **Wrap-up** and save notes; visit the old `/recap` URL and confirm it redirects; resize below 900px to see the bottom tabs. The update prompt's one-time "Update demo data" action is deferred until the later v2.1 demo features exist.

Tier 1 verification passed `pnpm run typecheck`, all four API self-test phases, and the Encore production build. No live AI calls or emails were sent.

### v2.1 Tier 2 Blueprint status

Blueprint adds an event-specific private venue map, PNG/JPG upload (5 MB maximum) or a blank grid, draggable/resizable booth, station, zone, stage, and entrance items, station-to-role links, map sharing, and a token-scoped volunteer view. Coordinates are percentages, so item placement survives viewport resizing. Map images are stored in private App Storage and served only after the organizer session or a volunteer token with sharing enabled and a linked station is checked. New events can optionally carry map items; sharing starts off, and booth vendor names carry only when the matching vendor resource is marked “use again.”

Apply additive development schema updates with `artifacts/api-server/scripts/setup-dev-db.mjs`. Production environments must apply `lib/db/schema-phase4.sql` before serving Blueprint routes and `lib/db/schema-phase5.sql` before serving chat and announcement routes. Existing event, role, task, and volunteer records are preserved.

The following remain outside Tier 2: chat and announcements (Tier 3); P1 map helper hints and resource-to-booth placement; P1 sponsors, email, and Google sign-in. The authenticated desktop/mobile interaction pass remains a separate release check. No paid AI calls or email messages are needed for Blueprint.

Initial verification passed all four API phase checks and the full project typecheck. Screenshots confirmed signup/login at 1280px and 375px, volunteer signup at 375px and 1280px (including a full role), and volunteer confirmation/event-day views at 375px. Temporary visual-test data was removed afterwards. No paid model calls or emails were sent.

Blueprint verification also passed all four API phases, full project typecheck, API server build and Encore production build. The map test exercises a real private App Storage upload/download/delete cycle and confirms organizer and linked-volunteer access, unsharing revocation, map item behavior and carry-forward. The authenticated Blueprint editor itself remains part of the separate desktop/mobile browser release check.

### v2.1 Tier 3 chat and announcements

Chat is available at `/app/events/:id/chat`. Messages are stored per event, limited to 2,000 characters, polled by cursor every five seconds, and soft-deleted so other open chat sessions can show deletion updates. Sending is rate-limited per organizer account. Announcements are stored as history, while only the newest body and timestamp are included in a volunteer's existing private-page and map responses. The public signup and private token-link model is unchanged; volunteers cannot read or post organizer chat or announcements.

The current account model gives each series one owner, so chat access is scoped to that owner. Co-organizer invitations and shared roles remain P1. The announcement drafter uses the existing server-side AI wrapper only when an organizer explicitly selects **Draft one**; it remains an editable, unpublished draft, and the deterministic template works with paid AI disabled.

### Global helper drawer

The gold helper buttons open a screen-aware drawer without leaving the current organizer page; below 900px it becomes a bottom sheet. The Tasks screen keeps its docked helper, and the rail button scrolls to and focuses that panel. Prompts and the server-side snapshot vary by screen. Chat context contains message and announcement counts only, never message text. Suggestions remain drafts until an organizer applies an action. With `AI_ENABLED` unset or false, the server returns deterministic screen-specific templates and makes no paid model calls.

The helper check passed in all API self-test phases and the authenticated browser suite: screen labels/prompts, action-only changes, Escape and focus restoration, a 375px bottom sheet, Tasks-panel focus, and organizer routes at 375px/1280px. No paid AI calls were made.

Event-editor/task-board regression verification also passed all four API phases, the full typecheck and the frontend production build. A signed-in browser pass at 1280px verified event editing, save/cancel, reload persistence, pointer-dragging dated tasks through all three columns, same-column reordering and the Status selector. At 375px it verified the scrollable editor, accessible save/cancel controls, status changes and no horizontal overflow. Touch-hold dragging was not exercised because the test browser lacks touch emulation; this is not a claim that the entire PRD 0.6 release gate has passed.

Authenticated-screen verification on November 23, 2026 used the fictional Calgary Builder Nights demo. Plan, Wrap-up, dashboard, task board and navigation were reviewed at 375px and 1280px with no horizontal overflow. Desktop navigation and the mobile More menu both navigated correctly; desktop pointer drag and mobile touch-hold drag moved tasks between columns. Changing the event date showed the due-date confirmation, shifted unfinished task dates and preserved completed dates. Reducing a full volunteer role below its signup count was blocked, and the old `/recap` route redirected to `/wrapup`.

The first dashboard request exposed an outdated development database schema; the documented additive `db:setup:dev` step restored the missing development columns. The API self-test passed phases 0–4. The current full workspace typecheck and Encore production build also pass. The build reports non-blocking third-party sourcemap and bundle-size warnings.

## Decisions

1. **Source precedence:** supplied original screen assets/HTML govern appearance; the PRD governs behavior. Exact Young Serif, Figtree and DM Mono fonts and the supplied Echo logo are used.
2. **Custom organizer auth is intentional:** the PRD explicitly requires email/password with hashed storage and a session cookie. Passwords use Node's scrypt with a random salt. Sessions live in PostgreSQL; cookies are HttpOnly and SameSite=Lax, and Secure in production. Organizer writes require a session-bound CSRF token.
3. **No volunteer accounts:** public slugs include a random suffix. Private volunteer links use 192-bit cryptographic random tokens. They cannot read other volunteers or update unassigned/other volunteers' tasks.
4. **Protect the API balance:** paid AI is opt-in using `AI_ENABLED=true`. Development and integration tests stay in template mode. The user supplied a Claude key after the initial build, so the wrapper supports Anthropic directly and retains the existing OpenAI adapter. Claude takes precedence when both keys exist. The model defaults to the economical Haiku rather than a larger model.
5. **Conflicting template task counts:** the exact PRD 10.4 fallback has 17 tasks, although 10.1 constrains model output to 8–16. The exact fallback template takes precedence for template mode; paid model output is constrained to 8–16.
6. **Acceptance and capacity are atomic:** accepting a plan twice does not duplicate work. Signup and role-capacity edits lock the event row in a database transaction to prevent overbooking across Autoscale instances.
7. **Carry-over is selected, not automatic:** lessons/notes, use-again resources, roles, recurring tasks and willing volunteers each have a choice. Volunteers retain their role, so roles must also be selected when carrying volunteers. New private tokens are generated; emails carry only with both ask-again and email consent. New event checklists are not pre-completed.
8. **Dates:** default America/Edmonton and CAD. Event instants are stored in UTC; task due dates remain `YYYY-MM-DD` calendar strings, including when read from PostgreSQL. Task due offsets and event-day switching use the event's timezone, not the browser's timezone. Editing an event preserves its tasks, signups, and public/private links. On a date change, the organizer can choose to shift unfinished task deadlines by the event-local calendar-day change; completed task deadlines stay unchanged, and the plan is not redrafted.
9. **Attendance is typed and aggregate-only:** no attendee records are collected. A zero registered count has no computable show rate.
10. **Safe reminder sharing:** a general draft can be shared with a group; individualized drafts must be sent separately so private tokens stay private.
11. **Scope gate:** build only the PRD phases and features currently approved; do not treat the supplied flow-map HTML as an app screen. The broader PRD 0.6 cross-surface check remains a separate release gate.
12. **Helper context:** send a validated screen name and only a bounded, event-owned snapshot to the server-side helper. Chat summaries use counts only, and suggested changes are never applied until the organizer chooses an action.
13. **Fictional demo only:** relative dates keep the demo's Spring Mixer upcoming. Real event data must be entered manually after publishing; it is not in seeds.

## Publishing

The project is configured for **Autoscale**, with static frontend assets and a running Express API. Sessions, rate limits and all application data live in PostgreSQL.

Before clicking Publish:

1. Complete the remaining interactive release checklist above.
2. In Publishing → Adjust settings → Machine configuration → Edit, set **Max machines to 1** for the initial small demo. This is a Publishing UI setting, not an application-code limit; it has not been set by the application.
3. Ensure `SESSION_SECRET` is available to production and leave paid AI off unless deliberately enabling it.
4. Review and apply Replit's managed development-to-production database schema diff through Publish.
5. Use a public deployment so volunteers can open their account-free signup/private pages.
6. Publish, then create an organizer account in production and load fictional demo data there. Development users and demo fixtures should not be assumed to be production records.
7. Share the signup URL copied inside the **published** app. The app uses the current real origin, never a placeholder URL.

Publishing requires the user's Publish action. There is no production URL until publishing succeeds.

## Left unbuilt

### P1 — deferred behind the P0 release gate

- Resend confirmation and organizer-triggered reminder sending, send confirmations, throttling and email logs (F-27/F-28).
- Co-organizer invite links and owner/editor/viewer access (F-3).
- Volunteer cancellation and calendar `.ics` download (F-23/F-24).
- Email password reset (F-1b).
- Organizer account/data export and deletion from Sections 12–13.

### Explicitly excluded

No P2, attendance CSV import (F-32), attendance/show-rate trends (F-33), Eventbrite pull, venue/sponsor pipeline or reserved pipeline tables. No ticketing, payments, RSVP, public discovery, volunteer chat, bulk campaigns, native app, billing/subscriptions, calendar sync or scheduled background reminders.

Entering a real past event, domain verification, production publishing and choosing the Publishing machine cap are not silently simulated.
