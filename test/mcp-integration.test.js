import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import WebSocket from "ws";

const serverPath = fileURLToPath(new URL("../server/index.js", import.meta.url));
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const profileId = "33333333-3333-4333-8333-333333333333";

function createMcpProcess(agentDir) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PI_BROWSER_BRIDGE_PORT: "0", PI_CODING_AGENT_DIR: agentDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      entry.resolve(message);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }
    }, 5_000).unref();
  });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return { child, request, notify };
}

function nextSocketMessage(socket, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", listener);
      reject(new Error("Timed out waiting for browser command"));
    }, timeoutMs);
    const listener = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== "command") return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("MCP server did not start")), 5_000);
    child.stderr.on("data", (chunk) => {
      text += chunk.toString();
      const match = text.match(/Listening on ws:\/\/127\.0\.0\.1:(\d+)\/bridge/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`MCP server exited before listening (${code})`));
    });
  });
}

test("Pi MCP server exposes safe browser tools and routes calls to the paired extension", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-browser-bridge-mcp-"));
  const mcp = createMcpProcess(agentDir);
  let extension;
  t.after(async () => {
    try { extension?.close(); } catch {}
    try { mcp.child.kill("SIGTERM"); } catch {}
    await once(mcp.child, "exit").catch(() => {});
    await rm(agentDir, { recursive: true, force: true });
  });

  const port = await waitForPort(mcp.child);
  const initialized = await mcp.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "pi-browser-bridge-test", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "pi-browser-bridge");
  mcp.notify("notifications/initialized");

  const listed = await mcp.request("tools/list");
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("list_profiles"));
  assert.ok(names.includes("list_tabs"));
  assert.ok(names.includes("list_workspaces"));
  assert.ok(names.includes("create_workspace"));
  assert.ok(names.includes("read_urls"));
  assert.ok(names.includes("download_url"));
  assert.ok(names.includes("download_media"));
  assert.ok(names.includes("upload_file"));
  assert.ok(names.includes("get_accessibility_tree"));
  assert.ok(names.includes("get_visible_dom"));
  assert.ok(names.includes("get_by_role"));
  assert.ok(names.includes("click_by_role"));
  assert.ok(names.includes("fill_by_role"));
  assert.ok(names.includes("fill_accessibility_node"));
  assert.ok(names.includes("click_dom_node"));
  assert.ok(names.includes("click_accessibility_node"));
  assert.ok(names.includes("get_interactives"));
  assert.ok(names.includes("read_page"));
  assert.ok(names.includes("list_page_assets"));
  assert.ok(names.includes("click"));
  assert.ok(!names.includes("execute_js"));
  assert.ok(!names.includes("get_storage"));

  extension = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin: `chrome-extension://${extensionId}` });
  await once(extension, "open");
  const helloAck = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("extension hello timed out")), 3_000);
    extension.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "hello_ack") { clearTimeout(timer); resolve(message); }
    });
  });
  extension.send(JSON.stringify({ type: "hello", extensionId, version: "0.6.0", profileId, profileName: "Test Chrome profile" }));
  await helloAck;

  const profileList = await mcp.request("tools/call", { name: "list_profiles", arguments: {} });
  const profilesData = JSON.parse(profileList.result.content[0].text);
  assert.equal(profilesData.profiles.length, 1);
  assert.equal(profilesData.profiles[0].profile_id, profileId);
  assert.equal(profilesData.profiles[0].name, "Test Chrome profile");

  const browserCommand = nextSocketMessage(extension);
  const toolCall = mcp.request("tools/call", { name: "get_active_tab", arguments: { profile_id: profileId } });
  const command = await browserCommand;
  assert.equal(command.command, "get_active_tab");
  assert.deepEqual(command.params, {});
  extension.send(JSON.stringify({ type: "result", id: command.id, data: { id: 17, title: "Pi test page", url: "https://example.com/" } }));
  const toolResult = await toolCall;
  assert.equal(toolResult.result.content.length, 1);
  assert.match(toolResult.result.content[0].text, /Pi test page/);

  const axSnapshotPromise = nextSocketMessage(extension);
  const axSnapshotCall = mcp.request("tools/call", {
    name: "get_accessibility_tree",
    arguments: { profile_id: profileId, tab_id: 17, offset: 0, limit: 3 },
  });
  const axSnapshotCommand = await axSnapshotPromise;
  assert.equal(axSnapshotCommand.command, "get_accessibility_tree");
  assert.deepEqual(axSnapshotCommand.params, { tab_id: 17, offset: 0, limit: 3 });
  extension.send(JSON.stringify({ type: "result", id: axSnapshotCommand.id, data: {
    snapshot_id: "123e4567-e89b-42d3-a456-426614174000",
    tab_id: 17,
    total_nodes: 4,
    returned_nodes: 3,
    offset: 0,
    next_offset: 3,
    truncated: false,
    nodes: [
      { node_id: "1", parent_node_id: null, role: "RootWebArea", name: "Test page", ignored: false, interactive: false, child_count: 1, properties: {} },
      { node_id: "2", parent_node_id: "1", role: "button", name: "Comment", ignored: false, interactive: true, child_count: 0, properties: { focusable: true } },
      { node_id: "3", parent_node_id: "1", role: "textbox", name: "Add a reply", ignored: false, interactive: true, child_count: 0, properties: { focusable: true } },
    ],
  } }));
  const axSnapshot = JSON.parse((await axSnapshotCall).result.content[0].text);
  assert.equal(axSnapshot.nodes[1].name, "Comment");
  assert.equal(axSnapshot.snapshot_id, "123e4567-e89b-42d3-a456-426614174000");

  const axClickPromise = nextSocketMessage(extension);
  const axClickCall = mcp.request("tools/call", {
    name: "click_accessibility_node",
    arguments: { profile_id: profileId, tab_id: 17, snapshot_id: axSnapshot.snapshot_id, node_id: "2" },
  });
  const axClickCommand = await axClickPromise;
  assert.equal(axClickCommand.command, "click_accessibility_node");
  assert.deepEqual(axClickCommand.params, { tab_id: 17, snapshot_id: axSnapshot.snapshot_id, node_id: "2" });
  extension.send(JSON.stringify({ type: "result", id: axClickCommand.id, data: {
    clicked: true, tab_id: 17, node_id: "2", role: "button", name: "Comment", point: { x: 100, y: 80 }, active_tab_unchanged: true,
  } }));
  const axClick = JSON.parse((await axClickCall).result.content[0].text);
  assert.equal(axClick.clicked, true);
  assert.equal(axClick.active_tab_unchanged, true);

  const roleCommandPromise = nextSocketMessage(extension);
  const roleCall = mcp.request("tools/call", {
    name: "get_by_role",
    arguments: { profile_id: profileId, tab_id: 17, role: "button", name: "Comment", exact: true },
  });
  const roleCommand = await roleCommandPromise;
  assert.equal(roleCommand.command, "get_by_role");
  assert.deepEqual(roleCommand.params, { tab_id: 17, role: "button", name: "Comment", exact: true });
  extension.send(JSON.stringify({ type: "result", id: roleCommand.id, data: {
    snapshot_id: "123e4567-e89b-42d3-a456-426614174001", role: "button", name: "Comment", exact: true,
    total_matches: 1, offset: 0, next_offset: null, matches: [{ node_id: "8", role: "button", name: "Comment", interactive: true }],
  } }));
  assert.match((await roleCall).result.content[0].text, /Comment/);

  const fillByRoleCommandPromise = nextSocketMessage(extension);
  const fillByRoleCall = mcp.request("tools/call", {
    name: "fill_by_role",
    arguments: { profile_id: profileId, tab_id: 17, role: "textbox", name: "Add a reply", exact: true, value: "Safe test" },
  });
  const fillByRoleCommand = await fillByRoleCommandPromise;
  assert.equal(fillByRoleCommand.command, "fill_by_role");
  assert.deepEqual(fillByRoleCommand.params, { tab_id: 17, role: "textbox", name: "Add a reply", exact: true, value: "Safe test" });
  extension.send(JSON.stringify({ type: "result", id: fillByRoleCommand.id, data: { filled: true, node_id: "9", role: "textbox", name: "Add a reply", value_length: 9 } }));
  assert.match((await fillByRoleCall).result.content[0].text, /value_length/);

  const clickRoleCommandPromise = nextSocketMessage(extension);
  const clickRoleCall = mcp.request("tools/call", {
    name: "click_by_role",
    arguments: { profile_id: profileId, tab_id: 17, role: "button", name: "Comment", exact: true },
  });
  const clickRoleCommand = await clickRoleCommandPromise;
  assert.equal(clickRoleCommand.command, "click_by_role");
  extension.send(JSON.stringify({ type: "result", id: clickRoleCommand.id, data: { clicked: true, node_id: "8", role: "button", name: "Comment", active_tab_unchanged: true } }));
  assert.match((await clickRoleCall).result.content[0].text, /clicked/);

  const assetsCommandPromise = nextSocketMessage(extension);
  const assetsCall = mcp.request("tools/call", { name: "list_page_assets", arguments: { profile_id: profileId, tab_id: 17, limit: 20 } });
  const assetsCommand = await assetsCommandPromise;
  assert.equal(assetsCommand.command, "list_page_assets");
  assert.deepEqual(assetsCommand.params, { tab_id: 17, limit: 20 });
  extension.send(JSON.stringify({ type: "result", id: assetsCommand.id, data: {
    title: "Pi test page", page_url: "https://example.com/", inline_svg_count: 0,
    assets: [{ selector: "#image", kind: "image", url: "https://example.com/image.png", label: "Courier sprite" }],
  } }));
  assert.match((await assetsCall).result.content[0].text, /Courier sprite/);

  const checkboxCommand = nextSocketMessage(extension);
  const checkboxCall = mcp.request("tools/call", {
    name: "fill_form",
    arguments: { fields: [{ selector: "#terms", checked: true }] },
  });
  const checkbox = await checkboxCommand;
  assert.equal(checkbox.command, "fill_form");
  assert.deepEqual(checkbox.params.fields, [{ selector: "#terms", checked: true }]);
  extension.send(JSON.stringify({ type: "result", id: checkbox.id, data: { filled: 1, fields: [{ selector: "#terms", checked: true }] } }));
  const checkboxResult = await checkboxCall;
  assert.match(checkboxResult.result.content[0].text, /checked/);

  const workspaceCommandPromise = nextSocketMessage(extension);
  const workspaceCall = mcp.request("tools/call", {
    name: "create_workspace",
    arguments: { name: "Research", url: "https://example.com/", color: "blue" },
  });
  const workspaceCommand = await workspaceCommandPromise;
  assert.equal(workspaceCommand.command, "create_workspace");
  assert.deepEqual(workspaceCommand.params, { name: "Research", url: "https://example.com/", color: "blue" });
  extension.send(JSON.stringify({ type: "result", id: workspaceCommand.id, data: {
    workspace_id: 31,
    name: "Research",
    color: "blue",
    tab: { id: 42, active: false, workspace_id: 31 },
    selected_tab_unchanged: true,
  } }));
  const workspaceResult = await workspaceCall;
  assert.match(workspaceResult.result.content[0].text, /selected_tab_unchanged/);

  const groupedTabCommandPromise = nextSocketMessage(extension);
  const groupedTabCall = mcp.request("tools/call", {
    name: "create_tab",
    arguments: { url: "https://example.org/", workspace_id: 31 },
  });
  const groupedTabCommand = await groupedTabCommandPromise;
  assert.equal(groupedTabCommand.command, "create_tab");
  assert.deepEqual(groupedTabCommand.params, { url: "https://example.org/", active: false, workspace_id: 31 });
  extension.send(JSON.stringify({ type: "result", id: groupedTabCommand.id, data: { id: 43, active: false, workspace_id: 31, selected_tab_unchanged: true } }));
  assert.match((await groupedTabCall).result.content[0].text, /workspace_id/);

  const readUrlsCommandPromise = nextSocketMessage(extension);
  const readUrlsCall = mcp.request("tools/call", {
    name: "read_urls",
    arguments: { urls: ["https://example.com/", "https://example.org/"], max_length: 5_000 },
  });
  const readUrlsCommand = await readUrlsCommandPromise;
  assert.equal(readUrlsCommand.command, "read_urls");
  assert.deepEqual(readUrlsCommand.params.urls, ["https://example.com/", "https://example.org/"]);
  extension.send(JSON.stringify({ type: "result", id: readUrlsCommand.id, data: {
    selected_tab_unchanged: true,
    results: [{ ok: true, url: "https://example.com/", text: "one" }, { ok: true, url: "https://example.org/", text: "two" }],
  } }));
  const readUrlsResult = await readUrlsCall;
  assert.match(readUrlsResult.result.content[0].text, /selected_tab_unchanged/);

  const downloadUrlCommandPromise = nextSocketMessage(extension);
  const downloadUrlCall = mcp.request("tools/call", {
    name: "download_url",
    arguments: { profile_id: profileId, url: "https://example.com/image.png", timeout_ms: 30_000 },
  });
  const downloadUrlCommand = await downloadUrlCommandPromise;
  assert.equal(downloadUrlCommand.command, "download_url");
  assert.deepEqual(downloadUrlCommand.params, { url: "https://example.com/image.png", timeout_ms: 30_000 });
  extension.send(JSON.stringify({ type: "result", id: downloadUrlCommand.id, data: {
    download_id: 91, file_path: "/tmp/pi-bridge-download/image.png", file_name: "image.png", state: "complete", size_bytes: 1234,
  } }));
  assert.match((await downloadUrlCall).result.content[0].text, /image\.png/);

  const downloadMediaCommandPromise = nextSocketMessage(extension);
  const downloadMediaCall = mcp.request("tools/call", {
    name: "download_media",
    arguments: { profile_id: profileId, tab_id: 17, selector: "#download", timeout_ms: 45_000 },
  });
  const downloadMediaCommand = await downloadMediaCommandPromise;
  assert.equal(downloadMediaCommand.command, "download_media");
  assert.deepEqual(downloadMediaCommand.params, { tab_id: 17, selector: "#download", timeout_ms: 45_000 });
  extension.send(JSON.stringify({ type: "result", id: downloadMediaCommand.id, data: {
    download_id: 92, file_path: "/tmp/pi-bridge-download/generated.png", file_name: "generated.png", state: "complete", size_bytes: 2048,
  } }));
  assert.match((await downloadMediaCall).result.content[0].text, /generated\.png/);

  const uploadPath = join(agentDir, "to-upload.txt");
  await writeFile(uploadPath, "local test upload");
  const uploadCommandPromise = nextSocketMessage(extension);
  const uploadCall = mcp.request("tools/call", {
    name: "upload_file",
    arguments: { profile_id: profileId, tab_id: 17, selector: "#upload", file_path: uploadPath, target_origin: "https://example.com" },
  });
  const uploadCommand = await uploadCommandPromise;
  assert.equal(uploadCommand.command, "upload_file");
  assert.deepEqual(uploadCommand.params, {
    tab_id: 17,
    selector: "#upload",
    file_path: await realpath(uploadPath),
    file_name: "to-upload.txt",
    size_bytes: 17,
    target_origin: "https://example.com",
  });
  extension.send(JSON.stringify({ type: "result", id: uploadCommand.id, data: { uploaded: true, file_name: "to-upload.txt", origin: "https://example.com" } }));
  assert.match((await uploadCall).result.content[0].text, /uploaded/);

  const unsafe = await mcp.request("tools/call", { name: "navigate", arguments: { url: "javascript:alert(1)" } });
  assert.equal(unsafe.result.isError, true);
});
