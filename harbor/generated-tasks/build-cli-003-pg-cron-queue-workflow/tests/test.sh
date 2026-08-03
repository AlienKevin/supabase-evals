#!/usr/bin/env bash
set -u

if [ "${HARBOR_SOURCE_SCORER:-0}" = "1" ]; then
  /usr/local/bin/supabase-harbor-sync
  sleep 2
  exec node --import /opt/source-runtime/node_modules/tsx/dist/loader.mjs /opt/source-runtime/run-source-scorer.mjs
fi


workdir="${HARBOR_WORKDIR:-/app}"
logs_dir="${HARBOR_LOGS_DIR:-/logs}/verifier"
mkdir -p "$logs_dir"
failed=0
answer="$workdir/answer.md"
if [ ! -f "$answer" ]; then
  printf 'FAIL build-cli-003-pg-cron-queue-workflow: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'enqueue-tasks' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: enqueue-tasks\n'
  failed=1
fi
if grep -Eiq 'tasks' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: tasks\n'
  failed=1
fi
if grep -Eiq 'process-tasks' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: process-tasks\n'
  failed=1
fi
fi
migration_found=0
for migration in "$workdir"/supabase/migrations/*.sql; do
  [ -f "$migration" ] || continue
  if grep -Eiq 'cron\.schedule|enqueue-tasks' "$migration" && grep -Eiq 'tasks|queue' "$migration"; then
    migration_found=1
    break
  fi
done
if [ "$migration_found" -eq 1 ]; then
  printf 'PASS enqueue-tasks migration (timestamp-independent)\n'
else
  printf 'FAIL enqueue-tasks migration not found\n'
  failed=1
fi
if [ -f "$workdir/supabase/functions/process-tasks/index.ts" ]; then
  printf 'PASS file supabase/functions/process-tasks/index.ts\n'
else
  printf 'FAIL missing file supabase/functions/process-tasks/index.ts\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/build-cli-003-pg-cron-queue-workflow.complete" ]; then
  printf 'PASS source-derived Oracle marker\n'
else
  printf 'FAIL source-derived Oracle marker\n'
  failed=1
fi
if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
