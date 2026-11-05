# Autoresearch: Direct browser tools with deferred discovery

## Objective
Keep common browser operations directly available, while exposing low-frequency advanced operations through Pi Tool Discovery. Minimize the actual initial tool declaration context across both Pi MCP registration paths without making any registered browser operation unreachable.

## Metrics
- **Primary**: `native_initial_context_bytes` (bytes, lower is better) — serialized direct MCP tool definitions plus the active discovery entry. For `codemode`, the entry includes Pi's generated description and any nested tool catalog that fits its configured inline budget. For `deferred`, it includes the `tool_search` description and schema. This is a reproducible byte proxy for context size, not an exact tokenizer count.
- **Secondary**: `native_direct_schema_bytes`, `native_direct_tool_count`, `native_discovery_route_bytes`, `adapter_initial_context_bytes`, `adapter_discovery_route_bytes`, `discoverable_tool_count`, `all_tool_schema_bytes`.

The measurement uses the live MCP `tools/list` response and Pi's installed codemode/tool-search definitions, so it measures declarations instead of counting unexposed server tools.

## How to Run
`./.auto/measure.sh` — syntax-checks the extension, starts the MCP server with an isolated temporary agent directory, measures declarations for both registration paths, and emits `METRIC name=value` lines. No Chrome connection is needed.

## Files in Scope
- `extensions/index.js` — native fallback MCP exposure defaults and direct tool allowlist.
- `mcp.json` — adapter exposure policy.
- `agents/playwright-browser.md` — operator allowlist only if the direct tool set intentionally changes.
- `test/pi-extension.test.js` and `test/tool-exposure.test.js` — exposure and fallback coverage.
- `.auto/` — measurement, checks, and experiment notes.

## Off Limits
Do not change browser command implementations, permissions, confirmation behavior, broker protocol, or the user's unrelated documentation and promotion files. Do not remove tools from the MCP server to improve the metric; advanced tools must remain callable through discovery.

## Constraints
- Preserve the existing 16 common direct tools unless evidence supports a narrowly scoped improvement.
- Keep both registration paths aligned on direct tools and Tool Discovery for the rest.
- All registered MCP tools must remain discoverable/callable; tests must verify advanced tools remain present.
- Run `npm run check` and `npm test` after code changes.
- Do not optimize only for schema bytes at the expense of the common browser workflow.

## What's Been Tried
- Original baseline: `mcp.json` exposed 16 direct tools and used `codemode`; native fallback exposed all 84 registered tools directly. Live direct schema cost was 61,213 bytes versus 10,842 bytes for the adapter's 16 direct tools.
- Kept an alignment change: native fallback now uses the same 16 direct tools and defaults to `codemode`; the other 68 tools remain callable. Native direct schema cost fell to 10,842 bytes, an 82.3% reduction, and all checks passed.
- Pi's codemode implementation still lists some non-direct tools in its generated description (up to the configured inline budget). The next experiment changes the default exposure to `deferred`, which uses Tool Discovery and avoids embedding advanced tool declarations in codemode's initial description.
