import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import extension from "../extensions/index.js";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Pi extension registers native direct tools and confirms local uploads before transmission", async (t) => {
  const registrations = [];
  const handlers = new Map();
  const events = new Map();
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-upload-confirm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "generated.png");
  await writeFile(filePath, Buffer.from([1, 2, 3, 4]));
  const context = {
    hasUI: true,
    ui: { confirm: async (title, message) => { context.confirmation = { title, message }; return false; } },
  };
  extension({
    on: (event, handler) => handlers.set(event, handler),
    events: { on: (event, handler) => events.set(event, handler) },
    getAllTools: () => [],
    registerMcpServer: (name, config) => registrations.push({ name, config }),
  });

  await handlers.get("session_start")({}, context);
  assert.equal(registrations.length, 1);
  const [{ name, config }] = registrations;
  assert.equal(name, "pi-browser-bridge");
  assert.equal(config.command, process.execPath);
  assert.equal(config.args.length, 1);
  assert.ok(existsSync(config.args[0]));
  assert.equal(config.exposure, "hidden");
  assert.equal(config.toolExposure.get_status, "direct");
  assert.equal(config.toolExposure.download_url, "direct");
  assert.equal(config.toolExposure.download_media, "direct");
  assert.equal(config.toolExposure.upload_file, "direct");
  assert.equal(config.timeout, 180);
  assert.equal(config.env, undefined);
  for (const tool of ["list_profiles", "list_tabs", "list_workspaces", "create_workspace", "read_urls", "list_page_assets", "download_url", "download_media", "upload_file", "get_accessibility_tree", "get_visible_dom", "get_by_role", "click_by_role", "fill_by_role", "fill_accessibility_node", "click_dom_node", "click_accessibility_node", "get_css_styles", "read_console", "monitor_network", "network_rules", "screenshot_diff", "audit", "clipboard", "window_layout", "tile_windows", "move_tab", "tab_action", "hover", "get_frames", "extract_table", "element_screenshot", "full_page_screenshot", "query_dom", "read_form", "get_tabs", "dismiss_overlays", "handle_dialogs", "drag_and_drop", "execute_js", "get_storage", "set_storage", "http_request", "inject_css", "modify_dom", "measure_spacing", "viewport_resize", "emulate_media", "set_geolocation", "find_text", "assert", "extract", "track_events", "find_setting", "manage_downloads", "session_fixture", "cookie_audit", "http_auth", "watch_dom", "watch", "animations", "frames", "save_page", "handoff", "session_record", "perf_trace", "screencast", "lighthouse", "heap_snapshot"]) {
    assert.equal(config.toolExposure[tool], "direct");
  }

  let confirmation;
  const uploadHandler = handlers.get("tool_call");
  assert.equal(typeof uploadHandler, "function");
  const clipboardDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__clipboard", input: { action: "read" } }, context);
  assert.equal(clipboardDeclined.block, true);
  assert.match(context.confirmation.title, /Read the system clipboard/);
  const networkDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__network_rules", input: { action: "block", url_filter: "||example.com/api/*" } }, context);
  assert.equal(networkDeclined.block, true);
  assert.match(context.confirmation.message, /example\.com\/api/);
  const dialogDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__handle_dialogs", input: { action: "accept", tab_id: 17 } }, context);
  assert.equal(dialogDeclined.block, true);
  assert.match(context.confirmation.title, /Accept a JavaScript dialog/);
  const scriptDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__execute_js", input: { code: "document.title", tab_id: 17 } }, context);
  assert.equal(scriptDeclined.block, true);
  assert.match(context.confirmation.message, /document\.title/);
  const storageDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__get_storage", input: { type: "cookies", tab_id: 17 } }, context);
  assert.equal(storageDeclined.block, true);
  assert.match(context.confirmation.message, /login tokens or other secrets/);
  const requestDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__http_request", input: { url: "https://example.com/private", method: "GET" } }, context);
  assert.equal(requestDeclined.block, true);
  assert.match(context.confirmation.message, /Browser cookies will be sent/);
  const geoDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__set_geolocation", input: { action: "set", latitude: 35, longitude: 139, tab_id: 17 } }, context);
  assert.equal(geoDeclined.block, true);
  assert.match(context.confirmation.title, /Override page geolocation/);
  const fixtureDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__session_fixture", input: { action: "save", name: "test-session", tab_id: 17 } }, context);
  assert.equal(fixtureDeclined.block, true);
  assert.match(context.confirmation.message, /may contain login credentials/);
  const auditDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__cookie_audit", input: { tab_id: 17 } }, context);
  assert.equal(auditDeclined.block, true);
  assert.match(context.confirmation.message, /may sign you out/);
  const authDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__http_auth", input: { action: "set", origin: "https://example.com", username: "user", password: "pass" } }, context);
  assert.equal(authDeclined.block, true);
  assert.match(context.confirmation.message, /Credentials stay in memory/);
  const archivePath = join(directory, "page.mhtml");
  const archiveDeclined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__save_page", input: { output_path: archivePath, tab_id: 17 } }, context);
  assert.equal(archiveDeclined.block, true);
  assert.match(context.confirmation.message, /page's visible content/);
  const input = { file_path: filePath, target_origin: "https://example.com", profile_id: "profile-1", tab_id: 17 };
  const declined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__upload_file", input }, context);
  assert.equal(input.file_path, await realpath(filePath));
  assert.equal(declined.block, true);
  confirmation = context.confirmation;
  assert.match(confirmation.message, /generated\.png/);
  assert.match(confirmation.message, /4 bytes/);
  assert.match(confirmation.message, /https:\/\/example\.com/);
  assert.match(confirmation.message, /profile-1/);
  assert.match(confirmation.message, /Tab ID: 17/);

  const headless = await uploadHandler({ toolName: "mcp__pi_browser_bridge__upload_file", input: { file_path: filePath } }, { hasUI: false });
  assert.equal(headless.block, true);
  const invalid = await uploadHandler({ toolName: "mcp__pi_browser_bridge__upload_file", input: { file_path: join(directory, "missing") } }, {
    hasUI: true,
    ui: { confirm: async () => { throw new Error("Must not ask to approve a missing file"); } },
  });
  assert.equal(invalid.block, true);
  const secretPath = join(directory, ".env");
  await writeFile(secretPath, "DO_NOT_UPLOAD=test");
  const secret = await uploadHandler({ toolName: "mcp__pi_browser_bridge__upload_file", input: { file_path: secretPath } }, {
    hasUI: true,
    ui: { confirm: async () => { throw new Error("Must not ask to approve a sensitive file"); } },
  });
  assert.equal(secret.block, true);
  assert.match(secret.reason, /sensitive key or credential/);
  assert.equal(typeof events.get("pi-mcp-adapter:tool-approval-request"), "function");
  assert.equal(await uploadHandler({ toolName: "mcp__pi_browser_bridge__read_page", input: {} }, { hasUI: false }), undefined);
});

test("Pi MCP Adapter loads the package server and brokers upload confirmation", async (t) => {
  const handlers = new Map();
  const events = new Map();
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-adapter-upload-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "adapter-upload.png");
  await writeFile(filePath, Buffer.from([1, 2, 3]));
  let confirmation;
  const context = {
    hasUI: true,
    ui: {
      confirm: async (title, message) => { confirmation = { title, message }; return true; },
      notify: () => {},
    },
  };
  extension({
    on: (event, handler) => handlers.set(event, handler),
    events: { on: (event, handler) => events.set(event, handler) },
    getAllTools: () => [{ name: "mcp" }],
    registerMcpServer: () => assert.fail("Adapter-backed servers come from the package manifest"),
  });

  await handlers.get("session_start")({}, context);
  assert.deepEqual(packageJson.pi.mcp, "./mcp.json");
  const mcpConfig = JSON.parse(readFileSync(new URL("../mcp.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ["browser"]);
  assert.equal(mcpConfig.mcpServers.browser.command, "node");
  assert.equal(mcpConfig.mcpServers.browser.args[0], "-e");

  const approvalHandler = events.get("pi-mcp-adapter:tool-approval-request");
  let decisionHandler;
  const request = {
    serverName: "pi-browser-bridge__browser",
    originalToolName: "upload_file",
    args: { file_path: filePath, target_origin: "https://example.org", profile_id: "profile-2", tab_id: 19 },
    claim(handler) { decisionHandler = handler; return true; },
  };
  approvalHandler(request);
  assert.equal(typeof decisionHandler, "function");
  assert.equal(await decisionHandler(), "allow_once");
  assert.equal(request.args.file_path, await realpath(filePath));
  assert.match(confirmation.message, /adapter-upload\.png/);
  assert.match(confirmation.message, /https:\/\/example\.org/);
  assert.match(confirmation.message, /profile-2/);
  assert.match(confirmation.message, /Tab ID: 19/);

  const clipboardRequest = {
    serverName: "pi-browser-bridge__browser",
    originalToolName: "clipboard",
    args: { action: "read" },
    claim(handler) { decisionHandler = handler; return true; },
  };
  approvalHandler(clipboardRequest);
  assert.equal(await decisionHandler(), "allow_once");
  assert.match(confirmation.title, /Read the system clipboard/);

  const dialogRequest = {
    serverName: "pi-browser-bridge__browser",
    originalToolName: "handle_dialogs",
    args: { action: "accept", tab_id: 23 },
    claim(handler) { decisionHandler = handler; return true; },
  };
  approvalHandler(dialogRequest);
  assert.equal(await decisionHandler(), "allow_once");
  assert.match(confirmation.title, /Accept a JavaScript dialog/);

  decisionHandler = undefined;
  approvalHandler({ ...request, serverName: "another-server", claim(handler) { decisionHandler = handler; return true; } });
  assert.equal(decisionHandler, undefined);

  let headlessDecision;
  const headlessExtension = new Map();
  const headlessEvents = new Map();
  extension({
    on: (event, handler) => headlessExtension.set(event, handler),
    events: { on: (event, handler) => headlessEvents.set(event, handler) },
    getAllTools: () => [{ name: "mcp" }],
    registerMcpServer: () => assert.fail("Adapter-backed servers come from the package manifest"),
  });
  await headlessExtension.get("session_start")({}, { hasUI: false });
  const headlessRequest = {
    serverName: "pi-browser-bridge__browser",
    originalToolName: "upload_file",
    args: { file_path: filePath },
    claim(handler) { headlessDecision = handler; return true; },
  };
  headlessEvents.get("pi-mcp-adapter:tool-approval-request")(headlessRequest);
  assert.equal(await headlessDecision(), "deny");
});

test("Pi package includes the browser subagent with a bounded Pi Bridge MCP allowlist", () => {
  const agent = readFileSync(new URL("../agents/playwright-browser.md", import.meta.url), "utf8");
  assert.deepEqual(packageJson["pi-subagents"].agents, ["./agents"]);
  assert.ok(packageJson.files.includes("agents/"));
  assert.deepEqual(packageJson.pi.mcp, "./mcp.json");
  const mcpConfig = JSON.parse(readFileSync(new URL("../mcp.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ["browser"]);
  assert.equal(mcpConfig.mcpServers.browser.command, "node");
  assert.equal(mcpConfig.mcpServers.browser.args[0], "-e");
  for (const tool of ["list_profiles", "get_active_tab", "list_tabs", "read_page", "get_accessibility_tree", "get_visible_dom", "get_by_role", "click_by_role", "click_dom_node", "click_accessibility_node", "fill_by_role", "fill_accessibility_node", "navigate", "wait_for", "scroll", "screenshot"]) {
    assert.match(agent, new RegExp(`mcp:pi-browser-bridge__browser/${tool}`));
  }
  assert.doesNotMatch(agent, /mcp:playwright\//);
  assert.doesNotMatch(agent, /browser_evaluate|browser_run_code_unsafe|network_request|file_upload/);
});

test("Chrome package uses scoped browser APIs and matching version metadata", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.version, packageJson.version);
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("tabGroups"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("debugger"));
  assert.ok(manifest.optional_permissions.includes("webRequest"));
  assert.ok(manifest.optional_permissions.includes("declarativeNetRequestWithHostAccess"));
  assert.ok(manifest.optional_permissions.includes("clipboardRead"));
  assert.ok(manifest.optional_permissions.includes("clipboardWrite"));
  assert.ok(manifest.optional_permissions.includes("offscreen"));
  assert.ok(manifest.optional_permissions.includes("cookies"));
  assert.ok(manifest.optional_permissions.includes("userScripts"));
  assert.ok(manifest.optional_permissions.includes("webRequestAuthProvider"));
  assert.ok(manifest.optional_permissions.includes("pageCapture"));
  assert.ok(!manifest.permissions.includes("activeTab"));
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("userScripts"));
  assert.equal(manifest.name, "Pi Bridge");
  const logo = readFileSync(new URL("../extension/icons/icon.svg", import.meta.url), "utf8");
  assert.match(logo, /#F09082/);
  assert.match(logo, /#4D9ABF/);
  assert.match(logo, /#F1BE58/);
  assert.ok(existsSync(new URL("../ATTRIBUTION.md", import.meta.url)));
});
