#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const manifest = JSON.parse(
  readFileSync(join(root, 'harbor', 'migration-manifest.json'), 'utf8')
);
const overrides = new Map([
  ['build-rls-003-org-roles-permissions', 'harbor-oracle-results-v7'],
  [
    'resolve-storage-001-upsert-missing-update-policy',
    'harbor-oracle-results-v7',
  ],
]);

const failures = [];
const rows = [];
for (const task of manifest.tasks) {
  const jobsDir = overrides.get(task.id) ?? 'harbor-oracle-results-v3';
  const jobDir = join(root, jobsDir, `${task.id}-oracle`);
  if (!existsSync(jobDir)) {
    failures.push(`${task.id}: missing job directory`);
    continue;
  }
  const trialDir = readdirSync(jobDir).find((entry) =>
    existsSync(join(jobDir, entry, 'result.json'))
  );
  if (!trialDir) {
    failures.push(`${task.id}: missing trial result`);
    continue;
  }
  const result = JSON.parse(
    readFileSync(join(jobDir, trialDir, 'result.json'), 'utf8')
  );
  const reward = result.verifier_result?.rewards?.reward;
  const exception = result.exception_info?.exception_type ?? null;
  rows.push({ id: task.id, jobsDir, reward, exception });
  if (reward !== 1 || exception !== null) {
    failures.push(
      `${task.id}: reward=${String(reward)} exception=${String(exception)}`
    );
  }
}

const report = {
  total: rows.length,
  passes: rows.filter((row) => row.reward === 1 && row.exception === null)
    .length,
  failures,
  rows,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length > 0 || rows.length !== manifest.tasks.length ? 1 : 0;
