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
  for (const tool of ["list_profiles", "list_tabs", "list_workspaces", "create_workspace", "read_urls", "list_page_assets", "download_url", "download_media", "upload_file", "get_accessibility_tree", "get_visible_dom", "get_by_role", "click_by_role", "fill_by_role", "fill_accessibility_node", "click_dom_node", "click_accessibility_node"]) {
    assert.equal(config.toolExposure[tool], "direct");
  }

  let confirmation;
  const uploadHandler = handlers.get("tool_call");
  assert.equal(typeof uploadHandler, "function");
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
