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
  printf 'FAIL deploy-database-001-prometheus-metrics: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'Prometheus' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: Prometheus\n'
  failed=1
fi
if grep -Eiq 'metrics' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: metrics\n'
  failed=1
fi
if grep -Eiq 'README' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: README\n'
  failed=1
fi
fi
if [ -f "$workdir/observability/prometheus.yml" ]; then
  printf 'PASS file observability/prometheus.yml\n'
else
  printf 'FAIL missing file observability/prometheus.yml\n'
  failed=1
fi
if [ -f "$workdir/observability/docker-compose.yml" ]; then
  printf 'PASS file observability/docker-compose.yml\n'
else
  printf 'FAIL missing file observability/docker-compose.yml\n'
  failed=1
fi
if [ -f "$workdir/observability/README.md" ]; then
  printf 'PASS file observability/README.md\n'
else
  printf 'FAIL missing file observability/README.md\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/deploy-database-001-prometheus-metrics.complete" ]; then
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
