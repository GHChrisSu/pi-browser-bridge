import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import extension from "../extensions/index.js";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Pi extension registers a session-local MCP server from the package", () => {
  const registrations = [];
  extension({ registerMcpServer: (name, config) => registrations.push({ name, config }) });

  assert.equal(registrations.length, 1);
  const [{ name, config }] = registrations;
  assert.equal(name, "pi-browser-bridge");
  assert.equal(config.command, process.execPath);
  assert.equal(config.args.length, 1);
  assert.ok(existsSync(config.args[0]));
  assert.equal(config.exposure, "hidden");
  assert.equal(config.toolExposure.get_status, "direct");
  assert.equal(config.env, undefined);
  for (const tool of ["list_tabs", "list_workspaces", "create_workspace", "read_urls"]) {
    assert.equal(config.toolExposure[tool], "direct");
  }
});

test("Chrome package uses scoped browser APIs and matching version metadata", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.version, packageJson.version);
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("tabGroups"));
  assert.ok(!manifest.permissions.includes("storage"));
  assert.ok(!manifest.permissions.includes("activeTab"));
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("debugger"));
  assert.ok(!manifest.permissions.includes("userScripts"));
  assert.equal(manifest.name, "Pi Bridge");
  const logo = readFileSync(new URL("../extension/icons/icon.svg", import.meta.url), "utf8");
  assert.match(logo, /#F09082/);
  assert.match(logo, /#4D9ABF/);
  assert.match(logo, /#F1BE58/);
  assert.ok(existsSync(new URL("../ATTRIBUTION.md", import.meta.url)));
});
