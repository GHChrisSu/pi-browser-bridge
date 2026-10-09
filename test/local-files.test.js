import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseHttpOrigin, validateUploadFile } from "../server/local-files.js";

test("upload validation accepts a bounded regular file and returns its canonical path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-upload-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "asset.png");
  await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const file = await validateUploadFile(path);
  assert.equal(file.file_path, await realpath(path));
  assert.equal(file.file_name, "asset.png");
  assert.equal(file.size_bytes, 8);
});

test("upload validation rejects relative paths, directories, missing files, and oversized files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-browser-bridge-upload-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oversized = join(directory, "large.bin");
  await writeFile(oversized, "");
  await truncate(oversized, 50 * 1024 * 1024 + 1);
  await assert.rejects(validateUploadFile("relative.png"), /absolute local path/);
  await assert.rejects(validateUploadFile(directory), /regular file/);
  await assert.rejects(validateUploadFile(join(directory, "missing.png")));
  await assert.rejects(validateUploadFile(oversized), /upload limit/);
});

test("upload destination accepts only bare HTTP and HTTPS origins", () => {
  assert.equal(parseHttpOrigin("https://example.com"), "https://example.com");
  assert.equal(parseHttpOrigin("https://example.com/"), "https://example.com");
  assert.equal(parseHttpOrigin("http://localhost:4173"), "http://localhost:4173");
  assert.throws(() => parseHttpOrigin("file:///tmp/index.html"), /HTTP or HTTPS/);
  assert.throws(() => parseHttpOrigin("https://example.com/upload"), /only scheme/);
  assert.throws(() => parseHttpOrigin("https://user:pass@example.com"), /without credentials/);
});
