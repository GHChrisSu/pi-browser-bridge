import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { DEFAULT_HOST, DEFAULT_PORT, extensionIdFromOrigin, isLoopbackAddress } from "./security.js";
import { HEALTH_PATH, MCP_PATH, SHARED_BROKER_PROTOCOL, VERSION } from "./constants.js";

const MAX_PAYLOAD = 8 * 1024 * 1024;
const MAX_MCP_PAYLOAD = 24 * 1024 * 1024;
const DEFAULT_CONNECT_WAIT_MS = 8_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_WRITE_COMMANDS = new Set([
  "navigate", "click", "fill_form", "type_text", "press_key", "scroll",
  "click_by_role", "fill_by_role", "fill_accessibility_node", "click_dom_node",
  "click_accessibility_node", "upload_file", "download_media", "create_workspace", "create_tab",
]);
const DOWNLOAD_COMMANDS = new Set(["download_url", "download_media"]);
const BROKER_COMMANDS = new Set([
  "get_status", "get_active_tab", "list_tabs", "list_workspaces", "get_page_info", "read_page", "read_urls",
  "list_page_assets", "get_accessibility_tree", "get_visible_dom", "get_by_role", "click_by_role", "fill_by_role",
  "fill_accessibility_node", "click_dom_node", "click_accessibility_node", "get_interactives", "navigate",
  "download_url", "download_media", "upload_file", "create_workspace", "create_tab", "click", "fill_form",
  "type_text", "press_key", "scroll", "wait_for", "screenshot",
]);
const PROFILE_DEBUGGER_COMMANDS = new Set([
  "get_accessibility_tree", "get_visible_dom", "get_by_role", "click_by_role", "fill_by_role",
  "fill_accessibility_node", "click_dom_node", "click_accessibility_node", "upload_file",
]);

function bearerMatches(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ") || typeof token !== "string") return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function isLoopbackRequest(request) {
  return isLoopbackAddress(request.socket.remoteAddress ?? "");
}

function agentDirectory() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function pairingPath(agentDir) {
  return join(agentDir, "state", "pi-browser-bridge", "extension.json");
}

function cleanProfileName(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

function operationLocks(profileId, command) {
  const locks = [];
  if (PROFILE_WRITE_COMMANDS.has(command)) locks.push(`profile:${profileId}:writes`);
  if (PROFILE_DEBUGGER_COMMANDS.has(command)) locks.push(`profile:${profileId}:debugger`);
  if (DOWNLOAD_COMMANDS.has(command)) locks.push(`profile:${profileId}:downloads`);
  return locks;
}

export class BrowserBroker {
  constructor({
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    connectWaitMs = DEFAULT_CONNECT_WAIT_MS,
    agentDir = agentDirectory(),
    mcpToken,
    idleTimeoutMs = 0,
    daemonId = randomUUID(),
    onMcpClientCountChange,
  } = {}) {
    this.host = host;
    this.port = port;
    this.connectWaitMs = connectWaitMs;
    this.pairingFile = pairingPath(agentDir);
    this.pairingDirectory = dirname(this.pairingFile);
    this.httpServer = null;
    this.wss = null;
    this.mcpWss = null;
    this.mcpToken = mcpToken;
    this.daemonId = daemonId;
    this.idleTimeoutMs = idleTimeoutMs;
    this.onMcpClientCountChange = onMcpClientCountChange || null;
    this.mcpClients = new Map();
    this.activeMcpRequests = new Map();
    this.operationQueues = new Map();
    this.extensionId = null;
    this.pairingPromise = null;
    this.profiles = new Map();
    this.pending = new Map();
    this.waiters = new Set();
    this.startedAt = Date.now();
    this.pingTimer = null;
    this.lastSeenAt = null;
    this.closed = false;
  }

  async start() {
    const saved = await this.#readPairing();
    this.extensionId = saved?.extensionId ?? null;

    this.httpServer = createServer((request, response) => {
      if (request.method === "GET" && request.url === HEALTH_PATH && isLoopbackRequest(request) && request.headers.host === `${this.host}:${this.port}` && request.headers.origin === undefined) {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({
          service: "pi-browser-bridge",
          version: VERSION,
          sharedBrokerProtocol: SHARED_BROKER_PROTOCOL,
          daemonId: this.daemonId,
          host: this.host,
          port: this.port,
        }));
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found\n");
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
    this.mcpWss = new WebSocketServer({ noServer: true, maxPayload: MAX_MCP_PAYLOAD });

    this.httpServer.on("upgrade", (request, socket, head) => {
      const remote = request.socket.remoteAddress ?? "";
      const expectedHost = `${this.host}:${this.port}`;
      if (request.url === MCP_PATH) {
        if (!isLoopbackAddress(remote) || request.headers.host !== expectedHost || request.headers.origin !== undefined || !bearerMatches(request.headers.authorization, this.mcpToken)) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        this.mcpWss.handleUpgrade(request, socket, head, (webSocket) => {
          this.mcpWss.emit("connection", webSocket, request);
        });
        return;
      }

      const originId = extensionIdFromOrigin(request.headers.origin);
      if (!isLoopbackAddress(remote) || request.url !== "/bridge" || request.headers.host !== expectedHost || !originId) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (webSocket) => {
        this.wss.emit("connection", webSocket, request, originId);
      });
    });

    this.wss.on("connection", (webSocket, _request, originId) => this.#handleExtension(webSocket, originId));
    this.mcpWss.on("connection", (webSocket) => this.#handleMcpClient(webSocket));
    this.httpServer.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`[pi-browser-bridge] Port ${this.port} is already in use; close the other Pi Bridge session.`);
      } else {
        console.error(`[pi-browser-bridge] Loopback server error: ${error.message}`);
      }
    });

    await new Promise((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(this.port, this.host, () => {
        this.httpServer.off("error", reject);
        const address = this.httpServer.address();
        if (address && typeof address === "object") this.port = address.port;
        resolve();
      });
    });

    console.error(`[pi-browser-bridge] Listening on ws://${this.host}:${this.port}/bridge`);
    this.pingTimer = setInterval(() => {
      for (const profile of this.#connectedProfiles()) {
        try { profile.socket.send(JSON.stringify({ type: "ping", at: Date.now() })); } catch {}
      }
    }, 25_000);
    this.pingTimer.unref?.();
  }

  getStatus() {
    const profiles = this.listProfiles();
    return {
      connected: profiles.some((profile) => profile.connected),
      connected_profile_count: profiles.filter((profile) => profile.connected).length,
      extension_id: this.extensionId,
      extension_version: profiles.find((profile) => profile.connected)?.extension_version ?? null,
      host: this.host,
      port: this.port,
      daemon_id: this.daemonId,
      shared_broker_protocol: SHARED_BROKER_PROTOCOL,
      mcp_client_count: this.mcpClients.size,
      last_seen_at: this.lastSeenAt,
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      pairing: this.extensionId ? "pinned" : "waiting for the Chrome extension to pair automatically",
      profiles,
    };
  }

  listProfiles() {
    return [...this.profiles.values()].map((profile) => ({
      profile_id: profile.id,
      name: profile.name,
      connected: profile.socket?.readyState === WebSocket.OPEN,
      extension_version: profile.version,
      connected_at: profile.connectedAt,
      last_seen_at: profile.lastSeenAt,
    }));
  }

  mcpClientCount() {
    return this.mcpClients.size;
  }

  isIdle() {
    return this.mcpClients.size === 0 && this.pending.size === 0;
  }

  async #handleMcpClient(socket) {
    const clientId = randomUUID();
    this.mcpClients.set(clientId, socket);
    this.activeMcpRequests.set(clientId, new Map());
    socket.send(JSON.stringify({
      type: "ready",
      sharedBrokerProtocol: SHARED_BROKER_PROTOCOL,
      version: VERSION,
      daemonId: this.daemonId,
      port: this.port,
      clientId,
    }));
    this.onMcpClientCountChange?.(this.mcpClients.size);
    socket.on("message", (raw) => { void this.#handleMcpMessage(socket, clientId, raw); });
    socket.on("close", () => {
      for (const controller of this.activeMcpRequests.get(clientId)?.values() || []) {
        controller.abort(new Error("Pi MCP session disconnected"));
      }
      this.activeMcpRequests.delete(clientId);
      this.#rejectClientPending(clientId, new Error("Pi MCP session disconnected"));
      if (!this.mcpClients.delete(clientId)) return;
      this.onMcpClientCountChange?.(this.mcpClients.size);
    });
  }

  async #handleMcpMessage(socket, clientId, raw) {
    let request;
    let controller;
    try {
      if (raw.length > 1_000_000) throw new Error("Shared broker request exceeded its size limit");
      request = JSON.parse(raw.toString());
      if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.id !== "string" || request.id.length > 100 || request.clientId !== clientId) {
        throw new Error("Invalid shared broker request");
      }
      if (request.type === "cancel") {
        this.activeMcpRequests.get(clientId)?.get(request.id)?.abort(new Error("Pi MCP request cancelled"));
        return;
      }
      if (request.type !== "rpc" || typeof request.method !== "string") throw new Error("Invalid shared broker request");
      controller = new AbortController();
      this.activeMcpRequests.get(clientId)?.set(request.id, controller);
      let result;
      if (request.method === "get_status") {
        result = this.getStatus();
      } else if (request.method === "list_profiles") {
        result = { profiles: this.listProfiles() };
      } else if (request.method === "request") {
        const params = request.params;
        if (!params || typeof params !== "object" || Array.isArray(params) || typeof params.command !== "string" || !params.command || params.command.length > 80) {
          throw new Error("Invalid shared browser command");
        }
        if (!BROKER_COMMANDS.has(params.command)) throw new Error("Browser command is not in the fixed Pi Bridge allowlist");
        const options = params.options && typeof params.options === "object" && !Array.isArray(params.options) ? params.options : {};
        const timeoutMs = Number.isInteger(options.timeoutMs) ? Math.max(1_000, Math.min(options.timeoutMs, 120_000)) : DEFAULT_COMMAND_TIMEOUT_MS;
        const profileId = typeof options.profileId === "string" ? options.profileId : undefined;
        const commandParams = params.params && typeof params.params === "object" && !Array.isArray(params.params) ? params.params : {};
        result = await this.request(params.command, commandParams, { timeoutMs, profileId, clientId, signal: controller.signal });
      } else if (request.method === "reset_pairing") {
        result = await this.resetPairing();
      } else {
        throw new Error("Unsupported shared broker method");
      }
      if (!controller.signal.aborted && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "rpc_result", id: request.id, ok: true, result }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN && request && typeof request.id === "string") {
        const message = error instanceof Error ? error.message : String(error);
        socket.send(JSON.stringify({ type: "rpc_result", id: request.id, ok: false, error: message.slice(0, 500) }));
      } else if (socket.readyState === WebSocket.OPEN) {
        socket.close(4400, "Invalid shared broker request");
      }
    } finally {
      if (controller) this.activeMcpRequests.get(clientId)?.delete(request.id);
    }
  }

  request(command, params = {}, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, profileId, clientId, signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
    return this.#selectProfile(profileId).then((profile) => {
      const keys = operationLocks(profile.id, command);
      return this.#withOperationLocks(keys, async () => {
        if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
        const currentProfile = await this.#selectProfile(profile.id);
        return this.#sendCommand(currentProfile, command, params, timeoutMs, clientId, signal);
      }, signal);
    });
  }

  async #sendCommand(profile, command, params, timeoutMs, clientId, signal) {
    if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
    const socket = profile.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(`Chrome profile "${profile.name}" disconnected`);

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(result);
      };
      const onAbort = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
      const timer = setTimeout(() => finish(new Error(`Browser command ${command} timed out after ${timeoutMs} ms`)), timeoutMs);
      this.pending.set(id, { resolve, reject, timer, profileId: profile.id, clientId, socket, finish });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try {
        socket.send(JSON.stringify({ type: "command", id, command, params }));
      } catch (error) {
        finish(error);
      }
    });
  }

  async #withOperationLocks(keys, operation, signal) {
    const ordered = [...new Set(keys)].sort();
    const run = async (index) => {
      if (index >= ordered.length) return operation();
      const key = ordered[index];
      const previous = this.operationQueues.get(key) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      let acquired = false;
      const tail = previous.catch(() => {}).then(() => gate);
      this.operationQueues.set(key, tail);
      try {
        if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
        if (signal) {
          let abortHandler;
          try {
            await Promise.race([
              previous.catch(() => {}),
              new Promise((_, reject) => {
                abortHandler = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
                signal.addEventListener("abort", abortHandler, { once: true });
              }),
            ]);
          } finally {
            if (abortHandler) signal.removeEventListener("abort", abortHandler);
          }
        } else {
          await previous.catch(() => {});
        }
        if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error("Shared broker request aborted"));
        acquired = true;
        return await run(index + 1);
      } finally {
        if (acquired) release();
        else void previous.catch(() => {}).then(release);
        void tail.finally(() => {
          if (this.operationQueues.get(key) === tail) this.operationQueues.delete(key);
        });
      }
    };
    return run(0);
  }

  async resetPairing() {
    await this.pairingPromise?.catch(() => {});
    this.pairingPromise = null;
    await rm(this.pairingFile, { force: true });
    this.extensionId = null;
    this.#rejectAll("Chrome extension pairing reset by user");
    for (const profile of this.profiles.values()) {
      if (profile.socket && profile.socket.readyState < WebSocket.CLOSING) profile.socket.close(4001, "Pairing reset by user");
    }
    this.profiles.clear();
    return { pairing_reset: true, note: "The next Chrome extension connection will pair automatically." };
  }

  async close() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.#rejectAll("Pi Bridge server is shutting down");
    for (const waiter of this.waiters) waiter(null, false);
    this.waiters.clear();
    for (const profile of this.profiles.values()) {
      if (profile.socket && profile.socket.readyState < WebSocket.CLOSING) profile.socket.close(1001, "Pi is shutting down");
    }
    for (const client of this.wss?.clients ?? []) client.terminate();
    for (const client of this.mcpWss?.clients ?? []) client.terminate();
    await Promise.all([this.wss, this.mcpWss].map((webSocketServer) => new Promise((resolve) => {
      try { webSocketServer?.close(() => resolve()); } catch { resolve(); }
    })));
    await new Promise((resolve) => {
      try {
        if (!this.httpServer?.listening) return resolve();
        this.httpServer.close(() => resolve());
      } catch { resolve(); }
    });
  }

  async #readPairing() {
    try {
      const data = JSON.parse(await readFile(this.pairingFile, "utf8"));
      if (!extensionIdFromOrigin(`chrome-extension://${data.extensionId}`)) {
        throw new Error("Saved extension pairing is invalid; run browser-bridge-reset to pair again.");
      }
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async #savePairing(extensionId) {
    const path = this.pairingFile;
    const dir = this.pairingDirectory;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ extensionId, pairedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  }

  #handleExtension(socket, originId) {
    if (this.closed) {
      socket.close(1001, "Server is shutting down");
      return;
    }
    const timer = setTimeout(() => socket.close(4400, "Extension handshake timed out"), 4_000);
    const onHello = async (raw) => {
      clearTimeout(timer);
      socket.off("message", onHello);
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(4400, "Invalid hello message");
        return;
      }
      if (message.type !== "hello" || message.extensionId !== originId || typeof message.version !== "string") {
        socket.close(4400, "Invalid extension identity");
        return;
      }
      if (message.profileId !== undefined && (typeof message.profileId !== "string" || !PROFILE_ID_PATTERN.test(message.profileId))) {
        socket.close(4400, "Invalid Chrome profile identity");
        return;
      }
      const profileId = message.profileId || `legacy-${originId}`;
      const profileName = message.profileId ? cleanProfileName(message.profileName) : "Chrome profile (legacy)";
      if (!profileName) {
        socket.close(4400, "Invalid Chrome profile name");
        return;
      }

      if (this.extensionId && this.extensionId !== originId) {
        socket.send(JSON.stringify({ type: "hello_refused", reason: "A different Chrome extension is already paired. Use reset_pairing only when replacing it." }));
        socket.close(4409, "A different extension is paired");
        return;
      }

      if (!this.extensionId) {
        if (!this.pairingPromise) {
          this.pairingPromise = this.#savePairing(originId)
            .then(() => { this.extensionId = originId; })
            .finally(() => { this.pairingPromise = null; });
        }
        try {
          await this.pairingPromise;
        } catch {
          socket.close(4500, "Could not save extension pairing");
          return;
        }
      }
      if (this.extensionId !== originId) {
        socket.send(JSON.stringify({ type: "hello_refused", reason: "A different Chrome extension is already paired. Use reset_pairing only when replacing it." }));
        socket.close(4409, "A different extension is paired");
        return;
      }

      const previous = this.profiles.get(profileId);
      if (previous?.socket && previous.socket !== socket && previous.socket.readyState < WebSocket.CLOSING) {
        this.#rejectProfilePending(profileId, "Chrome profile reconnected");
        previous.socket.close(1000, "This Chrome profile reconnected");
      }
      const profile = {
        id: profileId,
        name: profileName,
        version: message.version,
        socket,
        connectedAt: new Date().toISOString(),
        lastSeenAt: this.profiles.get(profileId)?.lastSeenAt || null,
      };
      this.profiles.set(profileId, profile);
      socket.send(JSON.stringify({ type: "hello_ack", protocol: 2, profileId }));
      this.#notifyWaiters(profileId, true);
      console.error(`[pi-browser-bridge] Chrome profile connected: ${profileName} (${message.version})`);

      socket.on("message", (responseRaw) => this.#handleExtensionMessage(profileId, socket, responseRaw));
      socket.on("close", () => {
        if (this.profiles.get(profileId) !== profile || profile.socket !== socket) return;
        profile.socket = null;
        this.#rejectProfilePending(profileId, "Chrome profile disconnected");
        this.#notifyWaiters(profileId, false);
      });
      socket.on("error", (error) => console.error(`[pi-browser-bridge] Chrome profile socket: ${error.message}`));
    };
    socket.on("message", onHello);
    socket.on("close", () => clearTimeout(timer));
  }

  #handleExtensionMessage(profileId, socket, raw) {
    let response;
    try {
      response = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const profile = this.profiles.get(profileId);
    if (!profile || profile.socket !== socket) return;
    if (response.type === "pong") {
      const at = new Date().toISOString();
      profile.lastSeenAt = at;
      this.lastSeenAt = at;
      return;
    }
    if (!response.id || !["result", "error"].includes(response.type)) return;
    const pending = this.pending.get(response.id);
    if (!pending || pending.socket !== socket || pending.profileId !== profileId) return;
    if (response.type === "error") pending.finish(new Error(String(response.error || "Browser command failed")));
    else pending.finish(null, response.data);
  }

  #connectedProfiles() {
    return [...this.profiles.values()].filter((profile) => profile.socket?.readyState === WebSocket.OPEN);
  }

  async #selectProfile(profileId) {
    if (profileId !== undefined) {
      if (typeof profileId !== "string" || !profileId) throw new Error("profile_id must be a connected Chrome profile ID");
      if (this.profiles.get(profileId)?.socket?.readyState === WebSocket.OPEN) return this.profiles.get(profileId);
      await this.#waitForProfile(profileId);
      const profile = this.profiles.get(profileId);
      if (!profile?.socket || profile.socket.readyState !== WebSocket.OPEN) {
        throw new Error(`Chrome profile ${profileId} is not connected. Call list_profiles to see connected profiles.`);
      }
      return profile;
    }

    let connected = this.#connectedProfiles();
    if (connected.length === 1) return connected[0];
    if (connected.length > 1) throw new Error("Multiple Chrome profiles are connected. Call list_profiles and pass profile_id to the browser tool.");
    await this.#waitForProfile(null);
    connected = this.#connectedProfiles();
    if (connected.length === 1) return connected[0];
    if (connected.length > 1) throw new Error("Multiple Chrome profiles are connected. Call list_profiles and pass profile_id to the browser tool.");
    throw new Error(`No Chrome profile connected (waited ${Math.round(this.connectWaitMs / 1000)} seconds). Open Chrome with Pi Bridge enabled and retry.`);
  }

  async #waitForProfile(profileId) {
    if (this.closed) throw new Error("Pi Bridge server is shutting down");
    const available = () => profileId === null
      ? this.#connectedProfiles().length > 0
      : this.profiles.get(profileId)?.socket?.readyState === WebSocket.OPEN;
    if (available()) return;
    const connected = await new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve(result);
      };
      const waiter = (connectedProfileId, isConnected) => {
        if (profileId === null) {
          if (connectedProfileId === null && !isConnected) finish(false);
          else if (isConnected) finish(true);
        } else if (connectedProfileId === profileId) {
          finish(isConnected);
        }
      };
      const timer = setTimeout(() => finish(false), this.connectWaitMs);
      this.waiters.add(waiter);
      if (available()) finish(true);
    });
    if (!connected || !available()) {
      if (profileId !== null) throw new Error(`Chrome profile ${profileId} is not connected. Call list_profiles to see connected profiles.`);
      throw new Error(`No Chrome profile connected (waited ${Math.round(this.connectWaitMs / 1000)} seconds). Open Chrome with Pi Bridge enabled and retry.`);
    }
  }

  #notifyWaiters(profileId, connected) {
    for (const waiter of this.waiters) waiter(profileId, connected);
  }

  #rejectProfilePending(profileId, reason) {
    for (const [id, pending] of this.pending) {
      if (pending.profileId !== profileId) continue;
      pending.finish(new Error(reason));
    }
  }

  #rejectClientPending(clientId, reason) {
    for (const pending of this.pending.values()) {
      if (pending.clientId !== clientId) continue;
      pending.finish(reason);
    }
  }

  #rejectAll(reason) {
    for (const pending of this.pending.values()) pending.finish(new Error(reason));
  }
}
