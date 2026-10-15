import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mcpConfig = JSON.parse(readFileSync(new URL("../mcp.json", import.meta.url), "utf8"));
const browserServer = mcpConfig.mcpServers.browser;
const browserAgent = readFileSync(new URL("../agents/playwright-browser.md", import.meta.url), "utf8");

test("package direct browser tools match the operator agent allowlist", () => {
  const directTools = Object.entries(browserServer.toolExposure ?? {})
    .filter(([, exposure]) => exposure === "direct")
    .map(([name]) => name)
    .sort();
  const agentTools = [...browserAgent.matchAll(/^\s+- mcp:pi-browser-bridge__browser\/([a-z_]+)\s*$/gm)]
    .map((match) => match[1])
    .sort();

  assert.equal(browserServer.exposure, "codemode");
  assert.ok(directTools.length > 0 && directTools.length <= 20);
  assert.deepEqual(directTools, agentTools);
});
