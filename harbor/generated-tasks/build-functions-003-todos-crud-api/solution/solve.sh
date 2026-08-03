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
printf '%s\n' 'Deployed todos-api with authenticated GET, POST, PATCH, and DELETE routes, filtering, limits, and ownership checks.' > "$workdir/answer.md"

function_dir="$workdir/supabase/functions/todos-api"
mkdir -p "$function_dir"
printf '%s\n' 'import { createClient } from '"'"'npm:@supabase/supabase-js@2'"'"';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async (request) => {
  const authorization = request.headers.get('"'"'authorization'"'"');
  if (!authorization) return json({ error: '"'"'missing authorization'"'"' }, 401);
  const supabase = createClient(
    Deno.env.get('"'"'SUPABASE_URL'"'"'), Deno.env.get('"'"'SUPABASE_ANON_KEY'"'"'),
    { global: { headers: { Authorization: authorization } } },
  );
  const url = new URL(request.url);
  const parts = url.pathname.split('"'"'/'"'"').filter(Boolean);
  const id = parts[1];
  if (request.method === '"'"'GET'"'"') {
    const rawLimit = url.searchParams.get('"'"'limit'"'"');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json({ error: '"'"'invalid limit'"'"' }, 400);
    let query = supabase.from('"'"'todos'"'"').select('"'"'*'"'"');
    const done = url.searchParams.get('"'"'done'"'"');
    if (done !== null) {
      if (done !== '"'"'true'"'"' && done !== '"'"'false'"'"') return json({ error: '"'"'invalid done'"'"' }, 400);
      query = query.eq('"'"'done'"'"', done === '"'"'true'"'"');
    }
    query = query.order('"'"'created_at'"'"', { ascending: true }).limit(limit);
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    return json({ todos: data ?? [] });
  }
  if (request.method === '"'"'POST'"'"') {
    let input;
    try { input = await request.json(); } catch { return json({ error: '"'"'invalid JSON'"'"' }, 400); }
    if (!input || typeof input.body !== '"'"'string'"'"' || !input.body.trim() ||
        (input.done !== undefined && typeof input.done !== '"'"'boolean'"'"')) return json({ error: '"'"'invalid todo'"'"' }, 400);
    const { data, error } = await supabase.from('"'"'todos'"'"').insert({ body: input.body, done: input.done ?? false }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ todo: data }, 201);
  }
  if (request.method === '"'"'PATCH'"'"' || request.method === '"'"'DELETE'"'"') {
    if (!id || !UUID.test(id)) return json({ error: '"'"'invalid UUID'"'"' }, 400);
    if (request.method === '"'"'DELETE'"'"') {
      const { data, error } = await supabase.from('"'"'todos'"'"').delete().eq('"'"'id'"'"', id).select('"'"'id'"'"');
      if (error) return json({ error: error.message }, 500);
      if (!data || data.length === 0) return json({ error: '"'"'not found'"'"' }, 404);
      return json({ deleted: true });
    }
    let input;
    try { input = await request.json(); } catch { return json({ error: '"'"'invalid JSON'"'"' }, 400); }
    if (!input || typeof input !== '"'"'object'"'"') return json({ error: '"'"'invalid todo'"'"' }, 400);
    const keys = Object.keys(input);
    if (keys.length === 0 || keys.some((key) => key !== '"'"'body'"'"' && key !== '"'"'done'"'"') ||
        (input.body !== undefined && (typeof input.body !== '"'"'string'"'"' || !input.body.trim())) ||
        (input.done !== undefined && typeof input.done !== '"'"'boolean'"'"')) return json({ error: '"'"'invalid todo'"'"' }, 400);
    const { data, error } = await supabase.from('"'"'todos'"'"').update(input).eq('"'"'id'"'"', id).select().maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: '"'"'not found'"'"' }, 404);
    return json({ todo: data });
  }
  return json({ error: '"'"'method not allowed'"'"' }, 405);
});' > "$function_dir/index.ts"
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  metadata_path="$workdir/.oracle/todos-api.metadata.json"
  printf '%s\n' '{"name":"todos-api","entrypoint_path":"index.ts","verify_jwt":true}' > "$metadata_path"
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/functions/deploy?slug=todos-api" \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    -F "metadata=<${metadata_path};type=application/json" \
    -F "file=@${function_dir}/index.ts;filename=index.ts;type=application/typescript" >/dev/null
fi
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:build-functions-003-todos-crud-api' > "$workdir/.oracle/build-functions-003-todos-crud-api.complete"
