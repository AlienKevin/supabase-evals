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
printf '%s\n' 'Do not use pause plus restore/resume as the first recovery step for an unhealthy project. Restart or reboot first for transient service trouble; restore is backup/data recovery, not a restart. Check logs, advisors, and resource pressure, reduce workload or scale if overloaded, follow the unhealthy-services guidance, and contact Supabase support if the project remains unhealthy.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:resolve-reliability-001-unhealthy-project-recovery' > "$workdir/.oracle/resolve-reliability-001-unhealthy-project-recovery.complete"
