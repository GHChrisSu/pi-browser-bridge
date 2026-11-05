#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import extension from "../extensions/index.js";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverPath = join(packageRoot, "server", "index.js");
const evaluationText = await readFile(join(packageRoot, ".auto", "discovery-evaluation.json"), "utf8");
let evaluationCases;
try {
  evaluationCases = JSON.parse(evaluationText);
} catch (error) {
  throw new Error("discovery-evaluation.json must contain valid JSON", { cause: error });
}
assert.ok(Array.isArray(evaluationCases) && evaluationCases.length > 0, "discovery evaluation suite must contain cases");
const generalizationText = await readFile(join(packageRoot, ".auto", "screenshot-diff-generalization.json"), "utf8");
let generalizationCases;
try {
  generalizationCases = JSON.parse(generalizationText);
} catch (error) {
  throw new Error("screenshot-diff-generalization.json must contain valid JSON", { cause: error });
}
assert.ok(Array.isArray(generalizationCases) && generalizationCases.length > 0, "generalization suite must contain cases");
assert.ok(generalizationCases.every((item) => item.expectedTool === "screenshot_diff"), "generalization suite must target only screenshot_diff");

const mcpText = await readFile(join(packageRoot, "mcp.json"), "utf8");
let mcpConfig;
try {
  mcpConfig = JSON.parse(mcpText);
} catch (error) {
  throw new Error("mcp.json must contain valid JSON", { cause: error });
}
const adapterServer = mcpConfig.mcpServers.browser;
const adapterDirect = Object.entries(adapterServer.toolExposure || {})
  .filter(([, exposure]) => exposure === "direct")
  .map(([name]) => name);
const adapterAgentDirectory = process.env.PI_CODING_AGENT_DIR
  ? resolve(process.env.PI_CODING_AGENT_DIR)
  : join(homedir(), ".pi", "agent");
const adapterConfigPath = join(adapterAgentDirectory, "npm", "node_modules", "pi-mcp-adapter", "dist", "config.js");
await access(adapterConfigPath);
const { translatePiMcpServer } = await import(pathToFileURL(adapterConfigPath).href);
const adapterTranslation = translatePiMcpServer("browser", adapterServer);
assert.ok(typeof adapterTranslation !== "string", `pi-mcp-adapter rejected browser config: ${adapterTranslation}`);

let nativeConfig;
const handlers = new Map();
extension({
  on: (event, handler) => handlers.set(event, handler),
  events: { on() {} },
  getAllTools: () => [],
  registerMcpServer: (_name, config) => { nativeConfig = config; },
});
await handlers.get("session_start")({}, { hasUI: false });
assert.ok(nativeConfig, "native MCP server did not register");
const nativeDirect = Object.entries(nativeConfig.toolExposure || {})
  .filter(([, exposure]) => exposure === "direct")
  .map(([name]) => name);

async function loadPiExposureTools() {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    try {
      const entry = await realpath(join(directory, "pi"));
      const root = resolve(dirname(entry), "..", "..");
      const codemodePath = join(root, "dist", "extensions", "codemode", "tool.js");
      const searchPath = join(root, "dist", "extensions", "tool-search", "tool.js");
      await Promise.all([access(codemodePath), access(searchPath)]);
      const [codemode, toolSearch] = await Promise.all([
        import(pathToFileURL(codemodePath).href),
        import(pathToFileURL(searchPath).href),
      ]);
      return { codemode, toolSearch, root };
    } catch {}
  }
  throw new Error("Could not locate Pi's installed codemode and tool-search declarations through PATH");
}

async function reservePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function startMcp(agentDir, port) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: packageRoot,
    env: {
      HOME: agentDir,
      PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: process.env.LANG || "en_US.UTF-8",
      PI_BROWSER_BRIDGE_PORT: String(port),
      PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "1000",
      PI_CODING_AGENT_DIR: agentDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText = `${stderrText}${chunk}`.slice(-4_000); });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    entry.resolve(message);
  });
  const request = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}; stderr: ${stderrText}`));
    }, 8_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolveRequest(value); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return { child, request, notify, getStderr: () => stderrText };
}

async function stopBroker(agentDir) {
  try {
    const statePath = join(agentDir, "state", "pi-browser-bridge", "shared-broker", "runtime.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (Number.isInteger(state.pid)) {
      try { process.kill(state.pid, "SIGTERM"); } catch {}
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        try { process.kill(state.pid, 0); } catch { break; }
        await new Promise((resolveWait) => setTimeout(resolveWait, 40));
      }
    }
  } catch {}
}

const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-autoresearch-"));
const mcp = startMcp(agentDir, await reservePort());
let tools;
try {
  const initialized = await mcp.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "pi-browser-bridge-autoresearch", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "pi-browser-bridge");
  mcp.notify("notifications/initialized");
  const listed = await mcp.request("tools/list");
  tools = listed.result.tools;
} finally {
  try { mcp.child.kill("SIGTERM"); } catch {}
  if (mcp.child.exitCode === null) await once(mcp.child, "exit").catch(() => {});
  await stopBroker(agentDir);
  await rm(agentDir, { recursive: true, force: true });
}

const byName = new Map(tools.map((tool) => [tool.name, tool]));
for (const name of [...nativeDirect, ...adapterDirect]) {
  assert.ok(byName.has(name), `configured direct tool is not registered by MCP: ${name}`);
}
const { codemode, toolSearch, root: piRoot } = await loadPiExposureTools();
const jitiPath = join(piRoot, "node_modules", "jiti", "lib", "jiti.mjs");
await access(jitiPath);
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url, {
  alias: {
    "typebox/value": join(piRoot, "node_modules", "typebox", "build", "value", "index.mjs"),
  },
});
const adapterPackageRoot = join(adapterAgentDirectory, "npm", "node_modules", "pi-mcp-adapter");
const [packageLoader, adapterSearchRanking, adapterTypes, adapterDirectSurface, adapterMetadataCache] = await Promise.all([
  jiti.import(join(adapterPackageRoot, "package-mcp-loader.ts")),
  jiti.import(join(adapterPackageRoot, "search-ranking.ts")),
  jiti.import(join(adapterPackageRoot, "types.ts")),
  jiti.import(join(adapterPackageRoot, "direct-tool-surface.ts")),
  jiti.import(join(adapterPackageRoot, "metadata-cache.ts")),
]);
const packageProjectDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-package-bootstrap-"));
let packageServerName;
let packageServerEntry;
try {
  await mkdir(join(packageProjectDir, ".pi"), { recursive: true });
  await writeFile(join(packageProjectDir, ".pi", "settings.json"), JSON.stringify({ packages: [packageRoot] }), "utf8");
  const packageConfig = packageLoader.loadPackageMcpConfigs(packageProjectDir);
  const packageServers = Object.entries(packageConfig.mcpServers).filter(([name]) =>
    name.endsWith("__browser") && packageConfig.serverSources.get(name)?.packageRoot === packageRoot,
  );
  assert.equal(packageServers.length, 1, "package bootstrap must load exactly one browser MCP server from this package");
  [packageServerName, packageServerEntry] = packageServers[0];
} finally {
  await rm(packageProjectDir, { recursive: true, force: true });
}
const packageTranslation = translatePiMcpServer(packageServerName, packageServerEntry);
assert.ok(typeof packageTranslation !== "string", `package-loaded browser config must translate: ${packageTranslation}`);
const packageDirectSetting = packageTranslation.entry.directTools;
const packageDirectNames = packageDirectSetting === true
  ? tools.map((tool) => tool.name)
  : Array.isArray(packageDirectSetting)
    ? packageDirectSetting
    : [];
const packageIgnoredDirectOverrides = packageTranslation.ignored.filter((item) => item.startsWith("toolExposure ") && item.endsWith(": direct")).length;
const packagePolicyMatches = packageDirectNames.length === adapterDirect.length
  && adapterDirect.every((name) => packageDirectNames.includes(name));
assert.ok(packageDirectNames.every((name) => byName.has(name)), "package-bootstrap direct tools must exist in the MCP server");
const packageCache = {
  version: 1,
  servers: {
    [packageServerName]: {
      configHash: adapterMetadataCache.computeServerHash(packageTranslation.entry),
      cachedAt: Date.now(),
      tools,
      resources: [],
    },
  },
};
const packageDirectSpecs = adapterDirectSurface.resolveDirectTools(
  { settings: { toolPrefix: "server" }, mcpServers: { [packageServerName]: packageTranslation.entry } },
  packageCache,
  "server",
);
const packageResolvedDirectNames = packageDirectSpecs.map((spec) => spec.originalName);
const packageResolvedDirectMatches = packageResolvedDirectNames.length === adapterDirect.length
  && adapterDirect.every((name) => packageResolvedDirectNames.includes(name));
const packageLazyDirectCount = packageDirectSpecs.filter((spec) => spec.lazy).length;
const packageToolPrefix = adapterTypes.resolveToolPrefix(packageServerEntry, "server");
const packageToolMetadata = tools.map((tool) => ({
  name: adapterTypes.formatToolName(tool.name, packageServerName, packageToolPrefix),
  originalName: tool.name,
  description: tool.description ?? "",
  inputSchema: tool.inputSchema,
}));
const packageSearchState = {
  config: { settings: { toolPrefix: "server" }, mcpServers: { [packageServerName]: packageTranslation.entry } },
  toolMetadata: new Map([[packageServerName, packageToolMetadata]]),
  manager: { getConnection: () => ({ status: "connected" }) },
  failureTracker: new Map(),
};
const packageSearchMatches = adapterSearchRanking.rankToolMatches(packageSearchState, "get_storage", packageServerName);
const packageSearchFindsAdvanced = packageSearchMatches.slice(0, 8).some((match) => match.tool.originalName === "get_storage");

function measureInitialContext({ directNames, defaultExposure, serverName }) {
  const directDefinitions = directNames.map((name) => byName.get(name));
  const directBytes = Buffer.byteLength(JSON.stringify(directDefinitions));
  const indirectTools = tools
    .filter((tool) => !directNames.includes(tool.name))
    .map((tool) => ({
      name: `${serverName}__${tool.name}`,
      description: tool.description,
      parameters: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));

  let route;
  if (defaultExposure === "codemode") {
    route = {
      name: "codemode",
      description: codemode.createCodemodeDescription(indirectTools, { models: false }),
      parameters: codemode.codemodeSchema,
    };
  } else if (defaultExposure === "deferred") {
    route = {
      name: toolSearch.TOOL_SEARCH_TOOL_NAME,
      description: toolSearch.TOOL_SEARCH_DESCRIPTION,
      parameters: toolSearch.toolSearchSchema,
    };
  } else {
    throw new Error(`Unsupported discovery exposure for measurement: ${defaultExposure}`);
  }
  const routeBytes = Buffer.byteLength(JSON.stringify(route));
  return { directBytes, routeBytes, initialBytes: directBytes + routeBytes };
}

const nativeMeasured = measureInitialContext({
  directNames: nativeDirect,
  defaultExposure: nativeConfig.exposure,
  serverName: "pi-browser-bridge",
});
const discoverable = tools.length - nativeDirect.length;
const translatedDirect = adapterTranslation.entry.directTools;
const adapterEffectiveDirect = translatedDirect === true
  ? tools.map((tool) => tool.name)
  : Array.isArray(translatedDirect)
    ? translatedDirect
    : [];
const adapterDirectDefinitions = adapterEffectiveDirect.map((name) => byName.get(name));
const adapterIgnoredDirectOverrides = adapterTranslation.ignored.filter((item) => item.startsWith("toolExposure ") && item.endsWith(": direct")).length;
const adapterPolicyMatches = adapterEffectiveDirect.length === adapterDirect.length
  && adapterDirect.every((name) => adapterEffectiveDirect.includes(name));
assert.ok(adapterEffectiveDirect.every((name) => byName.has(name)), "pi-mcp-adapter direct tools must exist in the MCP server");
const piToolNames = tools.map((tool) => ({
  name: `mcp__pi_browser_bridge__${tool.name}`,
  description: tool.description,
  parameters: tool.inputSchema,
  exposure: nativeDirect.includes(tool.name) ? "direct" : "deferred",
}));
let activeToolNames = new Set(nativeDirect.map((name) => `mcp__pi_browser_bridge__${name}`));
const toolState = {
  getAllTools: () => piToolNames,
  getActiveTools: () => [...activeToolNames],
  setActiveTools: (names) => { activeToolNames = new Set(names); },
};
const searchTool = toolSearch.createToolSearchToolDefinition({ tools: toolState });
const initialDirectNames = nativeDirect.map((name) => `mcp__pi_browser_bridge__${name}`);
let exactNameHits = 0;
for (const tool of tools.filter((candidate) => !nativeDirect.includes(candidate.name))) {
  activeToolNames = new Set(initialDirectNames);
  const result = await searchTool.execute(`autoresearch-${tool.name}`, { query: tool.name, limit: 8 });
  if (result.details.loaded.some((name) => name.endsWith(`__${tool.name}`))) exactNameHits += 1;
}

const recall = { calibration: { hits: 0, total: 0 }, holdout: { hits: 0, total: 0 } };
const discoveryMisses = [];
for (const item of evaluationCases) {
  const bucket = recall[item.split];
  assert.ok(bucket, `unknown evaluation split: ${item.split}`);
  const expectedTool = byName.get(item.expectedTool);
  assert.ok(expectedTool, `expected MCP tool is not registered: ${item.expectedTool}`);
  assert.ok(!nativeDirect.includes(item.expectedTool), `evaluation target must be deferred: ${item.expectedTool}`);
  activeToolNames = new Set(initialDirectNames);
  const result = await searchTool.execute(`autoresearch-${item.split}`, { query: item.query, limit: 8 });
  bucket.total += 1;
  const found = result.details.loaded.some((name) => name.endsWith(`__${item.expectedTool}`));
  if (found) bucket.hits += 1;
  else discoveryMisses.push({ split: item.split, expectedTool: item.expectedTool, query: item.query, loaded: result.details.loaded.map((name) => name.split("__").at(-1)) });
}
assert.ok(recall.calibration.total > 0 && recall.holdout.total > 0, "calibration and holdout cases are both required");
const calibrationRecall = (100 * recall.calibration.hits) / recall.calibration.total;
const holdoutRecall = (100 * recall.holdout.hits) / recall.holdout.total;
const generalizationMisses = [];
let generalizationHits = 0;
for (const item of generalizationCases) {
  activeToolNames = new Set(initialDirectNames);
  const result = await searchTool.execute("autoresearch-screenshot-diff-generalization", { query: item.query, limit: 8 });
  if (result.details.loaded.some((name) => name.endsWith("__screenshot_diff"))) generalizationHits += 1;
  else generalizationMisses.push({ query: item.query, loaded: result.details.loaded.map((name) => name.split("__").at(-1)) });
}
const generalizationRecall = (100 * generalizationHits) / generalizationCases.length;

console.log(`METRIC screenshot_diff_generalization_recall_pct=${generalizationRecall}`);
console.log(`METRIC discovery_calibration_recall_pct=${calibrationRecall}`);
console.log(`METRIC discovery_holdout_recall_pct=${holdoutRecall}`);
console.log(`METRIC discovery_exact_name_coverage_pct=${(100 * exactNameHits) / discoverable}`);
console.log(`METRIC native_initial_context_bytes=${nativeMeasured.initialBytes}`);
console.log(`METRIC native_direct_schema_bytes=${nativeMeasured.directBytes}`);
console.log(`METRIC native_direct_tool_count=${nativeDirect.length}`);
console.log(`METRIC native_discovery_route_bytes=${nativeMeasured.routeBytes}`);
console.log(`METRIC adapter_translated_direct_tool_count=${adapterEffectiveDirect.length}`);
console.log(`METRIC adapter_translated_direct_schema_bytes=${Buffer.byteLength(JSON.stringify(adapterDirectDefinitions))}`);
console.log(`METRIC adapter_ignored_direct_override_count=${adapterIgnoredDirectOverrides}`);
console.log(`METRIC adapter_search_only=${Number(translatedDirect === "search")}`);
console.log(`METRIC adapter_policy_match_pct=${Number(adapterPolicyMatches) * 100}`);
console.log(`METRIC adapter_non_direct_tool_count=${tools.length - adapterEffectiveDirect.length}`);
console.log(`METRIC package_bootstrap_direct_tool_count=${packageDirectNames.length}`);
console.log(`METRIC adapter_resolved_direct_tool_count=${packageDirectSpecs.length}`);
console.log(`METRIC adapter_resolved_direct_policy_match_pct=${Number(packageResolvedDirectMatches) * 100}`);
console.log(`METRIC adapter_lazy_direct_tool_count=${packageLazyDirectCount}`);
console.log(`METRIC package_bootstrap_policy_match_pct=${Number(packagePolicyMatches) * 100}`);
console.log(`METRIC package_bootstrap_ignored_direct_override_count=${packageIgnoredDirectOverrides}`);
console.log(`METRIC package_bootstrap_search_finds_advanced=${Number(packageSearchFindsAdvanced)}`);
console.log(`METRIC package_bootstrap_non_direct_tool_count=${tools.length - packageDirectNames.length}`);
console.log(`METRIC discoverable_tool_count=${discoverable}`);
console.log(`METRIC all_tool_schema_bytes=${Buffer.byteLength(JSON.stringify(tools))}`);
console.log(`GENERALIZATION_MISSES ${JSON.stringify(generalizationMisses)}`);
console.log(`DISCOVERY_MISSES ${JSON.stringify(discoveryMisses)}`);
