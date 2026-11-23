import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import pg from "pg";

// Uses the normal UI, cookies and CSRF protection. Never bypasses authentication.
// Run with: pnpm --filter @workspace/scripts run encore:check
const baseURL = process.env.ENCORE_TEST_URL || "http://localhost:80";
assert.notEqual(process.env.AI_ENABLED, "true", "Turn paid AI off before running core checks.");
const output = new URL("../../generated-artifacts/core-check/", import.meta.url).pathname;
const email = `browser-${randomBytes(8).toString("hex")}@example.invalid`;
const password = randomBytes(18).toString("hex");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
const layoutFailures = [];
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const testid = (id, p = page) => p.getByTestId(id);
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
let csrf = "";
async function api(path, method = "GET", data, expected = 200, ctx = context) {
  if (method !== "GET" && ctx === context && !csrf) {
    csrf = (await (await context.request.get("/api/auth/me")).json()).csrfToken;
  }
  const res = await ctx.request.fetch(`/api${path}`, {
    method, data,
    headers: ctx === context ? { "x-csrf-token": csrf } : {},
  });
  assert.equal(res.status(), expected, `${method} ${path.replace(/\/v\/[^/]+/, "/v/[private]")}: ${res.status()}`);
  return res.json();
}
async function waitUntil(fn, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out: ${label}`);
}
async function noOverflow(p, label) {
  await p.waitForTimeout(400);
  const result = await p.evaluate(() => ({
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("main *, form *, [role=dialog] *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width && r.right > window.innerWidth + 2 && getComputedStyle(el).position !== "fixed";
      }).slice(0, 8).map((el) => ({ tag: el.tagName, test: el.getAttribute("data-testid"), class: el.className })),
  }));
  if (result.width > result.viewport + 1) {
    const failure = `${label}: ${JSON.stringify(result)}`;
    layoutFailures.push(failure);
    console.log(`LAYOUT FAIL ${failure}`);
  }
}
async function visit(path, ready, width = 1280, p = page) {
  await p.setViewportSize({ width, height: 900 });
  await p.goto(path);
  await testid(ready, p).waitFor({ state: "visible" });
  await noOverflow(p, `${path.replace(/\/v\/[^/]+/, "/v/[private]")} @ ${width}`);
}
await mkdir(output, { recursive: true });
try {
  // Refuse any live paid calls even if a developer accidentally enables them.
  const settings = await pool.query("SELECT 1"); // Ensure cleanup is available before creating fixtures.
  assert.equal(settings.rowCount, 1);
  await visit("/", "form-auth", 375);
  await testid("tab-signup").click();
  await testid("input-name").fill("Fictional Browser Organizer");
  await testid("input-email").fill(email);
  await testid("input-password").fill(password);
  await testid("button-submit-auth").click();
  await page.waitForURL("**/app");
  const session = await api("/auth/me");
  assert(session.user.id);
  csrf = session.csrfToken;
  assert.equal(session.ai_remaining, 150);
  console.log("PASS browser signup and authenticated dashboard");

  // Create the series through the API (its dialog is tested elsewhere), event through the wizard.
  const series = await api("/series", "POST", { name: "Fictional Browser Series", description: "Disposable core checks" });
  await visit(`/app/series/${series.id}/events/new`, "form-new-event", 375);
  await testid("input-description").fill("A fictional community maker gathering with volunteer check-in.");
  await testid("input-event-name").fill("Fictional Browser Event");
  await testid("input-event-date").fill("2027-04-10");
  await testid("input-event-time").fill("18:30");
  await testid("input-purpose-why").fill("Help people meet");
  await testid("input-purpose-who").fill("Fictional makers");
  await testid("input-purpose-leave").fill("A new connection");
  await testid("button-draft-plan").click();
  await page.waitForURL(/\/events\/\d+\/plan$/);
  await testid("button-accept-plan").waitFor();
  const id = Number(page.url().match(/events\/(\d+)/)[1]);
  await noOverflow(page, "editable plan @ 375");
  assert.match(await testid("text-draft-notice").innerText(), /template/);
  const titles = page.locator('[data-testid^="input-task-title-"]');
  await titles.first().fill("Edited in browser");
  await page.locator('[data-testid^="button-remove-task-"]').nth(1).click();
  await testid("button-accept-plan").click();
  await page.waitForURL(/\/events\/\d+\/tasks$/);
  let bundle = await api(`/events/${id}`);
  assert.equal(bundle.tasks.length, 16);
  assert(bundle.tasks.some((t) => t.title === "Edited in browser"));
  assert.equal(bundle.event.purpose_why, "Help people meet");
  console.log("PASS phone wizard, editable template and plan acceptance");

  // A persisted dated card must move by pointer anywhere on its non-interactive area.
  const task = bundle.tasks.find((t) => t.title === "Edited in browser");
  await visit(`/app/events/${id}/tasks`, `drag-task-${task.id}`);
  const card = testid(`card-task-${task.id}`);
  const drop = page.locator('[data-testid="column-doing"]');
  async function dragTo(status) {
    const from = await card.boundingBox();
    const to = await testid(`column-${status}`).boundingBox();
    assert(from && to);
    // Bottom padding rather than the title/drag handle.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height - 5);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height - 5, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 70, { steps: 20 });
    await page.mouse.up();
    await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).status === status, `drag to ${status}`);
  }
  await drop.waitFor();
  for (const status of ["doing", "done", "todo"]) await dragTo(status);
  await testid(`button-task-menu-${task.id}`).click();
  await testid(`menu-move-${task.id}`).hover();
  await testid(`menu-move-${task.id}-done`).click();
  await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).status === "done", "Move to menu");
  assert.equal((await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).due_date, task.due_date);
  console.log("PASS full-card dragging through all columns and Move to menu with persisted dates");

  // Public sign-up has no organizer cookies.
  const role = await api(`/events/${id}/roles`, "POST", { name: "Fictional single place", instruction: "Welcome guests", slots_needed: 1 });
  const publicContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 } });
  const volunteerPage = await publicContext.newPage();
  volunteerPage.on("pageerror", (e) => errors.push(e.message));
  await visit(`/join/${bundle.event.signup_slug}`, "form-join", 375, volunteerPage);
  await testid(`option-role-${role.id}`, volunteerPage).click();
  await testid("input-name", volunteerPage).fill("Fictional Volunteer");
  await testid("checkbox-ask-again", volunteerPage).check();
  await testid("button-count-me-in", volunteerPage).click();
  await testid("text-you-are-in", volunteerPage).waitFor();
  const token = volunteerPage.url().match(/\/v\/([^/]+)/)[1];
  await noOverflow(volunteerPage, "volunteer confirmation @ 375");
  const fullPage = await publicContext.newPage();
  await visit(`/join/${bundle.event.signup_slug}`, "form-join", 375, fullPage);
  assert(await testid(`option-role-${role.id}`, fullPage).getByRole("radio").isDisabled());
  assert.match(await testid(`option-role-${role.id}`, fullPage).innerText(), /Full/);
  bundle = await api(`/events/${id}`);
  assert(bundle.tasks.some((t) => t.source === "signup"));
  await fullPage.close();
  console.log("PASS unauthenticated phone signup, confirmation, capacity Full and signup task");

  // Accepted-plan editing updates existing public/private links, not just the writer's cache.
  await visit(`/app/events/${id}/plan`, "button-edit-event-overview", 375);
  await testid("button-edit-event-overview").click();
  await testid("input-edit-event-name").fill("Fictional Browser Event updated");
  await testid("input-edit-event-date").fill("2027-04-11");
  await noOverflow(page, "event editor @ 375");
  await testid("button-save-event").click();
  await testid("checkbox-move-due-dates").waitFor();
  await testid("checkbox-move-due-dates").check();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save changes", exact: true }).click();
  await waitUntil(async () => (await api(`/events/${id}`)).event.name.endsWith("updated"), "event edits");
  await testid(`saved-task-title-${task.id}`).fill("Edited inline after accept");
  await testid(`saved-task-title-${task.id}`).press("Enter");
  await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).title === "Edited inline after accept", "inline title");
  await testid(`saved-role-instruction-${role.id}`).fill("Updated fictional role instructions");
  await testid(`saved-role-instruction-${role.id}`).press("Tab");
  await waitUntil(async () => (await api(`/events/${id}`)).roles.find((r) => r.id === role.id).instruction === "Updated fictional role instructions", "inline role instructions");
  await testid(`saved-task-owner-${task.id}`).selectOption(`user:${session.user.id}`);
  await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).assignee_user_id === session.user.id, "organizer assignment");
  const volunteer = bundle.volunteers.find((v) => v.role_id === role.id);
  await testid(`saved-task-owner-${task.id}`).selectOption(`volunteer:${volunteer.id}`);
  await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).assignee_volunteer_id === volunteer.id, "volunteer assignment");
  await volunteerPage.reload();
  await testid("text-you-are-in", volunteerPage).waitFor();
  assert.match(await volunteerPage.locator("body").innerText(), /Fictional Browser Event updated/);
  assert.match(await volunteerPage.locator("body").innerText(), /Apr(?:il)? 11/);
  assert.match(await volunteerPage.locator("body").innerText(), /Updated fictional role instructions/);
  await visit(`/app/events/${id}/volunteers`, "panel-latest-signups", 375);
  await testid("switch-event-day").click();
  await waitUntil(async () => (await api(`/events/${id}`)).event.event_day_mode, "event day toggle");
  await volunteerPage.reload();
  await testid("card-countdown", volunteerPage).waitFor();
  const signupTask = bundle.tasks.find((t) => t.source === "signup");
  await testid(`checkbox-task-${signupTask.id}`, volunteerPage).locator("..").click();
  await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === signupTask.id).status === "done", "volunteer checklist sync");
  await testid("button-reminder").click();
  await testid("input-reminder-message").waitFor();
  assert((await testid("input-reminder-message").inputValue()).length > 30);
  await testid("button-copy-reminder").click();
  assert.equal(await page.getByRole("button", { name: /Send reminder/i }).count(), 0);
  await page.keyboard.press("Escape");
  console.log("PASS accepted-event edits, inline task/role edits, assignments, private checklist sync and reminder fallback");

  // Blueprint real pointer editing, percent coordinates, sharing and responsive position.
  await visit(`/app/events/${id}/blueprint`, "blueprint-canvas");
  await testid("button-start-blank-grid").click();
  const booth = await api(`/events/${id}/map/items`, "POST", { kind: "booth", label: "Fictional booth", x_pct: 10, y_pct: 20, w_pct: 14, h_pct: 12 });
  const station = await api(`/events/${id}/map/items`, "POST", { kind: "station", label: "Fictional post", x_pct: 45, y_pct: 20, w_pct: 14, h_pct: 12, role_id: role.id });
  const zone = await api(`/events/${id}/map/items`, "POST", { kind: "zone", label: "Fictional zone", x_pct: 70, y_pct: 60, w_pct: 14, h_pct: 12 });
  await page.reload();
  await testid(`map-item-${booth.id}`).click();
  await testid("input-item-label").fill("Renamed fictional booth");
  await testid("button-save-item-details").click();
  await waitUntil(async () => (await api(`/events/${id}/map`)).items.find((i) => i.id === booth.id).label === "Renamed fictional booth", "map rename");
  const resize = await testid(`button-resize-${booth.id}`).boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + 35, resize.y + 25, { steps: 10 });
  await page.mouse.up();
  await waitUntil(async () => (await api(`/events/${id}/map`)).items.find((i) => i.id === booth.id).w_pct > booth.w_pct, "map resize");
  await testid(`map-item-${zone.id}`).click();
  await testid("button-delete-item").click();
  await waitUntil(async () => !(await api(`/events/${id}/map`)).items.some((i) => i.id === zone.id), "map delete");
  await testid("button-zoom-in").click();
  assert.equal(await testid("text-zoom").innerText(), "110%");
  await testid("blueprint-canvas").scrollIntoViewIfNeeded();
  const stage = await testid("blueprint-canvas").boundingBox();
  const panStart = { x: stage.x + stage.width * .5, y: stage.y + stage.height * .65 };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 20, panStart.y + 25, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.match(await testid("blueprint-canvas").getAttribute("style"), /translate\((?!0px, 0px)/);
  await page.reload();
  await testid(`map-item-${booth.id}`).waitFor();
  const geometry = (await api(`/events/${id}/map`)).items.find((i) => i.id === booth.id);
  await page.setViewportSize({ width: 375, height: 900 });
  await noOverflow(page, "Blueprint @ 375");
  const ratios = await testid(`map-item-${booth.id}`).evaluate((el) => {
    const item = el.getBoundingClientRect(), stage = el.parentElement.getBoundingClientRect();
    return { x: (item.left - stage.left) / stage.width * 100, y: (item.top - stage.top) / stage.height * 100 };
  });
  assert(Math.abs(ratios.x - geometry.x_pct) < .5 && Math.abs(ratios.y - geometry.y_pct) < .5);
  await api(`/events/${id}/map-sharing`, "PATCH", { map_shared: true });
  await volunteerPage.reload();
  await testid("link-volunteer-map", volunteerPage).click();
  await testid("text-own-station", volunteerPage).waitFor();
  assert.match(await volunteerPage.locator("body").innerText(), /Your post/i);
  await noOverflow(volunteerPage, "volunteer map @ 375");
  await api(`/events/${id}/map-sharing`, "PATCH", { map_shared: false });
  await volunteerPage.reload();
  await testid("link-back-shift", volunteerPage).waitFor();
  assert.equal(await testid("panel-volunteer-map", volunteerPage).count(), 0);
  assert.equal((await publicContext.request.get(`/api/events/${id}/messages`)).status(), 401);
  console.log("PASS Blueprint rename, resize, deletion, zoom, pan, responsive position and private sharing");

  // Cross-browser polling uses two normal sessions for the same organizer.
  // Separate teammate accounts remain a P1 invite/access prerequisite, not claimed here.
  const secondContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const me = await (await secondContext.request.get("/api/auth/me")).json();
  assert.equal((await secondContext.request.post("/api/auth/login", { headers: { "x-csrf-token": me.csrfToken }, data: { email, password } })).status(), 200);
  const secondPage = await secondContext.newPage();
  secondPage.on("pageerror", (e) => errors.push(e.message));
  await visit(`/app/events/${id}/chat`, "input-chat-message", 1280);
  await visit(`/app/events/${id}/chat`, "input-chat-message", 1280, secondPage);
  await testid("input-chat-message").fill("Fictional cross-session message");
  await testid("button-send-message").click();
  await secondPage.getByText("Fictional cross-session message", { exact: true }).waitFor({ timeout: 10000 });
  await testid("input-announcement-body").fill("First fictional announcement");
  await testid("button-post-announcement").click();
  await testid("text-current-announcement").filter({ hasText: "First fictional announcement" }).waitFor();
  await testid("input-announcement-body").fill("Replacement fictional announcement");
  await testid("button-post-announcement").click();
  await volunteerPage.goto(`/v/${token}`);
  await testid("text-latest-announcement", volunteerPage).filter({ hasText: "Replacement fictional announcement" }).waitFor();
  assert(!((await volunteerPage.locator("body").innerText()).includes("First fictional announcement")));
  console.log("PASS chat polling between sessions, latest-only volunteer announcement and chat denied to tokens");

  // All signed-in routes at both required widths, plus manual sidebar controls.
  const screens = [
    ["/app", `card-event-${id}`],
    [`/app/series/${series.id}/events/new`, "form-new-event"],
    [`/app/events/${id}/plan`, "panel-event-overview"],
    [`/app/events/${id}/tasks`, "button-new-task"],
    [`/app/events/${id}/volunteers`, "text-page-title"],
    [`/app/events/${id}/blueprint`, "blueprint-canvas"],
    [`/app/events/${id}/chat`, "input-chat-message"],
    [`/app/events/${id}/wrapup`, "text-page-title"],
    [`/app/events/${id}/next`, "form-next"],
  ];
  for (const width of [375, 1280]) {
    for (const [path, ready] of screens) {
      await visit(path, ready, width);
      if (path.endsWith("/tasks")) await page.screenshot({ path: `${output}tasks-${width}.png` });
      if (width === 375) {
        await testid("button-toggle-sections").click();
        await testid("button-close-sections").waitFor({ state: "visible" });
        await noOverflow(page, `open sidebar ${path} @ 375`);
        await page.keyboard.press("Escape");
        await testid("button-toggle-sections").focus();
        await page.keyboard.press("Enter");
        await testid("button-close-sections").click();
      }
    }
    await visit(`/join/${bundle.event.signup_slug}`, "form-join", width, volunteerPage);
    await visit(`/v/${token}`, "card-countdown", width, volunteerPage);
    await api(`/events/${id}/map-sharing`, "PATCH", { map_shared: true });
    await visit(`/v/${token}/map`, "panel-volunteer-map", width, volunteerPage);
  }
  await visit(`/app/events/${id}/tasks`, "button-new-task", 375);
  await testid("tab-col-done").click();
  await testid(`select-task-status-${task.id}`).selectOption("todo");
  await waitUntil(async () => (await api(`/events/${id}`)).tasks.find((t) => t.id === task.id).status === "todo", "phone status alternative");
  await visit(`/app/events/${id}/tasks`, `drag-task-${task.id}`);
  await testid("button-toggle-sidebar").click();
  assert.equal(await testid("button-toggle-sidebar").getAttribute("aria-expanded"), "false");
  await testid("button-toggle-sidebar").click();
  assert.equal(await testid("button-toggle-sidebar").getAttribute("aria-expanded"), "true");
  await testid("link-home").click();
  await page.waitForURL("**/app");
  assert.equal(await testid("button-toggle-sidebar").getAttribute("aria-expanded"), "false");
  await page.reload();
  await testid("button-toggle-sidebar").waitFor();
  assert.equal(await testid("button-toggle-sidebar").getAttribute("aria-expanded"), "false");

  await visit(`/app/events/${id}/next`, "form-next", 375);
  await testid("input-next-name").fill("Fictional next from dashboard");
  await testid("input-next-date").fill("2027-05-15");
  await testid("button-create-event-n").click();
  await page.waitForURL(/\/events\/\d+\/plan$/);
  const nextId = Number(page.url().match(/events\/(\d+)/)[1]);
  assert.notEqual(nextId, id);
  assert.equal((await api(`/events/${nextId}`)).event.previous_event_id, id);
  assert((await api(`/events/${nextId}`)).volunteers.some((v) => v.name === "Fictional Volunteer"));
  console.log("PASS next event creation without a saved wrap-up");

  // A genuinely unrelated account must not see the organizer's series or event UI.
  const isolated = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 } });
  const isolatedMe = await (await isolated.request.get("/api/auth/me")).json();
  assert.equal((await isolated.request.post("/api/auth/signup", { headers: { "x-csrf-token": isolatedMe.csrfToken }, data: { name: "Other Fictional Organizer", email: `other-${email}`, password } })).status(), 200);
  assert.deepEqual(await (await isolated.request.get("/api/series")).json(), []);
  const isolatedPage = await isolated.newPage();
  await isolatedPage.goto(`/app/events/${id}/plan`);
  await isolatedPage.getByText("Event not found", { exact: true }).waitFor();
  assert(!((await isolatedPage.locator("body").innerText()).includes("Fictional Browser Event updated")));
  console.log("PASS independent account UI and API isolation");

  await page.setViewportSize({ width: 1280, height: 900 });
  await testid("button-account-menu").click();
  await testid("button-logout").click();
  await page.waitForURL(/\/$/);
  await testid("tab-login").click();
  await testid("input-email").fill(email);
  await testid("input-password").fill(password);
  await testid("button-submit-auth").click();
  await page.waitForURL("**/app");
  console.log("PASS browser logout/login");
  assert.deepEqual(errors, []);
  assert.deepEqual(layoutFailures, []);
  console.log("PASS all organizer screens at 375/1280, mobile drawer, sidebar toggle and logo collapse persistence");
  console.log("PASS no browser runtime errors");
} catch (error) {
  await page.screenshot({ path: `${output}failure.png`, fullPage: false }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  // Delete exactly this randomized test account; cascading fixtures only.
  await pool.query("DELETE FROM users WHERE email=ANY($1::text[])", [[email, `other-${email}`]]);
  await pool.end();
  console.log("Removed only this run's fictional accounts and their fixtures");
}
