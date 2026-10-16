import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredIdleTimeout, DEFAULT_BROKER_IDLE_TIMEOUT_MS } from "../server/shared-broker.js";

test("shared broker stays alive by default and accepts an explicit idle shutdown timeout", () => {
  assert.equal(DEFAULT_BROKER_IDLE_TIMEOUT_MS, 0);
  assert.equal(configuredIdleTimeout({}), 0);
  assert.equal(configuredIdleTimeout({ PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "600000" }), 600_000);
  assert.equal(configuredIdleTimeout({ PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "0" }), 0);
  assert.throws(() => configuredIdleTimeout({ PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "999" }), /must be 0/);
  assert.throws(() => configuredIdleTimeout({ PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "86400001" }), /must be 0/);
  assert.throws(() => configuredIdleTimeout({ PI_BROWSER_BRIDGE_IDLE_TIMEOUT_MS: "NaN" }), /must be 0/);
});
