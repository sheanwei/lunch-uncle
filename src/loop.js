import { buildSystemPrompt } from "./prompt.js";
import { toolDefinitions, executeTool } from "./tools.js";

// TODO: set the base URL and model for your OpenAI-compatible provider.
const LLM_BASE_URL = "TODO";
const LLM_MODEL = "TODO";

const LLM_TIMEOUT_MS = 20_000;
const MAX_ROUNDS = 8;

const FALLBACK_REPLY = "Just go Berseh Food Centre lah.";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run the agentic loop for one user turn and return Uncle's reply.
 *
 * history is the prior conversation as OpenAI-style {role, content} messages.
 * sessionId is the client's conversation id; it is reused on every turn so the
 * OpenCode Go endpoint can route and cache the whole conversation together.
 */
export async function runLoop(history, message, env, sessionId) {
  // If the Places key is missing, Uncle cannot search, so give a safe answer.
  if (!env.GOOGLE_PLACES_API_KEY) {
    return FALLBACK_REPLY;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    { role: "user", content: buildUserMessage(message, new Date()) },
  ];

  const session = resolveSessionId(sessionId);

  let round = 0;
  while (round < MAX_ROUNDS) {
    const assistant = await callModel(messages, env, session);
    messages.push(assistant);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return assistant.content ?? "";
    }

    for (const call of toolCalls) {
      const args = parseArgs(call.function.arguments);
      console.log(`round ${round}: ${call.function.name}`, args);
      const result = await executeTool(call.function.name, args, env);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
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
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`LLM returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices[0].message;
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

function parseArgs(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
