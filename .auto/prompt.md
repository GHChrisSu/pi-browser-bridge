# Autoresearch: Natural-language discovery recall

## Objective
Measure whether Pi Tool Discovery retrieves the right deferred browser operation from realistic task descriptions. Keep the existing 16 Direct Tools and deferred exposure policy fixed during evaluation. Improve only if calibration results show a specific retrieval gap, and judge any change on the disjoint holdout set.

## Metrics
- **Primary**: `discovery_holdout_recall_pct` (%, higher is better) — share of holdout user-intent queries where Pi's actual BM25 `tool_search`, with its default limit of 8, loads the expected deferred tool.
- **Secondary**: `discovery_calibration_recall_pct`, `discovery_exact_name_coverage_pct`, `native_initial_context_bytes`, `native_direct_tool_count`, `discoverable_tool_count`.

This is a small diagnostic suite, not production usage telemetry. Do not tune descriptions or query phrasing against holdout cases. A byte measurement remains available as a context guardrail, not the target in this iteration.

## How to Run
`./.auto/measure.sh` — measures the live MCP tool schemas and runs every query in `.auto/discovery-evaluation.json` through Pi's installed `tool_search` implementation. Search is reset to the initial direct tools before each query. It also verifies every deferred tool can be found by exact name. The benchmark is paired with `npm run check` and `npm test` in `.auto/checks.sh`.

## Files in Scope
- `.auto/discovery-evaluation.json` — calibration and disjoint holdout queries, with expected tools.
- `.auto/measure.mjs` — MCP schema measurement and actual Pi Tool Search evaluation.
- `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — experiment record.
- `server/advanced-tools.js` and `server/tools.js` — tool descriptions only, if calibration identifies a genuine search vocabulary gap.

## Off Limits
Do not change Direct Tool membership, tool implementations, permissions, confirmations, broker behavior, or the holdout query set in response to its results. Avoid changes that improve only exact-name matching. Do not touch unrelated documentation or the user's uncommitted workspace files.

## Constraints
- Preserve the fixed 16 Direct Tools and all 68 deferred tools.
- Keep calibration and holdout targets disjoint by operation.
- If the baseline holdout score is already 100%, make no description changes without external query evidence.
- Run `npm run check` and `npm test` after any product code change.
- Do not infer real-world query frequency or quality from this small synthetic suite.

## What's Been Tried
- Direct/context optimization is complete: 16 common tools are direct, 68 are deferred; measured initial context is 11,457 bytes versus the prior codemode baseline of 42,947 bytes.
- Pi's `tool_search` finds all 68 deferred tools by exact name. Representative natural-language searches also loaded `audit` and `get_storage`.
- The next hypothesis is that a small, disjoint set of user-intent phrases may reveal semantic retrieval gaps that exact-name checks miss. Holdout results are evaluation only and will not be used for tuning.
