#!/usr/bin/env bash
set -euo pipefail
check_log=$(mktemp)
trap 'rm -f "$check_log"' EXIT
if ! npm run check >"$check_log" 2>&1; then
  tail -80 "$check_log"
  exit 1
fi
if ! npm test >"$check_log" 2>&1; then
  tail -80 "$check_log"
  exit 1
fi
