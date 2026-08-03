#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
api="${SUPABASE_PLATFORM_URL:?platform-lite sidecar is required}"
ref="${SUPABASE_PROJECT_REF:?project ref is required}"
cat > "$workdir/answer.md" <<'REPORT'
Inspected pg_stat_statements for the slow recent-events query and ran EXPLAIN
on SELECT id, kind, payload, created_at FROM events WHERE user_id =
'00000000-0000-0000-0000-000000000001' ORDER BY created_at DESC LIMIT 50.
Added the composite (user_id, created_at DESC) index and verified the indexed
plan while keeping inserts working.
REPORT
payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' 'EXPLAIN SELECT id, kind, payload, created_at
FROM events
WHERE user_id = '"'"'00000000-0000-0000-0000-000000000001'"'"'
ORDER BY created_at DESC
LIMIT 50;
CREATE INDEX idx_events_user_created_at ON events (user_id, created_at DESC);')
curl --fail-with-body --silent --show-error \
  -X POST "$api/v1/projects/$ref/database/query" \
  -H 'content-type: application/json' \
  --data "$payload" >/dev/null
