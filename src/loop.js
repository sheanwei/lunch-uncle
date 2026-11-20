import { buildSystemPrompt } from "./prompt.js";
import { toolDefinitions, executeTool } from "./tools.js";

// TODO: set the base URL and model for your OpenAI-compatible provider.
const LLM_BASE_URL = "TODO";
const LLM_MODEL = "TODO";

const LLM_TIMEOUT_MS = 20_000;
const LLM_MAX_TOKENS = 1000;
const MAX_ROUNDS = 8;
// Each Places search is billed, so cap tool calls across the whole turn.
export const MAX_TOOL_CALLS_PER_TURN = 6;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thrown when the Worker is not set up yet. Its message names the missing
 * settings (never their values), so it is safe to show to the user.
 */
export class ConfigError extends Error {
  constructor(problems) {
    super(`Uncle is not set up yet: ${problems.join("; ")}.`);
    this.name = "ConfigError";
  }
}

/**
 * List setup steps that were skipped. Empty when everything is in place.
 */
export function configProblems(baseUrl, model, env) {
  const problems = [];
  if (!baseUrl || baseUrl === "TODO") {
    problems.push("LLM_BASE_URL is not set in src/loop.js (README step 4)");
  }
  if (!model || model === "TODO") {
    problems.push("LLM_MODEL is not set in src/loop.js (README step 4)");
  }
  if (!env.OPENCODE_API_KEY) {
    problems.push("OPENCODE_API_KEY is not set (README step 3 or 6)");
  }
  if (!env.GOOGLE_PLACES_API_KEY) {
    problems.push("GOOGLE_PLACES_API_KEY is not set (README step 3 or 6)");
  }
  return problems;
}

/**
 * Run the agentic loop for one user turn and return Uncle's reply.
 *
 * history is the prior conversation as OpenAI-style {role, content} messages,
 * already checked by validateChatRequest.
 * sessionId is the client's conversation id; it is reused on every turn so the
 * OpenCode Go endpoint can route and cache the whole conversation together.
 */
export async function runLoop(history, message, env, sessionId) {
  const problems = configProblems(LLM_BASE_URL, LLM_MODEL, env);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    { role: "user", content: buildUserMessage(message, new Date()) },
  ];

  const session = resolveSessionId(sessionId);
  const toolCache = new Map();
  let toolCallsUsed = 0;

  let round = 0;
  while (round < MAX_ROUNDS) {
    const assistant = await callModel(messages, env, session);
    messages.push(assistant);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return assistant.content ?? "";
    }

    // Every tool call must get a tool message back, even ones we refuse.
    for (const call of toolCalls) {
      const name = call.function?.name;
      const args = parseArgs(call.function?.arguments);
      const cacheKey = `${name}:${JSON.stringify(args)}`;

      let result;
      if (toolCache.has(cacheKey)) {
        result = toolCache.get(cacheKey);
      } else if (toolCallsUsed >= MAX_TOOL_CALLS_PER_TURN) {
        result = JSON.stringify({
          error: "Tool limit reached for this question. Answer with what you have.",
        });
      } else {
        toolCallsUsed++;
        console.log(`round ${round}: ${name}`, args);
        result = await executeTool(name, args, env);
        toolCache.set(cacheKey, result);
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    round++;
  }

  return "Uncle tried too many times already. Ask something simpler.";
}

async function callModel(messages, env, sessionId) {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENCODE_API_KEY}`,
      "x-opencode-session": sessionId,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      tools: toolDefinitions,
      max_tokens: LLM_MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`LLM returned ${res.status}: ${await res.text()}`);
  }

  return assistantFromResponse(await res.json());
}

/**
 * Pull the assistant message out of a chat completions response, keeping only
 * the fields we send back on the next round. Throws on a malformed response.
 */
export function assistantFromResponse(data) {
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== "object") {
    throw new Error(`LLM response has no message: ${JSON.stringify(data)}`);
  }
  const assistant = { role: "assistant", content: message.content ?? null };
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    assistant.tool_calls = message.tool_calls;
  }
  return assistant;
}

/**
 * Use the client's session id if it is a UUID, otherwise make a new one.
 */
export function resolveSessionId(raw) {
  return typeof raw === "string" && UUID_RE.test(raw)
    ? raw
    : crypto.randomUUID();
}

/**
 * Put the current Singapore time on the newest user message. The time lives
 * here, not in the system prompt, so the prompt prefix stays identical across
 * turns and the provider can cache it.
 */
export function buildUserMessage(message, now) {
  const time = now.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `[Now: ${time}, Singapore]\n${message}`;
}

/**
 * Parse tool-call arguments. Anything that is not a JSON object (bad JSON,
 * "null", "[]", "5") becomes {} so tools can safely destructure it.
 */
export function parseArgs(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}
