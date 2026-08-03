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
printf '%s\n' 'Added organization-aware document policies, soft-delete behavior, and document_audit writes for admin, editor, and viewer roles.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' '
alter table public.documents enable row level security;
alter table public.document_audit enable row level security;
drop policy if exists "documents members read active" on public.documents;
drop policy if exists "documents editors insert" on public.documents;
drop policy if exists "documents members update" on public.documents;
drop policy if exists "documents members delete" on public.documents;
create policy "documents members read active" on public.documents for select to authenticated using (
  deleted_at is null and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id
  )
);
create policy "documents editors insert" on public.documents for insert to authenticated with check (
  deleted_at is null and owner_id = auth.uid() and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id and m.role in ('"'"'admin'"'"', '"'"'editor'"'"')
  )
);
create policy "documents members update" on public.documents for update to authenticated
  using (
    deleted_at is null and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.org_id = documents.org_id
        and (m.role = '"'"'admin'"'"' or (m.role = '"'"'editor'"'"' and documents.owner_id = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.org_id = documents.org_id
        and (m.role = '"'"'admin'"'"' or (m.role = '"'"'editor'"'"' and documents.owner_id = auth.uid()))
    )
  );
create policy "documents members delete" on public.documents for delete to authenticated using (
  deleted_at is null and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id
      and (m.role = '"'"'admin'"'"' or (m.role = '"'"'editor'"'"' and documents.owner_id = auth.uid()))
  )
);
create or replace function public.audit_document_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.document_audit(document_id, actor_id, action)
  values (new.id, auth.uid(), lower(tg_op));
  return new;
end;
$$;
drop trigger if exists documents_audit_write on public.documents;
create trigger documents_audit_write after insert or update on public.documents
for each row execute function public.audit_document_write();
create or replace function public.soft_delete_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.documents set deleted_at = coalesce(deleted_at, now()) where id = old.id;
  return null;
end;
$$;
drop trigger if exists documents_soft_delete on public.documents;
create trigger documents_soft_delete before delete on public.documents
for each row execute function public.soft_delete_document();
')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' '
alter table public.documents enable row level security;
alter table public.document_audit enable row level security;
drop policy if exists "documents members read active" on public.documents;
drop policy if exists "documents editors insert" on public.documents;
drop policy if exists "documents members update" on public.documents;
drop policy if exists "documents members delete" on public.documents;
create policy "documents members read active" on public.documents for select to authenticated using (
  deleted_at is null and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id
  )
);
create policy "documents editors insert" on public.documents for insert to authenticated with check (
  deleted_at is null and owner_id = auth.uid() and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id and m.role in ('"'"'admin'"'"', '"'"'editor'"'"')
  )
);
create policy "documents members update" on public.documents for update to authenticated
  using (
    deleted_at is null and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.org_id = documents.org_id
        and (m.role = '"'"'admin'"'"' or (m.role = '"'"'editor'"'"' and documents.owner_id = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.org_id = documents.org_id
        and (m.role = '"'"'admin'"'"' or (m.role = '"'"'editor'"'"' and documents.owner_id = auth.uid()))
    )
  );
create policy "documents members delete" on public.documents for delete to authenticated using (
  deleted_at is null and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id
      and (m.role = '"'"'admin'"'"' or (m.role = '"'"'editor'"'"' and documents.owner_id = auth.uid()))
  )
);
create or replace function public.audit_document_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.document_audit(document_id, actor_id, action)
  values (new.id, auth.uid(), lower(tg_op));
  return new;
end;
$$;
drop trigger if exists documents_audit_write on public.documents;
create trigger documents_audit_write after insert or update on public.documents
for each row execute function public.audit_document_write();
create or replace function public.soft_delete_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.documents set deleted_at = coalesce(deleted_at, now()) where id = old.id;
  return null;
end;
$$;
drop trigger if exists documents_soft_delete on public.documents;
create trigger documents_soft_delete before delete on public.documents
for each row execute function public.soft_delete_document();
' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:build-rls-003-org-roles-permissions' > "$workdir/.oracle/build-rls-003-org-roles-permissions.complete"
