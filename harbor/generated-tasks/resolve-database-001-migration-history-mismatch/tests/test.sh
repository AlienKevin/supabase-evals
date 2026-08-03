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
  printf 'FAIL resolve-database-001-migration-history-mismatch: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'migration' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: migration\n'
  failed=1
fi
if grep -Eiq 'profile' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: profile\n'
  failed=1
fi
if grep -Eiq '25' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: 25\n'
  failed=1
fi
if grep -Eiq 'avatar' "$answer"; then
  printf 'PASS answer check 4\n'
else
  printf 'FAIL answer check 4: avatar\n'
  failed=1
fi
fi
if [ -f "$workdir/supabase/migrations/20240115000000_add_profile_bio.sql" ]; then
  printf 'PASS file supabase/migrations/20240115000000_add_profile_bio.sql\n'
else
  printf 'FAIL missing file supabase/migrations/20240115000000_add_profile_bio.sql\n'
  failed=1
fi
if [ -f "$workdir/supabase/migrations/20240220000000_add_avatar_url.sql" ]; then
  printf 'PASS file supabase/migrations/20240220000000_add_avatar_url.sql\n'
else
  printf 'FAIL missing file supabase/migrations/20240220000000_add_avatar_url.sql\n'
  failed=1
fi
if [ -f "$workdir/supabase/migration-repair.txt" ]; then
  printf 'PASS file supabase/migration-repair.txt\n'
else
  printf 'FAIL missing file supabase/migration-repair.txt\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/resolve-database-001-migration-history-mismatch.complete" ]; then
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
