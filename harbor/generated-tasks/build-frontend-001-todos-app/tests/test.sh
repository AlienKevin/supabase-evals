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
  printf 'FAIL build-frontend-001-todos-app: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'Supabase' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: Supabase\n'
  failed=1
fi
if grep -Eiq 'sign-in' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: sign-in\n'
  failed=1
fi
if grep -Eiq 'todos' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: todos\n'
  failed=1
fi
if grep -Eiq 'updates' "$answer"; then
  printf 'PASS answer check 4\n'
else
  printf 'FAIL answer check 4: updates\n'
  failed=1
fi
fi
if [ -f "$workdir/src/supabase.ts" ]; then
  printf 'PASS file src/supabase.ts\n'
else
  printf 'FAIL missing file src/supabase.ts\n'
  failed=1
fi
if [ -f "$workdir/src/App.tsx" ]; then
  printf 'PASS file src/App.tsx\n'
else
  printf 'FAIL missing file src/App.tsx\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/build-frontend-001-todos-app.complete" ]; then
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
