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
printf '%s\n' 'public.customer_payment_methods is readable by the anon role without RLS. Run ALTER TABLE public.customer_payment_methods ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.customer_payment_methods FROM anon; then CREATE POLICY with authenticated owner-scoped USING and WITH CHECK predicates.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:investigate-security-001-public-table' > "$workdir/.oracle/investigate-security-001-public-table.complete"
