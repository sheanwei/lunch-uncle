/**
 * Checks on what the browser sends to POST /chat. Everything here ends up in
 * the LLM request, so it is bounded before it can run up the bill.
 */

export const MAX_MESSAGE_CHARS = 1000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_CHARS = 2000;

const HISTORY_ROLES = new Set(["user", "assistant"]);

/**
 * Validate a parsed /chat body.
 *
 * Returns { error } for a request that should get a 400, otherwise
 * { history, message, sessionId } with history reduced to recent plain
 * user/assistant turns. Other roles (system, tool) are dropped so a client
 * cannot rewrite Uncle's instructions or fake tool results.
 */
export function validateChatRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Body must be a JSON object" };
  }

  const { history = [], message, sessionId } = body;

  if (typeof message !== "string" || message.trim() === "") {
    return { error: "message is required" };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return { error: `message must be at most ${MAX_MESSAGE_CHARS} characters` };
  }
  if (!Array.isArray(history)) {
    return { error: "history must be an array" };
  }

  const cleaned = history
    .filter(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        HISTORY_ROLES.has(entry.role) &&
        typeof entry.content === "string",
    )
    .map(({ role, content }) => ({
      role,
      content: content.slice(0, MAX_HISTORY_CHARS),
    }))
    .slice(-MAX_HISTORY_MESSAGES);

  return { history: cleaned, message, sessionId };
}
