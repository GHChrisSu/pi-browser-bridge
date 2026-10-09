import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = join(packageRoot, "bin", "pi-browser-bridge.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: packageRoot, encoding: "utf8" });
}

test("mcp-config prints a portable stdio server entry", () => {
  const result = run(["mcp-config", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  const server = config.mcpServers["pi-browser-bridge"];
  assert.equal(server.command, process.execPath);
  assert.equal(server.args[0], join(packageRoot, "server", "index.js"));
  assert.equal(server.cwd, packageRoot);
});

test("mcp-config can emit Python MCP SDK parameters", () => {
  const result = run(["mcp-config", "--format", "python"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /StdioServerParameters/);
  assert.match(result.stdout, /ClientSession/);
  assert.match(result.stdout, /server\/index\.js/);
});

test("mcp-config merges into an existing JSON file without deleting other settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-config-"));
  const path = join(directory, "agent.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, `${JSON.stringify({ mcpServers: { existing: { command: "python" } }, theme: "dark" }, null, 2)}\n`);

  const result = run(["mcp-config", "--write", path]);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.theme, "dark");
  assert.equal(config.mcpServers.existing.command, "python");
  assert.equal(config.mcpServers["pi-browser-bridge"].args[0], join(packageRoot, "server", "index.js"));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("mcp-config refuses to overwrite a conflicting server name by default", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-config-"));
  const path = join(directory, "agent.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, `${JSON.stringify({ mcpServers: { "pi-browser-bridge": { command: "other" } } }, null, 2)}\n`);

  const result = run(["mcp-config", "--write", path]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different "pi-browser-bridge" server already exists/);
  const config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.mcpServers["pi-browser-bridge"].command, "other");
});
