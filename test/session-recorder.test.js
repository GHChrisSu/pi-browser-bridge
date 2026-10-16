import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSessionRecorder } from "../server/session-recorder.js";

test("session recorder stores only the safe allowlisted request shape and replays it", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pi-browser-bridge-session-record-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(home, { recursive: true, force: true });
  });

  const calls = [];
  const broker = {
    getStatus: async () => ({ connected: true }),
    listProfiles: async () => [],
    resetPairing: async () => ({ reset: true }),
    request: async (command, params, options) => { calls.push({ command, params, options }); return { ok: true }; },
  };
  const recorder = createSessionRecorder(broker);
  await recorder.control("start", { name: "smoke" });
  await recorder.broker.request("navigate", { url: "https://example.com/account?token=private#fragment", tab_id: 77 }, { profileId: "profile-a" });
  await recorder.broker.request("type_text", { selector: "#password", text: "never-record-this" }, { profileId: "profile-a" });
  const stopped = await recorder.control("stop");
  assert.equal(stopped.steps, 1);
  assert.equal((await stat(stopped.file)).mode & 0o777, 0o600);
  const lines = (await readFile(stopped.file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].command, "navigate");
  assert.equal(lines[1].params.url, "https://example.com/account");
  assert.equal("tab_id" in lines[1].params, false);
  assert.equal(JSON.stringify(lines).includes("never-record-this"), false);

  const replay = await recorder.control("replay", { name: "smoke", profile_id: "profile-b" });
  assert.equal(replay.steps, 1);
  assert.equal(replay.failures.length, 0);
  assert.equal(calls.at(-1).options.profileId, "profile-b");
  assert.deepEqual(await recorder.control("list"), { recordings: ["smoke"] });
  assert.deepEqual(await recorder.control("delete", { name: "smoke" }), { deleted: "smoke" });
});
