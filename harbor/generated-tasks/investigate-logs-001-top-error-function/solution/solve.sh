#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir"
printf '%s\n' 'stripe-webhook has the most errors in the last 15 minutes: 9 errors across 50 total events.' > "$workdir/answer.md"
