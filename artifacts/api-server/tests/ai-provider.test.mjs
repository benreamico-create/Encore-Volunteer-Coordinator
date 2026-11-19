import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: [new URL("../src/lib/ai-provider.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { getAiProvider, generateJsonText } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const signal = AbortSignal.timeout(5000);

test("configuration uses Claude first, keeps OpenAI, and requires a key", () => {
  assert.equal(getAiProvider({}), null);
  assert.equal(getAiProvider({ CLAUDE_API_KEY: "fake-key" }).model, "claude-haiku-4-5");
  assert.equal(getAiProvider({ LLM_API_KEY: "fake-key" }).kind, "openai");
  assert.equal(getAiProvider({ CLAUDE_API_KEY: "fake-key", LLM_API_KEY: "also-fake" }).kind, "anthropic");
  assert.equal(getAiProvider({ CLAUDE_API_KEY: "fake-key", LLM_MODEL: "test-model" }).model, "test-model");
});

test("Claude uses Messages API, correct headers, bounded output and JSON text extraction", async () => {
  let calls = 0;
  const text = await generateJsonText(getAiProvider({ CLAUDE_API_KEY: "fake-key" }), "Only JSON", { event: "Fictional" }, signal,
    async (url, init) => {
      calls++;
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(init.headers["x-api-key"], "fake-key");
      assert.equal(init.headers["anthropic-version"], "2023-06-01");
      assert.equal(init.headers.authorization, undefined);
      assert.equal(init.signal, signal);
      const body = JSON.parse(init.body);
      assert.equal(body.system, "Only JSON");
      assert.equal(body.max_tokens, 1800);
      assert.equal(body.messages[0].role, "user");
      assert.equal(body.response_format, undefined);
      return Response.json({ content: [{ type: "thinking", thinking: "ignored" }, { type: "text", text: '```json\n{"ok":true}\n```' }] });
    });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(text), { ok: true });
});

test("OpenAI retains its existing request/response contract", async () => {
  const text = await generateJsonText(getAiProvider({ LLM_API_KEY: "fake-key" }), "Only JSON", {}, signal,
    async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      assert.equal(init.headers.authorization, "Bearer fake-key");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-4o-mini");
      assert.equal(body.response_format.type, "json_object");
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
  assert.deepEqual(JSON.parse(text), { ok: true });
});

test("provider failures are not retried or exposed with sensitive response details", async () => {
  let calls = 0;
  await assert.rejects(generateJsonText(getAiProvider({ CLAUDE_API_KEY: "fake-key" }), "", {}, signal,
    async () => {
      calls++;
      return new Response("sensitive provider detail", { status: 401 });
    }), { message: "AI provider request failed" });
  assert.equal(calls, 1);
});
