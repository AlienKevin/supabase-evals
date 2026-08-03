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
printf '%s\n' 'video-thumbnails returned HTTP 546 resource-limit failures in 5 of 12 calls. The shutdown log explicitly reports reason CPUTime with cpu_time_used 2000ms equal to the 2000ms isolate CPU ceiling, so this is CPU exhaustion rather than memory, wall-clock timeout, or the unrelated welcome-email 500. Reduce CPU work by optimizing or chunking thumbnail generation, or offload it to a background job or external service; the fixed isolate limit cannot be raised.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:investigate-functions-001-546-resource-limit' > "$workdir/.oracle/investigate-functions-001-546-resource-limit.complete"
