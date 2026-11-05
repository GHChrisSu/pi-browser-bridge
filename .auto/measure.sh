#!/usr/bin/env bash
set -euo pipefail
node --check extensions/index.js
node .auto/measure.mjs
