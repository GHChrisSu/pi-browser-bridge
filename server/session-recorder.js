import { appendFile, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SAFE_RECORD_COMMANDS = new Set([
  "navigate", "click", "scroll", "press_key", "wait_for", "read_page", "get_page_info",
  "get_interactives", "get_accessibility_tree", "get_visible_dom", "get_by_role", "get_css_styles",
  "read_console", "monitor_network", "extract_table", "query_dom", "find_text", "read_form", "get_frames",
]);
const FORBIDDEN_RECORD_KEYS = /password|secret|token|cookie|credential|authorization|file|upload|body|headers|text|value|code/i;

function sanitizeParams(command, params) {
  if (!SAFE_RECORD_COMMANDS.has(command)) return null;
  const clean = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (FORBIDDEN_RECORD_KEYS.test(key)) return null;
    if (key === "tab_id" || value == null || typeof value === "boolean" || typeof value === "number") continue;
    if (typeof value === "string") {
      if (key === "url") {
        try {
          const url = new URL(value);
          url.search = "";
          url.hash = "";
          clean[key] = url.href;
        } catch { return null; }
      } else clean[key] = value.slice(0, 2_048);
      continue;
    }
    if (Array.isArray(value) && value.length <= 100) clean[key] = value;
    else if (typeof value === "object") return null;
  }
  return clean;
}

function recorderDirectory() {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(resolve(agentDir), "state", "pi-browser-bridge", "recordings");
}

function safeName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(value)) {
    throw new Error("recording name must contain 1–60 letters, numbers, underscores, or dashes");
  }
  return value;
}

export function createSessionRecorder(broker) {
  const directory = recorderDirectory();
  let active = null;
  let writeChain = Promise.resolve();
  let steps = 0;
  const originalRequest = broker.request.bind(broker);

  const wrappedBroker = {
    getStatus: (...args) => broker.getStatus(...args),
    listProfiles: (...args) => broker.listProfiles(...args),
    resetPairing: (...args) => broker.resetPairing(...args),
    request: async (command, params = {}, options = {}) => {
      const result = await originalRequest(command, params, options);
      if (active) {
        const safe = sanitizeParams(command, params);
        if (safe) {
          const line = `${JSON.stringify({ command, params: safe, profile_id: options.profileId || null })}\n`;
          const path = active.path;
          steps++;
          writeChain = writeChain.then(() => appendFile(path, line, { encoding: "utf8", mode: 0o600 })).catch(() => {});
        }
      }
      return result;
    },
  };

  async function control(action, input = {}) {
    if (action === "list") {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(directory, 0o700).catch(() => {});
      const files = await readdir(directory).catch(() => []);
      return { recordings: files.filter((file) => file.endsWith(".jsonl")).map((file) => file.slice(0, -6)).sort() };
    }
    if (action === "stop") {
      if (!active) return { stopped: false, reason: "no recording is active" };
      const completed = active;
      await writeChain;
      active = null;
      return { stopped: completed.name, file: completed.path, steps };
    }
    const name = safeName(input.name);
    const path = join(directory, `${name}.jsonl`);
    if (action === "start") {
      if (active) throw new Error(`Recording ${active.name} is already active; stop it first`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(directory, 0o700).catch(() => {});
      const file = await writeFile(path, `${JSON.stringify({ type: "pi-browser-bridge-session", version: 1, started_at: new Date().toISOString(), name })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }).then(() => path).catch((error) => {
        if (error.code === "EEXIST") throw new Error(`Recording already exists: ${name}`);
        throw error;
      });
      active = { name, path: file };
      steps = 0;
      return { started: name, file, note: "Only allowlisted non-secret actions are recorded; typed text, credentials, scripts, uploads, cookies, network bodies, and tool results are excluded." };
    }
    if (action === "delete") {
      if (active?.name === name) throw new Error("Stop the active recording before deleting it");
      await rm(path, { force: true });
      return { deleted: name };
    }
    if (action === "replay") {
      if (active) throw new Error("Stop the active recording before replaying a recording");
      const contents = await readFile(path, "utf8");
      const lines = contents.split(/\r?\n/).filter(Boolean).slice(1);
      if (lines.length > 500) throw new Error("Recording exceeds the 500-step replay limit");
      const results = [];
      for (const [index, line] of lines.entries()) {
        let entry;
        try { entry = JSON.parse(line); } catch { throw new Error(`Recording contains invalid JSON on step ${index + 1}`); }
        if (!SAFE_RECORD_COMMANDS.has(entry.command)) continue;
        const profileId = input.profile_id || entry.profile_id;
        if (typeof profileId !== "string" || !profileId) throw new Error("Each replay needs a known profile_id");
        try {
          await originalRequest(entry.command, entry.params || {}, { profileId, timeoutMs: 30_000 });
          results.push({ step: index + 1, ok: true, command: entry.command });
        } catch (error) {
          results.push({ step: index + 1, ok: false, command: entry.command, error: String(error?.message || error).slice(0, 300) });
          break;
        }
      }
      return { replayed: name, steps: results.length, failures: results.filter((result) => !result.ok), results };
    }
    throw new Error("action must be start, stop, list, replay, or delete");
  }

  return { broker: wrappedBroker, control };
}
