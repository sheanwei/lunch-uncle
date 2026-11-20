import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSessionId,
  buildUserMessage,
  configProblems,
  ConfigError,
  parseArgs,
  assistantFromResponse,
} from "../src/loop.js";
import { buildSystemPrompt } from "../src/prompt.js";

const UUID = "3f2b8c1e-9a4d-4c2f-8b1a-0d6e5f7a9b21";

test("resolveSessionId keeps a valid client id", () => {
  assert.equal(resolveSessionId(UUID), UUID);
});

test("resolveSessionId replaces missing or bad ids", () => {
  for (const bad of [undefined, "", "not-a-uuid", 42, `${UUID}x`]) {
    const id = resolveSessionId(bad);
    assert.notEqual(id, bad);
    assert.equal(resolveSessionId(id), id);
  }
});

test("buildUserMessage prefixes Singapore time", () => {
  // 04:30 UTC is 12:30 pm in Singapore.
  const out = buildUserMessage("where to eat?", new Date("2026-11-20T04:30:00Z"));
  assert.match(out, /^\[Now: .*12:30.*pm.*, Singapore\]\nwhere to eat\?$/i);
});

test("buildSystemPrompt is identical across calls", () => {
  assert.equal(buildSystemPrompt(), buildSystemPrompt());
});

test("configProblems flags the TODO placeholders and missing keys", () => {
  const problems = configProblems("TODO", "TODO", {});
  assert.equal(problems.length, 4);
  assert.match(problems[0], /LLM_BASE_URL/);
  assert.match(problems[1], /LLM_MODEL/);
  assert.match(problems[2], /OPENCODE_API_KEY/);
  assert.match(problems[3], /GOOGLE_PLACES_API_KEY/);
});

test("configProblems is empty when everything is set", () => {
  const env = { OPENCODE_API_KEY: "k", GOOGLE_PLACES_API_KEY: "p" };
  assert.deepEqual(configProblems("https://example.com/v1", "some-model", env), []);
});

test("ConfigError message names settings but not values", () => {
  const err = new ConfigError(configProblems("TODO", "m", { OPENCODE_API_KEY: "secret" }));
  assert.match(err.message, /LLM_BASE_URL/);
  assert.doesNotMatch(err.message, /secret/);
});

test("parseArgs turns anything that is not an object into {}", () => {
  for (const raw of [undefined, "", "null", "[]", "5", '"x"', "{bad"]) {
    assert.deepEqual(parseArgs(raw), {}, `for ${raw}`);
  }
  assert.deepEqual(parseArgs('{"query":"laksa"}'), { query: "laksa" });
});

test("assistantFromResponse keeps only role, content and tool_calls", () => {
  const toolCalls = [{ id: "1", type: "function", function: { name: "x" } }];
  const out = assistantFromResponse({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
          reasoning_content: "thinking...",
          refusal: null,
        },
      },
    ],
  });
  assert.deepEqual(out, { role: "assistant", content: null, tool_calls: toolCalls });
});

test("assistantFromResponse drops an empty tool_calls array", () => {
  const out = assistantFromResponse({
    choices: [{ message: { content: "Go Lavender Food Square.", tool_calls: [] } }],
  });
  assert.deepEqual(out, { role: "assistant", content: "Go Lavender Food Square." });
});

test("assistantFromResponse throws a clear error on malformed responses", () => {
  for (const data of [{}, { choices: [] }, { error: { message: "x" } }, null]) {
    assert.throws(() => assistantFromResponse(data), /no message/);
  }
});
