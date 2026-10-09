#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "server", "index.js");
const HELP = `pi-browser-bridge

Usage:
  pi-browser-bridge mcp
  pi-browser-bridge mcp-config [--format json|python] [--write PATH] [--force]

Commands:
  mcp          Run the local stdio MCP server (used automatically by the Pi package).
  mcp-config   Print a portable MCP configuration, or merge it into a JSON MCP config file.

The browser extension connects automatically while the server is running. No token or port entry is required.
`;

function configEntry() {
  return {
    command: process.execPath,
    args: [serverPath],
    cwd: packageRoot,
  };
}

function configDocument() {
  return { mcpServers: { "pi-browser-bridge": configEntry() } };
}

function pythonSnippet() {
  const entry = configEntry();
  return [
    "# Requires: pip install mcp",
    "import asyncio",
    "from mcp import ClientSession, StdioServerParameters",
    "from mcp.client.stdio import stdio_client",
    "",
    `server = StdioServerParameters(command=${JSON.stringify(entry.command)}, args=${JSON.stringify(entry.args)})`,
    "",
    "async def main():",
    "    async with stdio_client(server) as (read, write):",
    "        async with ClientSession(read, write) as session:",
    "            await session.initialize()",
    "            tools = await session.list_tools()",
    "            print([tool.name for tool in tools.tools])",
    "",
    "asyncio.run(main())",
    "",
  ].join("\n");
}

async function mergeJsonConfig(path, force) {
  const absolute = resolve(path);
  let current = {};
  try {
    current = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not parse ${absolute}: ${error.message}`);
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("The config root must be a JSON object");
  if (current.mcpServers !== undefined && (!current.mcpServers || typeof current.mcpServers !== "object" || Array.isArray(current.mcpServers))) {
    throw new Error('The existing "mcpServers" value must be a JSON object');
  }
  const servers = current.mcpServers || {};
  const existing = servers["pi-browser-bridge"];
  const expected = configEntry();
  const matches = existing && existing.command === expected.command
    && JSON.stringify(existing.args || []) === JSON.stringify(expected.args)
    && (!existing.cwd || existing.cwd === expected.cwd);
  if (existing && !force && !matches) {
    throw new Error('A different "pi-browser-bridge" server already exists. Review it or rerun with --force to replace only that entry.');
  }

  const result = { ...current, mcpServers: { ...servers, "pi-browser-bridge": { ...(matches ? existing : {}), ...expected } } };
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, absolute);
  return absolute;
}

async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "mcp") {
    const child = spawn(process.execPath, [serverPath], { cwd: packageRoot, stdio: "inherit" });
    const forward = (signal) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    const [code, signal] = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode, exitSignal) => resolveExit([exitCode, exitSignal]));
    });
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
    if (signal) return 1;
    return code ?? 1;
  }
  if (command !== "mcp-config") throw new Error(`Unknown command: ${command}`);

  let format = "json";
  let writePath = null;
  let force = false;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--format") format = rest[++i];
    else if (rest[i] === "--write") writePath = rest[++i];
    else if (rest[i] === "--force") force = true;
    else throw new Error(`Unknown option: ${rest[i]}`);
  }
  if (!["json", "python"].includes(format)) throw new Error("--format must be json or python");
  if (writePath && format !== "json") throw new Error("--write is only supported with --format json");
  if (writePath) {
    const destination = await mergeJsonConfig(writePath, force);
    process.stdout.write(`Added pi-browser-bridge to ${destination}\n`);
  } else {
    process.stdout.write(format === "python" ? pythonSnippet() : `${JSON.stringify(configDocument(), null, 2)}\n`);
  }
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`pi-browser-bridge: ${error.message}\n`);
  process.exitCode = 1;
});
