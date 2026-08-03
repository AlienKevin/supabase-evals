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
printf '%s\n' 'image-transform had eight recurring gateway HTTP 503s across 07:00Z–12:00Z on 2026-04-28. They appear on the gateway/HTTP log surface with no corresponding invocation/runtime rows during the failures while nearby invocations succeeded, so the fault is in the Edge Functions gateway/platform layer in front of the function—not image-transform application code or a function-level 500. The deployment_id stayed unchanged, further ruling out a bad rollout. Open a platform incident with the request IDs and exact window and inspect gateway routing and Edge Functions platform health.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:investigate-reliability-003-edge-function-5xx-correlation' > "$workdir/.oracle/investigate-reliability-003-edge-function-5xx-correlation.complete"
