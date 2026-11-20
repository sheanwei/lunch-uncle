import ui from "./ui.html";
import { runLoop, ConfigError } from "./loop.js";
import { validateChatRequest } from "./validate.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/") {
      return new Response(ui, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && pathname === "/chat") {
      return handleChat(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request, env) {
  if (!(await withinRateLimit(request, env))) {
    return json({ error: "Uncle very busy. Wait a minute then ask again." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const checked = validateChatRequest(body);
  if (checked.error) {
    return json({ error: checked.error }, 400);
  }

  try {
    const { history, message, sessionId } = checked;
    const reply = await runLoop(history, message, env, sessionId);
    return json({ reply });
  } catch (err) {
    console.error("chat failed:", err);
    if (err instanceof ConfigError) {
      return json({ error: err.message }, 500);
    }
    return json({ error: "Uncle cannot think right now, try again later." }, 502);
  }
}

/**
 * Per-IP limit on /chat, using the CHAT_LIMITER binding from wrangler.toml.
 * Every chat costs LLM and Places calls, so an open endpoint is an open wallet.
 */
async function withinRateLimit(request, env) {
  if (!env.CHAT_LIMITER) {
    console.warn("CHAT_LIMITER binding missing; /chat is not rate limited");
    return true;
  }
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.CHAT_LIMITER.limit({ key });
  return success;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
