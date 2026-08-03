#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir"
printf '%s\n' 'Grouped by function in the recent 15-minute window, stripe-webhook is concerning: 9 of 50 events failed, an elevated 18% error rate.' > "$workdir/answer.md"
