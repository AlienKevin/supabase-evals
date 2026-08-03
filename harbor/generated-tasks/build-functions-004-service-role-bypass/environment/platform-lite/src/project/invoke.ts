import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ts from 'typescript';
import type { ProjectInstance } from './ProjectInstance.js';

export type EdgeFunctionsInvokeInput = {
  name: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type EdgeFunctionsInvokeResponse = {
  type: 'response';
  status: number;
  headers: Record<string, string>;
  body: string;
  outboundBearerTokens: string[];
};

export type EdgeFunctionsInvokeResult =
  | EdgeFunctionsInvokeResponse
  | { type: 'error'; error: string };

const nodeRequire = createRequire(import.meta.url);
const RUNTIME_URL = 'http://supabase-evals.local';

export async function invokeEdgeFunction(
  instance: ProjectInstance,
  input: EdgeFunctionsInvokeInput
): Promise<EdgeFunctionsInvokeResult> {
  const outboundBearerTokens: string[] = [];
  try {
    const fn = instance.functions.get(input.name);
    if (!fn) throw new Error(`edge function not found: ${input.name}`);
    const source = fn.files[0]?.content;
    if (!source) throw new Error(`edge function ${input.name} has no source`);

    const method = (input.method ?? 'POST').toUpperCase();
    const headers = new Headers(input.headers ?? {});
    if (fn.verify_jwt && !headers.has('authorization')) {
      return {
        type: 'response',
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing authorization header' }),
        outboundBearerTokens,
      };
    }

    const projectFetch = (req: Request) => {
      const bearer = req.headers
        .get('authorization')
        ?.replace(/^Bearer\s+/i, '');
      if (bearer) outboundBearerTokens.push(bearer);
      return instance.app.fetch(req);
    };
    const runtimeFetch = createRuntimeFetch(RUNTIME_URL, projectFetch);
    const env: Record<string, string> = {
      ...Object.fromEntries(instance.secrets),
      SUPABASE_URL: RUNTIME_URL,
      SUPABASE_ANON_KEY: generateProjectKey(
        instance.ref,
        instance.jwtSecret,
        'anon'
      ),
      SUPABASE_SERVICE_ROLE_KEY: generateProjectKey(
        instance.ref,
        instance.jwtSecret,
        'service_role'
      ),
    };
    const handler = compileEdgeFunction(source, env, runtimeFetch);

    const hasBody =
      method !== 'GET' && method !== 'HEAD' && input.body !== undefined;
    const bodyStr =
      typeof input.body === 'string'
        ? input.body
        : input.body === undefined
          ? undefined
          : JSON.stringify(input.body);
    if (bodyStr !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await Promise.resolve(
      handler(
        new Request(
          `https://project-ref.functions.supabase.co/${input.name}${input.path ?? ''}`,
          { method, headers, body: hasBody ? bodyStr : undefined }
        )
      )
    );
    if (!(response instanceof Response)) {
      throw new Error(`edge function ${input.name} did not return a Response`);
    }

    return {
      type: 'response',
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
      outboundBearerTokens,
    };
  } catch (error) {
    return {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function generateProjectKey(
  ref: string,
  jwtSecret: string,
  role: 'anon' | 'service_role'
): string {
  const b64url = (value: string) => Buffer.from(value).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({
      role,
      iss: 'supabase-lite',
      ref,
      iat: Math.floor(Date.now() / 1000),
      exp: 9999999999,
    })
  );
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

type EdgeHandler = (req: Request) => unknown;

function createRuntimeFetch(
  runtimeUrl: string,
  projectFetch: (req: Request) => Promise<Response>
): typeof fetch {
  const origin = new URL(runtimeUrl).origin;
  return async (input, init) => {
    const req = new Request(input, init);
    const reqOrigin = new URL(req.url).origin;
    if (reqOrigin === origin || reqOrigin === 'http://localhost') {
      return projectFetch(req);
    }
    return fetch(req);
  };
}

function compileEdgeFunction(
  source: string,
  env: Record<string, string>,
  runtimeFetch: typeof fetch
): EdgeHandler {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  let denoServeHandler: EdgeHandler | undefined;
  const exports: Record<string, unknown> = {};
  const moduleState: { exports: Record<string, unknown> } = { exports };

  const requireFromSandbox = (specifier: string) => {
    if (specifier === 'jsr:@supabase/functions-js/edge-runtime.d.ts') return {};
    const id = toNodeRequireId(specifier);
    if (id === '@supabase/supabase-js' || id?.startsWith('@supabase/supabase-js/')) {
      return {
        createClient: (
          url: string,
          key: string,
          options: Parameters<typeof createClient>[2] = {}
        ): SupabaseClient =>
          createClient(url, key, {
            ...options,
            global: { ...options?.global, fetch: runtimeFetch },
          }) as SupabaseClient,
      };
    }
    if (id) {
      try {
        return nodeRequire(id);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
        throw new Error(
          `edge function dependency "${specifier}" is not available in the eval runtime (${code ?? (error instanceof Error ? error.message : String(error))})`
        );
      }
    }
    throw new Error(`edge function import not supported: ${specifier}`);
  };

  const sandbox = {
    Deno: {
      serve: (optOrHandler: unknown, maybeHandler?: unknown) => {
        const handler =
          typeof optOrHandler === 'function' ? optOrHandler : maybeHandler;
        if (typeof handler !== 'function') throw new Error('Deno.serve requires a handler');
        denoServeHandler = (req) => handler(req);
      },
      env: { get: (key: string) => env[key] },
    },
    fetch: runtimeFetch,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    Blob,
    FormData,
    TextDecoder,
    TextEncoder,
    atob,
    btoa,
    crypto,
    console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    exports,
    module: moduleState,
    require: requireFromSandbox,
  };

  vm.runInNewContext(js, sandbox, { timeout: 1000, displayErrors: true });
  const handler =
    denoServeHandler ??
    functionToEdgeHandler(moduleState.exports.default) ??
    functionToEdgeHandler(exports.default);
  if (!handler) throw new Error('edge function must call Deno.serve(handler) or export a default handler');
  return handler;
}

function functionToEdgeHandler(value: unknown): EdgeHandler | undefined {
  if (typeof value !== 'function') return undefined;
  return (req) => value(req);
}

function toNodeRequireId(specifier: string): string | undefined {
  if (specifier.startsWith('node:')) return specifier;
  if (specifier.startsWith('npm:')) return stripModuleVersion(specifier.slice(4));
  if (specifier.startsWith('jsr:')) return stripModuleVersion(specifier.slice(4));
  const cdn = specifier.match(
    /^https?:\/\/(?:esm\.sh|esm\.run|cdn\.skypack\.dev|cdn\.jsdelivr\.net\/npm)\/(?:v\d+\/)?(.+)$/
  );
  if (cdn) return stripModuleVersion(cdn[1]);
  if (/^https?:\/\//.test(specifier)) return undefined;
  if (!specifier.includes(':')) return specifier;
  return undefined;
}

function stripModuleVersion(specifier: string): string {
  let scope = '';
  let rest = specifier;
  if (specifier.startsWith('@')) {
    const slash = specifier.indexOf('/');
    if (slash === -1) return specifier;
    scope = specifier.slice(0, slash + 1);
    rest = specifier.slice(slash + 1);
  }
  const at = rest.indexOf('@');
  if (at === -1) return scope + rest;
  const slashAfter = rest.indexOf('/', at);
  return scope + rest.slice(0, at) + (slashAfter === -1 ? '' : rest.slice(slashAfter));
}
