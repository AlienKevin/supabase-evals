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
  printf 'FAIL investigate-reliability-001-error-rate-spike: answer.md is missing\n'
  failed=1
else
  if grep -Eiq 'process-payment' "$answer"; then
    printf 'PASS check 1\n'
  else
    printf 'FAIL check 1: process-payment\n'
    failed=1
  fi
  
  if grep -Eiq '(15%|0\.15|3.{0,20}(out of|/) ?20)' "$answer"; then
    printf 'PASS check 2\n'
  else
    printf 'FAIL check 2: (15%|0\.15|3.{0,20}(out of|/) ?20)\n'
    failed=1
  fi
  
  if grep -Eiq '(spike|elevated|abnormal|concerning|high error rate)' "$answer"; then
    printf 'PASS check 3\n'
  else
    printf 'FAIL check 3: (spike|elevated|abnormal|concerning|high error rate)\n'
    failed=1
  fi
  
  if grep -Eiq '(investigate|rollback|inspect|trace|mitigate|check|review)' "$answer"; then
    printf 'PASS check 4\n'
  else
    printf 'FAIL check 4: (investigate|rollback|inspect|trace|mitigate|check|review)\n'
    failed=1
  fi
fi

if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
