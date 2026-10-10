import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { BrowserBroker } from "../server/broker.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const otherExtensionId = "ponmlkjihgfedcbaponmlkjihgfedcba";

function receive(socket, predicate = () => true, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for a WebSocket message"));
    }, timeoutMs);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function connect(url, id) {
  return new WebSocket(url, { origin: `chrome-extension://${id}` });
}

test("local broker pairs one extension and routes command results to the caller", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-test-"));
  const broker = new BrowserBroker({ port: 0, agentDir, connectWaitMs: 1_000 });
  await broker.start();
  const url = `ws://127.0.0.1:${broker.port}/bridge`;
  const extension = connect(url, extensionId);
  t.after(async () => {
    try { extension.close(); } catch {}
    await broker.close();
    await rm(agentDir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    extension.once("open", resolve);
    extension.once("error", reject);
  });
  const acknowledged = receive(extension, (message) => message.type === "hello_ack");
  extension.send(JSON.stringify({ type: "hello", extensionId, version: "0.7.0" }));
  assert.deepEqual(await acknowledged, { type: "hello_ack", protocol: 2, profileId: `legacy-${extensionId}` });
  assert.equal(broker.getStatus().connected, true);
  assert.equal(broker.getStatus().extension_id, extensionId);

  const commandResult = broker.request("get_active_tab", {});
  const command = await receive(extension, (message) => message.type === "command");
  assert.equal(command.command, "get_active_tab");
  extension.send(JSON.stringify({ type: "result", id: command.id, data: { id: 7, title: "Example" } }));
  assert.deepEqual(await commandResult, { id: 7, title: "Example" });

  const saved = JSON.parse(await readFile(join(agentDir, "state", "pi-browser-bridge", "extension.json"), "utf8"));
  assert.equal(saved.extensionId, extensionId);
});

test("ordinary web origins cannot open a browser bridge connection", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-test-"));
  const broker = new BrowserBroker({ port: 0, agentDir });
  await broker.start();
  const website = new WebSocket(`ws://127.0.0.1:${broker.port}/bridge`, { origin: "https://example.com" });
  t.after(async () => {
    try { website.close(); } catch {}
    await broker.close();
    await rm(agentDir, { recursive: true, force: true });
  });

  const status = await new Promise((resolve, reject) => {
    website.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    website.once("error", reject);
  });
  assert.equal(status, 403);
  assert.equal(broker.getStatus().connected, false);
});
test("a different extension cannot replace an automatically paired extension", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-test-"));
  const broker = new BrowserBroker({ port: 0, agentDir, connectWaitMs: 1_000 });
  await broker.start();
  const url = `ws://127.0.0.1:${broker.port}/bridge`;
  const first = connect(url, extensionId);
  t.after(async () => {
    try { first.close(); } catch {}
    await broker.close();
    await rm(agentDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { first.once("open", resolve); first.once("error", reject); });
  const firstAck = receive(first, (message) => message.type === "hello_ack");
  first.send(JSON.stringify({ type: "hello", extensionId, version: "0.7.0" }));
  await firstAck;

  const second = connect(url, otherExtensionId);
  await new Promise((resolve, reject) => { second.once("open", resolve); second.once("error", reject); });
  t.after(() => { try { second.close(); } catch {} });
  const refusal = receive(second, (message) => message.type === "hello_refused");
  second.send(JSON.stringify({ type: "hello", extensionId: otherExtensionId, version: "9.9.9" }));
  assert.match((await refusal).reason, /different Chrome extension/);
  assert.equal(broker.getStatus().extension_id, extensionId);
});

test("separates simultaneous Chrome profiles and routes commands by profile ID", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-profiles-"));
  const broker = new BrowserBroker({ port: 0, agentDir, connectWaitMs: 1_000 });
  await broker.start();
  const url = `ws://127.0.0.1:${broker.port}/bridge`;
  const profileOneId = "11111111-1111-4111-8111-111111111111";
  const profileTwoId = "22222222-2222-4222-8222-222222222222";
  let first;
  let second;
  t.after(async () => {
    try { first?.close(); } catch {}
    try { second?.close(); } catch {}
    await broker.close();
    await rm(agentDir, { recursive: true, force: true });
  });

  first = connect(url, extensionId);
  second = connect(url, extensionId);
  await Promise.all([first, second].map((socket) => new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  })));
  const firstAck = receive(first, (message) => message.type === "hello_ack");
  const secondAck = receive(second, (message) => message.type === "hello_ack");
  first.send(JSON.stringify({ type: "hello", extensionId, version: "0.7.0", profileId: profileOneId, profileName: "chrissusogo" }));
  second.send(JSON.stringify({ type: "hello", extensionId, version: "0.7.0", profileId: profileTwoId, profileName: "chrissusuhao" }));
  assert.deepEqual(await firstAck, { type: "hello_ack", protocol: 2, profileId: profileOneId });
  assert.deepEqual(await secondAck, { type: "hello_ack", protocol: 2, profileId: profileTwoId });
  assert.equal(broker.getStatus().connected_profile_count, 2);
  assert.deepEqual(broker.listProfiles().map(({ profile_id, name }) => [profile_id, name]), [
    [profileOneId, "chrissusogo"],
    [profileTwoId, "chrissusuhao"],
  ]);
  await assert.rejects(broker.request("get_active_tab", {}), /Multiple Chrome profiles are connected/);

  const firstCommandPromise = receive(first, (message) => message.type === "command");
  const firstResult = broker.request("get_active_tab", {}, { profileId: profileOneId });
  const firstCommand = await firstCommandPromise;
  first.send(JSON.stringify({ type: "result", id: firstCommand.id, data: { id: 11, title: "Profile one" } }));
  assert.deepEqual(await firstResult, { id: 11, title: "Profile one" });

  const secondCommandPromise = receive(second, (message) => message.type === "command");
  const secondResult = broker.request("get_active_tab", {}, { profileId: profileTwoId });
  const secondCommand = await secondCommandPromise;
  second.send(JSON.stringify({ type: "result", id: secondCommand.id, data: { id: 22, title: "Profile two" } }));
  assert.deepEqual(await secondResult, { id: 22, title: "Profile two" });
  assert.equal(broker.getStatus().connected_profile_count, 2);
});

test("shared MCP endpoint requires a local bearer token and exposes only fixed broker methods", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-shared-control-"));
  const token = "a".repeat(64);
  const broker = new BrowserBroker({ port: 0, agentDir, mcpToken: token });
  await broker.start();
  const url = `ws://127.0.0.1:${broker.port}/mcp`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) { try { socket.close(); } catch {} }
    await broker.close();
    await rm(agentDir, { recursive: true, force: true });
  });

  const expectForbidden = (socket) => new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("error", reject);
  });
  const noToken = new WebSocket(url);
  sockets.push(noToken);
  assert.equal(await expectForbidden(noToken), 403);

  const webOrigin = new WebSocket(url, { origin: "https://example.com", headers: { authorization: `Bearer ${token}` } });
  sockets.push(webOrigin);
  assert.equal(await expectForbidden(webOrigin), 403);

  const client = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  sockets.push(client);
  const readyPromise = receive(client, (message) => message.type === "ready");
  await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
  const ready = await readyPromise;
  assert.equal(ready.sharedBrokerProtocol, 1);
  client.send(JSON.stringify({ type: "rpc", id: "status-1", clientId: ready.clientId, method: "get_status", params: {} }));
  const status = await receive(client, (message) => message.type === "rpc_result" && message.id === "status-1");
  assert.equal(status.ok, true);
  assert.equal(status.result.port, broker.port);
  client.send(JSON.stringify({ type: "rpc", id: "unsafe-1", clientId: ready.clientId, method: "request", params: { command: "execute_js", params: {} } }));
  const unsafe = await receive(client, (message) => message.type === "rpc_result" && message.id === "unsafe-1");
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error, /fixed Pi Bridge allowlist/);
});
