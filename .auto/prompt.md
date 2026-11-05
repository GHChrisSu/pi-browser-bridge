# Autoresearch: Verify adapter Direct Tool mapping

## Objective
Verify that the installed `pi-mcp-adapter` translates Pi MCP exposure settings into the intended runtime behavior: exactly 16 common browser tools registered as Direct Tools, with the other 68 operations available through adapter search. Fix the manifest only if the adapter's actual translator demonstrates a mismatch.

## Metrics
- **Primary**: `adapter_translated_direct_tool_count` (count, higher is better; target 16) — number of tools the installed adapter translator actually marks direct from this package's `mcp.json`.
- **Secondary**: `adapter_translated_direct_schema_bytes`, `adapter_ignored_direct_override_count`, `adapter_search_only`, `adapter_policy_match_pct`, `adapter_non_direct_tool_count`, `native_direct_tool_count`, `native_initial_context_bytes`.

This targets adapter compatibility, not synthetic natural-language retrieval. The native Pi fallback remains separately measured. The 16-tool list and 68 deferred operations are acceptance constraints.

## How to Run
`./.auto/measure.sh` — starts the actual MCP server in an isolated agent directory, reads its live `tools/list`, and calls the installed `pi-mcp-adapter` `translatePiMcpServer()` on the package's real `mcp.json` entry. It reports effective direct mappings and ignored overrides. `.auto/checks.sh` runs `npm run check` and `npm test` after a passing measurement.

## Files in Scope
- `mcp.json` — adapter-side exposure mode and direct tool overrides.
- `test/tool-exposure.test.js` — static manifest contract.
- `.auto/measure.mjs`, `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — measurement and experiment record.

## Off Limits
Do not change the native fallback's separate `deferred` exposure or the Direct Tool list. Do not modify browser implementations, permissions, confirmations, broker behavior, or unrelated workspace files. Do not tune the natural-language evaluation query sets.

## Constraints
- Adapter translation must produce exactly the same 16 direct tool names as `agents/playwright-browser.md`.
- The remaining 68 MCP operations must remain non-direct and available through adapter search.
- No direct override may be silently ignored.
- Native initial context remains 11,457 bytes.
- Run `npm run check` and `npm test` after product changes.

## What's Been Tried
- The native fallback uses standard Pi `deferred` exposure with 16 direct overrides and 68 tools discoverable by `tool_search`.
- The adapter manifest currently also uses server-level `deferred` plus 16 `toolExposure: direct` entries.
- The installed adapter's `translatePiMcpServer()` source sets `directTools: "search"` for server-level `deferred`, and only converts per-tool direct overrides into a direct-name array when the server exposure is `codemode`. The next experiment measures the current effective result before changing the manifest.
