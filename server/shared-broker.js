import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import http from "node:http";
import WebSocket from "ws";
import { DEFAULT_HOST, DEFAULT_PORT } from "./security.js";

export const SHARED_BROKER_PROTOCOL = 1;
export const DEFAULT_BROKER_IDLE_TIMEOUT_MS = 10 * 60 * 1_000;
const STARTUP_TIMEOUT_MS = 12_000;
const HEALTH_TIMEOUT_MS = 500;
const MCP_RESPONSE_TIMEOUT_MS = 30_000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function getAgentDirectory(env = process.env) {
  return resolve(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
}

export function getBrokerStatePaths(agentDir = getAgentDirectory()) {
  const stateDirectory = join(resolve(agentDir), "state", "pi-browser-bridge");
  const brokerDirectory = join(stateDirectory, "shared-broker");
  return {
    stateDirectory,
    brokerDirectory,
    authPath: join(brokerDirectory, "mcp-auth.json"),
    runtimePath: join(brokerDirectory, "runtime.json"),
    startupErrorPath: join(brokerDirectory, "startup-error.json"),
    startupLockPath: join(brokerDirectory, "startup.lock"),
  };
}

export async function readMcpToken(agentDir = getAgentDirectory()) {
  const paths = getBrokerStatePaths(agentDir);
  const stored = JSON.parse(await readFile(paths.authPath, "utf8"));
  if (typeof stored.token !== "string" || !TOKEN_PATTERN.test(stored.token)) {
    throw new Error("Shared Pi Bridge broker authentication file is invalid; do not overwrite it while a broker is running.");
  }
  if (process.platform !== "win32") await chmod(paths.authPath, 0o600).catch(() => {});
  return stored.token;
}

export async function loadOrCreateMcpToken(agentDir = getAgentDirectory()) {
  const paths = getBrokerStatePaths(agentDir);
  await mkdir(paths.brokerDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(paths.brokerDirectory, 0o700).catch(() => {});

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await readMcpToken(agentDir);
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) {
        await delay(25);
        continue;
      }
    }

    const token = randomBytes(32).toString("hex");
    try {
      await writeFile(paths.authPath, `${JSON.stringify({ token })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      if (process.platform !== "win32") await chmod(paths.authPath, 0o600).catch(() => {});
      return token;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }

  throw new Error("Could not read or create the shared Pi Bridge broker authentication file");
}

async function readRuntimeState(agentDir) {
  try {
    const value = JSON.parse(await readFile(getBrokerStatePaths(agentDir).runtimePath, "utf8"));
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65_535) return null;
    return value;
  } catch {
    return null;
  }
}

export async function writeRuntimeState(agentDir, value) {
  const paths = getBrokerStatePaths(agentDir);
  await mkdir(paths.brokerDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${paths.runtimePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await renameReplace(temporary, paths.runtimePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function renameReplace(source, destination) {
  const { rename } = await import("node:fs/promises");
  try {
    await rename(source, destination);
  } catch (error) {
    if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error.code)) throw error;
    await rm(destination, { force: true });
    await rename(source, destination);
  }
}

export async function writeStartupError(agentDir, error, attemptId) {
  const paths = getBrokerStatePaths(agentDir);
  await mkdir(paths.brokerDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${paths.startupErrorPath}.${process.pid}.${randomUUID()}.tmp`;
  const record = { attemptId, timestamp: Date.now(), message: String(error?.message || error).slice(0, 500) };
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await renameReplace(temporary, paths.startupErrorPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function readStartupError(agentDir, attemptId) {
  try {
    const record = JSON.parse(await readFile(getBrokerStatePaths(agentDir).startupErrorPath, "utf8"));
    return record.attemptId === attemptId ? record.message : null;
  } catch {
    return null;
  }
}

export function probeBrokerHealth(host, port, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    const request = http.get({ host, port, path: "/health", timeout: timeoutMs, headers: { accept: "application/json" } }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 8_192) chunks.push(chunk);
        else response.destroy(new Error("Health response exceeded its size limit"));
      });
      response.on("end", () => {
        try {
          const health = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (health.service === "pi-browser-bridge" && health.sharedBrokerProtocol === SHARED_BROKER_PROTOCOL && health.state === "stopping") {
            resolvePromise({ kind: "stopping", health });
          } else if (response.statusCode === 200 && health.service === "pi-browser-bridge" && health.sharedBrokerProtocol === SHARED_BROKER_PROTOCOL && health.state === "ready") {
            resolvePromise({ kind: "shared", health });
          } else {
            resolvePromise({ kind: "occupied", statusCode: response.statusCode });
          }
        } catch {
          resolvePromise({ kind: "occupied", statusCode: response.statusCode });
        }
      });
      response.on("error", () => resolvePromise({ kind: "occupied", statusCode: response.statusCode }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Health check timed out"), { code: "ETIMEDOUT" })));
    request.on("error", (error) => {
      if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ETIMEDOUT"].includes(error.code)) {
        resolvePromise({ kind: "unavailable", error });
      } else {
        resolvePromise({ kind: "occupied", error });
      }
    });
  });
}

async function acquireStartupLock(agentDir) {
  const paths = getBrokerStatePaths(agentDir);
  await mkdir(paths.brokerDirectory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ownerToken = randomUUID();
      const handle = await open(paths.startupLockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, ownerToken, createdAt: Date.now() })}\n`);
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const owner = JSON.parse(await readFile(paths.startupLockPath, "utf8"));
          if (owner.ownerToken === ownerToken) await rm(paths.startupLockPath, { force: true });
        } catch {}
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(await readFile(paths.startupLockPath, "utf8")); } catch {}
      if (owner && Number.isInteger(owner.pid)) {
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (probeError) { alive = probeError.code === "EPERM"; }
        if (alive && Date.now() - Number(owner.createdAt || 0) < STARTUP_TIMEOUT_MS * 3) return null;
      } else {
        let info;
        try { info = await stat(paths.startupLockPath); } catch {}
        if (info && Date.now() - info.mtimeMs < STARTUP_TIMEOUT_MS * 2) return null;
      }
      await rm(paths.startupLockPath, { force: true }).catch(() => {});
    }
  }
  return null;
}

function daemonEnvironment({ agentDir, port, idleTimeoutMs, attemptId }) {
  const env = {
    HOME: process.env.HOME || homedir(),
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: process.env.TMPDIR || tmpdir(),
    LANG: process.env.LANG || "en_US.UTF-8",
    PI_CODING_AGENT_DIR: agentDir,
    PI_BROWSER_BRIDGE_PORT: String(port),
    PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: String(idleTimeoutMs),
    PI_BROWSER_BRIDGE_STARTUP_ID: attemptId,
  };
  return env;
}

async function startDaemon(packageRoot, agentDir, port, idleTimeoutMs, attemptId) {
  const paths = getBrokerStatePaths(agentDir);
  await rm(paths.startupErrorPath, { force: true }).catch(() => {});
  if (!packageRoot) throw new Error("Shared Pi Bridge startup requires the installed package directory");
  const daemonPath = join(packageRoot, "server", "daemon.js");
  const child = spawn(process.execPath, [daemonPath], {
    cwd: packageRoot,
    env: daemonEnvironment({ agentDir, port, idleTimeoutMs, attemptId }),
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", (error) => { void writeStartupError(agentDir, error, attemptId); });
  child.unref();
}

export class SharedBrokerClient {
  constructor(socket, address, clientId, health) {
    this.socket = socket;
    this.address = address;
    this.clientId = clientId;
    this.health = health;
    this.pending = new Map();
    this.closed = false;
    socket.on("message", (raw) => this.#onMessage(raw));
    socket.on("close", () => this.#failPending(new Error("Shared Pi Bridge broker connection closed")));
    socket.on("error", (error) => this.#failPending(new Error(`Shared Pi Bridge broker error: ${error.message}`)));
  }

  static async connect({ host = DEFAULT_HOST, port, token, timeoutMs = 5_000 }) {
    const socket = new WebSocket(`ws://${host}:${port}/mcp`, {
      headers: { authorization: `Bearer ${token}` },
      handshakeTimeout: timeoutMs,
      maxPayload: 24 * 1024 * 1024,
      perMessageDeflate: false,
    });
    const ready = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to the shared Pi Bridge broker")), timeoutMs);
      const fail = (error) => { clearTimeout(timer); reject(error); };
      const onUnexpectedResponse = (_request, response) => {
        response.resume();
        fail(new Error(`Shared Pi Bridge broker rejected MCP authentication (HTTP ${response.statusCode})`));
      };
      const onHandshakeClose = () => fail(new Error("Shared Pi Bridge broker closed the MCP handshake"));
      socket.once("error", fail);
      socket.once("close", onHandshakeClose);
      socket.once("unexpected-response", onUnexpectedResponse);
      socket.once("open", () => {
        const onMessage = (raw) => {
          let message;
          try { message = JSON.parse(raw.toString()); } catch { return; }
          if (message.type !== "ready") return;
          clearTimeout(timer);
          socket.off("message", onMessage);
          socket.off("error", fail);
          socket.off("close", onHandshakeClose);
          socket.off("unexpected-response", onUnexpectedResponse);
          resolvePromise(message);
        };
        socket.on("message", onMessage);
      });
    }).catch((error) => {
      socket.close();
      throw error;
    });
    if (ready.sharedBrokerProtocol !== SHARED_BROKER_PROTOCOL || typeof ready.clientId !== "string") {
      socket.close();
      throw new Error("The shared Pi Bridge broker uses an incompatible protocol");
    }
    return new SharedBrokerClient(socket, { host, port }, ready.clientId, ready);
  }

  getStatus() {
    return this.#call("get_status");
  }

  async listProfiles() {
    const result = await this.#call("list_profiles");
    return Array.isArray(result?.profiles) ? result.profiles : [];
  }

  request(command, params = {}, options = {}) {
    return this.#call("request", { command, params, options }, options.timeoutMs);
  }

  resetPairing() {
    return this.#call("reset_pairing");
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.#failPending(new Error("Shared Pi Bridge MCP client closed"), true);
    if (this.socket.readyState < WebSocket.CLOSING) {
      await new Promise((resolvePromise) => {
        const timer = setTimeout(resolvePromise, 500);
        this.socket.once("close", () => { clearTimeout(timer); resolvePromise(); });
        this.socket.close(1000, "Pi MCP client closed");
      });
    }
  }

  #call(method, params = {}, timeoutMs = MCP_RESPONSE_TIMEOUT_MS) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Shared Pi Bridge broker is disconnected"));
    const id = randomUUID();
    const boundedTimeout = Math.max(1_000, Math.min(Number(timeoutMs) || MCP_RESPONSE_TIMEOUT_MS, 120_000));
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        if (this.socket.readyState === WebSocket.OPEN) {
          try { this.socket.send(JSON.stringify({ type: "cancel", id, clientId: this.clientId })); } catch {}
        }
        this.pending.delete(id);
        reject(new Error(`Shared Pi Bridge request ${method} timed out after ${boundedTimeout} ms`));
      }, boundedTimeout);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      try {
        this.socket.send(JSON.stringify({ type: "rpc", id, clientId: this.clientId, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  #onMessage(raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== "rpc_result" || typeof message.id !== "string") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok === false) pending.reject(new Error(String(message.error || "Shared Pi Bridge request failed")));
    else pending.resolve(message.result);
  }

  #failPending(error, cancel = false) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (cancel && this.socket.readyState === WebSocket.OPEN) {
        try { this.socket.send(JSON.stringify({ type: "cancel", id, clientId: this.clientId })); } catch {}
      }
      pending.reject(error);
    }
  }
}

export async function connectSharedBroker({
  agentDir = getAgentDirectory(),
  packageRoot,
  host = DEFAULT_HOST,
  port = configuredPort(),
  idleTimeoutMs = configuredIdleTimeout(),
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
} = {}) {
  const normalizedAgentDir = resolve(agentDir);
  const paths = getBrokerStatePaths(normalizedAgentDir);
  await mkdir(paths.brokerDirectory, { recursive: true, mode: 0o700 });
  const runtime = await readRuntimeState(normalizedAgentDir);
  const targetPort = runtime?.port ?? port;
  const firstProbe = await probeBrokerHealth(host, targetPort);
  if (firstProbe.kind === "shared" || firstProbe.kind === "stopping") {
    const existing = await attachToExistingBroker(normalizedAgentDir, host, targetPort, startupTimeoutMs);
    if (existing) return existing;
  }
  if (firstProbe.kind === "occupied") throw occupiedPortError(targetPort, firstProbe);

  const releaseLock = await acquireStartupLock(normalizedAgentDir);
  if (!releaseLock) {
    const waitStartedAt = Date.now();
    const attached = await waitForBroker({ agentDir: normalizedAgentDir, host, port: targetPort, timeoutMs: startupTimeoutMs, startedAt: waitStartedAt });
    return attachToBroker(normalizedAgentDir, host, attached.port);
  }

  const attemptId = randomUUID();
  const startedAt = Date.now();
  try {
    const again = await probeBrokerHealth(host, targetPort);
    if (again.kind === "shared" || again.kind === "stopping") {
      const existing = await attachToExistingBroker(normalizedAgentDir, host, targetPort, startupTimeoutMs);
      if (existing) return existing;
    }
    if (again.kind === "occupied") throw occupiedPortError(targetPort, again);
    await loadOrCreateMcpToken(normalizedAgentDir);
    await startDaemon(packageRoot, normalizedAgentDir, targetPort, idleTimeoutMs, attemptId);
    const attached = await waitForBroker({ agentDir: normalizedAgentDir, host, port: targetPort, timeoutMs: startupTimeoutMs, attemptId, startedAt });
    return attachToBroker(normalizedAgentDir, host, attached.port);
  } finally {
    await releaseLock();
  }
}

export function configuredPort() {
  const value = process.env.PI_BROWSER_BRIDGE_PORT === undefined ? DEFAULT_PORT : Number(process.env.PI_BROWSER_BRIDGE_PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("PI_BROWSER_BRIDGE_PORT must be an integer from 1 to 65535 for the shared broker");
  return value;
}

export function configuredIdleTimeout() {
  const value = process.env.PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS === undefined
    ? DEFAULT_BROKER_IDLE_TIMEOUT_MS : Number(process.env.PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS);
  if (!Number.isInteger(value) || value < 1_000 || value > 24 * 60 * 60 * 1_000) {
    throw new Error("PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS must be an integer from 1000 to 86400000");
  }
  return value;
}

async function attachToExistingBroker(agentDir, host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const health = await probeBrokerHealth(host, port);
    if (health.kind === "unavailable") return null;
    if (health.kind === "occupied") throw occupiedPortError(port, health);
    if (health.kind === "shared") {
      try { return await attachToBroker(agentDir, host, port); }
      catch (error) {
        if (!/closed the MCP handshake|ECONNREFUSED|ECONNRESET|socket hang up|Timed out connecting to the shared Pi Bridge broker/i.test(error.message)) throw error;
        lastError = error;
      }
    }
    await delay(60);
  }
  const health = await probeBrokerHealth(host, port);
  if (health.kind === "unavailable" || health.kind === "stopping") return null;
  if (lastError) throw lastError;
  throw new Error(`Timed out attaching to the shared Pi Bridge broker on ${host}:${port}`);
}

async function attachToBroker(agentDir, host, port) {
  let token;
  try { token = await readMcpToken(agentDir); }
  catch (error) { throw new Error(`Shared Pi Bridge broker is running but its local authentication state is unavailable: ${error.message}`); }
  return SharedBrokerClient.connect({ host, port, token });
}

async function waitForBroker({ agentDir, host, port, timeoutMs, attemptId, startedAt }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = await readRuntimeState(agentDir);
    const candidatePort = runtime?.port ?? port;
    const health = await probeBrokerHealth(host, candidatePort);
    if (health.kind === "shared") return { port: candidatePort, health: health.health };
    if (health.kind === "occupied") throw occupiedPortError(candidatePort, health);
    if (attemptId) {
      const error = await readStartupError(agentDir, attemptId);
      if (error) throw new Error(error);
      const runtime = await readRuntimeState(agentDir);
      if (runtime?.state === "failed" && runtime.updatedAt >= (startedAt || 0)) {
        throw new Error(runtime.message || "Shared Pi Bridge broker failed to start");
      }
    }
    await delay(80);
  }
  throw new Error(`Timed out waiting for the shared Pi Bridge broker on ${host}:${port}`);
}

function occupiedPortError(port, probe) {
  const suffix = probe.statusCode ? ` (HTTP ${probe.statusCode})` : "";
  return new Error(`Pi Bridge port ${port} is occupied by a server that does not expose the shared-broker health endpoint${suffix}. Stop or upgrade the legacy Pi Bridge session, then reconnect.`);
}
