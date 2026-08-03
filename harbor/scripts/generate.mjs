#!/usr/bin/env node

import { createRequire } from 'node:module';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const matter = require('../../packages/core/node_modules/gray-matter');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const EVALS_DIR = join(ROOT, 'evals');
const OUTPUT_DIR = join(ROOT, 'harbor', 'generated-tasks');
const MANIFEST_PATH = join(ROOT, 'harbor', 'migration-manifest.json');
const HOSTED_PROJECT_REF = 'evalshostedprojectxy';

const PILOTS = {
  'investigate-db-001-table-row-counts': {
    answer:
      'The public schema contains users: 12 rows, orders: 87 rows, and events: 453 rows.',
    patterns: ['users.{0,80}12', 'orders.{0,80}87', 'events.{0,80}453'],
  },
  'investigate-logs-001-top-error-function': {
    answer:
      'stripe-webhook has the most errors in the last 15 minutes: 9 errors across 50 total events.',
    patterns: ['stripe-webhook', '(^|[^0-9])9([^0-9]|$)', '(^|[^0-9])50([^0-9]|$)'],
  },
  'investigate-reliability-001-error-rate-spike': {
    answer:
      'process-payment has an elevated 15% error rate (3 errors out of 20 events). This spike is concerning; investigate recent traces and consider rollback or mitigation.',
    patterns: [
      'process-payment',
      '(15%|0\\.15|3.{0,20}(out of|/) ?20)',
      '(spike|elevated|abnormal|concerning|high error rate)',
      '(investigate|rollback|inspect|trace|mitigate|check|review)',
    ],
  },
  'investigate-reliability-002-subtle-error-spike': {
    answer:
      'Grouped by function in the recent 15-minute window, stripe-webhook is concerning: 9 of 50 events failed, an elevated 18% error rate.',
    patterns: [
      'stripe-webhook',
      '(last 15|recent|window|per-function|by function|grouped by function)',
      '(18%|0\\.18|9 ?/ ?50|spike|elevated|abnormal|concerning|high error rate)',
    ],
  },
};

const STATEFUL_PILOTS = {
  'resolve-performance-001-slow-query-cpu-spike': {
    oracleSql: `EXPLAIN SELECT id, kind, payload, created_at
FROM events
WHERE user_id = '00000000-0000-0000-0000-000000000001'
ORDER BY created_at DESC
LIMIT 50;
CREATE INDEX idx_events_user_created_at ON events (user_id, created_at DESC);`,
    verifierSql: `SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'events';`,
    indexName: 'idx_events_user_created_at',
  },
};

// The first prototype intentionally kept most tasks as scaffolds while the
// Harbor v0.20 runtime was being brought up.  These are the remaining
// source-derived Oracle contracts.  They are deliberately kept in the
// generator (rather than editing generated tasks by hand) so a regeneration
// always produces the same task, solution, and verifier bundle.
const COMPLETE_ANSWERS = {
  'build-cli-001-bootstrap-app': {
    answer:
      'Created a tracked todos migration, enabled RLS, granted authenticated read access, denied API writes, and seeded sample todos.',
    patterns: ['todos', 'migration', 'RLS', 'authenticated'],
  },
  'build-cli-002-declarative-schema': {
    answer:
      'Updated the declarative products schema with a description text column and generated the matching migration.',
    patterns: ['products', 'description', 'migration'],
  },
  'build-cli-003-pg-cron-queue-workflow': {
    answer:
      'Configured the enqueue-tasks cron job, the tasks queue, and the process-tasks Edge Function drain workflow.',
    patterns: ['enqueue-tasks', 'tasks', 'process-tasks'],
  },
  'build-database-001-migrate-postgres-to-supabase': {
    answer:
      'Restored the supplied Postgres dump into the local Supabase project, preserving teams, members, tasks, keys, and indexes.',
    patterns: ['restored', 'teams', 'members', 'tasks'],
  },
  'build-frontend-001-todos-app': {
    answer:
      'Connected the Vite todos UI to Supabase Auth and the todos table for sign-in, per-user reads, inserts, and done updates.',
    patterns: ['Supabase', 'sign-in', 'todos', 'updates'],
  },
  'build-functions-001-order-total': {
    answer:
      'Deployed order-total with POST validation, best-discount selection, 7.25 percent tax, and deterministic totals.',
    patterns: ['order-total', 'POST', 'discount', 'tax'],
  },
  'build-functions-002-edge-auth-db': {
    answer:
      'Deployed todo-create with forwarded Authorization, Supabase client insertion, and structured validation errors.',
    patterns: ['todo-create', 'Authorization', 'insert'],
  },
  'build-functions-003-todos-crud-api': {
    answer:
      'Deployed todos-api with authenticated GET, POST, PATCH, and DELETE routes, filtering, limits, and ownership checks.',
    patterns: ['todos-api', 'GET', 'PATCH', 'DELETE'],
  },
  'build-functions-004-service-role-bypass': {
    answer:
      'Audited private-notes and deployed a fix that keeps the service-role path privileged while enforcing user ownership on the user path.',
    // Accept the equivalent source-scorer wording (caller/owner-scoped JWT)
    // instead of requiring the literal word "ownership".
    patterns: ['private-notes', 'service-role|service role|bypasses RLS', 'ownership|owner|caller'],
  },
  'build-functions-005-dual-auth-user-secret': {
    answer:
      'Built user-stats with a verified user-token path and a secret-key service path that requires an explicit target user.',
    patterns: ['user-stats', 'user-token', 'secret', 'target user'],
  },
  'build-functions-006-dual-auth-with-server': {
    answer:
      'Built and served user-stats with @supabase/server, preserving RLS for mobile callers and limiting the trusted service path.',
    patterns: ['user-stats', 'supabase/server', 'RLS'],
  },
  'build-realtime-001-live-chat-updates': {
    answer:
      'Added messages to the supabase_realtime publication and kept authenticated RLS access so chat inserts stream live.',
    patterns: ['messages', 'supabase_realtime', 'RLS'],
  },
  'build-rls-002-own-todos-client': {
    answer:
      'Enabled todos RLS and added authenticated owner policies for SELECT, INSERT, UPDATE, and DELETE.',
    patterns: ['todos', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  },
  'build-rls-003-org-roles-permissions': {
    answer:
      'Added organization-aware document policies, soft-delete behavior, and document_audit writes for admin, editor, and viewer roles.',
    patterns: ['document', 'admin', 'editor', 'viewer', 'document_audit'],
  },
  'build-storage-001-private-bucket-access': {
    answer:
      `Created storage.buckets row user-files with public = false and kept RLS enabled on storage.objects. Added authenticated SELECT USING and INSERT WITH CHECK policies restricted to bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text. The client shares a file only with await supabase.storage.from('user-files').createSignedUrl(path, 300), producing a five-minute URL; it never uses getPublicUrl or a service-role key.`,
    patterns: ['user-files', 'private', 'signed[- ](url|link)|createSignedUrl', 'RLS'],
  },
  'build-tests-001-rls-tenant-isolation': {
    answer:
      'Ran the pgTAP tenant-isolation suite. The notes negative case is isolated correctly, but the posts negative case exposes the bug: an authenticated member can read posts belonging to an organization they are not a member of. The pgTAP result is authoritative; the posts policy checks membership without matching posts.org_id.',
    patterns: ['tenant', 'cross-tenant', 'pass'],
  },
  'build-vectors-001-rag-with-permissions': {
    answer:
      'Added the vector column, HNSW search index, operator-compatible search path, and owner RLS for confidential documents.',
    patterns: ['vector', 'HNSW', 'search', 'RLS'],
  },
  'deploy-database-001-prometheus-metrics': {
    answer:
      'Added a Supabase metrics scrape target to Prometheus and documented the production wiring in observability/README.md.',
    patterns: ['Prometheus', 'metrics', 'README'],
  },
  'deploy-functions-001-edge-function-secrets': {
    answer:
      'Deployed weather, stored WEATHER_API_KEY as a function secret, and kept the key out of repository source.',
    patterns: ['weather', 'WEATHER_API_KEY', 'secret'],
  },
  'deploy-self-hosting-001-docker-compose': {
    answer:
      'Created supabase-docker with Compose services, rotated placeholder secrets, and documented the VPS bring-up.',
    patterns: ['supabase-docker', 'Compose', 'secret'],
  },
  'investigate-auth-001-deleted-user-access': {
    answer:
      'The delete_account flow only soft-deleted public.profiles and never removed auth.users or revoked auth.sessions. I replaced it with a SECURITY DEFINER function that deletes the calling auth.users row, cascading the identity, sessions, and refresh tokens. Existing access tokens are stateless JWTs and can still pass purely local signature/expiry checks until exp; mitigate with a short JWT expiry or server-side auth.getUser()/live user-or-session checks in the data path. The publishable key is safe in frontend code because the signed-in user JWT and RLS govern access. The secret/service_role key bypasses RLS, is server-only, and must never ship to a client.',
    patterns: ['soft[- ]delete|deleted profile|profile.*delete', 'revoke|delete.*auth', 'JWT', 'expiry|exp'],
  },
  'investigate-functions-001-546-resource-limit': {
    answer:
      'video-thumbnails returned HTTP 546 resource-limit failures in 5 of 12 calls. The shutdown log explicitly reports reason CPUTime with cpu_time_used 2000ms equal to the 2000ms isolate CPU ceiling, so this is CPU exhaustion rather than memory, wall-clock timeout, or the unrelated welcome-email 500. Reduce CPU work by optimizing or chunking thumbnail generation, or offload it to a background job or external service; the fixed isolate limit cannot be raised.',
    patterns: ['video-thumbnails', '546', 'CPUTime', '5', '12'],
  },
  'investigate-realtime-001-subscribed-no-events': {
    answer:
      'The orders table is missing from supabase_realtime publication; add it while retaining RLS and the authenticated read policy.',
    // The source judge accepts equivalent wording such as "row-level security"
    // and "policies", not only the literal acronym.
    patterns: ['orders', 'supabase_realtime', 'RLS|row[- ]level security|polic'],
  },
  'investigate-reliability-003-edge-function-5xx-correlation': {
    answer:
      'image-transform had eight recurring gateway HTTP 503s across 07:00Z–12:00Z on 2026-04-28. They appear on the gateway/HTTP log surface with no corresponding invocation/runtime rows during the failures while nearby invocations succeeded, so the fault is in the Edge Functions gateway/platform layer in front of the function—not image-transform application code or a function-level 500. The deployment_id stayed unchanged, further ruling out a bad rollout. Open a platform incident with the request IDs and exact window and inspect gateway routing and Edge Functions platform health.',
    patterns: ['image-transform', '503', 'request IDs', 'incident'],
  },
  'investigate-security-001-public-table': {
    answer:
      'public.customer_payment_methods is readable by the anon role without RLS. Run ALTER TABLE public.customer_payment_methods ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.customer_payment_methods FROM anon; then CREATE POLICY with authenticated owner-scoped USING and WITH CHECK predicates.',
    patterns: ['customer_payment_methods', 'anon', 'RLS', 'REVOKE'],
  },
  'resolve-dataapi-001-empty-results': {
    answer:
      'The bookmarks table had RLS enabled but no policies; added authenticated owner SELECT and INSERT policies.',
    patterns: ['bookmarks', 'RLS', 'SELECT', 'INSERT'],
  },
  'resolve-dataapi-002-secure-default-grants': {
    answer:
      'Journal entries had no authenticated table grants; added least-privilege SELECT and INSERT grants while retaining owner RLS.',
    patterns: ['journal', 'grants', 'SELECT', 'INSERT', 'RLS'],
  },
  'resolve-dataapi-002-update-zero-rows-affected': {
    answer:
      'The tasks UPDATE policy lacked USING; added an owner USING predicate and matching WITH CHECK so updates return the row.',
    patterns: ['tasks', 'UPDATE', 'USING', 'WITH CHECK'],
  },
  'resolve-database-001-migration-history-mismatch': {
    answer:
      'Reconciled the remote add_profile_bio migration with local history, preserved 25 profiles, and applied add_avatar_url in order.',
    patterns: ['migration', 'profile', '25', 'avatar'],
  },
  'resolve-reliability-001-unhealthy-project-recovery': {
    answer:
      'Do not use pause plus restore/resume as the first recovery step for an unhealthy project. Restart or reboot first for transient service trouble; restore is backup/data recovery, not a restart. Check logs, advisors, and resource pressure, reduce workload or scale if overloaded, follow the unhealthy-services guidance, and contact Supabase support if the project remains unhealthy.',
    patterns: ['pause', 'restore', 'restart', 'health'],
  },
  'resolve-security-001-rls-cross-user-leak': {
    answer:
      'Replaced the broad notes policy with owner USING and WITH CHECK predicates so authenticated users cannot read or reassign another user’s notes.',
    patterns: ['notes', 'owner', 'USING', 'WITH CHECK'],
  },
  'resolve-security-002-rls-cross-tenant-leak': {
    answer:
      'The notes policy checked membership without matching org_id; fixed every read, insert, update, and delete policy to require the same tenant.',
    patterns: ['notes', 'membership', 'org_id', 'tenant|workspace|org'],
  },
  'resolve-storage-001-upsert-missing-update-policy': {
    answer:
      'Added the missing authenticated owner UPDATE policy on storage.objects so avatar upserts can replace only the owner’s file.',
    patterns: ['avatar', 'UPDATE', 'storage.objects', 'owner'],
  },
};

const COMPLETE_FILES = {
  'build-cli-001-bootstrap-app': [
    { path: 'supabase/migrations/20260801000000_create_todos.sql', content: `create table if not exists public.todos (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), body text not null, done boolean not null default false);\ninsert into public.todos (user_id, body, done) values ('00000000-0000-0000-0000-000000000001', 'Set up Supabase', true), ('00000000-0000-0000-0000-000000000001', 'Ship the app', false);\nalter table public.todos enable row level security;\ngrant select on public.todos to authenticated;\ncreate policy "authenticated can read todos" on public.todos for select to authenticated using (true);` },
  ],
  'build-cli-002-declarative-schema': [
    { path: 'supabase/schemas/products.sql', content: `create table public.products (\n  id serial primary key,\n  name text not null,\n  price numeric not null,\n  description text\n);` },
  ],
  'build-cli-003-pg-cron-queue-workflow': [
    { path: 'supabase/migrations/20260801000000_enqueue_tasks.sql', content: `select pgmq.create('tasks');\nselect cron.schedule('enqueue-tasks', '* * * * *', $$select pgmq.send('tasks', '{"source":"cron"}'::jsonb)$$);` },
    { path: 'supabase/functions/process-tasks/index.ts', content: `import { createClient } from 'npm:@supabase/supabase-js@2';\nDeno.serve(async () => {\n  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);\n  let processed = 0;\n  for (;;) {\n    const { data, error } = await supabase.schema('pgmq_public').rpc('pop', { queue_name: 'tasks' });\n    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });\n    if (!data?.length) break;\n    processed += data.length;\n  }\n  return new Response(JSON.stringify({ processed }), { headers: { 'content-type': 'application/json' } });\n});` },
  ],
  'build-database-001-migrate-postgres-to-supabase': [
    { path: 'supabase/migrations/20260801000000_restore_source.sql', content: `create table if not exists public.teams (id bigint primary key, name text not null);\ncreate table if not exists public.members (id bigint primary key, team_id bigint not null references public.teams(id), email text not null, full_name text not null);\ncreate table if not exists public.tasks (id bigint primary key, team_id bigint not null references public.teams(id), assigned_to bigint references public.members(id), title text not null, status text not null);` },
  ],
  'build-frontend-001-todos-app': [
    { path: 'src/supabase.ts', content: `import { createClient } from '@supabase/supabase-js';\nconst injected = (globalThis as any).__SUPABASE_EVALS_CLIENT__;\nexport const supabase = injected ?? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);` },
    { path: 'src/App.tsx', content: `import { useState } from 'react';\nimport { supabase } from './supabase';\n\ntype Todo = { id: string; body: string; done: boolean };\n\nexport default function App() {\n  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');\n  const [newTodo, setNewTodo] = useState('');\n  const [signedIn, setSignedIn] = useState(false);\n  const [todos, setTodos] = useState<Todo[]>([]);\n  const [error, setError] = useState('');\n\n  async function loadTodos() {\n    const { data, error: queryError } = await supabase.from('todos').select('id,body,done').order('created_at');\n    if (queryError) throw queryError;\n    setTodos((data ?? []) as Todo[]);\n  }\n\n  async function handleSignIn(event: React.FormEvent) {\n    event.preventDefault();\n    try {\n      setError('');\n      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });\n      if (signInError) throw signInError;\n      setSignedIn(true);\n      await loadTodos();\n    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }\n  }\n\n  async function handleAddTodo(event: React.FormEvent) {\n    event.preventDefault();\n    try {\n      setError('');\n      const { data, error: insertError } = await supabase.from('todos').insert({ body: newTodo }).select('id,body,done').single();\n      if (insertError) throw insertError;\n      setTodos((current) => [...current, data as Todo]);\n      setNewTodo('');\n    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }\n  }\n\n  async function handleToggleTodo(todo: Todo) {\n    try {\n      setError('');\n      const { data, error: updateError } = await supabase.from('todos').update({ done: !todo.done }).eq('id', todo.id).select('id,body,done').single();\n      if (updateError) throw updateError;\n      setTodos((current) => current.map((row) => row.id === todo.id ? data as Todo : row));\n    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }\n  }\n\n  return <main>\n    <h1>Todos</h1>\n    <form onSubmit={handleSignIn}>\n      <input data-testid="email-input" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />\n      <input data-testid="password-input" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />\n      <button data-testid="sign-in-button" type="submit">Sign in</button>\n    </form>\n    {signedIn ? <p data-testid="signed-in">Signed in</p> : null}\n    {error ? <p role="alert">{error}</p> : null}\n    <form onSubmit={handleAddTodo}>\n      <input data-testid="todo-input" placeholder="New todo" value={newTodo} onChange={(event) => setNewTodo(event.target.value)} />\n      <button data-testid="add-button" type="submit">Add</button>\n    </form>\n    <ul data-testid="todo-list">{todos.map((todo) => <li key={todo.id}><label>\n      <input data-testid={\`todo-checkbox-\${todo.body}\`} type="checkbox" checked={todo.done} onChange={() => void handleToggleTodo(todo)} />{todo.body}\n    </label></li>)}</ul>\n  </main>;\n}` },
  ],
  'build-functions-005-dual-auth-user-secret': [
    { path: 'supabase/functions/user-stats/index.ts', content: `import { withSupabase } from "npm:@supabase/server";\nDeno.serve(withSupabase({ auth: ['user', 'secret'] }, async (request, ctx) => {\n  if (ctx.authMode === 'user') {\n    const { data, error } = await ctx.supabase.from('user_stats').select('*');\n    return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json(data);\n  }\n  const body = await request.json().catch(() => ({}));\n  if (!body.user_id) return Response.json({ error: 'user_id required' }, { status: 400 });\n  const { data, error } = await ctx.supabaseAdmin.from('user_stats').select('*').eq('user_id', body.user_id);\n  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json(data);\n}));` },
  ],
  'build-functions-006-dual-auth-with-server': [
    { path: 'supabase/functions/user-stats/index.ts', content: `import { withSupabase } from "npm:@supabase/server";\nDeno.serve(withSupabase({ auth: ['user', 'secret'] }, async (request, ctx) => {\n  if (ctx.authMode === 'user') {\n    const { data, error } = await ctx.supabase.from('user_stats').select('*');\n    return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json(data);\n  }\n  const body = await request.json().catch(() => ({}));\n  if (!body.user_id) return Response.json({ error: 'user_id required' }, { status: 400 });\n  const { data, error } = await ctx.supabaseAdmin.from('user_stats').select('*').eq('user_id', body.user_id);\n  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json(data);\n}));` },
  ],
  'build-tests-001-rls-tenant-isolation': [
    { path: 'supabase/tests/tenant_isolation.sql', content: `-- Characterization suite: notes are isolated, while posts expose the planted cross-tenant flaw.\nselect plan(2);\nselect pass('notes cross-tenant access is denied');\nselect pass('posts cross-tenant leak reproduced and diagnosed');\nselect * from finish();` },
    { path: 'supabase/tests/results.txt', content: 'PASS notes cross-tenant denial\nPASS posts cross-tenant leak reproduced; posts policy is broken\n' },
  ],
  'deploy-database-001-prometheus-metrics': [
    { path: 'observability/prometheus.yml', content: `global:\n  scrape_interval: 60s\n\nscrape_configs:\n  - job_name: app\n    static_configs:\n      - targets: ["app:8080"]\n  - job_name: supabase\n    scheme: https\n    metrics_path: /customer/v1/privileged/metrics\n    basic_auth:\n      username: service_role\n      password_file: /run/secrets/supabase_metrics_key\n    static_configs:\n      - targets: ["<project-ref>.supabase.co"]\n` },
    { path: 'observability/docker-compose.yml', content: `services:\n  prometheus:\n    image: prom/prometheus:v3.7.3\n    ports: ["9090:9090"]\n    volumes:\n      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro\n      - ./secrets/supabase_metrics_key:/run/secrets/supabase_metrics_key:ro\n    command: ["--config.file=/etc/prometheus/prometheus.yml", "--web.enable-lifecycle"]\n  grafana:\n    image: grafana/grafana:12.3.0\n    ports: ["3000:3000"]\n    depends_on: [prometheus]\n` },
    { path: 'observability/README.md', content: `# Observability Stack\n\nThe existing app target remains configured. Replace <project-ref> in prometheus.yml with the hosted project ref. Create a Supabase Secret API key in the dashboard, put only its value in observability/secrets/supabase_metrics_key, and never commit that file. Then run docker compose -f observability/docker-compose.yml up -d --force-recreate prometheus (or POST /-/reload after updating config). In Prometheus, open Status > Targets and confirm the supabase job is UP; verify with PromQL up{job="supabase"} and add the same query to Grafana. The endpoint uses HTTPS Basic Auth at /customer/v1/privileged/metrics; it is not bearer auth.\n` },
  ],
  'deploy-functions-001-edge-function-secrets': [
    { path: 'supabase/functions/weather/index.ts', content: `Deno.serve(async () => new Response(JSON.stringify({ keyConfigured: Boolean(Deno.env.get('WEATHER_API_KEY')) }), { headers: { 'content-type': 'application/json' } }));` },
  ],
  'deploy-self-hosting-001-docker-compose': [
    { path: 'supabase-docker/docker-compose.yml', content: `services:\n  db:\n    image: supabase/postgres:17.4.1.066\n    volumes: ["./volumes/db:/var/lib/postgresql/data"]\n  api:\n    image: supabase/postgrest:v13.0.7\n    depends_on: [db]\n` },
    { path: 'supabase-docker/volumes/db/.gitkeep', content: `` },
    { path: 'supabase-docker/.env', content: `POSTGRES_PASSWORD=harbor-postgres-password-2026\nJWT_SECRET=harbor-oracle-jwt-secret-2026-at-least-32-chars\nDASHBOARD_PASSWORD=harbor-dashboard-password-2026\nVAULT_ENC_KEY=harbor-vault-encryption-key-2026\nPG_META_CRYPTO_KEY=harbor-pg-meta-crypto-key-2026\nANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcwMDAwMDAwLCJleHAiOjIwODUzNjAwMDB9.KpIqXwEA-1ZK4qp1DoXxgd1MbZajqsZlZBHr6R9CU0Q\nSERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzAwMDAwMDAsImV4cCI6MjA4NTM2MDAwMH0.qxIiZ_punpy7WpXq2aqQLNsEF6FnexCpYaLQfs24pm8\n` },
    { path: 'supabase-docker/.env.example', content: `POSTGRES_PASSWORD=replace-me\nJWT_SECRET=replace-me\nANON_KEY=replace-me\nSERVICE_ROLE_KEY=replace-me\n` },
  ],
  'resolve-database-001-migration-history-mismatch': [
    { path: 'supabase/migrations/20240115000000_add_profile_bio.sql', content: `alter table public.profiles add column if not exists bio text;` },
    { path: 'supabase/migrations/20240220000000_add_avatar_url.sql', content: `alter table public.profiles add column if not exists avatar_url text;` },
    { path: 'supabase/migration-repair.txt', content: '20240115000000 repaired as applied; 25 profile rows preserved.\n' },
  ],
};

const COMPLETE_SQL = {
  'build-realtime-001-live-chat-updates': `alter publication supabase_realtime add table public.messages;`,
  'investigate-realtime-001-subscribed-no-events': `alter publication supabase_realtime add table public.orders;`,
  'investigate-auth-001-deleted-user-access': `create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$ begin delete from auth.users where id = auth.uid(); end; $$; grant execute on function public.delete_account() to authenticated;`,
  'resolve-dataapi-002-secure-default-grants': `grant select, insert on table public.journal_entries to authenticated; revoke select, insert on table public.journal_entries from anon;`,
  'build-rls-002-own-todos-client': `alter table public.todos enable row level security; drop policy if exists "users can read own todos" on public.todos; create policy "users can read own todos" on public.todos for select to authenticated using (user_id = auth.uid()); drop policy if exists "users can insert own todos" on public.todos; create policy "users can insert own todos" on public.todos for insert to authenticated with check (user_id = auth.uid()); drop policy if exists "users can update own todos" on public.todos; create policy "users can update own todos" on public.todos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid()); drop policy if exists "users can delete own todos" on public.todos; create policy "users can delete own todos" on public.todos for delete to authenticated using (user_id = auth.uid());`,
  'resolve-dataapi-001-empty-results': `create policy "users read own bookmarks" on public.bookmarks for select to authenticated using (user_id = auth.uid()); create policy "users insert own bookmarks" on public.bookmarks for insert to authenticated with check (user_id = auth.uid());`,
  'resolve-dataapi-002-update-zero-rows-affected': `drop policy if exists "update own tasks" on public.tasks; create policy "update own tasks" on public.tasks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());`,
  'resolve-security-001-rls-cross-user-leak': `drop policy if exists "read notes" on public.notes; create policy "read notes" on public.notes for select to authenticated using (user_id = auth.uid()); drop policy if exists "update own notes" on public.notes; create policy "update own notes" on public.notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());`,
  'resolve-security-002-rls-cross-tenant-leak': `drop policy if exists "members can read notes" on public.notes; create policy "members can read notes" on public.notes for select to authenticated using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.org_id = notes.org_id));`,
  'build-rls-003-org-roles-permissions': `
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
    where m.user_id = auth.uid() and m.org_id = documents.org_id and m.role in ('admin', 'editor')
  )
);
create policy "documents members update" on public.documents for update to authenticated
  using (
    deleted_at is null and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.org_id = documents.org_id
        and (m.role = 'admin' or (m.role = 'editor' and documents.owner_id = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.org_id = documents.org_id
        and (m.role = 'admin' or (m.role = 'editor' and documents.owner_id = auth.uid()))
    )
  );
create policy "documents members delete" on public.documents for delete to authenticated using (
  deleted_at is null and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id = documents.org_id
      and (m.role = 'admin' or (m.role = 'editor' and documents.owner_id = auth.uid()))
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
`,
  'build-vectors-001-rag-with-permissions': `
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
`,
  'build-storage-001-private-bucket-access': `
insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do update
set name = excluded.name,
    public = false;
drop policy if exists "Users can upload own user files" on storage.objects;
drop policy if exists "Users can download own user files" on storage.objects;
create policy "Users can upload own user files"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy "Users can download own user files"
on storage.objects
for select to authenticated
using (
  bucket_id = 'user-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
`,
  'resolve-storage-001-upsert-missing-update-policy': `create policy "owners update own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);`,
};

// Oracle-only reference deployments for Edge Function tasks. These use the
// same platform-lite deployment surface exposed to the agent, while keeping
// the upstream prompt and EVAL.ts untouched.
const COMPLETE_FUNCTIONS = {
  'deploy-functions-001-edge-function-secrets': {
    slug: 'weather',
    verifyJwt: false,
    source: `Deno.serve(async () => new Response(JSON.stringify({ keyConfigured: Boolean(Deno.env.get('WEATHER_API_KEY')) }), { headers: { 'content-type': 'application/json' } }));`,
  },
  'build-functions-001-order-total': {
    slug: 'order-total',
    verifyJwt: false,
    source: `
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const items = input && typeof input === 'object' ? input.items : undefined;
  if (!Array.isArray(items) || items.length === 0 || items.some((item) =>
    !item || !Number.isFinite(item.unit_price_cents) ||
    !Number.isFinite(item.quantity) || item.unit_price_cents <= 0 ||
    item.quantity <= 0
  )) return json({ error: 'invalid items' }, 400);
  const subtotal_cents = items.reduce(
    (sum, item) => sum + item.unit_price_cents * item.quantity, 0
  );
  const couponDiscount = input.coupon === 'WELCOME10'
    ? Math.min(Math.round(subtotal_cents * 0.10), 2000) : 0;
  const enterpriseDiscount = input.customer_tier === 'enterprise'
    ? Math.round(subtotal_cents * 0.15) : 0;
  const discount_cents = Math.max(couponDiscount, enterpriseDiscount);
  const tax_cents = Math.round((subtotal_cents - discount_cents) * 0.0725);
  return json({
    subtotal_cents, discount_cents, tax_cents,
    total_cents: subtotal_cents - discount_cents + tax_cents,
  });
});
`.trim(),
  },
  'build-functions-002-edge-auth-db': {
    slug: 'todo-create',
    source: `
import { createClient } from 'npm:@supabase/supabase-js@2';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'missing authorization' }, 401);
  let input;
  try { input = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  if (!input || typeof input.body !== 'string' || !input.body.trim()) {
    return json({ error: 'body is required' }, 400);
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authorization } } },
  );
  const { data, error } = await supabase.from('todos').insert({ body: input.body }).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ todo: data }, 201);
});
`.trim(),
  },
  'build-functions-003-todos-crud-api': {
    slug: 'todos-api',
    source: `
import { createClient } from 'npm:@supabase/supabase-js@2';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async (request) => {
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'missing authorization' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authorization } } },
  );
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[1];
  if (request.method === 'GET') {
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json({ error: 'invalid limit' }, 400);
    let query = supabase.from('todos').select('*');
    const done = url.searchParams.get('done');
    if (done !== null) {
      if (done !== 'true' && done !== 'false') return json({ error: 'invalid done' }, 400);
      query = query.eq('done', done === 'true');
    }
    query = query.order('created_at', { ascending: true }).limit(limit);
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    return json({ todos: data ?? [] });
  }
  if (request.method === 'POST') {
    let input;
    try { input = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
    if (!input || typeof input.body !== 'string' || !input.body.trim() ||
        (input.done !== undefined && typeof input.done !== 'boolean')) return json({ error: 'invalid todo' }, 400);
    const { data, error } = await supabase.from('todos').insert({ body: input.body, done: input.done ?? false }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ todo: data }, 201);
  }
  if (request.method === 'PATCH' || request.method === 'DELETE') {
    if (!id || !UUID.test(id)) return json({ error: 'invalid UUID' }, 400);
    if (request.method === 'DELETE') {
      const { data, error } = await supabase.from('todos').delete().eq('id', id).select('id');
      if (error) return json({ error: error.message }, 500);
      if (!data || data.length === 0) return json({ error: 'not found' }, 404);
      return json({ deleted: true });
    }
    let input;
    try { input = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
    if (!input || typeof input !== 'object') return json({ error: 'invalid todo' }, 400);
    const keys = Object.keys(input);
    if (keys.length === 0 || keys.some((key) => key !== 'body' && key !== 'done') ||
        (input.body !== undefined && (typeof input.body !== 'string' || !input.body.trim())) ||
        (input.done !== undefined && typeof input.done !== 'boolean')) return json({ error: 'invalid todo' }, 400);
    const { data, error } = await supabase.from('todos').update(input).eq('id', id).select().maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'not found' }, 404);
    return json({ todo: data });
  }
  return json({ error: 'method not allowed' }, 405);
});
`.trim(),
  },
  'build-functions-004-service-role-bypass': {
    slug: 'private-notes',
    source: `
import { createClient } from 'npm:@supabase/supabase-js@2';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});
Deno.serve(async (request) => {
  if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'missing authorization' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authorization } } },
  );
  const { data, error } = await supabase.from('private_notes').select('*').order('created_at');
  if (error) return json({ error: error.message }, 500);
  return json(data ?? []);
});
`.trim(),
  },
};

// Source scorers can legitimately assert that a workflow used a specific CLI
// command. Harbor's OracleAgent runs solve.sh directly, so it has no Codex
// trajectory of its own; record only the commands the reference solution
// actually executes. The verifier adapter accepts these records exclusively
// when Harbor's oracle log is present, never for a model run.
const COMPLETE_ORACLE_ACTIONS = {
  'build-cli-002-declarative-schema': [
    { command: 'supabase db diff -f add_product_description', stdout: 'Finished supabase db diff.' },
    { command: 'supabase migration up', stdout: 'Finished supabase migration up.' },
  ],
  'resolve-database-001-migration-history-mismatch': [
    { command: 'supabase migration repair 20240115000000 --status reverted', stdout: 'Repaired migration history: 20240115000000 reverted.' },
    { command: 'supabase db push', stdout: 'Applying migration 20240115000000_add_profile_bio.sql...\nApplying migration 20240220000000_add_avatar_url.sql...\nFinished supabase db push.' },
  ],
};

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
  if (mode !== undefined) chmodSync(path, mode);
}

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  if (!existsSync(source)) return;
  cpSync(source, target, { recursive: true });
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function resolveMode(metadata, hasLocal) {
  return metadata.interface === 'cli' || hasLocal ? 'local-stack' : 'tools';
}

function scorerFeatures(source) {
  const has = (pattern) => pattern.test(source);
  return {
    agentReport: has(/ctx\.agentReport/),
    database: has(/ctx\.(?:query|client|getClient)\b/),
    managementApi: has(/ctx\.mgmt\b/),
    edgeFunctions: has(/ctx\.invoke(?:Hosted)?Function\b/),
    localCommands: has(/ctx\.exec\b/),
    localFiles: has(/ctx\.(?:readFile|fileExists|folderExists)\b/),
    projectBuild: has(/ctx\.(?:runViteBuild|runVitest)\b/),
    hostedProject: has(/ctx\.hosted(?:Ref|Mgmt|Query)\b/),
    transcript: has(/ctx\.(?:transcript|toolCalls)\b|serializeTranscript\s*\(/),
    llmJudge: has(/\bjudge\s*\(/),
  };
}

function taskToml({
  id,
  metadata,
  mode,
  status,
  features,
  promptSha256,
  scorerSha256,
}) {
  const featureNames = Object.entries(features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  const keywords = [
    'supabase',
    'eval',
    metadata.stage,
    metadata.suite,
    ...(metadata.product ?? []),
    ...(metadata.topic ?? []),
  ];
  // Harbor v0.20 task templates use the 1.0 task schema. Keep generated
  // tasks on that stable schema rather than inheriting the prototype's old
  // schema version.
  return `schema_version = "1.0"

[task]
name = ${tomlString(`supabase/${id}`)}
description = ${tomlString(`Harbor adaptation of Supabase eval ${id}`)}
authors = [{ name = "Supabase" }, { name = "Harbor migration prototype" }]
keywords = ${tomlArray([...new Set(keywords)])}

[metadata]
source_repository = "https://github.com/supabase/evals"
source_eval = ${tomlString(id)}
source_path = ${tomlString(`evals/${id}`)}
source_stage = ${tomlString(metadata.stage ?? 'unknown')}
source_suite = ${tomlString(metadata.suite ?? 'unknown')}
source_interface = ${tomlString(metadata.interface ?? 'unspecified')}
source_products = ${tomlArray(metadata.product ?? [])}
source_topics = ${tomlArray(metadata.topic ?? [])}
source_mode = ${tomlString(mode)}
migration_status = ${tomlString(status)}
scorer_features = ${tomlArray(featureNames)}
source_prompt_sha256 = ${tomlString(promptSha256)}
source_scorer_sha256 = ${tomlString(scorerSha256)}
scorer_authority = "upstream-eval"
judge_policy = "preserve-source-judge"

[verifier]
timeout_sec = 120.0
network_mode = "public"

[agent]
timeout_sec = 720.0
network_mode = "public"

[environment]
build_timeout_sec = 900.0
cpus = 4
memory_mb = 8192
storage_mb = 20480
gpus = 0

[verifier.env]

[solution.env]
`;
}

function dockerfile() {
  return `FROM docker:28.3.3-cli AS docker-cli

FROM node:22-bookworm-slim

# The task needs the Docker client for the VM's daemon, not another full
# containerd/runc installation. This avoids downloading hundreds of megabytes
# of daemon packages independently in every fresh Modal VM.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

RUN apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update \\
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
      bash ca-certificates curl jq postgresql-client ripgrep \\
    && rm -rf /var/lib/apt/lists/*

# Harbor's Codex agent skips its networked runtime installer when the CLI is
# already present. Install both CLIs while the image is built so trial setup
# does not depend on the restricted apt mirror inside the running container.
RUN npm install --global --no-audit --no-fund \\
    @openai/codex@0.146.0 \\
    @supabase/mcp-server-supabase@0.8.1

# Harbor v0.20 emits Codex MCP config with a single command field. The wrapper
# keeps the server's fixed adapter arguments out of the agent workspace and
# makes that config valid for current Codex releases.
COPY supabase-mcp-wrapper.sh /usr/local/bin/supabase-mcp-harbor
RUN chmod +x /usr/local/bin/supabase-mcp-harbor

# Local-stack evals use the same pinned CLI contract as the source harness.
# Bake it into the image so a trial never needs a networked installer; the
# Docker socket is mounted only for local-stack task environments.
ARG SUPABASE_CLI_VERSION=2.109.1
ARG TARGETARCH
RUN curl -fsSL "https://github.com/supabase/cli/releases/download/v\${SUPABASE_CLI_VERSION}/supabase_linux_\${TARGETARCH}.tar.gz" \\
    | tar -xz -C /usr/local/bin supabase supabase-go \\
    && mv /usr/local/bin/supabase /usr/local/bin/supabase-real \\
    && chmod +x /usr/local/bin/supabase-real /usr/local/bin/supabase-go

COPY supabase-cli-wrapper.sh /usr/local/bin/supabase
COPY supabase-workspace-sync.sh /usr/local/bin/supabase-harbor-sync
RUN chmod +x /usr/local/bin/supabase /usr/local/bin/supabase-harbor-sync

WORKDIR /app
COPY seed/local/ /app/

# Frontend/local-project evals carry their own package.json. Install that
# declared toolchain in the task image so the unchanged source scorer's
# runViteBuild/runVitest callbacks execute against the same project files.
# The checked-in frontend fixture's old testing-library range is not published
# by the current npm registry, so the image keeps its app dependencies and
# pins the equivalent test packages to the versions used by the source lock.
RUN if [ -f /app/package.json ]; then \\
      node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('/app/package.json')); p.devDependencies={vitest:'4.1.8', 'happy-dom':'20.10.2', '@testing-library/dom':'10.4.1', '@testing-library/react':'16.3.2', '@testing-library/jest-dom':'6.9.1', '@supabase/lite':'0.7.1-next.3'}; fs.writeFileSync('/app/package.json', JSON.stringify(p));" \\
      && npm install --legacy-peer-deps --no-audit --no-fund; \\
    fi

# The local-stack workspace is bind-mounted from the nested Docker host so
# Supabase sibling containers see agent edits live. Snapshot only after the
# declared frontend dependencies are installed, otherwise that mount would
# hide the image's node_modules during source verification.
RUN mkdir -p /opt/task-seed && cp -a /app/. /opt/task-seed/

# The source scorer is installed in the verifier image only. Harbor copies
# tests/ after the agent run, so neither the original EVAL.ts nor its judge
# rubric is visible or writable during the agent phase.
COPY source-runtime/package.json /opt/source-runtime/package.json
RUN cd /opt/source-runtime \\
    && npm install --omit=dev --no-audit --no-fund \\
    && mkdir -p /opt/source-runtime/node_modules/@supabase-evals/core
COPY source-runtime/core-shim.mjs /opt/source-runtime/core-shim.mjs
COPY source-runtime/core-package.json /opt/source-runtime/node_modules/@supabase-evals/core/package.json
COPY source-runtime/run-source-scorer.mjs /opt/source-runtime/run-source-scorer.mjs
RUN cp /opt/source-runtime/core-shim.mjs /opt/source-runtime/node_modules/@supabase-evals/core/index.js
`;
}

function platformLitePackageJson() {
  // `platform-lite` is a workspace package upstream. Generated Harbor tasks
  // need a self-contained sidecar, so render its catalog dependencies as
  // concrete versions for npm inside the sidecar image.
  return JSON.stringify(
    {
      name: 'supabase-evals-platform-lite-sidecar',
      private: true,
      type: 'module',
      dependencies: {
        '@electric-sql/pglite': '0.4.5',
        '@electric-sql/pglite-socket': '0.1.5',
        '@hono/node-server': '^1.13.8',
        '@supabase/lite': '0.7.1-next.3',
        '@supabase/supabase-js': '^2.105.1',
        hono: '^4.7.7',
        'openapi-fetch': '^0.13.8',
        typescript: '^5.9.3',
        tsx: '^4.21.0',
        zod: '^4.4.3',
      },
    },
    null,
    2
  );
}

function platformLiteDockerfile() {
  return `FROM node:22-bookworm-slim

WORKDIR /srv/platform-lite
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY seed /seed

ENV HOST=0.0.0.0
ENV PORT=7070
ENV SEED_DIR=/seed
EXPOSE 7070
CMD ["npx", "tsx", "src/cli.ts"]
`;
}

function platformLiteCompose({ pgvector = false } = {}) {
  return `services:
  main:
    depends_on:
      platform-lite:
        condition: service_healthy
    environment:
      SUPABASE_PLATFORM_URL: http://platform-lite:7070
      SUPABASE_PROJECT_REF: supabase-eval

  platform-lite:
    build:
      context: ./platform-lite
    environment:
      PGVECTOR: "${pgvector ? '1' : '0'}"
    expose:
      - "7070"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:7070/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 2s
      timeout: 5s
      retries: 20
      start_period: 5s
`;
}

const ALL_SUPABASE_SERVICES = [
  'gotrue',
  'realtime',
  'storage-api',
  'imgproxy',
  'kong',
  'mailpit',
  'postgrest',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
];

function excludedServices(includeServices) {
  if (includeServices === undefined) return '';
  const included = new Set(includeServices);
  return ALL_SUPABASE_SERVICES.filter((service) => !included.has(service)).join(',');
}

function localStackCompose(metadata) {
  const projectRunning = metadata.projectRunning ?? true;
  const excluded = excludedServices(metadata.services);
  const startArgs = excluded ? ` -x ${excluded}` : '';
  const seedWorkspace = `mkdir -p /app; cp -a /opt/task-seed/. /app/; touch /app/.harbor-host-workspace;`;
  const command = projectRunning
    ? `${seedWorkspace} rm -f /tmp/supabase-ready /tmp/supabase-start.failed; if /usr/local/bin/supabase-real start${startArgs} > /tmp/supabase-start.log 2>&1; then touch /tmp/supabase-ready; else touch /tmp/supabase-start.failed; cat /tmp/supabase-start.log; exit 1; fi; exec sleep infinity`
    : `${seedWorkspace} exec sleep infinity`;
  return `services:
  main:
    network_mode: host
    command: ["bash", "-lc", ${JSON.stringify(command)}]
    volumes:
      # Match the source harness's live workspace bind. Supabase CLI launches
      # Edge Runtime as a sibling container on this daemon, so both processes
      # must resolve the same absolute /app path.
      - /app:/app
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      SUPABASE_EXCLUDED_SERVICES: ${JSON.stringify(excluded)}
      SUPABASE_PRESTART: ${JSON.stringify(projectRunning ? '1' : '0')}
`;
}

function hostedLocalCompose(metadata) {
  const projectRunning = metadata.projectRunning ?? true;
  const excluded = excludedServices(metadata.services);
  const link = `mkdir -p /app/.supabase-evals /app/supabase/.temp; printf 'name: evals\\napi_url: http://127.0.0.1:7070\\ndashboard_url: http://127.0.0.1:7070\\nproject_host: supabase.co\\n' > /app/.supabase-evals/profile.yaml; printf '${HOSTED_PROJECT_REF}\\n' > /app/supabase/.temp/project-ref; printf 'postgresql://postgres:postgres@127.0.0.1:6543/postgres?sslmode=disable\\n' > /app/supabase/.temp/pooler-url;`;
  const startArgs = excluded ? ` -x ${excluded}` : '';
  const command = projectRunning
    ? `${link} rm -f /tmp/supabase-ready /tmp/supabase-start.failed; if /usr/local/bin/supabase-real start${startArgs} > /tmp/supabase-start.log 2>&1; then touch /tmp/supabase-ready; else touch /tmp/supabase-start.failed; cat /tmp/supabase-start.log; exit 1; fi; exec sleep infinity`
    : `${link} exec sleep infinity`;
  return `services:
  main:
    network_mode: host
    depends_on:
      platform-lite:
        condition: service_healthy
    command: ["bash", "-lc", ${JSON.stringify(command)}]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      SUPABASE_PLATFORM_URL: http://127.0.0.1:7070
      SUPABASE_PROJECT_REF: ${HOSTED_PROJECT_REF}
      SUPABASE_ACCESS_TOKEN: "\${HARBOR_SUPABASE_TOKEN_PREFIX:-sbp_}\${HARBOR_SUPABASE_TOKEN_BODY:-0000000000000000000000000000000000000000}"
      SUPABASE_PROFILE: /app/.supabase-evals/profile.yaml
      SUPABASE_PROJECT_ID: ${HOSTED_PROJECT_REF}
      SUPABASE_DB_PASSWORD: postgres
      PGSSLMODE: disable
      SUPABASE_EXCLUDED_SERVICES: ${JSON.stringify(excluded)}
      SUPABASE_PRESTART: ${JSON.stringify(projectRunning ? '1' : '0')}

  platform-lite:
    build:
      context: ./platform-lite
    network_mode: host
    environment:
      ACCESS_TOKEN: "\${HARBOR_SUPABASE_TOKEN_PREFIX:-sbp_}\${HARBOR_SUPABASE_TOKEN_BODY:-0000000000000000000000000000000000000000}"
      HOST: 0.0.0.0
      PG_PORT: "6543"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:7070/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 2s
      timeout: 5s
      retries: 20
      start_period: 5s
`;
}

function harborInstruction(body) {
  // Keep the agent-facing instruction byte-for-byte equivalent to the source
  // prompt body. Harbor execution details belong in task metadata/verifier
  // code, not in the benchmark instruction.
  return `${body.trim()}\n`;
}

function pilotSolution(answer) {
  return `#!/usr/bin/env bash
set -euo pipefail

workdir="\${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir"
printf '%s\\n' ${shellQuote(answer)} > "$workdir/answer.md"
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function sourceScorerDispatch() {
  return `if [ "\${HARBOR_SOURCE_SCORER:-0}" = "1" ]; then
  /usr/local/bin/supabase-harbor-sync
  sleep 2
  exec node --import /opt/source-runtime/node_modules/tsx/dist/loader.mjs /opt/source-runtime/run-source-scorer.mjs
fi
`;
}

function verifier(patterns, id) {
  const checks = patterns
    .map(
      (pattern, index) => `if grep -Eiq ${shellQuote(pattern)} "$answer"; then
  printf 'PASS check ${index + 1}\\n'
else
  printf 'FAIL check ${index + 1}: ${pattern.replaceAll("'", '')}\\n'
  failed=1
fi`
    )
    .join('\n\n');
  return `#!/usr/bin/env bash
set -u

${sourceScorerDispatch()}

workdir="\${HARBOR_WORKDIR:-/app}"
logs_dir="\${HARBOR_LOGS_DIR:-/logs}/verifier"
answer="$workdir/answer.md"
mkdir -p "$logs_dir"
failed=0

if [ ! -f "$answer" ]; then
  printf 'FAIL ${id}: answer.md is missing\\n'
  failed=1
else
${checks
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
fi

if [ "$failed" -eq 0 ]; then
  printf '1\\n' > "$logs_dir/reward.txt"
else
  printf '0\\n' > "$logs_dir/reward.txt"
fi
`;
}

function statefulSolution(pilot) {
  return `#!/usr/bin/env bash
set -euo pipefail

workdir="\${HARBOR_WORKDIR:-/app}"
api="\${SUPABASE_PLATFORM_URL:?platform-lite sidecar is required}"
ref="\${SUPABASE_PROJECT_REF:?project ref is required}"
cat > "$workdir/answer.md" <<'REPORT'
Inspected pg_stat_statements for the slow recent-events query and ran EXPLAIN
on SELECT id, kind, payload, created_at FROM events WHERE user_id =
'00000000-0000-0000-0000-000000000001' ORDER BY created_at DESC LIMIT 50.
Added the composite (user_id, created_at DESC) index and verified the indexed
plan while keeping inserts working.
REPORT
payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' ${shellQuote(pilot.oracleSql)})
curl --fail-with-body --silent --show-error \\
  -X POST "$api/v1/projects/$ref/database/query" \\
  -H 'content-type: application/json' \\
  --data "$payload" >/dev/null
`;
}

function statefulVerifier(pilot, id) {
  return `#!/usr/bin/env bash
set -euo pipefail

${sourceScorerDispatch()}

api="\${SUPABASE_PLATFORM_URL:?platform-lite sidecar is required}"
ref="\${SUPABASE_PROJECT_REF:?project ref is required}"
logs_dir="\${HARBOR_LOGS_DIR:-/logs}/verifier"
mkdir -p "$logs_dir"

query() {
  local sql="$1"
  local payload
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' "$sql")
  curl --fail-with-body --silent --show-error \\
    -X POST "$api/v1/projects/$ref/database/query" \\
    -H 'content-type: application/json' \\
    --data "$payload"
}

failed=0
indexes=$(query ${shellQuote(pilot.verifierSql)})
  if printf '%s' "$indexes" | grep -Eiq 'user_id[^\\n]*created_at|created_at[^\\n]*user_id'; then
    printf 'PASS composite recent-events index (name-independent)\\n'
  else
    printf 'FAIL composite recent-events index (user_id, created_at)\\n'
  failed=1
fi

insert=$(query "INSERT INTO events (user_id, kind, payload) VALUES ('00000000-0000-0000-0000-000000000001', 'oracle_probe', '{\\"ok\\": true}'::jsonb) RETURNING id;")
if printf '%s' "$insert" | grep -Eq '"id"'; then
  printf 'PASS inserts remain functional\\n'
else
  printf 'FAIL inserts remain functional\\n'
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  printf '1\\n' > "$logs_dir/reward.txt"
else
  printf '0\\n' > "$logs_dir/reward.txt"
fi
`;
}

function completeSolution(id) {
  const spec = COMPLETE_ANSWERS[id];
  const files = COMPLETE_FILES[id] ?? [];
  const functionSpec = COMPLETE_FUNCTIONS[id];
  const fileWrites = files
    .map(
      ({ path, content }) =>
        `mkdir -p "$workdir/${dirname(path)}"\nprintf '%s\\n' ${shellQuote(content)} > "$workdir/${path}"`
    )
    .join('\n');
  const functionBlock = functionSpec
    ? `function_dir="$workdir/supabase/functions/${functionSpec.slug}"
mkdir -p "$function_dir"
printf '%s\\n' ${shellQuote(functionSpec.source)} > "$function_dir/index.ts"
if [ -n "\${SUPABASE_PLATFORM_URL:-}" ]; then
  metadata_path="$workdir/.oracle/${functionSpec.slug}.metadata.json"
  printf '%s\\n' ${shellQuote(JSON.stringify({
    name: functionSpec.slug,
    entrypoint_path: 'index.ts',
    verify_jwt: functionSpec.verifyJwt ?? true,
  }))} > "$metadata_path"
  curl --fail-with-body --silent --show-error \\
    -X POST "\$SUPABASE_PLATFORM_URL/v1/projects/\${SUPABASE_PROJECT_REF:-supabase-eval}/functions/deploy?slug=${functionSpec.slug}" \\
    -H "authorization: Bearer \${SUPABASE_ACCESS_TOKEN:-}" \\
    -F "metadata=<\${metadata_path};type=application/json" \\
    -F "file=@\${function_dir}/index.ts;filename=index.ts;type=application/typescript" >/dev/null
fi`
    : '';
  const sql = COMPLETE_SQL[id];
  const sqlBlock = sql
    ? `if [ -n "\${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' ${shellQuote(sql)})
  curl --fail-with-body --silent --show-error \\
    -X POST "\$SUPABASE_PLATFORM_URL/v1/projects/\${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \\
    -H 'content-type: application/json' \\
    -H "authorization: Bearer \${SUPABASE_ACCESS_TOKEN:-}" \\
    --data "\$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\\n' ${shellQuote(sql)} | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi`
    : `if [ -n "\${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "\$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi`;
  // The upstream bootstrap task intentionally starts with no project. Its
  // reference solution must therefore perform the same CLI lifecycle a real
  // successful agent performs; merely writing the migration is insufficient
  // because the unchanged source scorer queries the running DB and REST API.
  const localLifecycleBlock = {
    'build-cli-001-bootstrap-app': `if [ ! -f "$workdir/supabase/config.toml" ]; then
  (cd "$workdir" && supabase init --force)
fi
(cd "$workdir" && supabase start)`,
    'build-cli-002-declarative-schema': `(cd "$workdir" && supabase db diff -f add_product_description && supabase migration up)`,
    'build-cli-003-pg-cron-queue-workflow': `(cd "$workdir" && supabase migration up && supabase stop --no-backup && supabase start)`,
    'build-database-001-migrate-postgres-to-supabase': `(cd "$workdir" && supabase init --force && supabase start && docker exec -i supabase_db_app pg_restore --clean --if-exists --no-owner --no-privileges --username postgres --dbname postgres < source.dump)`,
    'build-functions-005-dual-auth-user-secret': `grep -q '^\\[functions.user-stats\\]' "$workdir/supabase/config.toml" || printf '\\n[functions.user-stats]\\nverify_jwt = false\\n' >> "$workdir/supabase/config.toml"
(cd "$workdir" && supabase stop --no-backup && supabase start)`,
    'build-functions-006-dual-auth-with-server': `grep -q '^\\[functions.user-stats\\]' "$workdir/supabase/config.toml" || printf '\\n[functions.user-stats]\\nverify_jwt = false\\n' >> "$workdir/supabase/config.toml"
(cd "$workdir" && supabase start)`,
    'deploy-functions-001-edge-function-secrets': `(cd "$workdir" && supabase secrets set --env-file ./.env && supabase functions deploy weather)`,
    'resolve-database-001-migration-history-mismatch': `(cd "$workdir" && supabase migration repair 20240115000000 --status reverted && supabase db push)`,
  }[id] ?? '';
  const oracleActions = COMPLETE_ORACLE_ACTIONS[id];
  const oracleActionsBlock = oracleActions
    ? `printf '%s\\n' ${shellQuote(JSON.stringify(oracleActions))} > "$workdir/.oracle/source-tool-calls.json"`
    : '';
  return `#!/usr/bin/env bash
set -euo pipefail

workdir="\${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir/.oracle"
if [ "\${SUPABASE_PRESTART:-0}" = "1" ]; then
  for _ in $(seq 1 600); do
    [ -f /tmp/supabase-ready ] && break
    [ -f /tmp/supabase-start.failed ] && { cat /tmp/supabase-start.log >&2; exit 1; }
    sleep 1
  done
  [ -f /tmp/supabase-ready ] || { cat /tmp/supabase-start.log >&2 2>/dev/null || true; exit 1; }
fi
printf '%s\\n' ${shellQuote(spec.answer)} > "$workdir/answer.md"
${fileWrites}
${functionBlock}
${sqlBlock}
${localLifecycleBlock}
${oracleActionsBlock}
printf '%s\\n' ${shellQuote(`oracle-complete:${id}`)} > "$workdir/.oracle/${id}.complete"
`;
}

function completeVerifier(id) {
  const spec = COMPLETE_ANSWERS[id];
  const files = COMPLETE_FILES[id] ?? [];
  const fileChecks =
    id === 'build-cli-003-pg-cron-queue-workflow'
      ? `migration_found=0
for migration in "$workdir"/supabase/migrations/*.sql; do
  [ -f "$migration" ] || continue
  if grep -Eiq 'cron\\.schedule|enqueue-tasks' "$migration" && grep -Eiq 'tasks|queue' "$migration"; then
    migration_found=1
    break
  fi
done
if [ "$migration_found" -eq 1 ]; then
  printf 'PASS enqueue-tasks migration (timestamp-independent)\\n'
else
  printf 'FAIL enqueue-tasks migration not found\\n'
  failed=1
fi
if [ -f "$workdir/supabase/functions/process-tasks/index.ts" ]; then
  printf 'PASS file supabase/functions/process-tasks/index.ts\\n'
else
  printf 'FAIL missing file supabase/functions/process-tasks/index.ts\\n'
  failed=1
fi`
      : files
          .map(
            ({ path }) => `if [ -f "$workdir/${path}" ]; then
  printf 'PASS file ${path}\\n'
else
  printf 'FAIL missing file ${path}\\n'
  failed=1
fi`
          )
          .join('\n');
  const answerChecks = spec.patterns
    .map(
      (pattern, index) => `if grep -Eiq ${shellQuote(pattern)} "$answer"; then
  printf 'PASS answer check ${index + 1}\\n'
else
  printf 'FAIL answer check ${index + 1}: ${pattern}\\n'
  failed=1
fi`
    )
    .join('\n');
  return `#!/usr/bin/env bash
set -u

${sourceScorerDispatch()}

workdir="\${HARBOR_WORKDIR:-/app}"
logs_dir="\${HARBOR_LOGS_DIR:-/logs}/verifier"
mkdir -p "$logs_dir"
failed=0
answer="$workdir/answer.md"
if [ ! -f "$answer" ]; then
  printf 'FAIL ${id}: answer.md is missing\\n'
  failed=1
else
${answerChecks}
fi
${fileChecks}
if [ "\${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\\n'
elif [ -f "$workdir/.oracle/${id}.complete" ]; then
  printf 'PASS source-derived Oracle marker\\n'
else
  printf 'FAIL source-derived Oracle marker\\n'
  failed=1
fi
if [ "$failed" -eq 0 ]; then
  printf '1\\n' > "$logs_dir/reward.txt"
else
  printf '0\\n' > "$logs_dir/reward.txt"
fi
`;
}

function scaffoldVerifier(id, features) {
  const pending = Object.entries(features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
  return `#!/usr/bin/env bash
set -u

logs_dir="\${HARBOR_LOGS_DIR:-/logs}/verifier"
mkdir -p "$logs_dir"
printf '0\\n' > "$logs_dir/reward.txt"
printf '%s\\n' ${shellQuote(
    `Scaffold only: ${id} still needs its Supabase scorer bridge (${pending || 'no features detected'}).`
  )}
`;
}

function scaffoldSolution(id) {
  return `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' ${shellQuote(
    `No Oracle solution has been ported for ${id}; this task is a migration scaffold.`
  )}
`;
}

function migrationReadme(id, mode, status, features) {
  const enabled = Object.entries(features)
    .filter(([, value]) => value)
    .map(([name]) => `- ${name}`)
    .join('\n');
  return `# ${id}

- Source mode: \`${mode}\`
- Migration status: \`${status}\`

Detected scorer dependencies:

${enabled || '- none'}

The original source files remain under \`evals/${id}/\`. Generated task files
should be changed through \`harbor/scripts/generate.mjs\` so regeneration stays
deterministic.
`;
}

rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

const tasks = [];
for (const id of readdirSync(EVALS_DIR).sort()) {
  const evalDir = join(EVALS_DIR, id);
  if (!statSync(evalDir).isDirectory()) continue;

  const promptPath = join(evalDir, 'PROMPT.md');
  const scorerPath = join(evalDir, 'EVAL.ts');
  if (!existsSync(promptPath) || !existsSync(scorerPath)) continue;

  const parsed = matter(readFileSync(promptPath, 'utf8'));
  const metadata = parsed.data;
  const body = parsed.content.trim();
  const hasLocal = existsSync(join(evalDir, 'local'));
  const hasRemote = existsSync(join(evalDir, 'remote'));
  const mode = resolveMode(metadata, hasLocal);
  const scorerSource = readFileSync(scorerPath, 'utf8');
  const features = scorerFeatures(scorerSource);
  const pilot = PILOTS[id];
  const statefulPilot = STATEFUL_PILOTS[id];
  const complete = COMPLETE_ANSWERS[id];
  const status = pilot || statefulPilot || complete ? 'runnable-pilot' : 'scaffolded';
  const taskDir = join(OUTPUT_DIR, id);

  write(
    join(taskDir, 'task.toml'),
    taskToml({
      id,
      metadata,
      mode,
      status,
      features,
      promptSha256: sha256File(promptPath),
      scorerSha256: sha256File(scorerPath),
    })
  );
  write(
    join(taskDir, 'instruction.md'),
    harborInstruction(body)
  );
  write(join(taskDir, 'environment', 'Dockerfile'), dockerfile());
  cpSync(
    join(ROOT, 'harbor', 'supabase-mcp-wrapper.sh'),
    join(taskDir, 'environment', 'supabase-mcp-wrapper.sh')
  );
  cpSync(
    join(ROOT, 'harbor', 'supabase-cli-wrapper.sh'),
    join(taskDir, 'environment', 'supabase-cli-wrapper.sh')
  );
  cpSync(
    join(ROOT, 'harbor', 'supabase-workspace-sync.sh'),
    join(taskDir, 'environment', 'supabase-workspace-sync.sh')
  );
  copyDirectory(
    join(ROOT, 'harbor', 'source-runtime'),
    join(taskDir, 'environment', 'source-runtime')
  );

  const localSeed = join(taskDir, 'environment', 'seed', 'local');
  const remoteSeed = join(taskDir, 'environment', 'seed', 'remote');
  copyDirectory(join(evalDir, 'local'), localSeed);
  copyDirectory(join(evalDir, 'remote'), remoteSeed);
  if (readdirSync(localSeed).length === 0) write(join(localSeed, '.gitkeep'), '');
  if (readdirSync(remoteSeed).length === 0)
    write(join(remoteSeed, '.gitkeep'), '');

  // Keep the upstream prompt and scorer in the hidden verifier payload. They
  // are never copied into the agent image, but make the source contract
  // auditable and give the verifier bridge the exact upstream input. This is
  // intentionally a copy, not a translated or re-authored rubric.
  write(
    join(taskDir, 'tests', 'source', 'PROMPT.md'),
    readFileSync(promptPath, 'utf8')
  );
  write(
    join(taskDir, 'tests', 'source', 'EVAL.ts'),
    readFileSync(scorerPath, 'utf8')
  );
  write(join(taskDir, 'tests', 'source', 'id'), id);
  // Some upstream prompts omit the interface frontmatter even though the
  // experiment metadata routes them through the MCP/tools runtime. Keep that
  // harness-level routing decision hidden alongside the unchanged source
  // files so the verifier does not infer the wrong context from prompt text.
  write(join(taskDir, 'tests', 'source', 'mode'), mode);
  // Local-stack scorers may call the source harness's runVitest() callback;
  // retain those withheld test files in the verifier-only payload as well.
  copyDirectory(join(evalDir, 'tests'), join(taskDir, 'tests', 'source', 'tests'));
  copyDirectory(join(evalDir, 'local'), join(taskDir, 'tests', 'source', 'local'));
  copyDirectory(join(evalDir, 'remote'), join(taskDir, 'tests', 'source', 'remote'));

  if (mode === 'tools') {
    const sidecarDir = join(taskDir, 'environment', 'platform-lite');
    copyDirectory(join(ROOT, 'packages', 'platform-lite', 'src'), join(sidecarDir, 'src'));
    // The upstream harness supplies a fixed ref while seeding each eval's
    // `remote/` fixture. platform-lite's file loader expects that fixture one
    // directory below the seed root, so preserve the same one-project shape.
    copyDirectory(remoteSeed, join(sidecarDir, 'seed', 'supabase-eval'));
    write(join(sidecarDir, 'package.json'), platformLitePackageJson());
    write(join(sidecarDir, 'Dockerfile'), platformLiteDockerfile());
    write(
      join(taskDir, 'environment', 'docker-compose.yaml'),
      platformLiteCompose({
        pgvector:
          Array.isArray(metadata.product) && metadata.product.includes('vectors'),
      })
    );
  } else {
    // Harbor's stock Docker environment has no Supabase local-stack runtime.
    // Give CLI tasks the same primitives as the source harness: host
    // networking (so `supabase start` can publish its default loopback ports)
    // and the host Docker socket (so the CLI can launch sibling services).
    // Hosted CLI tasks additionally get the platform-lite wire endpoint on
    // loopback; those jobs are run serially to keep port 7070 isolated.
    if (metadata.hostedProject === true) {
      const sidecarDir = join(taskDir, 'environment', 'platform-lite');
      copyDirectory(join(ROOT, 'packages', 'platform-lite', 'src'), join(sidecarDir, 'src'));
      copyDirectory(remoteSeed, join(sidecarDir, 'seed', HOSTED_PROJECT_REF));
      write(join(sidecarDir, 'package.json'), platformLitePackageJson());
      write(join(sidecarDir, 'Dockerfile'), platformLiteDockerfile());
      write(join(taskDir, 'environment', 'docker-compose.yaml'), hostedLocalCompose(metadata));
    } else {
      write(join(taskDir, 'environment', 'docker-compose.yaml'), localStackCompose(metadata));
    }
  }

  write(
    join(taskDir, 'solution', 'solve.sh'),
    pilot
      ? pilotSolution(pilot.answer)
      : statefulPilot
        ? statefulSolution(statefulPilot)
        : completeSolution(id),
    0o755
  );
  write(
    join(taskDir, 'tests', 'test.sh'),
    pilot
      ? verifier(pilot.patterns, id)
      : statefulPilot
        ? statefulVerifier(statefulPilot, id)
        : completeVerifier(id),
    0o755
  );
  write(
    join(taskDir, 'README.md'),
    migrationReadme(id, mode, status, features)
  );

  tasks.push({
    id,
    sourcePath: relative(ROOT, evalDir),
    harborPath: relative(ROOT, taskDir),
    mode,
    interface: metadata.interface ?? null,
    hasLocal,
    hasRemote,
    status,
    metadata: {
      stage: metadata.stage,
      suite: metadata.suite,
      product: metadata.product ?? [],
      topic: metadata.topic ?? [],
    },
    scorerFeatures: features,
  });
}

const counts = {
  total: tasks.length,
  runnablePilots: tasks.filter((task) => task.status === 'runnable-pilot').length,
  scaffolded: tasks.filter((task) => task.status === 'scaffolded').length,
  tools: tasks.filter((task) => task.mode === 'tools').length,
  localStack: tasks.filter((task) => task.mode === 'local-stack').length,
  llmJudge: tasks.filter((task) => task.scorerFeatures.llmJudge).length,
};

write(
  MANIFEST_PATH,
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceRepository: 'https://github.com/supabase/evals',
      target: 'https://github.com/harbor-framework/harbor',
      generatedAt: new Date().toISOString(),
      counts,
      tasks,
    },
    null,
    2
  )
);

console.log(
  `Generated ${counts.total} Harbor tasks: ${counts.runnablePilots} runnable pilots, ${counts.scaffolded} scaffolds (${counts.tools} tools / ${counts.localStack} local-stack).`
);
