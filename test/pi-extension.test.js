import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import extension from "../extensions/index.js";

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
});

test("Chrome package uses web access without credential or debugging APIs", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(!manifest.permissions.includes("storage"));
  assert.ok(!manifest.permissions.includes("activeTab"));
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("debugger"));
  assert.ok(!manifest.permissions.includes("userScripts"));
  assert.equal(manifest.name, "Pi Bridge");
});
