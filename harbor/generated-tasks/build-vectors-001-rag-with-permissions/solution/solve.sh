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
printf '%s\n' 'Added the vector column, HNSW search index, operator-compatible search path, and owner RLS for confidential documents.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' '
create extension if not exists vector with schema extensions;
alter table public.documents enable row level security;
alter table public.document_sections add column if not exists embedding extensions.vector(384);
alter table public.document_sections enable row level security;
drop policy if exists "owners read documents" on public.documents;
drop policy if exists "owners read sections" on public.document_sections;
create policy "owners read documents" on public.documents for select to authenticated
  using (owner_id = auth.uid());
create policy "owners read sections" on public.document_sections for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_sections.document_id and d.owner_id = auth.uid()
  ));
create index if not exists document_sections_embedding_hnsw
  on public.document_sections using hnsw (embedding vector_cosine_ops);
create or replace function public.match_document_sections(
  query_embedding extensions.vector(384), match_count integer
)
returns table (id bigint, document_id bigint, content text, similarity real)
language sql stable as $$
  select s.id, s.document_id, s.content,
    (1 - (s.embedding <=> query_embedding))::real as similarity
  from public.document_sections s
  join public.documents d on d.id = s.document_id
  where s.embedding is not null
  order by s.embedding <=> query_embedding
  limit match_count;
$$;
')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' '
create extension if not exists vector with schema extensions;
alter table public.documents enable row level security;
alter table public.document_sections add column if not exists embedding extensions.vector(384);
alter table public.document_sections enable row level security;
drop policy if exists "owners read documents" on public.documents;
drop policy if exists "owners read sections" on public.document_sections;
create policy "owners read documents" on public.documents for select to authenticated
  using (owner_id = auth.uid());
create policy "owners read sections" on public.document_sections for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_sections.document_id and d.owner_id = auth.uid()
  ));
create index if not exists document_sections_embedding_hnsw
  on public.document_sections using hnsw (embedding vector_cosine_ops);
create or replace function public.match_document_sections(
  query_embedding extensions.vector(384), match_count integer
)
returns table (id bigint, document_id bigint, content text, similarity real)
language sql stable as $$
  select s.id, s.document_id, s.content,
    (1 - (s.embedding <=> query_embedding))::real as similarity
  from public.document_sections s
  join public.documents d on d.id = s.document_id
  where s.embedding is not null
  order by s.embedding <=> query_embedding
  limit match_count;
$$;
' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:build-vectors-001-rag-with-permissions' > "$workdir/.oracle/build-vectors-001-rag-with-permissions.complete"
