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
  printf 'FAIL investigate-reliability-002-subtle-error-spike: answer.md is missing\n'
  failed=1
else
  if grep -Eiq 'stripe-webhook' "$answer"; then
    printf 'PASS check 1\n'
  else
    printf 'FAIL check 1: stripe-webhook\n'
    failed=1
  fi
  
  if grep -Eiq '(last 15|recent|window|per-function|by function|grouped by function)' "$answer"; then
    printf 'PASS check 2\n'
  else
    printf 'FAIL check 2: (last 15|recent|window|per-function|by function|grouped by function)\n'
    failed=1
  fi
  
  if grep -Eiq '(18%|0\.18|9 ?/ ?50|spike|elevated|abnormal|concerning|high error rate)' "$answer"; then
    printf 'PASS check 3\n'
  else
    printf 'FAIL check 3: (18%|0\.18|9 ?/ ?50|spike|elevated|abnormal|concerning|high error rate)\n'
    failed=1
  fi
fi

if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
