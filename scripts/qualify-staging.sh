#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
exec node scripts/qualify-staging.mjs "$@"
