import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { DEFAULT_HOST, DEFAULT_PORT, extensionIdFromOrigin, isLoopbackAddress } from "./security.js";

const MAX_PAYLOAD = 8 * 1024 * 1024;
const DEFAULT_CONNECT_WAIT_MS = 8_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

function agentDirectory() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function pairingPath(agentDir) {
  return join(agentDir, "state", "pi-browser-bridge", "extension.json");
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

export class BrowserBroker {
  constructor({ host = DEFAULT_HOST, port = DEFAULT_PORT, connectWaitMs = DEFAULT_CONNECT_WAIT_MS, agentDir = agentDirectory() } = {}) {
    this.host = host;
    this.port = port;
    this.connectWaitMs = connectWaitMs;
    this.pairingFile = pairingPath(agentDir);
    this.pairingDirectory = dirname(this.pairingFile);
    this.httpServer = null;
    this.wss = null;
    this.extension = null;
    this.extensionId = null;
    this.extensionVersion = null;
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

    this.httpServer = createServer((_request, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found\n");
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

    this.httpServer.on("upgrade", (request, socket, head) => {
      const remote = request.socket.remoteAddress ?? "";
      const originId = extensionIdFromOrigin(request.headers.origin);
      const expectedHost = `${this.host}:${this.port}`;
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
      if (this.extension?.readyState !== WebSocket.OPEN) return;
      try { this.extension.send(JSON.stringify({ type: "ping", at: Date.now() })); } catch {}
    }, 25_000);
    this.pingTimer.unref?.();
  }

  getStatus() {
    return {
      connected: this.extension !== null && this.extension.readyState === WebSocket.OPEN,
      extension_id: this.extensionId,
      extension_version: this.extensionVersion,
      host: this.host,
      port: this.port,
      last_seen_at: this.lastSeenAt,
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      pairing: this.extensionId ? "pinned" : "waiting for the Chrome extension to pair automatically",
    };
  }

  async request(command, params = {}, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    await this.#waitForExtension();
    const socket = this.extension;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Chrome extension disconnected");

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser command ${command} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ type: "command", id, command, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async resetPairing() {
    const path = this.pairingFile;
    await rm(path, { force: true });
    this.extensionId = null;
    if (this.extension?.readyState === WebSocket.OPEN) this.extension.close(4001, "Pairing reset by user");
    return { pairing_reset: true, note: "The next Chrome extension connection will pair automatically." };
  }

  async close() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.#rejectAll("Pi Bridge server is shutting down");
    for (const waiter of this.waiters) waiter(false);
    this.waiters.clear();
    if (this.extension && this.extension.readyState < WebSocket.CLOSING) this.extension.close(1001, "Pi is shutting down");
    for (const client of this.wss?.clients ?? []) client.terminate();
    await new Promise((resolve) => {
      try { this.wss?.close(() => resolve()); } catch { resolve(); }
    });
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

      if (this.extensionId && this.extensionId !== originId) {
        socket.send(JSON.stringify({ type: "hello_refused", reason: "A different Chrome extension is already paired. Use the reset_pairing Pi browser tool only when replacing it." }));
        socket.close(4409, "A different extension is paired");
        return;
      }

      if (!this.extensionId) {
        try {
          await this.#savePairing(originId);
        } catch (error) {
          socket.close(4500, `Could not save pairing: ${errorText(error)}`);
          return;
        }
        this.extensionId = originId;
      }

      if (this.extension && this.extension !== socket && this.extension.readyState < WebSocket.CLOSING) {
        this.extension.close(1000, "Extension reconnected");
      }
      this.extension = socket;
      this.extensionVersion = message.version;
      socket.send(JSON.stringify({ type: "hello_ack", protocol: 1 }));
      for (const waiter of this.waiters) waiter(true);
      this.waiters.clear();
      console.error(`[pi-browser-bridge] Chrome extension connected (${message.version})`);

      socket.on("message", (responseRaw) => this.#handleExtensionMessage(responseRaw));
      socket.on("close", () => {
        if (this.extension === socket) {
          this.extension = null;
          this.extensionVersion = null;
          this.#rejectAll("Chrome extension disconnected");
        }
      });
      socket.on("error", (error) => console.error(`[pi-browser-bridge] Extension socket: ${error.message}`));
    };
    socket.on("message", onHello);
    socket.on("close", () => clearTimeout(timer));
  }

  #handleExtensionMessage(raw) {
    let response;
    try {
      response = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (response.type === "pong") {
      this.lastSeenAt = new Date().toISOString();
      return;
    }
    if (!response.id || !["result", "error"].includes(response.type)) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.type === "error") pending.reject(new Error(String(response.error || "Browser command failed")));
    else pending.resolve(response.data);
  }

  #rejectAll(reason) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async #waitForExtension() {
    if (this.extension?.readyState === WebSocket.OPEN) return;
    if (this.closed) throw new Error("Pi Bridge server is shutting down");
    const connected = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(onConnection);
        resolve(false);
      }, this.connectWaitMs);
      const onConnection = (value) => {
        clearTimeout(timer);
        this.waiters.delete(onConnection);
        resolve(value);
      };
      this.waiters.add(onConnection);
    });
    if (!connected || !this.extension || this.extension.readyState !== WebSocket.OPEN) {
      throw new Error(`Chrome extension is not connected (waited ${Math.round(this.connectWaitMs / 1000)} seconds). Open Chrome, enable Pi Bridge, and retry.`);
    }
  }
}
