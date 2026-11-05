# Autoresearch: Direct browser tool context cost

## Objective
Unify the Pi MCP adapter and native fallback exposure policy: expose the small, frequently used browser operation set as direct tools, and leave low-frequency advanced operations available through MCP codemode tool discovery. Reduce the initial context cost of the native fallback without making registered browser tools unreachable.

## Metrics
- **Primary**: `native_direct_schema_bytes` (bytes, lower is better) — serialized MCP tool definitions for tools configured as direct by `extensions/index.js`; this measures the larger legacy path that currently exposes nearly every browser operation directly.
- **Secondary**: `native_direct_tool_count`, `adapter_direct_schema_bytes`, `adapter_direct_tool_count`, `discoverable_tool_count`, `all_tool_schema_bytes`.

Schema bytes are a reproducible proxy for model context cost, not an exact tokenizer count. The same live MCP `tools/list` response is used each run.

## How to Run
`./.auto/measure.sh` — syntax-checks the changed extension and starts the local MCP server with an isolated temporary agent directory, then emits `METRIC name=value` lines. No Chrome connection is needed.

## Files in Scope
- `extensions/index.js` — native fallback MCP exposure defaults and direct tool allowlist.
- `mcp.json` — adapter exposure policy, only if the measured behavior demonstrates a mismatch.
- `agents/playwright-browser.md` — the adapter's documented operator allowlist, only when its direct tool set intentionally changes.
- `test/pi-extension.test.js` and `test/tool-exposure.test.js` — exposure and fallback coverage.
- `.auto/` — measurement, checks, and experiment notes.

## Off Limits
Do not change browser command implementations, permissions, confirmation behavior, broker protocol, or the user's unrelated documentation and promotion files. Do not remove tools from the MCP server to improve the metric; advanced tools must remain callable through discovery.

## Constraints
- Preserve the adapter's existing common-tool set unless evidence supports a narrowly scoped improvement.
- Keep both registration paths aligned on direct tools and codemode discovery for the rest.
- All registered MCP tools must remain discoverable/callable; test that advanced tools remain present.
- Run `npm run check` and `npm test` after code changes.
- Do not optimize only for schema bytes at the expense of the common browser workflow.

## What's Been Tried
- Baseline inspection: `mcp.json` already uses server-level `codemode` with a 16-tool direct allowlist; `extensions/index.js` currently configures almost every tool as direct under a hidden server default. This leaves the native fallback with much higher initial context cost and no codemode discovery path.
- No code experiment has run yet.
