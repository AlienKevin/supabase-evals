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
printf '%s\n' 'Audited private-notes and deployed a fix that keeps the service-role path privileged while enforcing user ownership on the user path.' > "$workdir/answer.md"

function_dir="$workdir/supabase/functions/private-notes"
mkdir -p "$function_dir"
printf '%s\n' 'import { createClient } from '"'"'npm:@supabase/supabase-js@2'"'"';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' },
});
Deno.serve(async (request) => {
  if (request.method !== '"'"'GET'"'"') return json({ error: '"'"'GET required'"'"' }, 405);
  const authorization = request.headers.get('"'"'authorization'"'"');
  if (!authorization) return json({ error: '"'"'missing authorization'"'"' }, 401);
  const supabase = createClient(
    Deno.env.get('"'"'SUPABASE_URL'"'"'), Deno.env.get('"'"'SUPABASE_ANON_KEY'"'"'),
    { global: { headers: { Authorization: authorization } } },
  );
  const { data, error } = await supabase.from('"'"'private_notes'"'"').select('"'"'*'"'"').order('"'"'created_at'"'"');
  if (error) return json({ error: error.message }, 500);
  return json(data ?? []);
});' > "$function_dir/index.ts"
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  metadata_path="$workdir/.oracle/private-notes.metadata.json"
  printf '%s\n' '{"name":"private-notes","entrypoint_path":"index.ts","verify_jwt":true}' > "$metadata_path"
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/functions/deploy?slug=private-notes" \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    -F "metadata=<${metadata_path};type=application/json" \
    -F "file=@${function_dir}/index.ts;filename=index.ts;type=application/typescript" >/dev/null
fi
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:build-functions-004-service-role-bypass' > "$workdir/.oracle/build-functions-004-service-role-bypass.complete"
