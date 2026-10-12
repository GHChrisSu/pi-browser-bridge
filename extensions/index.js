import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "server", "index.js");
const UPLOAD_SERVER_NAMES = new Set([
  "pi-browser-bridge",
  "pi-browser-bridge__browser",
]);
const MCP_ADAPTER_APPROVAL_EVENT = "pi-mcp-adapter:tool-approval-request";
const DIRECT_BROWSER_TOOLS = [
  "get_status",
  "list_profiles",
  "get_active_tab",
  "list_tabs",
  "list_workspaces",
  "create_workspace",
  "read_urls",
  "create_tab",
  "navigate",
  "read_page",
  "get_page_info",
  "get_accessibility_tree",
  "get_visible_dom",
  "get_by_role",
  "fill_by_role",
  "fill_accessibility_node",
  "click_dom_node",
  "click_accessibility_node",
  "list_page_assets",
  "get_interactives",
  "click",
  "click_by_role",
  "fill_form",
  "type_text",
  "press_key",
  "scroll",
  "wait_for",
  "screenshot",
  "download_url",
  "download_media",
  "upload_file",
  "reset_pairing",
];

async function inspectUpload(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 8_192 || !isAbsolute(filePath)) {
    throw new Error("file_path must be an absolute local path under 8192 characters");
  }
  const localFile = await realpath(filePath);
  const info = await stat(localFile);
  if (!info.isFile() || info.size <= 0 || info.size > 50 * 1024 * 1024) {
    throw new Error("File must be a non-empty regular file no larger than 50 MiB");
  }
  return { localFile, fileSize: info.size };
}

async function confirmUpload(ctx, file, input) {
  if (!ctx?.hasUI) return false;
  const targetOrigin = typeof input.target_origin === "string" ? input.target_origin : "(unknown website)";
  const profileId = typeof input.profile_id === "string" ? input.profile_id : "(unknown profile)";
  return ctx.ui.confirm(
    "Upload a local file to a website?",
    `File: ${basename(file.localFile)} (${file.fileSize.toLocaleString()} bytes)\nPath: ${file.localFile}\nWebsite: ${targetOrigin}\nChrome profile: ${profileId}\nTab ID: ${String(input.tab_id ?? "(unknown tab)")}\n\nThe website will receive this file. Continue?`,
  );
}

export default function (pi) {
  let activeContext;
  let serverRegistered = false;

  // pi-mcp-adapter owns configured MCP calls. Its approval broker preserves
  // the explicit per-server confirmation required before browser uploads.
  pi.events.on(MCP_ADAPTER_APPROVAL_EVENT, (request) => {
    if (!UPLOAD_SERVER_NAMES.has(request.serverName) || request.originalToolName !== "upload_file") return;

    request.claim(async () => {
      const ctx = activeContext;
      if (!ctx?.hasUI) return "deny";

      let file;
      try {
        file = await inspectUpload(request.args.file_path);
      } catch (error) {
        ctx.ui.notify?.(`Upload blocked: ${error.message}`, "warning");
        return "deny";
      }

      // The adapter dispatches this same argument record after approval.
      request.args.file_path = file.localFile;
      return await confirmUpload(ctx, file, request.args) ? "allow_once" : "deny";
    });
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    if (serverRegistered) return;

    const adapterMode = pi.getAllTools().some((tool) => tool.name === "mcp");
    if (adapterMode) {
      // pi-browser-bridge/mcp.json is loaded as a configured Pi package server,
      // so adapter-backed subagents can resolve its direct tools by allowlist.
      return;
    }

    pi.registerMcpServer("pi-browser-bridge", {
      command: process.execPath,
      args: [serverPath],
      cwd: packageRoot,
      timeout: 180,
      exposure: "hidden",
      description: "Control selected Chrome profiles and tabs through the per-agent-directory shared Pi Bridge broker. Multiple Pi sessions reuse one loopback endpoint; pass profile IDs when multiple Chrome profiles are connected.",
      toolExposure: Object.fromEntries(DIRECT_BROWSER_TOOLS.map((name) => [name, "direct"])),
    });
    serverRegistered = true;
  });

  pi.on("session_shutdown", () => {
    activeContext = undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "mcp__pi_browser_bridge__upload_file") return undefined;

    let file;
    try {
      file = await inspectUpload(event.input.file_path);
    } catch (error) {
      return { block: true, reason: `Local upload file is unavailable: ${error.message}` };
    }

    event.input.file_path = file.localFile;
    const approved = await confirmUpload(ctx, file, event.input);
    return approved ? undefined : { block: true, reason: "The user declined the local file upload." };
  });
}
