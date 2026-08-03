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
  printf 'FAIL investigate-realtime-001-subscribed-no-events: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'orders' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: orders\n'
  failed=1
fi
if grep -Eiq 'supabase_realtime' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: supabase_realtime\n'
  failed=1
fi
if grep -Eiq 'RLS|row[- ]level security|polic' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: RLS|row[- ]level security|polic\n'
  failed=1
fi
fi

if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/investigate-realtime-001-subscribed-no-events.complete" ]; then
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
