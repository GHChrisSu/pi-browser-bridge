import { randomUUID } from "node:crypto";
import { BrowserBroker } from "./broker.js";
import { VERSION } from "./constants.js";
import {
  configuredIdleTimeout,
  configuredPort,
  getAgentDirectory,
  loadOrCreateMcpToken,
  probeBrokerHealth,
  writeRuntimeState,
  writeStartupError,
} from "./shared-broker.js";

const daemonId = randomUUID();
const agentDir = getAgentDirectory();
const host = "127.0.0.1";
const idleTimeoutMs = configuredIdleTimeout();
let broker;
let idleTimer;
let shuttingDown = false;

function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  if (broker?.mcpClientCount() !== 0) return;
  idleTimer = setTimeout(() => {
    if (broker?.isIdle()) void shutdown("idle timeout");
    else scheduleIdleShutdown();
  }, idleTimeoutMs);
  idleTimer.unref?.();
}

async function shutdown(reason = "Pi Bridge daemon stopping") {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(idleTimer);
  try { await broker?.close(); } catch {}
  await writeRuntimeState(agentDir, {
    state: "stopped",
    daemonId,
    pid: process.pid,
    version: VERSION,
    sharedBrokerProtocol: 1,
    port: broker?.port ?? configuredPort(),
    updatedAt: Date.now(),
    reason,
  }).catch(() => {});
  process.exit(0);
}

async function main() {
  const mcpToken = await loadOrCreateMcpToken(agentDir);
  broker = new BrowserBroker({
    host,
    port: configuredPort(),
    agentDir,
    mcpToken,
    daemonId,
    idleTimeoutMs,
    onMcpClientCountChange: (count) => {
      if (count === 0) scheduleIdleShutdown();
      else clearTimeout(idleTimer);
    },
  });

  try {
    await broker.start();
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      const health = await probeBrokerHealth(host, broker.port);
      if (health.kind === "shared") {
        // Another simultaneous Pi session won the singleton race. Its broker is the shared owner.
        process.exit(0);
      }
    }
    await writeStartupError(agentDir, error, process.env.PI_BROWSER_BRIDGE_STARTUP_ID);
    await writeRuntimeState(agentDir, {
      state: "failed",
      daemonId,
      pid: process.pid,
      version: VERSION,
      sharedBrokerProtocol: 1,
      port: broker.port,
      updatedAt: Date.now(),
      message: String(error?.message || error).slice(0, 500),
    }).catch(() => {});
    throw error;
  }

  await writeRuntimeState(agentDir, {
    state: "ready",
    daemonId,
    pid: process.pid,
    version: VERSION,
    sharedBrokerProtocol: 1,
    port: broker.port,
    updatedAt: Date.now(),
  });
  console.error(`[pi-browser-bridge] Shared broker ready on ws://${host}:${broker.port}/bridge`);
  scheduleIdleShutdown();
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("uncaughtException", (error) => {
  console.error(`[pi-browser-bridge] Shared broker uncaught error: ${error?.message || error}`);
  void shutdown("uncaught exception");
});
process.on("unhandledRejection", (error) => {
  console.error(`[pi-browser-bridge] Shared broker unhandled rejection: ${error?.message || error}`);
});

main().catch((error) => {
  console.error(`[pi-browser-bridge] Shared broker startup failed: ${error?.message || error}`);
  process.exitCode = 1;
  broker?.close().catch(() => {});
});
