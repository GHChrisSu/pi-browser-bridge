# Autoresearch: Verify adapter Direct Tool resolution

## Objective
Verify that the adapter's real `resolveDirectTools()` runtime step builds exactly the 16 common browser Direct Tools after package bootstrap and metadata loading. Confirm the remaining 68 operations are non-direct and visible to adapter Tool Search.

## Metrics
- **Primary**: `adapter_resolved_direct_tool_count` (count, higher is better; target 16) — number of direct tool specs actually constructed by the installed adapter's `resolveDirectTools()` from the package-loaded server entry and a valid metadata-cache entry.
- **Secondary**: `adapter_resolved_direct_policy_match_pct`, `adapter_lazy_direct_tool_count`, `package_bootstrap_search_finds_advanced`, `package_bootstrap_direct_tool_count`, `package_bootstrap_policy_match_pct`, `adapter_translated_direct_tool_count`, `native_direct_tool_count`, `native_initial_context_bytes`.

This checks runtime resolution, not just configuration translation. It does not tune synthetic natural-language query suites.

## How to Run
`./.auto/measure.sh` — starts the live MCP server, loads the package manifest through `loadPackageMcpConfigs()`, translates its entry with `translatePiMcpServer()`, creates an adapter-valid metadata cache, and calls the installed adapter's `resolveDirectTools()`. It also checks that adapter ranking can find the non-direct `get_storage` tool. `.auto/checks.sh` runs `npm run check` and `npm test` after a passing measurement.

## Files in Scope
- `.auto/measure.mjs` — package bootstrap and runtime resolution verification.
- `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — experiment record.
- No product files are in scope unless actual Direct Tool resolution reveals a mismatch.

## Off Limits
Do not change product exposure, Direct Tool membership, descriptions, implementations, permissions, confirmations, or broker behavior during this validation. Do not tune the semantic query suites.

## Constraints
- `resolveDirectTools()` must produce exactly the 16 names in `agents/playwright-browser.md`.
- None of those specs should be lazy; lazy search-only behavior belongs to deferred tools.
- The adapter search ranker must still return `get_storage` from package-loaded metadata.
- Native fallback stays at 16 direct, 68 deferred, and 11,457 initial context bytes.
- Run correctness checks after a passing measurement.

## What's Been Tried
- The installed translator maps the adapter manifest's codemode + 16 direct overrides to an explicit 16-name direct list and 68 non-direct tools.
- A temporary project loaded the package's MCP config, and the adapter ranker found `get_storage` from that package-loaded metadata.
- This next check advances one step deeper into the adapter lifecycle: whether its real direct-tool resolver constructs the expected 16 tool specs without marking them lazy.
