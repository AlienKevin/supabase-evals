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
printf '%s\n' 'Added a Supabase metrics scrape target to Prometheus and documented the production wiring in observability/README.md.' > "$workdir/answer.md"
mkdir -p "$workdir/observability"
printf '%s\n' 'global:
  scrape_interval: 60s

scrape_configs:
  - job_name: app
    static_configs:
      - targets: ["app:8080"]
  - job_name: supabase
    scheme: https
    metrics_path: /customer/v1/privileged/metrics
    basic_auth:
      username: service_role
      password_file: /run/secrets/supabase_metrics_key
    static_configs:
      - targets: ["<project-ref>.supabase.co"]
' > "$workdir/observability/prometheus.yml"
mkdir -p "$workdir/observability"
printf '%s\n' 'services:
  prometheus:
    image: prom/prometheus:v3.7.3
    ports: ["9090:9090"]
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./secrets/supabase_metrics_key:/run/secrets/supabase_metrics_key:ro
    command: ["--config.file=/etc/prometheus/prometheus.yml", "--web.enable-lifecycle"]
  grafana:
    image: grafana/grafana:12.3.0
    ports: ["3000:3000"]
    depends_on: [prometheus]
' > "$workdir/observability/docker-compose.yml"
mkdir -p "$workdir/observability"
printf '%s\n' '# Observability Stack

The existing app target remains configured. Replace <project-ref> in prometheus.yml with the hosted project ref. Create a Supabase Secret API key in the dashboard, put only its value in observability/secrets/supabase_metrics_key, and never commit that file. Then run docker compose -f observability/docker-compose.yml up -d --force-recreate prometheus (or POST /-/reload after updating config). In Prometheus, open Status > Targets and confirm the supabase job is UP; verify with PromQL up{job="supabase"} and add the same query to Grafana. The endpoint uses HTTPS Basic Auth at /customer/v1/privileged/metrics; it is not bearer auth.
' > "$workdir/observability/README.md"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:deploy-database-001-prometheus-metrics' > "$workdir/.oracle/deploy-database-001-prometheus-metrics.complete"
