import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const serverPath = fileURLToPath(new URL("../server/index.js", import.meta.url));

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("shared broker remains available after the last MCP client exits by default", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-idle-default-"));
  const port = await freePort();
  const child = spawn(process.execPath, [serverPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      HOME: agentDir,
      PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: process.env.LANG || "en_US.UTF-8",
      PI_BROWSER_BRIDGE_PORT: String(port),
      PI_CODING_AGENT_DIR: agentDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 8_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter.resolve(message); }
  });

  let daemonPid;
  t.after(async () => {
    try { child.kill("SIGTERM"); } catch {}
    if (child.exitCode === null) await once(child, "exit").catch(() => {});
    if (Number.isInteger(daemonPid)) {
      try { process.kill(daemonPid, "SIGTERM"); } catch {}
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        try { process.kill(daemonPid, 0); } catch { break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    lines.close();
    await rm(agentDir, { recursive: true, force: true });
  });

  const initialized = await request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "pi-browser-bridge-idle-test", version: "1" },
  });
  assert.equal(initialized.result?.serverInfo?.name, "pi-browser-bridge");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  const status = await request("tools/call", { name: "get_status", arguments: {} });
  assert.equal(status.result?.isError, undefined);
  const runtimePath = join(agentDir, "state", "pi-browser-bridge", "shared-broker", "runtime.json");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  daemonPid = runtime.pid;
  assert.equal(runtime.state, "ready");

  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("MCP adapter did not exit after SIGTERM")), 8_000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).daemonId, runtime.daemonId);
  const afterDisconnect = JSON.parse(await readFile(runtimePath, "utf8"));
  assert.equal(afterDisconnect.state, "ready");
});
