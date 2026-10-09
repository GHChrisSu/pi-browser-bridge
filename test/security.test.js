import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionIdFromOrigin, isLoopbackAddress, isSensitiveField, normalizeSelector, parseWebUrl } from "../server/security.js";

test("URL validation allows web pages and refuses executable or credential-bearing URLs", () => {
  assert.equal(parseWebUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(parseWebUrl("http://localhost:4173/"), "http://localhost:4173/");
  assert.throws(() => parseWebUrl("javascript:alert(1)"), /Only HTTP and HTTPS/);
  assert.throws(() => parseWebUrl("data:text/html,hello"), /Only HTTP and HTTPS/);
  assert.throws(() => parseWebUrl("https://user:pass@example.com/"), /embedded usernames or passwords/);
  assert.throws(() => parseWebUrl(""), /non-empty URL/);
});

test("extension origin parsing accepts only Chrome extension origins", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";
  assert.equal(extensionIdFromOrigin(`chrome-extension://${id}`), id);
  assert.equal(extensionIdFromOrigin("https://example.com"), null);
  assert.equal(extensionIdFromOrigin("chrome-extension://not-a-valid-id"), null);
  assert.equal(extensionIdFromOrigin(undefined), null);
});

test("loopback checks exclude remote interfaces", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.10"), false);
});

test("form safety rules block credentials while allowing ordinary fields", () => {
  assert.equal(isSensitiveField({ type: "password" }), true);
  assert.equal(isSensitiveField({ name: "authenticity_token" }), true);
  assert.equal(isSensitiveField({ autocomplete: "one-time-code" }), true);
  assert.equal(isSensitiveField({ name: "email", type: "email" }), false);
  assert.equal(isSensitiveField({ name: "project_name", type: "text" }), false);
});

test("CSS selectors must be non-empty and bounded", () => {
  assert.equal(normalizeSelector("  #save  "), "#save");
  assert.throws(() => normalizeSelector("  "), /non-empty CSS selector/);
  assert.throws(() => normalizeSelector("x".repeat(2049)), /2048 characters/);
});
