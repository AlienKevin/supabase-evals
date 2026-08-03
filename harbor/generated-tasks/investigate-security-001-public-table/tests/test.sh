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
  printf 'FAIL investigate-security-001-public-table: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'customer_payment_methods' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: customer_payment_methods\n'
  failed=1
fi
if grep -Eiq 'anon' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: anon\n'
  failed=1
fi
if grep -Eiq 'RLS' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: RLS\n'
  failed=1
fi
if grep -Eiq 'REVOKE' "$answer"; then
  printf 'PASS answer check 4\n'
else
  printf 'FAIL answer check 4: REVOKE\n'
  failed=1
fi
fi

if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/investigate-security-001-public-table.complete" ]; then
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
