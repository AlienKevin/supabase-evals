#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir"
printf '%s\n' 'process-payment has an elevated 15% error rate (3 errors out of 20 events). This spike is concerning; investigate recent traces and consider rollback or mitigation.' > "$workdir/answer.md"
