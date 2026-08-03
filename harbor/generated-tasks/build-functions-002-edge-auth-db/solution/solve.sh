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
printf '%s\n' 'Deployed todo-create with forwarded Authorization, Supabase client insertion, and structured validation errors.' > "$workdir/answer.md"

function_dir="$workdir/supabase/functions/todo-create"
mkdir -p "$function_dir"
printf '%s\n' 'import { createClient } from '"'"'npm:@supabase/supabase-js@2'"'"';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' },
});
Deno.serve(async (request) => {
  if (request.method !== '"'"'POST'"'"') return json({ error: '"'"'POST required'"'"' }, 405);
  const authorization = request.headers.get('"'"'authorization'"'"');
  if (!authorization) return json({ error: '"'"'missing authorization'"'"' }, 401);
  let input;
  try { input = await request.json(); } catch { return json({ error: '"'"'invalid JSON'"'"' }, 400); }
  if (!input || typeof input.body !== '"'"'string'"'"' || !input.body.trim()) {
    return json({ error: '"'"'body is required'"'"' }, 400);
  }
  const supabase = createClient(
    Deno.env.get('"'"'SUPABASE_URL'"'"'), Deno.env.get('"'"'SUPABASE_ANON_KEY'"'"'),
    { global: { headers: { Authorization: authorization } } },
  );
  const { data, error } = await supabase.from('"'"'todos'"'"').insert({ body: input.body }).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ todo: data }, 201);
});' > "$function_dir/index.ts"
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  metadata_path="$workdir/.oracle/todo-create.metadata.json"
  printf '%s\n' '{"name":"todo-create","entrypoint_path":"index.ts","verify_jwt":true}' > "$metadata_path"
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/functions/deploy?slug=todo-create" \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    -F "metadata=<${metadata_path};type=application/json" \
    -F "file=@${function_dir}/index.ts;filename=index.ts;type=application/typescript" >/dev/null
fi
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:build-functions-002-edge-auth-db' > "$workdir/.oracle/build-functions-002-edge-auth-db.complete"
