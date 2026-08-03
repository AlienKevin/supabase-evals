// Runtime-only compatibility surface for source EVAL.ts modules. Type imports
// are erased by tsx; these are the source helpers that remain at runtime.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export function serializeTranscript(transcript, options = {}) {
  const includeInputs = options.includeToolCallInputs ?? false;
  const includeOutputs = options.includeToolCallOutputs ?? false;
  return (transcript ?? [])
    .map((part) => {
      if (part?.type === 'message') {
        const content = String(part.content ?? '').trim();
        return content ? `[${part.role ?? 'unknown'}]\n${content}` : '';
      }
      if (part?.type !== 'tool_call') return '';
      const lines = [`[called ${String(part.name ?? 'unknown')}]`];
      if (includeInputs) lines.push(`input:\n${JSON.stringify(part.input ?? {}, null, 2)}`);
      if (includeOutputs) {
        if (part.error) lines.push(`error:\n${part.error}`);
        else if (part.output !== undefined) lines.push(`output:\n${JSON.stringify(part.output, null, 2)}`);
      }
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

export function unwrapEdgeFunctionResponse(result) {
  if (result?.type === 'error') throw new Error(result.error);
  if (!result || result.type !== 'response') {
    throw new Error('edge function did not return a response');
  }
  return result;
}

export function readEnvVariable(filePath, name) {
  let contents;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`could not read env file ${String(filePath)}: ${error?.message ?? error}`);
  }
  const value = parseEnv(contents)[name];
  if (value === undefined) {
    throw new Error(`${name} not found in env file ${String(filePath)}`);
  }
  return value;
}

/**
 * Preserve the source judge call. The default implementation uses an
 * explicitly configured judge command so the adapter never silently changes a
 * judge-scored eval into a regex check. The command must print JSON with
 * `passed` and optional `notes` fields.
 */
export async function judge({ input, rubric }) {
  const command = process.env.HARBOR_JUDGE_COMMAND;
  if (!command) {
    throw new Error(
      'source scorer requested judge(...), but HARBOR_JUDGE_COMMAND is not configured'
    );
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const payload = JSON.stringify({ input, rubric });
  // MCP/search transcripts can be larger than the platform's environment-size
  // limit. Keep the same command contract, but pass large payloads through a
  // verifier-only temporary file instead of forcing them into execve(2)'s env.
  const payloadDir = mkdtempSync(join(tmpdir(), 'harbor-judge-'));
  const payloadPath = join(payloadDir, 'payload.json');
  writeFileSync(payloadPath, payload);
  // The command is intentionally configured outside the agent-visible task
  // workspace. It may be a path or a shell command with fixed arguments (for
  // example, a verifier-only Codex judge wrapper), but there is deliberately
  // no deterministic fallback here.
  let stdout;
  try {
    try {
      const { stdout: result } = await run('bash', ['-lc', command], {
        env: {
          ...process.env,
          // Preserve the legacy variable for small custom payloads while using
          // the file for all payloads so the configured bridge is size-safe.
          HARBOR_JUDGE_PAYLOAD: payload.length < 32_000 ? payload : '',
          HARBOR_JUDGE_PAYLOAD_FILE: payloadPath,
        },
        maxBuffer: 8 * 1024 * 1024,
      });
      stdout = result;
    } catch (error) {
      throw new Error(
        `HARBOR_JUDGE_INFRASTRUCTURE_ERROR: judge command failed: ${
          error?.message ?? String(error)
        }`,
        { cause: error }
      );
    }
  } finally {
    rmSync(payloadDir, { recursive: true, force: true });
  }
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(
      'HARBOR_JUDGE_INFRASTRUCTURE_ERROR: judge command did not return a JSON object'
    );
  }
  let result;
  try {
    result = JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      `HARBOR_JUDGE_INFRASTRUCTURE_ERROR: judge command returned invalid JSON: ${
        error?.message ?? String(error)
      }`,
      { cause: error }
    );
  }
  if (typeof result?.passed !== 'boolean') {
    throw new Error(
      'HARBOR_JUDGE_INFRASTRUCTURE_ERROR: judge result is missing boolean passed'
    );
  }
  return { passed: result.passed, notes: String(result.notes ?? '') };
}
