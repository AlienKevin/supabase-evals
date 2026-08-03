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
printf '%s\n' 'Created storage.buckets row user-files with public = false and kept RLS enabled on storage.objects. Added authenticated SELECT USING and INSERT WITH CHECK policies restricted to bucket_id = '"'"'user-files'"'"' and (storage.foldername(name))[1] = auth.uid()::text. The client shares a file only with await supabase.storage.from('"'"'user-files'"'"').createSignedUrl(path, 300), producing a five-minute URL; it never uses getPublicUrl or a service-role key.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' '
insert into storage.buckets (id, name, public)
values ('"'"'user-files'"'"', '"'"'user-files'"'"', false)
on conflict (id) do update
set name = excluded.name,
    public = false;
drop policy if exists "Users can upload own user files" on storage.objects;
drop policy if exists "Users can download own user files" on storage.objects;
create policy "Users can upload own user files"
on storage.objects
for insert to authenticated
with check (
  bucket_id = '"'"'user-files'"'"'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy "Users can download own user files"
on storage.objects
for select to authenticated
using (
  bucket_id = '"'"'user-files'"'"'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' '
insert into storage.buckets (id, name, public)
values ('"'"'user-files'"'"', '"'"'user-files'"'"', false)
on conflict (id) do update
set name = excluded.name,
    public = false;
drop policy if exists "Users can upload own user files" on storage.objects;
drop policy if exists "Users can download own user files" on storage.objects;
create policy "Users can upload own user files"
on storage.objects
for insert to authenticated
with check (
  bucket_id = '"'"'user-files'"'"'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy "Users can download own user files"
on storage.objects
for select to authenticated
using (
  bucket_id = '"'"'user-files'"'"'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:build-storage-001-private-bucket-access' > "$workdir/.oracle/build-storage-001-private-bucket-access.complete"
