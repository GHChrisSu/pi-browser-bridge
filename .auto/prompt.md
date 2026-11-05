# Autoresearch: Verify package-bootstrap adapter policy

## Objective
Verify that a clean Pi package installation path loads this package's `mcp.json`, applies the adapter-specific exposure settings, and leaves deferred browser operations visible through the adapter's real Tool Search ranker. The 16 common tools must remain direct and the other 68 must remain searchable.

## Metrics
- **Primary**: `package_bootstrap_direct_tool_count` (count, higher is better; target 16) — effective direct tools after Pi's installed `loadPackageMcpConfigs()` and `translatePiMcpServer()` process the package manifest.
- **Secondary**: `package_bootstrap_policy_match_pct`, `package_bootstrap_ignored_direct_override_count`, `package_bootstrap_search_finds_advanced`, `package_bootstrap_non_direct_tool_count`, `adapter_translated_direct_tool_count`, `adapter_ignored_direct_override_count`, `native_direct_tool_count`, `native_initial_context_bytes`.

This validates package configuration and adapter wiring. It does not tune or score synthetic natural-language query suites.

## How to Run
`./.auto/measure.sh` — starts the MCP server in an isolated agent directory, creates a temporary Pi project that installs this package by absolute path, loads its package MCP manifest with the installed adapter's real loader, translates the server entry, and runs the adapter's real Tool Search ranker over the live MCP metadata. It checks that the deferred `get_storage` operation can be discovered. `.auto/checks.sh` runs `npm run check` and `npm test` after a passing measurement.

## Files in Scope
- `.auto/measure.mjs` — bootstrap, translation, search visibility, and context measurements.
- `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — experiment record.
- No product files are in scope unless the bootstrap path shows a concrete regression.

## Off Limits
Do not change product exposure or tool descriptions during this validation. Do not change the native fallback, Direct Tool list, synthetic query suites, permissions, broker behavior, or unrelated workspace files.

## Constraints
- Package bootstrap must yield exactly the 16 Direct Tools listed in `agents/playwright-browser.md`.
- No per-tool direct override may be ignored.
- Package-backed adapter search must find at least one non-direct advanced tool by exact name.
- Native fallback stays at 16 direct, 68 deferred, and 11,457 initial context bytes.
- Run the existing correctness checks after a passing measurement.

## What's Been Tried
- The installed adapter translator baseline showed that server-level `deferred` sets `directTools: "search"` and ignores all 16 `toolExposure: direct` entries.
- Switching only the adapter manifest to `codemode` produced the intended adapter mapping: 16 direct, zero ignored overrides, and 68 non-direct/searchable tools. The native fallback remains `deferred`.
- The next check exercises the package loader, manifest resolution, adapter translator, and adapter ranking function end to end using a temporary project that references this package.
