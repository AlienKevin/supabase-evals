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
printf '%s\n' 'Deployed weather, stored WEATHER_API_KEY as a function secret, and kept the key out of repository source.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/functions/weather"
printf '%s\n' 'Deno.serve(async () => new Response(JSON.stringify({ keyConfigured: Boolean(Deno.env.get('"'"'WEATHER_API_KEY'"'"')) }), { headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' } }));' > "$workdir/supabase/functions/weather/index.ts"
function_dir="$workdir/supabase/functions/weather"
mkdir -p "$function_dir"
printf '%s\n' 'Deno.serve(async () => new Response(JSON.stringify({ keyConfigured: Boolean(Deno.env.get('"'"'WEATHER_API_KEY'"'"')) }), { headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' } }));' > "$function_dir/index.ts"
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  metadata_path="$workdir/.oracle/weather.metadata.json"
  printf '%s\n' '{"name":"weather","entrypoint_path":"index.ts","verify_jwt":false}' > "$metadata_path"
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/functions/deploy?slug=weather" \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    -F "metadata=<${metadata_path};type=application/json" \
    -F "file=@${function_dir}/index.ts;filename=index.ts;type=application/typescript" >/dev/null
fi
if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
(cd "$workdir" && supabase secrets set --env-file ./.env && supabase functions deploy weather)

printf '%s\n' 'oracle-complete:deploy-functions-001-edge-function-secrets' > "$workdir/.oracle/deploy-functions-001-edge-function-secrets.complete"
