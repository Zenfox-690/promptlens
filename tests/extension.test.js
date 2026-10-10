"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const providers = require("../background/providers.js");
const editorApi = require("../content/editor.js");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const baseOptions = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  apiKey: "local-mock-key",
  prompt: "Keep the exact version and output JSON.",
  mode: "technical"
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("manifest references existing scripts and keeps permissions narrow", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*"
  ]);
  assert.equal(manifest.action.default_popup, "popup/settings.html");
  for (const file of [manifest.background.service_worker, ...manifest.content_scripts.flatMap((item) => item.js), ...manifest.content_scripts.flatMap((item) => item.css), manifest.action.default_popup]) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
  }
});

test("Gemini request uses its fixed HTTPS endpoint and header authentication", async () => {
  let request;
  const result = await providers.optimize(baseOptions, async (url, init) => {
    request = { url, init };
    return response(200, {
      candidates: [{ content: { parts: [{ text: JSON.stringify({ keepOriginal: false, rewritten: "Preserve the exact version and return JSON.", reason: "Kept the constraints." }) }] } }],
      usageMetadata: { promptTokenCount: 81, candidatesTokenCount: 22, totalTokenCount: 103 }
    });
  });
  assert.equal(result.keepOriginal, false);
  assert.equal(result.rewritten, "Preserve the exact version and return JSON.");
  assert.deepEqual(result.usage, { provider: "gemini", inputTokens: 81, outputTokens: 22, totalTokens: 103 });
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  assert.equal(request.init.headers["x-goog-api-key"], baseOptions.apiKey);
  assert.equal(request.url.includes(baseOptions.apiKey), false);
  const body = JSON.parse(request.init.body);
  assert.equal(body.contents[0].parts[0].text, baseOptions.prompt);
  assert.match(body.systemInstruction.parts[0].text, /technical details/);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(request.init.signal instanceof AbortSignal, true);
});

test("OpenAI request uses Chat Completions JSON mode and parses its response", async () => {
  let request;
  const result = await providers.optimize({ ...baseOptions, provider: "openai", model: "gpt-4o-mini" }, async (url, init) => {
    request = { url, init };
    return response(200, { choices: [{ message: { content: JSON.stringify({ keepOriginal: false, rewritten: "Return JSON while preserving the version.", reason: "Made the constraint explicit." }) } }], usage: { prompt_tokens: 33, completion_tokens: 14, total_tokens: 47 } });
  });
  assert.equal(result.keepOriginal, false);
  assert.deepEqual(result.usage, { provider: "openai", inputTokens: 33, outputTokens: 14, totalTokens: 47 });
  assert.equal(result.rewritten, "Return JSON while preserving the version.");
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, `Bearer ${baseOptions.apiKey}`);
  assert.equal(request.url.includes(baseOptions.apiKey), false);
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[1].content, baseOptions.prompt);
});

test("missing key, unsupported provider, and oversized prompts never fetch", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return response(200, {}); };
  await assert.rejects(providers.optimize({ ...baseOptions, apiKey: "" }, fetcher), /API key/);
  await assert.rejects(providers.optimize({ ...baseOptions, provider: "other" }, fetcher), /supported provider/);
  await assert.rejects(providers.optimize({ ...baseOptions, prompt: "x".repeat(12001) }, fetcher), /12,000/);
  await assert.rejects(providers.optimize({ ...baseOptions, model: "../untrusted/path" }, fetcher), /unreadable|no text/);
  assert.equal(calls, 1);
});

test("provider errors are categorized without relaying provider payloads", async () => {
  for (const [status, expected] of [
    [401, /rejected this API key/],
    [403, /rejected this API key/],
    [404, /model or API endpoint/],
    [429, /rate limit or quota/],
    [503, /temporarily unavailable/]
  ]) {
    await assert.rejects(
      providers.optimize(baseOptions, async () => response(status, { error: { message: "private provider detail" } })),
      (error) => expected.test(error.message) && !error.message.includes("private provider detail")
    );
  }
});

test("network, timeout, malformed JSON, and empty provider output fail safely", async () => {
  await assert.rejects(providers.optimize(baseOptions, async () => { throw new TypeError("network"); }), /connection/);
  await assert.rejects(providers.optimize(baseOptions, async () => { throw Object.assign(new Error(), { name: "AbortError" }); }), /timed out/);
  await assert.rejects(providers.optimize(baseOptions, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } })), /invalid response/);
  await assert.rejects(providers.optimize(baseOptions, async () => response(200, { candidates: [] })), /no text/);
  assert.throws(() => providers.parseJsonText('{"rewritten":"  ","reason":""}'), /incomplete rewrite/);
});

test("optimization modes preserve intent and custom instructions are bounded", () => {
  for (const mode of ["concise", "technical", "creative", "custom"]) {
    assert.match(providers.instructionsFor(mode, "extra"), /Preserve its intended outcome/);
  }
  assert.match(providers.instructionsFor("custom", "extra preference"), /extra preference/);
  assert.doesNotMatch(providers.instructionsFor("concise", "should not apply"), /should not apply/);
  assert.ok(providers.instructionsFor("custom", "x".repeat(2000)).length < 2700);
});

test("already concise prompts return an explicit keep-original outcome", async () => {
  const result = await providers.optimize({ ...baseOptions, prompt: "Explain binary search in Java with an example. Keep the answer concise." }, async () => response(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ keepOriginal: true, rewritten: "", reason: "The request is already clear and concise; a rewrite would only paraphrase it." }) }] } }],
    usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 20, totalTokenCount: 80 }
  }));
  assert.equal(result.keepOriginal, true);
  assert.equal(result.rewritten, "");
  assert.match(result.reason, /already clear and concise/);
  assert.equal(result.usage.inputTokens, 60);
});

test("vague prompts keep the original instead of receiving a generic paraphrase", async () => {
  let systemInstruction;
  const prompt = "Build me an app.";
  const result = await providers.optimize({ ...baseOptions, prompt }, async (_url, init) => {
    systemInstruction = JSON.parse(init.body).systemInstruction.parts[0].text;
    return response(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({
      keepOriginal: true,
      rewritten: "",
      reason: "The prompt is too vague to improve without guessing what the app should do."
    }) }] } }] });
  });
  assert.match(systemInstruction, /Build me an app/);
  assert.match(systemInstruction, /Create a simple software application/);
  assert.match(systemInstruction, /too vague to improve without guessing/);
  assert.match(systemInstruction, /reason must describe a concrete change/);
  assert.equal(result.keepOriginal, true);
  assert.equal(result.rewritten, "");
  assert.match(result.reason, /too vague/);
});

test("shorter equivalent rewrites are accepted without losing requirements", async () => {
  let requestBody;
  const prompt = "Explain binary search in Java with an example. Keep the answer concise.";
  const result = await providers.optimize({ ...baseOptions, prompt }, async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return response(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({
      keepOriginal: false,
      rewritten: "Briefly explain binary search in Java with an example.",
      reason: "Removes a redundant sentence while retaining language, example, and brevity requirements."
    }) }] } }] });
  });
  assert.equal(requestBody.contents[0].parts[0].text, prompt);
  assert.ok(result.rewritten.length < prompt.length);
  assert.match(result.rewritten, /Java/);
  assert.match(result.rewritten, /example/);
  assert.match(result.reason, /retaining language/);
});

test("longer rewrites are accepted when the response explains a meaningful clarity gain", async () => {
  const result = await providers.optimize({ ...baseOptions, prompt: "Summarize this." }, async () => response(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      keepOriginal: false,
      rewritten: "Summarize the attached report in five bullet points, preserving its key findings and stated limitations.",
      reason: "Specifies the requested output structure and protects the report's key findings and limitations."
    }) }] } }]
  }));
  assert.ok(result.rewritten.length > "Summarize this.".length);
  assert.match(result.reason, /output structure/);
});

test("optimization instructions favor minimal edits and preserve requirements", () => {
  const instructions = providers.instructionsFor("concise");
  assert.match(instructions, /removing unnecessary length/);
  assert.match(instructions, /already clear and concise/);
  assert.match(instructions, /meaningful improvement/);
  assert.match(instructions, /generic paraphrase/);
  assert.match(instructions, /Never claim improved clarity or specificity/);
  assert.match(instructions, /longer rewrite.*specific improvement/s);
  assert.match(instructions, /constraints and exclusions/);
  assert.match(instructions, /requested format/);
  assert.match(instructions, /keepOriginal/);
});

test("token estimates are explicitly approximate and not language tokenizers", () => {
  assert.equal(providers.estimateTokens(""), 0);
  assert.equal(providers.estimateTokens("12345678"), 2);
  assert.equal(providers.estimateTokens("12345"), 2);
  assert.equal(providers.estimateTokens("iiiiii"), providers.estimateTokens("你你你你你你"));
  assert.match(read("README.md"), /roughly one token per four UTF-16 characters.*approximate/i);
});

test("API usage is optional and only valid integer counts are shown", () => {
  assert.equal(providers.usageFor("gemini", {}), null);
  assert.equal(providers.usageFor("gemini", { usageMetadata: { promptTokenCount: -1, candidatesTokenCount: "2" } }), null);
  assert.deepEqual(providers.usageFor("gemini", { usageMetadata: { promptTokenCount: 12, totalTokenCount: 19 } }), {
    provider: "gemini",
    inputTokens: 12,
    outputTokens: null,
    totalTokens: 19
  });
  assert.throws(() => providers.parseJsonText('{"rewritten":"x","reason":"missing outcome"}'), /incomplete rewrite/);
});

test("editor discovery sees replacement editors and ignores hidden ones", () => {
  const makeEditor = (tagName, visible = true) => ({
    tagName,
    isContentEditable: tagName !== "TEXTAREA",
    isConnected: true,
    disabled: false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: visible ? 300 : 0, height: visible ? 40 : 0 })
  });
  const first = makeEditor("DIV");
  let current = [first];
  const documentObject = { querySelectorAll: () => current };
  assert.deepEqual(editorApi.findEditors(documentObject), [first]);
  const replacement = makeEditor("TEXTAREA");
  current = [replacement];
  assert.deepEqual(editorApi.findEditors(documentObject), [replacement]);
  current = [makeEditor("TEXTAREA", false)];
  assert.deepEqual(editorApi.findEditors(documentObject), []);
});

test("textarea accept dispatches input events and preserves multiline text", () => {
  const dispatched = [];
  const textarea = {
    tagName: "TEXTAREA",
    value: "original prompt",
    ownerDocument: { defaultView: { InputEvent: class { constructor(type, detail) { this.type = type; Object.assign(this, detail); } }, Event: class { constructor(type) { this.type = type; } } } },
    focus() {},
    setRangeText(value) { this.value = value; },
    dispatchEvent(event) { dispatched.push(event.type); }
  };
  const rewritten = "First line\nSecond line";
  assert.equal(editorApi.apply(textarea, rewritten, {}), true);
  assert.equal(editorApi.read(textarea), rewritten);
  assert.deepEqual(dispatched, ["input", "change"]);
});

test("contenteditable failure leaves the original prompt unchanged", () => {
  const editor = { tagName: "DIV", isContentEditable: true, isConnected: true, innerText: "keep this", focus() {} };
  const selection = { removeAllRanges() {}, addRange() {} };
  const documentObject = {
    defaultView: { getSelection: () => selection },
    createRange: () => ({ selectNodeContents() {} }),
    execCommand: () => false
  };
  assert.equal(editorApi.apply(editor, "new text", documentObject), false);
  assert.equal(editorApi.read(editor), "keep this");
});

test("worker rejects unsupported origins and missing credentials without a provider call", async () => {
  let listener;
  let calls = 0;
  const store = { provider: "openai", openaiModel: "gpt-4o-mini" };
  const chrome = {
    runtime: { onMessage: { addListener: (handler) => { listener = handler; } } },
    storage: { local: { get: async () => store } }
  };
  const providerApi = {
    optimize: async () => { calls += 1; return { rewritten: "new", reason: "reason" }; },
    estimateTokens: () => 2
  };
  vm.runInNewContext(read("background/service_worker.js"), {
    chrome,
    URL,
    Set,
    importScripts: () => {},
    PromptLensProviders: providerApi
  });
  const denied = await new Promise((resolve) => listener(
    { type: "PROMPTLENS_OPTIMIZE", prompt: "prompt" },
    { url: "https://example.com/" },
    resolve
  ));
  assert.match(denied.error, /supported ChatGPT page/);
  const missing = await new Promise((resolve) => listener(
    { type: "PROMPTLENS_OPTIMIZE", prompt: "prompt" },
    { url: "https://chatgpt.com/" },
    resolve
  ));
  assert.match(missing.error, /No OpenAI API key/);
  assert.equal(calls, 0);
});

test("worker sends only to selected provider using local settings", async () => {
  let listener;
  let received;
  const store = { provider: "gemini", geminiModel: "gemini-3.5-flash-lite", geminiApiKey: "local-mock-key", mode: "creative" };
  const chrome = {
    runtime: { onMessage: { addListener: (handler) => { listener = handler; } } },
    storage: { local: { get: async () => store } }
  };
  const providerApi = {
    optimize: async (options) => { received = options; return { rewritten: "new prompt", reason: "clearer" }; },
    estimateTokens: (text) => text.length
  };
  vm.runInNewContext(read("background/service_worker.js"), {
    chrome,
    URL,
    Set,
    importScripts: () => {},
    PromptLensProviders: providerApi
  });
  const result = await new Promise((resolve) => listener(
    { type: "PROMPTLENS_OPTIMIZE", prompt: "original" },
    { url: "https://chat.openai.com/c/example" },
    resolve
  ));
  assert.equal(received.provider, "gemini");
  assert.equal(received.apiKey, store.geminiApiKey);
  assert.equal(received.mode, "creative");
  assert.equal(result.originalEstimate, 8);
  assert.equal(result.finalPromptEstimate, 10);
});

test("worker estimates the original as the final prompt when keep-original is returned", async () => {
  let listener;
  const store = { provider: "gemini", geminiApiKey: "local-mock-key" };
  const chrome = {
    runtime: { onMessage: { addListener: (handler) => { listener = handler; } } },
    storage: { local: { get: async () => store } }
  };
  const providerApi = {
    optimize: async () => ({ keepOriginal: true, rewritten: "", reason: "Already concise.", usage: null }),
    estimateTokens: (text) => Math.ceil(text.length / 4)
  };
  vm.runInNewContext(read("background/service_worker.js"), {
    chrome,
    URL,
    Set,
    importScripts: () => {},
    PromptLensProviders: providerApi
  });
  const result = await new Promise((resolve) => listener(
    { type: "PROMPTLENS_OPTIMIZE", prompt: "Already concise." },
    { url: "https://chatgpt.com/" },
    resolve
  ));
  assert.equal(result.keepOriginal, true);
  assert.equal(result.originalEstimate, result.finalPromptEstimate);
});

test("settings save and remove provider-specific keys locally", async () => {
  const ids = ["#provider", "#model", "#api-key", "#key-state", "#mode", "#custom-instructions", "#custom-label", "#save-state", "#settings-form", "#remove-key"];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    value: "",
    textContent: "",
    hidden: false,
    required: false,
    listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    classList: { add() {}, remove() {} }
  }]));
  const store = { openaiApiKey: "openai-saved-key", openaiModel: "gpt-4o-mini" };
  const chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])); },
    async set(values) { Object.assign(store, values); },
    async remove(key) { delete store[key]; }
  } } };
  vm.runInNewContext(read("popup/settings.js"), { document: { querySelector: (id) => elements[id] }, chrome });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements["#provider"].value, "gemini");
  elements["#provider"].value = "openai";
  await elements["#provider"].listeners.change();
  assert.equal(elements["#model"].value, "gpt-4o-mini");
  elements["#api-key"].value = "new-local-test-key";
  await elements["#settings-form"].listeners.submit({ preventDefault() {} });
  assert.equal(store.openaiApiKey, "new-local-test-key");
  assert.equal(store.provider, "openai");
  elements["#provider"].value = "gemini";
  await elements["#provider"].listeners.change();
  elements["#api-key"].value = "gemini-local-test-key";
  await elements["#settings-form"].listeners.submit({ preventDefault() {} });
  assert.equal(store.geminiApiKey, "gemini-local-test-key");
  assert.equal(store.openaiApiKey, "new-local-test-key");
  await elements["#remove-key"].listeners.click();
  assert.equal("geminiApiKey" in store, false);
  assert.equal("openaiApiKey" in store, true);
});

test("source has no common hardcoded key patterns and ignores local secrets", () => {
  const sourceFiles = ["manifest.json", "background/providers.js", "background/service_worker.js", "content/content.js", "content/editor.js", "popup/settings.js", "popup/settings.html"];
  const keyPattern = /sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}/;
  for (const file of sourceFiles) assert.doesNotMatch(read(file), keyPattern, `${file} contains no credential-shaped literal`);
  const ignore = read(".gitignore");
  assert.match(ignore, /\.env/);
  assert.match(ignore, /\.pem/);
  assert.match(ignore, /node_modules/);
});

test("content script has duplicate guard, persistent observer, and explicit apply control", () => {
  const content = read("content/content.js");
  assert.match(content, /window\.__promptLensLoaded/);
  assert.match(content, /new MutationObserver\(scheduleRefresh\)/);
  assert.match(content, /\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\)/);
  assert.match(content, /\.pl-accept/);
  assert.match(content, /PromptLensEditor\.apply\(requestEditor, currentRewrite, document\)/);
  assert.match(content, /if \(result\.keepOriginal\)/);
  assert.match(content, /acceptButton\.disabled = true;\s*copyButton\.disabled = true;/);
  assert.match(content, /tokens \(approx\.\)/);
  assert.match(content, /API-reported usage/);
  assert.match(content, /separate from the approximate final-prompt size/);
});