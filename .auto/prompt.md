# Autoresearch: Validate Tool Discovery description generalization

## Objective
Check whether the accepted `screenshot_diff` description improvement retrieves the tool for varied visual-comparison requests, beyond the single calibration phrase that motivated the change. This is a one-shot generalization evaluation; do not modify descriptions or query phrasing based on its result.

## Metrics
- **Primary**: `screenshot_diff_generalization_recall_pct` (%, higher is better) — share of a newly held-out set of eight visual-comparison intents where Pi's actual BM25 `tool_search`, with default limit 8, loads `screenshot_diff`.
- **Secondary**: `discovery_calibration_recall_pct`, `discovery_holdout_recall_pct`, `discovery_exact_name_coverage_pct`, `native_initial_context_bytes`, `native_direct_tool_count`, `discoverable_tool_count`.

The new generalization set is distinct from the fixed calibration/holdout suite and is used once as evaluation only. These synthetic queries are not production telemetry and must not be used to tune descriptions.

## How to Run
`./.auto/measure.sh` — starts the MCP server in an isolated temporary agent directory, measures the live tool declarations, and runs all query suites through Pi's installed `tool_search` implementation. It resets the active tool set before every query, prints missed matches, and checks exact-name retrieval for all deferred tools. `.auto/checks.sh` runs `npm run check` and `npm test` after a passing measurement.

## Files in Scope
- `.auto/screenshot-diff-generalization.json` — fixed, one-shot generalization queries.
- `.auto/discovery-evaluation.json` — previous calibration and holdout queries, unchanged.
- `.auto/measure.mjs` — actual Pi Tool Search evaluation.
- `.auto/prompt.md`, `.auto/ideas.md`, and `.auto/log.jsonl` — experiment record.
- No product files are in scope for this evaluation.

## Off Limits
Do not change `server/advanced-tools.js`, the query sets, Direct Tool membership, tool implementations, permissions, confirmations, or broker behavior. Do not treat the synthetic recall score as evidence of actual user query frequency.

## Constraints
- Preserve the 16 direct and 68 deferred tools.
- Keep calibration at 100%, holdout at 75% or better, exact-name coverage at 100%, and initial context at 11,457 bytes.
- Report the generalization result without tuning against this query set.
- Run the existing correctness checks after a passing benchmark.

## What's Been Tried
- Initial context remains 11,457 bytes versus a 42,947-byte codemode baseline; 16 tools are direct and 68 are deferred.
- `screenshot_diff` wording was improved using only its calibration miss; calibration recall rose from 87.5% to 100%, while the untouched holdout stayed at 75% and exact-name coverage stayed at 100%.
- This iteration tests whether that description change generalizes to different visual-comparison phrasing. It is evaluation only; no follow-up tuning on this set is allowed.
