# Autoresearch: Verify adapter Direct Tool mapping

## Objective
Ensure the installed `pi-mcp-adapter` translates Pi MCP exposure settings into the intended runtime: the 16 common browser operations are actual Direct Tools, while the other 68 remain available through adapter search. Change the package manifest only if the installed adapter's real translator proves the current mapping is wrong.

## Metrics
- **Primary**: `adapter_translated_direct_tool_count` (count, higher is better; target 16) — effective direct tools returned by the installed adapter's `translatePiMcpServer()` for the package's actual `mcp.json` entry.
- **Secondary**: `adapter_translated_direct_schema_bytes`, `adapter_ignored_direct_override_count`, `adapter_search_only`, `adapter_policy_match_pct`, `adapter_non_direct_tool_count`, `native_direct_tool_count`, `native_initial_context_bytes`.

The benchmark measures adapter configuration translation, not synthetic user-query success. The 16-tool allowlist and 68 non-direct operations are acceptance constraints.

## How to Run
`./.auto/measure.sh` — starts the browser MCP server in an isolated temporary agent directory, reads its live `tools/list`, imports the installed `pi-mcp-adapter` translator, and reports the effective direct tool set plus ignored overrides. It also retains the previous native exposure and discovery checks. `.auto/checks.sh` runs `npm run check` and `npm test` after each passing measurement.

## Files in Scope
- `mcp.json` — adapter-side exposure mode and direct overrides.
- `test/tool-exposure.test.js` — manifest contract.
- `.auto/measure.mjs`, `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — measurement and record.

## Off Limits
Do not change the native fallback's separate `deferred` exposure or the existing 16-tool Direct allowlist. Do not change browser implementations, permissions, confirmations, broker behavior, or unrelated workspace files. Do not tune natural-language query suites during this adapter compatibility experiment.

## Constraints
- The adapter translator must map exactly the same 16 direct tool names as `agents/playwright-browser.md`.
- The other 68 tools must remain non-direct and searchable through the adapter.
- No direct override may be silently ignored.
- Native fallback context remains 11,457 bytes.
- Run `npm run check` and `npm test` after product changes.

## What's Been Tried
- The native fallback uses standard Pi `deferred` exposure with 16 direct overrides and 68 tools discoverable by `tool_search`.
- The package `mcp.json` currently uses server-level `deferred` plus 16 `toolExposure: direct` entries.
- The installed `pi-mcp-adapter` 5.2.0 translator maps server-level `deferred` to `directTools: "search"` and ignores per-tool direct overrides in this mode. Baseline measurement showed 0 adapter Direct Tools, 16 ignored overrides, and all 84 tools routed through search.
- The next experiment switches only the adapter manifest to its supported `codemode` + per-tool direct mapping, then checks for 16 direct and 68 searchable operations. The native fallback remains deferred.
