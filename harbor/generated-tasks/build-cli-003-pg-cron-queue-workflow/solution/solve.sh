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
printf '%s\n' 'Configured the enqueue-tasks cron job, the tasks queue, and the process-tasks Edge Function drain workflow.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/migrations"
printf '%s\n' 'select pgmq.create('"'"'tasks'"'"');
select cron.schedule('"'"'enqueue-tasks'"'"', '"'"'* * * * *'"'"', $$select pgmq.send('"'"'tasks'"'"', '"'"'{"source":"cron"}'"'"'::jsonb)$$);' > "$workdir/supabase/migrations/20260801000000_enqueue_tasks.sql"
mkdir -p "$workdir/supabase/functions/process-tasks"
printf '%s\n' 'import { createClient } from '"'"'npm:@supabase/supabase-js@2'"'"';
Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('"'"'SUPABASE_URL'"'"')!, Deno.env.get('"'"'SUPABASE_SERVICE_ROLE_KEY'"'"')!);
  let processed = 0;
  for (;;) {
    const { data, error } = await supabase.schema('"'"'pgmq_public'"'"').rpc('"'"'pop'"'"', { queue_name: '"'"'tasks'"'"' });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' } });
    if (!data?.length) break;
    processed += data.length;
  }
  return new Response(JSON.stringify({ processed }), { headers: { '"'"'content-type'"'"': '"'"'application/json'"'"' } });
});' > "$workdir/supabase/functions/process-tasks/index.ts"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
(cd "$workdir" && supabase migration up && supabase stop --no-backup && supabase start)

printf '%s\n' 'oracle-complete:build-cli-003-pg-cron-queue-workflow' > "$workdir/.oracle/build-cli-003-pg-cron-queue-workflow.complete"
