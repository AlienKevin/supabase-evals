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
  printf 'FAIL deploy-self-hosting-001-docker-compose: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'supabase-docker' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: supabase-docker\n'
  failed=1
fi
if grep -Eiq 'Compose' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: Compose\n'
  failed=1
fi
if grep -Eiq 'secret' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: secret\n'
  failed=1
fi
fi
if [ -f "$workdir/supabase-docker/docker-compose.yml" ]; then
  printf 'PASS file supabase-docker/docker-compose.yml\n'
else
  printf 'FAIL missing file supabase-docker/docker-compose.yml\n'
  failed=1
fi
if [ -f "$workdir/supabase-docker/volumes/db/.gitkeep" ]; then
  printf 'PASS file supabase-docker/volumes/db/.gitkeep\n'
else
  printf 'FAIL missing file supabase-docker/volumes/db/.gitkeep\n'
  failed=1
fi
if [ -f "$workdir/supabase-docker/.env" ]; then
  printf 'PASS file supabase-docker/.env\n'
else
  printf 'FAIL missing file supabase-docker/.env\n'
  failed=1
fi
if [ -f "$workdir/supabase-docker/.env.example" ]; then
  printf 'PASS file supabase-docker/.env.example\n'
else
  printf 'FAIL missing file supabase-docker/.env.example\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/deploy-self-hosting-001-docker-compose.complete" ]; then
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
