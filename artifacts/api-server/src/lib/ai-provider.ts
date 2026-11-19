// Server-only adapters. A configured key never enables spending on its own.
export type AiProvider = { kind: "anthropic" | "openai"; apiKey: string; model: string };

export function getAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  if (env.CLAUDE_API_KEY) {
    return { kind: "anthropic", apiKey: env.CLAUDE_API_KEY, model: env.LLM_MODEL || "claude-haiku-4-5" };
  }
  if (env.LLM_API_KEY) {
    return { kind: "openai", apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || "gpt-4o-mini" };
  }
  return null;
}

export async function generateJsonText(
  provider: AiProvider, system: string, context: unknown, signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<string> {
  const anthropic = provider.kind === "anthropic";
  const response = await request(anthropic
    ? "https://api.anthropic.com/v1/messages"
    : "https://api.openai.com/v1/chat/completions", {
    method: "POST", signal,
    headers: anthropic
      ? { "content-type": "application/json", "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
      : { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({
      model: provider.model, max_tokens: 1800,
      ...(anthropic
        ? { system, messages: [{ role: "user", content: JSON.stringify(context) }] }
        : { response_format: { type: "json_object" }, messages: [
          { role: "system", content: system }, { role: "user", content: JSON.stringify(context) },
        ] }),
    }),
  });
  // Do not include provider response bodies or credentials in errors/logs.
  if (!response.ok) throw new Error("AI provider request failed");
  const data = await response.json() as {
    content?: { type?: string; text?: string }[];
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = anthropic
    ? (Array.isArray(data?.content)
      ? data.content.filter(block => block?.type === "text" && typeof block.text === "string")
        .map(block => block.text).join("")
      : "")
    : data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("AI provider returned no text");
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
