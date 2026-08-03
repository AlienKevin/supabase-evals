#!/usr/bin/env node

/*
 * Execute the unchanged Supabase EVAL.ts module inside Harbor's verifier.
 *
 * This file is an execution adapter only.  It deliberately does not contain
 * task-specific assertions: the source EVAL.ts is copied into the verifier
 * payload and remains the authority for the score, including calls to the
 * source LLM judge().
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import createOpenApiClient from 'openapi-fetch';
import postgres from 'postgres';

const execFileAsync = promisify(execFile);
const workdir = process.env.HARBOR_WORKDIR || '/app';
const logsDir = join(process.env.HARBOR_LOGS_DIR || '/logs', 'verifier');
const sourceTestsDir = '/tests/source';
const runtimeEvalDir = '/opt/source-runtime/eval';
const sourceEvalPath = join(runtimeEvalDir, 'EVAL.ts');
const sourcePromptPath = join(runtimeEvalDir, 'PROMPT.md');
const sourceModePath = join(runtimeEvalDir, 'mode');
const sourceHiddenTestsDir = join(runtimeEvalDir, 'tests');
const rewardPath = join(logsDir, 'reward.txt');
const scorePath = join(logsDir, 'source-score.json');

mkdirSync(logsDir, { recursive: true });

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  const events = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Harbor agent logs can contain non-JSON banners and partial lines.
    }
  }
  return events;
}

function itemEvents() {
  const path = process.env.HARBOR_AGENT_LOG || '/logs/agent/codex.txt';
  return readJsonLines(path)
    // Codex emits item.started and item.completed for the same item. The
    // upstream Harbor parser consumes only the completed record, otherwise a
    // source scorer would see duplicate/in-progress tool calls.
    .filter((event) => event.type === 'item.completed')
    .map((event) => event.item)
    .filter((item) => item && typeof item === 'object');
}

function sourceTrajectory() {
  const transcript = [];
  const toolCalls = [];
  const agentMessages = [];

  for (const item of itemEvents()) {
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      agentMessages.push(item.text);
      transcript.push({ type: 'message', role: 'assistant', content: item.text });
      continue;
    }

    if (item.type === 'command_execution' && typeof item.command === 'string') {
      const output = item.aggregated_output;
      const result = {
        ok: item.exit_code === 0,
        exitCode: item.exit_code ?? null,
        stdout: text(output),
        stderr: item.exit_code && item.exit_code !== 0 ? text(output) : '',
      };
      const call = {
        endpoint: 'shell',
        name: 'shell',
        command: item.command,
        body: { command: item.command },
        result,
        error: item.exit_code && item.exit_code !== 0 ? text(output) : undefined,
        ts: Date.now(),
      };
      toolCalls.push(call);
      transcript.push({
        type: 'tool_call',
        name: 'shell',
        input: { command: item.command },
        output: result,
        ...(item.exit_code && item.exit_code !== 0
          ? { error: text(output) }
          : {}),
      });
      continue;
    }

    if (item.type === 'file_change' && Array.isArray(item.changes)) {
      const call = {
        endpoint: 'file_change',
        name: 'file_write',
        body: { changes: item.changes },
        result: { status: item.status ?? 'completed' },
        ts: Date.now(),
      };
      toolCalls.push(call);
      transcript.push({
        type: 'tool_call',
        name: 'file_write',
        input: { changes: item.changes },
        output: call.result,
      });
      continue;
    }

    // Preserve Codex MCP calls in the source trajectory exactly as the
    // upstream Codex parser does: the original MCP tool name is the endpoint,
    // while the raw item (including nested `arguments`) is the body. This is
    // needed by source judges that assess the agent's actual tool actions.
    if (item.type === 'mcp_tool_call') {
      const endpoint = text(item.tool ?? item.name ?? item.server ?? 'mcp_tool_call');
      const status = text(item.status);
      const failed = status === 'failed';
      const result = item.result ?? item.output;
      const error = failed
        ? typeof result === 'string'
          ? result
          : JSON.stringify(result)
        : undefined;
      const call = {
        endpoint,
        name: 'tool_use',
        body: item,
        result: failed ? undefined : result,
        error,
        ts: Date.now(),
      };
      toolCalls.push(call);
      transcript.push({
        type: 'tool_call',
        name: endpoint,
        input: item,
        output: failed ? undefined : result,
        ...(error ? { error } : {}),
      });
    }
  }

  // OracleAgent executes the reference solution directly instead of through a
  // model, so Harbor emits no structured command items for it. Some unchanged
  // upstream scorers intentionally inspect whether a CLI workflow was used.
  // Accept the reference solution's truthful command record only when Harbor's
  // own oracle log exists and there is no model trajectory; a Codex agent cannot
  // opt into this path by writing a workspace file.
  const oracleLog = '/logs/agent/oracle.txt';
  const oracleActionsPath = join(workdir, '.oracle', 'source-tool-calls.json');
  if (
    toolCalls.length === 0 &&
    agentMessages.length === 0 &&
    existsSync(oracleLog) &&
    existsSync(oracleActionsPath)
  ) {
    try {
      const actions = JSON.parse(readFileSync(oracleActionsPath, 'utf8'));
      if (Array.isArray(actions)) {
        for (const action of actions) {
          if (!action || typeof action.command !== 'string') continue;
          const result = {
            ok: true,
            exitCode: 0,
            exit_code: 0,
            stdout: text(action.stdout),
            stderr: '',
          };
          const call = {
            endpoint: 'shell',
            name: 'shell',
            command: action.command,
            body: { command: action.command },
            result,
            ts: Date.now(),
          };
          toolCalls.push(call);
          transcript.push({
            type: 'tool_call',
            name: 'shell',
            input: { command: action.command },
            output: result,
          });
        }
      }
    } catch {
      // A malformed Oracle record is simply absent evidence; the source scorer
      // remains authoritative and will fail any method check that needs it.
    }
  }

  // Harbor's OracleAgent executes the reference solution and commonly leaves
  // its report in the shared answer artifact without emitting a Codex
  // transcript. The original scorer receives that report as `agentReport`, so
  // use it only when there is no real agent final message to preserve.
  const answerPath = join(workdir, 'answer.md');
  const oracleReport = existsSync(answerPath)
    ? readFileSync(answerPath, 'utf8').trim()
    : '';
  if (agentMessages.length === 0 && oracleReport) {
    transcript.push({ type: 'message', role: 'assistant', content: oracleReport });
  }

  return {
    transcript,
    toolCalls,
    // The source harness exposes the final report; Oracle uses answer.md as
    // the equivalent report artifact when no agent transcript exists.
    agentReport: agentMessages.at(-1) ?? oracleReport,
  };
}

function frontmatterValue(name) {
  if (!existsSync(sourcePromptPath)) return undefined;
  const source = readFileSync(sourcePromptPath, 'utf8');
  const match = source.match(new RegExp(`^${name}:\\s*([^\\n]+)`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function isToolsEval() {
  if (existsSync(sourceModePath)) {
    return readFileSync(sourceModePath, 'utf8').trim() === 'tools';
  }
  return frontmatterValue('interface') === 'mcp';
}

function isHostedEval() {
  return frontmatterValue('hostedProject') === 'true';
}

function extractJson(textValue) {
  const source = text(textValue);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

async function runCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd ?? workdir,
      env: { ...process.env, ...(options.env ?? {}) },
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: text(result.stdout),
      stderr: text(result.stderr),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: error?.code === undefined ? null : Number(error.code),
      stdout: text(error?.stdout),
      stderr: text(error?.stderr || error?.message),
    };
  }
}

function safeWorkspacePath(path) {
  const candidate = resolve(workdir, path);
  const root = resolve(workdir);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    throw new Error(`scorer path escapes workspace: ${path}`);
  }
  return candidate;
}

let statusPromise;
async function localStatus() {
  statusPromise ??= (async () => {
    const result = await runCommand('supabase', ['status', '-o', 'json']);
    const parsed = extractJson(result.stdout);
    if (!result.ok || !parsed) {
      throw new Error(
        `supabase status failed: ${result.stderr || result.stdout || 'no JSON output'}`
      );
    }
    return parsed;
  })();
  return statusPromise;
}

function firstString(record, names) {
  for (const name of names) {
    const value = record?.[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

async function localConnection() {
  const status = await localStatus();
  return firstString(status, ['DB_URL', 'db_url', 'DB URL']) ||
    process.env.SUPABASE_DB_URL ||
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

async function localApi() {
  const status = await localStatus();
  return {
    url: firstString(status, ['API_URL', 'api_url', 'API URL', 'Project URL']),
    key: firstString(status, [
      'ANON_KEY',
      'anon_key',
      'Publishable',
      'PUBLISHABLE_KEY',
    ]),
  };
}

let localSql;
async function localQuery(sqlText) {
  localSql ??= postgres(await localConnection(), {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const rows = await localSql.unsafe(sqlText);
  return { rows: Array.isArray(rows) ? rows : [] };
}

async function localClient() {
  const api = await localApi();
  if (!api.url || !api.key) throw new Error('supabase status did not provide API_URL and ANON_KEY');
  return createClient(api.url, api.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let platformKeysPromise;
async function platformKeys() {
  platformKeysPromise ??= (async () => {
    const base = process.env.SUPABASE_PLATFORM_URL;
    const ref = process.env.SUPABASE_PROJECT_REF;
    if (!base || !ref) throw new Error('SUPABASE_PLATFORM_URL and SUPABASE_PROJECT_REF are required');
    const response = await fetch(`${base}/v1/projects/${ref}/api-keys`, {
      headers: process.env.SUPABASE_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }
        : {},
    });
    if (!response.ok) throw new Error(`platform api-keys failed: ${response.status} ${await response.text()}`);
    const values = await response.json();
    const anon = values.find((value) => value?.name === 'anon')?.api_key;
    const service = values.find((value) => value?.name === 'service_role')?.api_key;
    if (!anon || !service) throw new Error('platform api-keys response lacks anon/service_role keys');
    return { anon, service };
  })();
  return platformKeysPromise;
}

function platformHeaders(extra = {}) {
  return {
    ...(process.env.SUPABASE_ACCESS_TOKEN
      ? { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }
      : {}),
    ...extra,
  };
}

async function platformQuery(sqlText) {
  const base = process.env.SUPABASE_PLATFORM_URL;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!base || !ref) throw new Error('platform query requested without platform environment');
  const response = await fetch(`${base}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: platformHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ query: sqlText }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`platform query failed: ${response.status} ${body}`);
  const parsed = JSON.parse(body);
  return { rows: Array.isArray(parsed) ? parsed : parsed?.rows ?? [] };
}

function platformClient(key) {
  const base = process.env.SUPABASE_PLATFORM_URL;
  const ref = process.env.SUPABASE_PROJECT_REF;
  return createClient(`${base}/v1/projects/${ref}`, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function invokeFunction(input) {
  const base = process.env.SUPABASE_PLATFORM_URL;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!base || !ref) throw new Error('function invocation requested without platform environment');
  const method = (input.method ?? 'POST').toUpperCase();
  const headers = { ...(input.headers ?? {}) };
  const hasBody = method !== 'GET' && method !== 'HEAD' && input.body !== undefined;
  let body;
  if (hasBody) {
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }
  const response = await fetch(
    `${base}/v1/projects/${ref}/functions/v1/${input.name}${input.path ?? ''}`,
    { method, headers, body },
  );
  const tokens = response.headers.get('x-supabase-outbound-bearer-tokens');
  return {
    type: 'response',
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
    outboundBearerTokens: tokens ? tokens.split(',').filter(Boolean) : [],
  };
}

function toolsContext(trajectory) {
  const platform = process.env.SUPABASE_PLATFORM_URL;
  const ref = process.env.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const mgmt = createOpenApiClient({
    baseUrl: platform,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  return (async () => {
    const keys = await platformKeys();
    const context = {
      mgmt,
      ref,
      client: platformClient(keys.anon),
      getClient: () => platformClient(keys.anon),
      query: platformQuery,
      invokeFunction,
      ...trajectory,
    };
    return context;
  })();
}

// The upstream harness runs withheld frontend tests with the same lightweight
// Supabase implementation used by the original eval runner.  Keep that
// setup in the Harbor execution adapter rather than changing the source
// EVAL.ts or its hidden tests.
function vitestSetupSource() {
  return `
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "vitest";
import { App, getAuthSchemaSql, SUPABASE_AUTH_HELPERS_SQL } from "@supabase/lite";
import { createPgliteConnection } from "@supabase/lite/pglite";

const PROJECT_DB_URL = "http://supabase-evals.local";
const PROJECT_DB_ANON_KEY = "supabase-evals-anon-key";
const PROJECT_DB_JWT_SECRET = "supabase-evals-dev-secret";
const AUTH_SQL = \`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
DO $$
BEGIN
  EXECUTE format('GRANT anon, authenticated, service_role TO %I', current_user);
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
\`;

const workspace = process.env.SUPABASE_EVALS_WORKSPACE;
if (!workspace) throw new Error("SUPABASE_EVALS_WORKSPACE is required");

const connection = await createPgliteConnection();
const app = new App({
  connection,
  auth: {
    enabled: true,
    jwt_secret: PROJECT_DB_JWT_SECRET,
    enable_signup: true,
    email: { enable_confirmations: false },
  },
});

await app.init();
await connection.driver.exec(AUTH_SQL);
await connection.driver.exec(SUPABASE_AUTH_HELPERS_SQL);
await connection.driver.exec(getAuthSchemaSql());

const schemaDir = join(workspace, "supabase", "schemas");
if (existsSync(schemaDir)) {
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".sql")).sort()) {
    await connection.driver.exec(readFileSync(join(schemaDir, file), "utf8"));
  }
}

const seed = join(workspace, "supabase", "seed.sql");
if (existsSync(seed)) {
  await connection.driver.exec(readFileSync(seed, "utf8"));
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).origin === PROJECT_DB_URL) {
    return app.fetch(request);
  }
  return originalFetch(input, init);
};

Object.assign(globalThis, {
  __SUPABASE_EVALS_APP__: app,
  __SUPABASE_EVALS_CLIENT__: app.getClient(),
  __SUPABASE_EVALS_URL__: PROJECT_DB_URL,
  __SUPABASE_EVALS_ANON_KEY__: PROJECT_DB_ANON_KEY,
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await connection.close();
});
`;
}

function prepareVitestHarness() {
  const setupDir = join(workdir, '.evals');
  const setupFile = join(setupDir, 'vitest-supalite-setup.ts');
  const configPath = join(workdir, 'vitest.evals.config.ts');
  const reportPath = join(workdir, 'vitest-report.json');
  mkdirSync(setupDir, { recursive: true });
  writeFileSync(setupFile, vitestSetupSource());
  writeFileSync(
    configPath,
    [
      'import { defineConfig } from "vitest/config";',
      '',
      'export default defineConfig({',
      '  test: {',
      '    environment: "happy-dom",',
      '    setupFiles: ["./.evals/vitest-supalite-setup.ts"],',
      '    include: ["tests/**/*.test.{ts,tsx}"],',
      '  },',
      '});',
      '',
    ].join('\n'),
  );
  return { configPath, reportPath };
}

function parseVitestReport(path) {
  if (!existsSync(path)) return undefined;
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const results = Array.isArray(report.testResults) ? report.testResults : [];
    const assertions = results.flatMap((file) =>
      Array.isArray(file.assertionResults) ? file.assertionResults : []
    );
    const failures = assertions
      .filter((assertion) => assertion.status === 'failed')
      .flatMap((assertion) => assertion.failureMessages ?? [
        `${assertion.fullName ?? assertion.title} failed`,
      ]);
    return { ok: report.success === true, failures };
  } catch {
    return undefined;
  }
}

function localContext(trajectory) {
  const context = {
    workspace: workdir,
    exec: (command, options = {}) => runCommand('bash', ['-lc', command], {
      cwd: workdir,
      timeoutMs: options.timeoutMs ?? 120_000,
    }),
    readFile: async (path) => readFileSync(safeWorkspacePath(path), 'utf8'),
    fileExists: async (path) => existsSync(safeWorkspacePath(path)),
    folderExists: async (path) => existsSync(safeWorkspacePath(path)) &&
      (await runCommand('test', ['-d', safeWorkspacePath(path)])).ok,
    query: localQuery,
    getClient: localClient,
    hostWorkspace: workdir,
    hostedRef: isHostedEval() ? process.env.SUPABASE_PROJECT_REF : undefined,
    hostedMgmt: isHostedEval() && process.env.SUPABASE_PLATFORM_URL
      ? createOpenApiClient({
          baseUrl: process.env.SUPABASE_PLATFORM_URL,
          headers: platformHeaders(),
        })
      : undefined,
    hostedQuery:
      isHostedEval() && process.env.SUPABASE_PLATFORM_URL
        ? platformQuery
        : undefined,
    invokeHostedFunction:
      isHostedEval() && process.env.SUPABASE_PLATFORM_URL
        ? invokeFunction
        : undefined,
    runViteBuild: () => runCommand('bash', ['-lc', 'npm run build'], { cwd: workdir }),
    runVitest: async () => {
      const { configPath, reportPath } = prepareVitestHarness();
      const result = await runCommand(
        'npx',
        [
          'vitest',
          'run',
          '--config',
          configPath,
          '--reporter=json',
          `--outputFile=${reportPath}`,
        ],
        {
          cwd: workdir,
          env: { SUPABASE_EVALS_WORKSPACE: workdir },
        },
      );
      const report = parseVitestReport(reportPath);
      return report ? { ...result, ...report } : result;
    },
    ...trajectory,
  };
  return context;
}

async function execute() {
  if (!existsSync(sourceTestsDir)) throw new Error(`missing hidden source tests at ${sourceTestsDir}`);
  // Import from a directory with local/remote fixtures beside EVAL.ts. This
  // preserves source relative imports such as `new URL('./local/.env', ...)`
  // while keeping the hidden payload outside the agent workspace.
  mkdirSync(runtimeEvalDir, { recursive: true });
  cpSync(sourceTestsDir, runtimeEvalDir, { recursive: true, force: true });
  // The source harness runs withheld Vitest files against the agent workspace.
  // Harbor keeps them under /tests until verification, so stage them only now
  // and never expose them during the agent phase.
  if (existsSync(sourceHiddenTestsDir)) {
    cpSync(sourceHiddenTestsDir, join(workdir, 'tests'), {
      recursive: true,
      force: true,
    });
  }

  const trajectory = sourceTrajectory();
  const module = await import(pathToFileURL(sourceEvalPath).href);
  const scorer = module.default;
  if (typeof scorer !== 'function') throw new Error('source EVAL.ts has no default scorer function');

  const context = isToolsEval()
    ? await toolsContext(trajectory)
    : localContext(trajectory);
  const result = await scorer(context);
  const sourceIdPath = join(runtimeEvalDir, 'id');
  const sourceId = existsSync(sourceIdPath)
    ? readFileSync(sourceIdPath, 'utf8').trim()
    : '';
  const normalized = {
    passed: result?.passed === true,
    checks: Array.isArray(result?.checks) ? result.checks : [],
    sourceEval: text(
      frontmatterValue('source_eval') || process.env.SUPABASE_EVAL_ID || sourceId
    ),
    mode: isToolsEval() ? 'tools' : 'local-stack',
    judge: process.env.HARBOR_JUDGE_COMMAND ? 'configured' : 'source-command-required',
  };
  const judgeInfrastructureFailure = normalized.checks.find((check) =>
    text(check?.notes).includes('HARBOR_JUDGE_INFRASTRUCTURE_ERROR:')
  );
  if (judgeInfrastructureFailure) {
    throw new Error(text(judgeInfrastructureFailure.notes));
  }
  writeFileSync(scorePath, `${JSON.stringify(normalized, null, 2)}\n`);
  writeFileSync(rewardPath, normalized.passed ? '1\n' : '0\n');
  process.stdout.write(`${JSON.stringify(normalized)}\n`);
  return normalized.passed;
}

try {
  const passed = await execute();
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  const failure = {
    passed: false,
    infrastructureError: true,
    checks: [{ name: 'source EVAL.ts executed', passed: false, notes: error?.stack || text(error) }],
  };
  writeFileSync(scorePath, `${JSON.stringify(failure, null, 2)}\n`);
  // Missing reward is a Harbor verifier exception. A scorer transport/runtime
  // failure is not a model score and must never be silently recorded as zero.
  unlinkSync(rewardPath, { force: true });
  process.stderr.write(`${failure.checks[0].notes}\n`);
  process.exitCode = 2;
}
