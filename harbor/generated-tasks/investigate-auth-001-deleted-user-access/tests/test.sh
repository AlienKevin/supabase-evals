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
  printf 'FAIL investigate-auth-001-deleted-user-access: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'soft[- ]delete|deleted profile|profile.*delete' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: soft[- ]delete|deleted profile|profile.*delete\n'
  failed=1
fi
if grep -Eiq 'revoke|delete.*auth' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: revoke|delete.*auth\n'
  failed=1
fi
if grep -Eiq 'JWT' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: JWT\n'
  failed=1
fi
if grep -Eiq 'expiry|exp' "$answer"; then
  printf 'PASS answer check 4\n'
else
  printf 'FAIL answer check 4: expiry|exp\n'
  failed=1
fi
fi

if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/investigate-auth-001-deleted-user-access.complete" ]; then
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
