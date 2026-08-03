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
  printf 'FAIL investigate-logs-001-top-error-function: answer.md is missing\n'
  failed=1
else
  if grep -Eiq 'stripe-webhook' "$answer"; then
    printf 'PASS check 1\n'
  else
    printf 'FAIL check 1: stripe-webhook\n'
    failed=1
  fi
  
  if grep -Eiq '(^|[^0-9])9([^0-9]|$)' "$answer"; then
    printf 'PASS check 2\n'
  else
    printf 'FAIL check 2: (^|[^0-9])9([^0-9]|$)\n'
    failed=1
  fi
  
  if grep -Eiq '(^|[^0-9])50([^0-9]|$)' "$answer"; then
    printf 'PASS check 3\n'
  else
    printf 'FAIL check 3: (^|[^0-9])50([^0-9]|$)\n'
    failed=1
  fi
fi

if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
