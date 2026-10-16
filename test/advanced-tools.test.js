import assert from "node:assert/strict";
import { test } from "node:test";
import { executeAdvancedCommand } from "../extension/advanced.js";
import { registerAdvancedBrowserTools } from "../server/advanced-tools.js";

function fakeChrome({ permission = true } = {}) {
  const state = { rules: [], storage: {}, alarms: new Set() };
  const chrome = {
    permissions: { contains: async () => permission },
    declarativeNetRequest: {
      getSessionRules: async () => state.rules.map((rule) => structuredClone(rule)),
      updateSessionRules: async ({ addRules = [], removeRuleIds = [] }) => {
        state.rules = state.rules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules.map((rule) => structuredClone(rule)));
      },
    },
    storage: { local: {
      get: async (key) => typeof key === "string" ? { [key]: structuredClone(state.storage[key]) } : structuredClone(state.storage),
      set: async (values) => Object.assign(state.storage, structuredClone(values)),
    } },
    alarms: {
      create: (name) => state.alarms.add(name),
      clear: async (name) => state.alarms.delete(name),
    },
  };
  return { chrome, state };
}

test("network rules are optional, tab-scoped, session-only, and expire", async (t) => {
  const previous = globalThis.chrome;
  const { chrome, state } = fakeChrome();
  globalThis.chrome = chrome;
  t.after(() => { globalThis.chrome = previous; });

  const added = await executeAdvancedCommand("network_rules", {
    action: "block",
    url_filter: "||example.com/api/*",
    tab_id: 17,
    expires_ms: 30_000,
  }, {});
  assert.equal(added.added, true);
  assert.equal(state.rules.length, 1);
  assert.deepEqual(state.rules[0].condition.tabIds, [17]);
  assert.equal(state.rules[0].action.type, "block");
  assert.equal(state.storage.piBrowserBridgeNetworkRules[added.id].expires_at > Date.now(), true);

  const listed = await executeAdvancedCommand("network_rules", { action: "list" }, {});
  assert.equal(listed.rules.length, 1);
  assert.equal(listed.rules[0].condition.url_filter, "||example.com/api/*");
  assert.ok(listed.rules[0].expires_at);

  const cleared = await executeAdvancedCommand("network_rules", { action: "clear", rule_id: added.id }, {});
  assert.equal(cleared.removed, 1);
  assert.equal(state.rules.length, 0);
});

test("page JavaScript requires the optional userScripts permission and targets one tab", async (t) => {
  const previous = globalThis.chrome;
  const { chrome } = fakeChrome();
  let request;
  chrome.userScripts = { execute: async (value) => { request = value; return [{ result: "Example title" }]; } };
  globalThis.chrome = chrome;
  t.after(() => { globalThis.chrome = previous; });

  const result = await executeAdvancedCommand("execute_js", { code: "document.title", tab_id: 17, frame_id: 2 }, { getTab: async (id) => ({ id }) });
  assert.deepEqual(request.target, { tabId: 17, frameIds: [2] });
  assert.equal(request.js[0].code, "document.title");
  assert.equal(request.world, "MAIN");
  assert.equal(result.result, "Example title");
});

test("authenticated HTTP requests send cookies only without redirects and bound text", async (t) => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const { chrome } = fakeChrome();
  globalThis.chrome = chrome;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.credentials, "include");
    assert.equal(init.redirect, "error");
    return new Response("private response", { status: 200, headers: { "content-type": "text/plain" } });
  };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  const result = await executeAdvancedCommand("http_request", { url: "https://example.com/account", method: "GET" }, {});
  assert.equal(result.status, 200);
  assert.equal(result.body, "private response");
  assert.equal(result.url, "https://example.com/account");
});

test("console reads and network monitoring redact secret query values without collecting request bodies", async (t) => {
  const previous = globalThis.chrome;
  const { chrome } = fakeChrome();
  const makeEvent = () => {
    const listeners = new Set();
    return {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
      emit: (details) => { for (const listener of listeners) listener(details); },
    };
  };
  const beforeRequest = makeEvent();
  const completed = makeEvent();
  const failed = makeEvent();
  chrome.webRequest = { onBeforeRequest: beforeRequest, onCompleted: completed, onErrorOccurred: failed };
  const consoleEntries = [{ level: "error", text: "Request failed access_token=top-secret-value", at: 123 }];
  chrome.scripting = { executeScript: async () => [{ result: consoleEntries }] };
  globalThis.chrome = chrome;
  t.after(() => { globalThis.chrome = previous; });
  const tabId = 92_001;
  const helpers = { getTab: async (id) => ({ id }) };

  const empty = await executeAdvancedCommand("monitor_network", { tab_id: tabId, clear: true }, helpers);
  assert.equal(empty.returned, 0);
  beforeRequest.emit({ requestId: "req-1", url: "https://example.com/api?token=private", method: "GET", type: "xmlhttprequest", timeStamp: 100, tabId });
  completed.emit({ requestId: "req-1", statusCode: 200, timeStamp: 145, fromCache: false });
  const network = await executeAdvancedCommand("monitor_network", { tab_id: tabId }, helpers);
  assert.equal(network.requests.length, 1);
  assert.equal(network.requests[0].url, "https://example.com/api?token=%5BREDACTED%5D");
  assert.equal(network.requests[0].status, 200);
  assert.equal(network.requests[0].duration_ms, 45);
  assert.equal("body" in network.requests[0], false);
  assert.equal("headers" in network.requests[0], false);

  const consoleResult = await executeAdvancedCommand("read_console", { tab_id: tabId, level: "error" }, helpers);
  assert.match(consoleResult.messages[0].text, /access_token=\[REDACTED\]/);
  assert.doesNotMatch(consoleResult.messages[0].text, /top-secret-value/);
});

test("advanced MCP console/network tools route profile and tab arguments through the broker", async () => {
  const tools = new Map();
  const calls = [];
  const server = { registerTool: (name, schema, handler) => tools.set(name, { schema, handler }) };
  const broker = { request: async (command, params, options) => {
    calls.push({ command, params, options });
    return command === "read_console"
      ? { messages: [{ level: "error", text: "test" }], count: 1 }
      : { tab_id: params.tab_id, requests: [{ url: "https://example.com/api", status: 200 }] };
  } };
  registerAdvancedBrowserTools(server, broker);

  const consoleResponse = await tools.get("read_console").handler({ profile_id: "profile-a", tab_id: 17, level: "error", limit: 5 });
  assert.equal(calls[0].command, "read_console");
  assert.deepEqual(calls[0].params, { tab_id: 17, level: "error", limit: 5 });
  assert.equal(calls[0].options.profileId, "profile-a");
  assert.match(JSON.parse(consoleResponse.content[0].text).messages[0].text, /test/);

  const networkResponse = await tools.get("monitor_network").handler({ profile_id: "profile-b", tab_id: 19, limit: 10 });
  assert.equal(calls[1].command, "monitor_network");
  assert.deepEqual(calls[1].params, { tab_id: 19, limit: 10 });
  assert.equal(calls[1].options.profileId, "profile-b");
  assert.match(networkResponse.content[0].text, /example\.com\/api/);

  const handoffResponse = await tools.get("handoff").handler({ profile_id: "profile-c", tab_id: 23, message: "wait for response", timeout_ms: 1_000 });
  assert.equal(calls[2].command, "handoff");
  assert.deepEqual(calls[2].params, { tab_id: 23, message: "wait for response", timeout_ms: 1_000 });
  assert.equal(calls[2].options.profileId, "profile-c");
  assert.equal(calls[2].options.timeoutMs, 6_000);
  assert.ok(handoffResponse.content[0].text);
});

test("handle_dialogs maps accept and dismiss to fixed Chrome debugger commands", async (t) => {
  const previous = globalThis.chrome;
  const calls = [];
  globalThis.chrome = { debugger: { sendCommand: async (target, method, params) => { calls.push({ target, method, params }); } } };
  t.after(() => { globalThis.chrome = previous; });
  const helpers = { getTab: async (id) => ({ id }), withDebugger: async (tabId, operation) => operation({ tabId }) };

  const dismissed = await executeAdvancedCommand("handle_dialogs", { action: "dismiss", tab_id: 31 }, helpers);
  const accepted = await executeAdvancedCommand("handle_dialogs", { action: "accept", prompt_text: "local answer", tab_id: 32 }, helpers);
  assert.equal(dismissed.handled, true);
  assert.equal(accepted.handled, true);
  assert.deepEqual(calls, [
    { target: { tabId: 31 }, method: "Page.handleJavaScriptDialog", params: { accept: false } },
    { target: { tabId: 32 }, method: "Page.handleJavaScriptDialog", params: { accept: true, promptText: "local answer" } },
  ]);
  const bridgeCalls = [];
  const bridged = await executeAdvancedCommand("handle_dialogs", { action: "dismiss", tab_id: 33 }, {
    getTab: async (id) => ({ id }),
    handleJavaScriptDialog: async (...args) => { bridgeCalls.push(args); return { handled: true, action: args[1], tab_id: args[0] }; },
    withDebugger: async () => { throw new Error("handle_dialogs must bypass the locked debugger queue"); },
  });
  assert.equal(bridged.handled, true);
  assert.deepEqual(bridgeCalls, [[33, "dismiss", undefined]]);
});

test("animations handles omitted animation_index without passing unserializable values to Chrome", async (t) => {
  const previousDocument = globalThis.document;
  const animationState = [{ paused: false, playing: false, cancelled: false }, { paused: false, playing: false, cancelled: false }];
  const animations = animationState.map((state) => ({
    id: "fixture-animation",
    playState: "running",
    currentTime: 10,
    playbackRate: 1,
    pause() { state.paused = true; },
    play() { state.playing = true; },
    cancel() { state.cancelled = true; },
  }));
  globalThis.document = { getAnimations: () => animations };
  t.after(() => { globalThis.document = previousDocument; });
  const calls = [];
  const helpers = {
    getTab: async (id) => ({ id }),
    executeInTab: async (_tabId, fn, args) => { calls.push(args); return fn(...args); },
  };

  const listed = await executeAdvancedCommand("animations", { action: "list", tab_id: 17 }, helpers);
  assert.equal(listed.count, 2);
  assert.deepEqual(calls[0], ["list", "", -1]);
  const paused = await executeAdvancedCommand("animations", { action: "pause", tab_id: 17 }, helpers);
  assert.equal(paused.changed, 2);
  assert.deepEqual(calls[1], ["pause", "", -1]);
  assert.deepEqual(animationState.map((state) => state.paused), [true, true]);
});

test("clipboard command uses only the offscreen bridge and can be tested without host clipboard access", async (t) => {
  const previous = globalThis.chrome;
  const calls = [];
  globalThis.chrome = {
    permissions: { contains: async () => true },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => { calls.push(message); return message.action === "read" ? { text: "synthetic clipboard value" } : { written: true }; },
    },
    offscreen: { createDocument: async (options) => { assert.deepEqual(options.reasons, ["CLIPBOARD"]); } },
  };
  t.after(() => { globalThis.chrome = previous; });

  const read = await executeAdvancedCommand("clipboard", { action: "read" }, {});
  const write = await executeAdvancedCommand("clipboard", { action: "write", text: "synthetic test value" }, {});
  assert.equal(read.text, "synthetic clipboard value");
  assert.equal(write.written, true);
  assert.deepEqual(calls.map((call) => call.action), ["read", "write"]);
  assert.equal(calls[1].text, "synthetic test value");
});

test("network rules refuse to run without the optional permission", async (t) => {
  const previous = globalThis.chrome;
  const { chrome } = fakeChrome({ permission: false });
  globalThis.chrome = chrome;
  t.after(() => { globalThis.chrome = previous; });

  await assert.rejects(
    executeAdvancedCommand("network_rules", { action: "list" }, {}),
    /optional declarativeNetRequestWithHostAccess permission/,
  );
});
