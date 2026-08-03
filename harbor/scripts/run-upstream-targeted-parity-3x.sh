#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${UPSTREAM_PARITY_OUT:-$ROOT/targeted-parity-3x/upstream}"

cd "$ROOT"

for run in 1 2 3; do
  run_label="$(printf '%02d' "$run")"
  run_dir="$OUT/run-$run_label"
  mkdir -p "$run_dir/skills" "$run_dir/noskills" "$run_dir/cli002-diagnostic"

  pnpm dlx pnpm@10.24.0 eval -- \
    --experiment codex-gpt-5.6 \
    --eval build-cli-003-pg-cron-queue-workflow \
    --eval investigate-auth-001-deleted-user-access \
    --concurrency 1 \
    --timeout-sec 720

  cp results/codex-gpt-5.6/build-cli-003-pg-cron-queue-workflow.json "$run_dir/skills/"
  cp results/codex-gpt-5.6/investigate-auth-001-deleted-user-access.json "$run_dir/skills/"

  pnpm dlx pnpm@10.24.0 eval -- \
    --experiment codex-gpt-5.6-no-skills \
    --eval build-cli-002-declarative-schema \
    --eval build-cli-003-pg-cron-queue-workflow \
    --eval investigate-realtime-001-subscribed-no-events \
    --eval build-functions-005-dual-auth-user-secret \
    --eval investigate-auth-001-deleted-user-access \
    --concurrency 1 \
    --timeout-sec 720

  cp results/codex-gpt-5.6-no-skills/build-cli-003-pg-cron-queue-workflow.json "$run_dir/noskills/"
  cp results/codex-gpt-5.6-no-skills/investigate-realtime-001-subscribed-no-events.json "$run_dir/noskills/"
  cp results/codex-gpt-5.6-no-skills/build-functions-005-dual-auth-user-secret.json "$run_dir/noskills/"
  cp results/codex-gpt-5.6-no-skills/investigate-auth-001-deleted-user-access.json "$run_dir/noskills/"
  cp results/codex-gpt-5.6-no-skills/build-cli-002-declarative-schema.json "$run_dir/cli002-diagnostic/"
done
