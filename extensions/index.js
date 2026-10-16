import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateNewOutputFile, validateUploadFile } from "../server/local-files.js";

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
  "get_css_styles",
  "read_console",
  "monitor_network",
  "network_rules",
  "screenshot_diff",
  "audit",
  "clipboard",
  "window_layout",
  "tile_windows",
  "move_tab",
  "tab_action",
  "hover",
  "get_frames",
  "extract_table",
  "element_screenshot",
  "full_page_screenshot",
  "query_dom",
  "read_form",
  "get_tabs",
  "dismiss_overlays",
  "handle_dialogs",
  "drag_and_drop",
  "execute_js",
  "get_storage",
  "set_storage",
  "http_request",
  "inject_css",
  "modify_dom",
  "measure_spacing",
  "viewport_resize",
  "emulate_media",
  "set_geolocation",
  "find_text",
  "assert",
  "extract",
  "track_events",
  "find_setting",
  "manage_downloads",
  "session_fixture",
  "cookie_audit",
  "http_auth",
  "watch_dom",
  "watch",
  "animations",
  "frames",
  "save_page",
  "handoff",
  "session_record",
  "perf_trace",
  "screencast",
  "lighthouse",
  "heap_snapshot",
];

const CONFIRMATION_TOOLS = new Set(["clipboard", "network_rules", "handle_dialogs", "execute_js", "get_storage", "set_storage", "http_request", "set_geolocation", "session_fixture", "cookie_audit", "http_auth", "save_page", "session_record", "screencast", "lighthouse", "heap_snapshot"]);

function confirmationUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[REDACTED]");
    url.hash = "";
    return url.href;
  } catch { return String(value || "").slice(0, 500); }
}

async function confirmSensitiveTool(ctx, toolName, input) {
  if (toolName === "handle_dialogs" && input.action === "dismiss") return true;
  if (!ctx?.hasUI) return false;
  if (toolName === "execute_js") {
    const code = String(input.code || "");
    return ctx.ui.confirm(
      "Run JavaScript in a page?",
      `Tab: ${String(input.tab_id)} · frame: ${String(input.frame_id ?? "main")}\nCode preview:\n${code.slice(0, 600)}${code.length > 600 ? "…" : ""}\n\nThis code runs in the page's MAIN world and can read or change anything available to the page. Continue?`,
    );
  }
  if (toolName === "get_storage") {
    return ctx.ui.confirm(
      "Read website storage and cookies?",
      `Type: ${String(input.type || "all")} · tab: ${String(input.tab_id)}\nThis may return login tokens or other secrets to the model context. Continue?`,
    );
  }
  if (toolName === "set_storage") {
    const value = String(input.value || "");
    const valuePreview = input.type === "cookie"
      ? "Cookie contents are not shown."
      : `Preview: ${value.slice(0, 200)}${value.length > 200 ? "…" : ""}`;
    return ctx.ui.confirm(
      "Change website storage?",
      `Type: ${String(input.type)} · action: ${String(input.action)} · key: ${String(input.key || "(all keys)")} · tab: ${String(input.tab_id)}\nValue length: ${value.length} characters${value ? `\n${valuePreview}` : ""}\nContinue?`,
    );
  }
  if (toolName === "set_geolocation") {
    return ctx.ui.confirm(
      input.action === "clear" ? "Clear location emulation?" : "Override page geolocation?",
      input.action === "clear"
        ? `The page in tab ${String(input.tab_id)} will return to the browser's current location behavior. Continue?`
        : `The page in tab ${String(input.tab_id)} will see latitude ${String(input.latitude)}, longitude ${String(input.longitude)}, accuracy ${String(input.accuracy ?? 10)} m instead of the real position. Continue?`,
    );
  }
  if (toolName === "http_request") {
    const headerDetails = Object.entries(input.headers || {}).map(([name, value]) => /authorization|cookie|token|secret|password/i.test(name)
      ? `${name}=[redacted]`
      : `${name}=${String(value).slice(0, 100)}`).join("\n");
    const body = String(input.body || "");
    const bodyPreview = body ? `\nBody preview:\n${body.slice(0, 200)}${body.length > 200 ? "…" : ""}` : "";
    return ctx.ui.confirm(
      "Send an authenticated browser request?",
      `Method: ${String(input.method || "GET")}\nURL: ${confirmationUrl(input.url)}\nHeaders:\n${headerDetails || "none"}\nBody: ${body.length} characters${bodyPreview}\nBrowser cookies will be sent for this host; redirects are refused. Continue?`,
    );
  }
  if (toolName === "session_fixture") {
    if (input.action === "list") return true;
    return ctx.ui.confirm(
      `${input.action === "restore" ? "Restore" : input.action === "delete" ? "Delete" : "Save"} a browser session fixture?`,
      `Fixture: ${String(input.name)} · action: ${String(input.action)} · tab: ${String(input.tab_id ?? "(not applicable)")}\nA fixture may contain login credentials, cookies, and site storage; it is stored in this Chrome profile's extension storage. Continue?`,
    );
  }
  if (toolName === "cookie_audit") {
    return ctx.ui.confirm(
      "Audit site cookies and consent?",
      `Tab: ${String(input.tab_id)} · consent selector: ${String(input.consent_selector || "(no consent click)")}\nThis clears cookies for the current page, reloads it, and may sign you out. Continue?`,
    );
  }
  if (["lighthouse", "heap_snapshot"].includes(toolName)) {
    return ctx.ui.confirm(
      toolName === "lighthouse" ? "Run Lighthouse in an isolated browser?" : "Save a JavaScript heap snapshot?",
      `URL: ${confirmationUrl(input.url)}\nBrowser profile cookies are not used.${input.output_path ? `\nNew output file: ${String(input.output_path)}` : ""}\n${toolName === "heap_snapshot" ? "The snapshot can contain page data and memory objects." : "The isolated browser will load this URL and may send ordinary unauthenticated web requests."} Continue?`,
    );
  }
  if (toolName === "screencast") {
    return ctx.ui.confirm(
      "Capture a short page screencast?",
      `Tab: ${String(input.tab_id)} · duration: ${String(input.duration_ms ?? 3_000)} ms · max frames: ${String(input.max_frames ?? 10)}\nFrames may contain confidential page content and will be returned to the model context. Continue?`,
    );
  }
  if (toolName === "session_record") {
    if (!["replay", "delete"].includes(input.action)) return true;
    return ctx.ui.confirm(
      input.action === "replay" ? "Replay a browser recording?" : "Delete a browser recording?",
      `Recording: ${String(input.name)}${input.action === "replay" ? `\nProfile ID: ${String(input.profile_id || "recorded profile")}` : ""}\nReplay may navigate and click in Chrome; delete removes the local recording file. Continue?`,
    );
  }
  if (toolName === "save_page") {
    return ctx.ui.confirm(
      "Save a local page archive?",
      `Output: ${String(input.output_path)}\nTab ID: ${String(input.tab_id)}\nThe MHTML file can contain the page's visible content and resources. The destination must be new; existing files are never overwritten. Continue?`,
    );
  }
  if (toolName === "http_auth") {
    return ctx.ui.confirm(
      input.action === "set" ? "Set HTTP authentication credentials?" : "Clear HTTP authentication credentials?",
      `Origin: ${String(input.origin || "all configured origins")} · username: ${String(input.username || "(not shown)")} · password length: ${String(input.password || "").length}\nCredentials stay in memory only. Continue?`,
    );
  }
  if (toolName === "clipboard") {
    return ctx.ui.confirm(
      input.action === "read" ? "Read the system clipboard?" : "Replace the system clipboard?",
      input.action === "read"
        ? "The current clipboard text will be returned to the Pi model context. Continue?"
        : `The clipboard will be replaced with ${String(input.text ?? "").length.toLocaleString()} characters. Preview: ${String(input.text ?? "").slice(0, 200)}${String(input.text ?? "").length > 200 ? "…" : ""}. Continue?`,
    );
  }
  if (toolName === "handle_dialogs") {
    return ctx.ui.confirm(
      "Accept a JavaScript dialog?",
      `This accepts the alert, confirmation, or prompt currently open in tab ${String(input.tab_id ?? "active")}. The page may continue or perform the action guarded by that dialog. Continue?`,
    );
  }
  if (toolName === "network_rules") {
    if (input.action === "list") return true;
    const headerValue = input.header_value === undefined ? " (remove)"
      : /authorization|cookie|token|secret|password/i.test(String(input.header || ""))
        ? "=[redacted]"
        : `=${String(input.header_value).slice(0, 200)}${String(input.header_value).length > 200 ? "…" : ""}`;
    const headerDetail = input.header ? `\nHeader: ${input.header}${headerValue}` : "";
    return ctx.ui.confirm(
      "Change Chrome network rules?",
      `Action: ${String(input.action)}\nURL filter: ${String(input.url_filter || "(not specified)")}\nRedirect: ${String(input.redirect_url || "(none)")}\nTab ID: ${String(input.tab_id ?? "all matching tabs")}\nExpires: ${String(input.expires_ms ?? 1_800_000)} ms${headerDetail}\n\nThis can change requests made by pages in this Chrome profile. Continue?`,
    );
  }
  return true;
}

async function inspectUpload(filePath) {
  const file = await validateUploadFile(filePath);
  return { localFile: file.file_path, fileSize: file.size_bytes };
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
    if (!UPLOAD_SERVER_NAMES.has(request.serverName)) return;
    if (request.originalToolName === "upload_file") {
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

        request.args.file_path = file.localFile;
        return await confirmUpload(ctx, file, request.args) ? "allow_once" : "deny";
      });
      return;
    }
    if (!CONFIRMATION_TOOLS.has(request.originalToolName)) return;
    request.claim(async () => {
      const ctx = activeContext;
      if (!ctx?.hasUI) return "deny";
      if (request.originalToolName === "save_page" || request.originalToolName === "heap_snapshot" || (request.originalToolName === "lighthouse" && request.args.output_path)) {
        try { request.args.output_path = (await validateNewOutputFile(request.args.output_path)).output_path; }
        catch (error) { ctx.ui.notify?.(`Browser capture output blocked: ${error.message}`, "warning"); return "deny"; }
      }
      const approved = await confirmSensitiveTool(ctx, request.originalToolName, request.args);
      return approved ? "allow_once" : "deny";
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
    const toolName = String(event.toolName || "");
    if (["mcp__pi_browser_bridge__lighthouse", "mcp__pi_browser_bridge__heap_snapshot"].includes(toolName)) {
      if (event.input.output_path) {
        try { event.input.output_path = (await validateNewOutputFile(event.input.output_path)).output_path; }
        catch (error) { return { block: true, reason: `Browser capture output blocked: ${error.message}` }; }
      }
      const approved = await confirmSensitiveTool(ctx, toolName.endsWith("__lighthouse") ? "lighthouse" : "heap_snapshot", event.input);
      return approved ? undefined : { block: true, reason: "The user declined the isolated browser capture." };
    }
    if (toolName === "mcp__pi_browser_bridge__upload_file") {
      let file;
      try {
        file = await inspectUpload(event.input.file_path);
      } catch (error) {
        return { block: true, reason: `Local upload file is unavailable: ${error.message}` };
      }

      event.input.file_path = file.localFile;
      const approved = await confirmUpload(ctx, file, event.input);
      return approved ? undefined : { block: true, reason: "The user declined the local file upload." };
    }
    if (toolName === "mcp__pi_browser_bridge__save_page") {
      try { event.input.output_path = (await validateNewOutputFile(event.input.output_path)).output_path; }
      catch (error) { return { block: true, reason: `Page archive output blocked: ${error.message}` }; }
      const approved = await confirmSensitiveTool(ctx, "save_page", event.input);
      return approved ? undefined : { block: true, reason: "The user declined the page archive." };
    }
    const toolKey = toolName.match(/__(clipboard|network_rules|handle_dialogs|execute_js|get_storage|set_storage|http_request|set_geolocation|session_fixture|cookie_audit|http_auth|session_record|screencast)$/)?.[1];
    if (!toolKey) return undefined;
    const approved = await confirmSensitiveTool(ctx, toolKey, event.input);
    return approved ? undefined : { block: true, reason: `The user declined the ${toolKey} operation.` };
  });
}
