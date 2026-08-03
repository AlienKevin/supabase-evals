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
printf '%s\n' 'Built user-stats with a verified user-token path and a secret-key service path that requires an explicit target user.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/functions/user-stats"
printf '%s\n' 'import { withSupabase } from "npm:@supabase/server";
Deno.serve(withSupabase({ auth: ['"'"'user'"'"', '"'"'secret'"'"'] }, async (request, ctx) => {
  if (ctx.authMode === '"'"'user'"'"') {
    const { data, error } = await ctx.supabase.from('"'"'user_stats'"'"').select('"'"'*'"'"');
    return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json(data);
  }
  const body = await request.json().catch(() => ({}));
  if (!body.user_id) return Response.json({ error: '"'"'user_id required'"'"' }, { status: 400 });
  const { data, error } = await ctx.supabaseAdmin.from('"'"'user_stats'"'"').select('"'"'*'"'"').eq('"'"'user_id'"'"', body.user_id);
  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json(data);
}));' > "$workdir/supabase/functions/user-stats/index.ts"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
grep -q '^\[functions.user-stats\]' "$workdir/supabase/config.toml" || printf '\n[functions.user-stats]\nverify_jwt = false\n' >> "$workdir/supabase/config.toml"
(cd "$workdir" && supabase stop --no-backup && supabase start)

printf '%s\n' 'oracle-complete:build-functions-005-dual-auth-user-secret' > "$workdir/.oracle/build-functions-005-dual-auth-user-secret.complete"
