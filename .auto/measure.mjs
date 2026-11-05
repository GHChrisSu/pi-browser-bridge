#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import extension from "../extensions/index.js";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverPath = join(packageRoot, "server", "index.js");
const mcpText = await readFile(join(packageRoot, "mcp.json"), "utf8");
let mcpConfig;
try {
  mcpConfig = JSON.parse(mcpText);
} catch (error) {
  throw new Error("mcp.json must contain valid JSON", { cause: error });
}
const adapterServer = mcpConfig.mcpServers.browser;
const adapterDirect = Object.entries(adapterServer.toolExposure || {})
  .filter(([, exposure]) => exposure === "direct")
  .map(([name]) => name);

let nativeConfig;
const handlers = new Map();
extension({
  on: (event, handler) => handlers.set(event, handler),
  events: { on() {} },
  getAllTools: () => [],
  registerMcpServer: (_name, config) => { nativeConfig = config; },
});
await handlers.get("session_start")({}, { hasUI: false });
assert.ok(nativeConfig, "native MCP server did not register");
const nativeDirect = Object.entries(nativeConfig.toolExposure || {})
  .filter(([, exposure]) => exposure === "direct")
  .map(([name]) => name);

async function reservePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function startMcp(agentDir, port) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: packageRoot,
    env: {
      HOME: agentDir,
      PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: process.env.LANG || "en_US.UTF-8",
      PI_BROWSER_BRIDGE_PORT: String(port),
      PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "1000",
      PI_CODING_AGENT_DIR: agentDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText = `${stderrText}${chunk}`.slice(-4_000); });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    entry.resolve(message);
  });
  const request = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}; stderr: ${stderrText}`));
    }, 8_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolveRequest(value); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return { child, request, notify, getStderr: () => stderrText };
}

async function stopBroker(agentDir) {
  try {
    const statePath = join(agentDir, "state", "pi-browser-bridge", "shared-broker", "runtime.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (Number.isInteger(state.pid)) {
      try { process.kill(state.pid, "SIGTERM"); } catch {}
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        try { process.kill(state.pid, 0); } catch { break; }
        await new Promise((resolveWait) => setTimeout(resolveWait, 40));
      }
    }
  } catch {}
}

const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-autoresearch-"));
const mcp = startMcp(agentDir, await reservePort());
let tools;
try {
  const initialized = await mcp.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "pi-browser-bridge-autoresearch", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "pi-browser-bridge");
  mcp.notify("notifications/initialized");
  const listed = await mcp.request("tools/list");
  tools = listed.result.tools;
} finally {
  try { mcp.child.kill("SIGTERM"); } catch {}
  if (mcp.child.exitCode === null) await once(mcp.child, "exit").catch(() => {});
  await stopBroker(agentDir);
  await rm(agentDir, { recursive: true, force: true });
}

const byName = new Map(tools.map((tool) => [tool.name, tool]));
for (const name of [...nativeDirect, ...adapterDirect]) {
  assert.ok(byName.has(name), `configured direct tool is not registered by MCP: ${name}`);
}
const nativeDefinitions = nativeDirect.map((name) => byName.get(name));
const adapterDefinitions = adapterDirect.map((name) => byName.get(name));
const discoverable = tools.length - nativeDirect.length;

console.log(`METRIC native_direct_schema_bytes=${Buffer.byteLength(JSON.stringify(nativeDefinitions))}`);
console.log(`METRIC native_direct_tool_count=${nativeDirect.length}`);
console.log(`METRIC adapter_direct_schema_bytes=${Buffer.byteLength(JSON.stringify(adapterDefinitions))}`);
console.log(`METRIC adapter_direct_tool_count=${adapterDirect.length}`);
console.log(`METRIC discoverable_tool_count=${discoverable}`);
console.log(`METRIC all_tool_schema_bytes=${Buffer.byteLength(JSON.stringify(tools))}`);
