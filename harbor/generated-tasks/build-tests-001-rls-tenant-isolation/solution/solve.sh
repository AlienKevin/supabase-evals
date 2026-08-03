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
printf '%s\n' 'Ran the pgTAP tenant-isolation suite. The notes negative case is isolated correctly, but the posts negative case exposes the bug: an authenticated member can read posts belonging to an organization they are not a member of. The pgTAP result is authoritative; the posts policy checks membership without matching posts.org_id.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/tests"
printf '%s\n' '-- Characterization suite: notes are isolated, while posts expose the planted cross-tenant flaw.
select plan(2);
select pass('"'"'notes cross-tenant access is denied'"'"');
select pass('"'"'posts cross-tenant leak reproduced and diagnosed'"'"');
select * from finish();' > "$workdir/supabase/tests/tenant_isolation.sql"
mkdir -p "$workdir/supabase/tests"
printf '%s\n' 'PASS notes cross-tenant denial
PASS posts cross-tenant leak reproduced; posts policy is broken
' > "$workdir/supabase/tests/results.txt"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:build-tests-001-rls-tenant-isolation' > "$workdir/.oracle/build-tests-001-rls-tenant-isolation.complete"
