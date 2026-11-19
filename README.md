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
   SQL source files live at `lib/db/schema-phase0.sql` through `schema-phase3.sql`. Do not run schema setup in production. Replit Publish manages the production schema diff.
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

Never paste credentials into chat, source code, screenshots or README files.

### No-cost mode

The plan drafter, helper and next-event starter use editable, explicitly accepted templates when paid AI is disabled, missing, capped, times out, or returns invalid output. The exact PRD plan template is used. Reminder drafts use the PRD text template. No paid AI calls are made by the self-tests.

The Claude/OpenAI wrapper has a 30-second total deadline, validates JSON, and retries invalid JSON once. Each provider attempt is counted atomically before it starts. Provider and network failures do not get automatic retries. Output is limited to 1,800 tokens per attempt to conserve the API balance. There is no automatic application of AI results. Adding a key does not enable paid calls. Adapter tests use fake keys and mocked responses, never paid requests.

Email sending is off in this P0 build. Reminders can be copied or opened in the organizer's email app. Each personalized draft includes only that volunteer's private link. The general draft intentionally contains no private links; do not paste multiple volunteers' private links into a shared message.

## Main flows

- `/` — organizer signup/login and logout through the app shell.
- `/app` — series switcher, events/progress, fictional demo loader and carried-forward context.
- `/app/series/:id/events/new` — event details, description and purpose wizard.
- `/app/events/:id/plan` — editable draft tasks/roles, explicit acceptance, and **Edit event information** for the overview (name, date/time, city/place, guests, budget, description and purpose).
- `/app/events/:id/tasks` — three-column task board with cards draggable from the whole card body by mouse, highlighted drop columns, keyboard controls, visible per-card Status selectors and Move to menus, assignment and recurring work. On phones, drag from the title handle so normal page scrolling remains easy.
- `/app/events/:id/volunteers` — role management, link/toggles, volunteers, day-of details and reminder drafts.
- `/app/events/:id/recap` — typed attendance, show rate, ratings, notes, reusable resources and starter draft.
- `/app/events/:id/next` — selected-only recap carry-over.
- `/join/:slug` — public volunteer signup without login.
- `/v/:token` — private confirmation and checklist; event-day view on the event's date or by organizer toggle.

All demo data is fictional. **Load demo data** creates Calgary Builder Nights with Fall Kickoff, Winter Jam and Spring Mixer, complete recaps for the first two events, four Spring Mixer roles, six fictional volunteers and eight tasks across all three columns. Repeated clicks do not duplicate the series.

## Verification

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run self-test
```

The API self-test runs phase checks in order and deletes its own randomized fictional test accounts and their data afterwards. It covers:

- Signup, logout, login, wrong passwords, hashing, independent sessions and CSRF rejection.
- Organizer isolation, event validation/purpose fields, draft edits/deletion, explicit/idempotent acceptance and progress counts.
- Task/role create-edit-delete, status and ordering changes on tasks with persisted due dates, organizer/volunteer assignment; real calendar-date validation including leap years and clearing a date.
- Event overview editing and persistence, invalid fields, cross-organizer protection, and stable public signup links.
- Public signup, honeypot, simultaneous capacity submissions, closed/full roles, email consent and private-token isolation.
- Event-day mode and checklist-to-board sync; volunteer removal and automatic task cleanup.
- Recap persistence, computed show rate, template starter, selected carry-over, fresh volunteer tokens and ask-again/email consent rules.
- Private reminder drafts with sending off and idempotent fictional demo loading.

These are API integration checks, not an end-to-end browser certification. The complete PRD 0.6 browser checklist (including drag/touch interactions and every authenticated screen at both 375px and 1280px) remains the release gate before P1. Do not treat a typecheck as proof of those interactions.

Initial verification passed all four API phase checks and the full project typecheck. Screenshots confirmed signup/login at 1280px and 375px, volunteer signup at 375px and 1280px (including a full role), and volunteer confirmation/event-day views at 375px. Temporary visual-test data was removed afterwards. No paid model calls or emails were sent.

Event-editor/task-board regression verification also passed all four API phases, the full typecheck and the frontend production build. A signed-in browser pass at 1280px verified event editing, save/cancel, reload persistence, pointer-dragging dated tasks through all three columns, same-column reordering and the Status selector. At 375px it verified the scrollable editor, accessible save/cancel controls, status changes and no horizontal overflow. Touch-hold dragging was not exercised because the test browser lacks touch emulation; this is not a claim that the entire PRD 0.6 release gate has passed.

## Decisions

1. **Source precedence:** supplied original screen assets/HTML govern appearance; the PRD governs behavior. Exact Young Serif, Figtree and DM Mono fonts and the supplied Echo logo are used.
2. **Custom organizer auth is intentional:** the PRD explicitly requires email/password with hashed storage and a session cookie. Passwords use Node's scrypt with a random salt. Sessions live in PostgreSQL; cookies are HttpOnly and SameSite=Lax, and Secure in production. Organizer writes require a session-bound CSRF token.
3. **No volunteer accounts:** public slugs include a random suffix. Private volunteer links use 192-bit cryptographic random tokens. They cannot read other volunteers or update unassigned/other volunteers' tasks.
4. **Protect the API balance:** paid AI is opt-in using `AI_ENABLED=true`. Development and integration tests stay in template mode. The user supplied a Claude key after the initial build, so the wrapper supports Anthropic directly and retains the existing OpenAI adapter. Claude takes precedence when both keys exist. The model defaults to the economical Haiku rather than a larger model.
5. **Conflicting template task counts:** the exact PRD 10.4 fallback has 17 tasks, although 10.1 constrains model output to 8–16. The exact fallback template takes precedence for template mode; paid model output is constrained to 8–16.
6. **Acceptance and capacity are atomic:** accepting a plan twice does not duplicate work. Signup and role-capacity edits lock the event row in a database transaction to prevent overbooking across Autoscale instances.
7. **Carry-over is selected, not automatic:** lessons/notes, use-again resources, roles, recurring tasks and willing volunteers each have a choice. Volunteers retain their role, so roles must also be selected when carrying volunteers. New private tokens are generated; emails carry only with both ask-again and email consent. New event checklists are not pre-completed.
8. **Dates:** default America/Edmonton and CAD. Event instants are stored in UTC; task due dates remain `YYYY-MM-DD` calendar strings, including when read from PostgreSQL. Task due offsets and event-day switching use the event's timezone, not the browser's timezone. Editing an event preserves its tasks, signups, public/private links and existing due dates; the editor explains that rescheduling does not silently shift deadlines or redraft the plan.
9. **Attendance is typed and aggregate-only:** no attendee records are collected. A zero registered count has no computable show rate.
10. **Safe reminder sharing:** a general draft can be shared with a group; individualized drafts must be sent separately so private tokens stay private.
11. **Scope gate:** P0 is the initial build. P1 remains deferred until the complete P0 release checklist passes. The supplied flow-map HTML is documentation only, not an app screen.
12. **Fictional demo only:** relative dates keep the demo's Spring Mixer upcoming. Real event data must be entered manually after publishing; it is not in seeds.

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
- Attendance CSV upload with column mapping and malformed-row feedback (F-32).
- Series attendance/show-rate trends (F-33).
- Co-organizer invite links and owner/editor/viewer access (F-3).
- Volunteer cancellation and calendar `.ics` download (F-23/F-24).
- Email password reset (F-1b).
- Organizer account/data export and deletion from Sections 12–13.

### Explicitly excluded

No P2, Eventbrite pull, venue/sponsor pipeline or reserved pipeline tables. No ticketing, payments, RSVP, public discovery, inbox/chat, bulk campaigns, native app, billing/subscriptions, calendar sync or scheduled background reminders.

Entering a real past event, domain verification, production publishing and choosing the Publishing machine cap are not silently simulated.
