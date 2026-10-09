import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import extension from "../extensions/index.js";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Pi extension registers browser tools and confirms local uploads before transmission", async (t) => {
  const registrations = [];
  const handlers = new Map();
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-upload-confirm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "generated.png");
  await writeFile(filePath, Buffer.from([1, 2, 3, 4]));
  extension({
    on: (event, handler) => handlers.set(event, handler),
    registerMcpServer: (name, config) => registrations.push({ name, config }),
  });

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
  for (const tool of ["list_profiles", "list_tabs", "list_workspaces", "create_workspace", "read_urls", "list_page_assets", "download_url", "download_media", "upload_file", "get_accessibility_tree", "click_accessibility_node"]) {
    assert.equal(config.toolExposure[tool], "direct");
  }

  let confirmation;
  const uploadHandler = handlers.get("tool_call");
  assert.equal(typeof uploadHandler, "function");
  const input = { file_path: filePath, target_origin: "https://example.com", profile_id: "profile-1", tab_id: 17 };
  const declined = await uploadHandler({ toolName: "mcp__pi_browser_bridge__upload_file", input }, {
    hasUI: true,
    ui: { confirm: async (title, message) => { confirmation = { title, message }; return false; } },
  });
  assert.equal(input.file_path, await realpath(filePath));
  assert.equal(declined.block, true);
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
  assert.equal(await uploadHandler({ toolName: "mcp__pi_browser_bridge__read_page", input: {} }, { hasUI: false }), undefined);
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
