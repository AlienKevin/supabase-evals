#!/usr/bin/env bash
set -u

if [ "${HARBOR_SOURCE_SCORER:-0}" = "1" ]; then
  /usr/local/bin/supabase-harbor-sync
  sleep 2
  exec node --import /opt/source-runtime/node_modules/tsx/dist/loader.mjs /opt/source-runtime/run-source-scorer.mjs
fi


workdir="${HARBOR_WORKDIR:-/app}"
logs_dir="${HARBOR_LOGS_DIR:-/logs}/verifier"
answer="$workdir/answer.md"
mkdir -p "$logs_dir"
failed=0

if [ ! -f "$answer" ]; then
  printf 'FAIL investigate-db-001-table-row-counts: answer.md is missing\n'
  failed=1
else
  if grep -Eiq 'users.{0,80}12' "$answer"; then
    printf 'PASS check 1\n'
  else
    printf 'FAIL check 1: users.{0,80}12\n'
    failed=1
  fi
  
  if grep -Eiq 'orders.{0,80}87' "$answer"; then
    printf 'PASS check 2\n'
  else
    printf 'FAIL check 2: orders.{0,80}87\n'
    failed=1
  fi
  
  if grep -Eiq 'events.{0,80}453' "$answer"; then
    printf 'PASS check 3\n'
  else
    printf 'FAIL check 3: events.{0,80}453\n'
    failed=1
  fi
fi

if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
