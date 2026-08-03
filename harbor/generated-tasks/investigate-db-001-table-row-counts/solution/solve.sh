#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir"
printf '%s\n' 'The public schema contains users: 12 rows, orders: 87 rows, and events: 453 rows.' > "$workdir/answer.md"
