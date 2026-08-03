#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir/.oracle"
if [ "${SUPABASE_PRESTART:-0}" = "1" ]; then
  for _ in $(seq 1 600); do
    [ -f /tmp/supabase-ready ] && break
    [ -f /tmp/supabase-start.failed ] && { cat /tmp/supabase-start.log >&2; exit 1; }
    sleep 1
  done
  [ -f /tmp/supabase-ready ] || { cat /tmp/supabase-start.log >&2 2>/dev/null || true; exit 1; }
fi
printf '%s\n' 'Created supabase-docker with Compose services, rotated placeholder secrets, and documented the VPS bring-up.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase-docker"
printf '%s\n' 'services:
  db:
    image: supabase/postgres:17.4.1.066
    volumes: ["./volumes/db:/var/lib/postgresql/data"]
  api:
    image: supabase/postgrest:v13.0.7
    depends_on: [db]
' > "$workdir/supabase-docker/docker-compose.yml"
mkdir -p "$workdir/supabase-docker/volumes/db"
printf '%s\n' '' > "$workdir/supabase-docker/volumes/db/.gitkeep"
mkdir -p "$workdir/supabase-docker"
printf '%s\n' 'POSTGRES_PASSWORD=harbor-postgres-password-2026
JWT_SECRET=harbor-oracle-jwt-secret-2026-at-least-32-chars
DASHBOARD_PASSWORD=harbor-dashboard-password-2026
VAULT_ENC_KEY=harbor-vault-encryption-key-2026
PG_META_CRYPTO_KEY=harbor-pg-meta-crypto-key-2026
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcwMDAwMDAwLCJleHAiOjIwODUzNjAwMDB9.KpIqXwEA-1ZK4qp1DoXxgd1MbZajqsZlZBHr6R9CU0Q
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzAwMDAwMDAsImV4cCI6MjA4NTM2MDAwMH0.qxIiZ_punpy7WpXq2aqQLNsEF6FnexCpYaLQfs24pm8
' > "$workdir/supabase-docker/.env"
mkdir -p "$workdir/supabase-docker"
printf '%s\n' 'POSTGRES_PASSWORD=replace-me
JWT_SECRET=replace-me
ANON_KEY=replace-me
SERVICE_ROLE_KEY=replace-me
' > "$workdir/supabase-docker/.env.example"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:deploy-self-hosting-001-docker-compose' > "$workdir/.oracle/deploy-self-hosting-001-docker-compose.complete"
