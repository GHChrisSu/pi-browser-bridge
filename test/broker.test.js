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
  extension.send(JSON.stringify({ type: "hello", extensionId, version: "0.1.0" }));
  assert.deepEqual(await acknowledged, { type: "hello_ack", protocol: 1 });
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
  first.send(JSON.stringify({ type: "hello", extensionId, version: "0.1.0" }));
  await firstAck;

  const second = connect(url, otherExtensionId);
  await new Promise((resolve, reject) => { second.once("open", resolve); second.once("error", reject); });
  t.after(() => { try { second.close(); } catch {} });
  const refusal = receive(second, (message) => message.type === "hello_refused");
  second.send(JSON.stringify({ type: "hello", extensionId: otherExtensionId, version: "9.9.9" }));
  assert.match((await refusal).reason, /different Chrome extension/);
  assert.equal(broker.getStatus().extension_id, extensionId);
});
