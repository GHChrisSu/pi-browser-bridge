# Autoresearch: Improve calibration-set Tool Discovery recall

## Objective
Improve Pi's BM25 Tool Discovery for realistic deferred browser task descriptions without changing the Direct Tool set or the initial context cost. Use the calibration split to guide a narrowly scoped tool-description improvement, and keep the disjoint holdout split untouched as a generalization guardrail.

## Metrics
- **Primary**: `discovery_calibration_recall_pct` (%, higher is better) — share of the fixed calibration queries where Pi's actual BM25 `tool_search`, with default limit 8, loads the expected deferred tool.
- **Secondary**: `discovery_holdout_recall_pct`, `discovery_exact_name_coverage_pct`, `native_initial_context_bytes`, `native_direct_tool_count`, `discoverable_tool_count`.

This is a small diagnostic suite, not production usage telemetry. Do not edit either query split to improve results. A successful change must improve calibration recall, leave holdout recall unchanged or better, and preserve the 16 direct tools and initial context bytes.

## How to Run
`./.auto/measure.sh` — measures live MCP schemas and evaluates all queries in `.auto/discovery-evaluation.json` with Pi's installed `tool_search` implementation. It resets the active tool set before each query, prints failed query diagnostics, and verifies exact-name lookup for every deferred tool. `.auto/checks.sh` runs `npm run check` and `npm test` after a passing measurement.

## Files in Scope
- `server/advanced-tools.js` and `server/tools.js` — tool descriptions only, if calibration identifies a retrieval gap.
- `.auto/discovery-evaluation.json` — fixed calibration and disjoint holdout query sets; do not change them.
- `.auto/measure.mjs`, `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — benchmark and experiment record.

## Off Limits
Do not change Direct Tool membership, tool implementations, permissions, confirmations, broker behavior, or holdout query text. Do not tune exact tool names alone. Do not touch unrelated documentation or workspace edits.

## Constraints
- Keep all 16 Direct Tools and all 68 deferred tools.
- A description change must improve calibration recall while leaving holdout recall unchanged or better.
- Keep `native_initial_context_bytes` at 11,457 and all tools discoverable by exact name.
- Run `npm run check` and `npm test` after product code changes.
- Do not infer real-world query frequency or retrieval quality from this synthetic suite.

## What's Been Tried
- Direct/context optimization remains at 11,457 bytes versus a 42,947-byte codemode baseline, with 16 direct tools and 68 deferred tools.
- Baseline semantic search: calibration recall 87.5% (7/8), holdout recall 75% (6/8), and exact-name coverage 100% (68/68).
- The calibration miss is `screenshot_diff`: the query asks to compare a page visually with a saved reference, while its description uses baseline terminology. Holdout misses are `network_rules` and `lighthouse`; they remain untouched and will only serve as a regression check.
