#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'harbor', 'migration-manifest.json'), 'utf8')
);
const requestedJobDirs = process.argv.slice(2);
const jobDirs = (
  requestedJobDirs.length > 0
    ? requestedJobDirs
    : [
        'targeted-parity-3x/oracle-final-tools-v2/oracle-final-tools-v2',
        'targeted-parity-3x/oracle-final-local-v2/oracle-final-local-v2',
      ]
).map((jobDir) => path.resolve(root, jobDir));

const rows = [];
for (const jobDir of jobDirs) {
  if (!fs.existsSync(jobDir)) continue;
  for (const entry of fs.readdirSync(jobDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const resultPath = path.join(jobDir, entry.name, 'result.json');
    if (!fs.existsSync(resultPath)) continue;
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    rows.push({
      task: String(result.task_name ?? '').replace(/^supabase\//, ''),
      reward: result.verifier_result?.rewards?.reward ?? null,
      exception: result.exception_info?.exception_type ?? null,
      taskChecksum: result.task_checksum ?? null,
      trialName: result.trial_name,
      jobDir: path.relative(root, jobDir),
    });
  }
}

const expected = new Set(manifest.tasks.map((task) => task.id));
const observed = new Set(rows.map((row) => row.task));
const failures = [];
for (const task of expected) {
  if (!observed.has(task)) failures.push(`${task}: missing final Oracle result`);
}
for (const row of rows) {
  if (!expected.has(row.task)) failures.push(`${row.task}: unexpected final Oracle result`);
  if (row.reward !== 1 || row.exception !== null) {
    failures.push(
      `${row.task}: reward=${String(row.reward)} exception=${String(row.exception)}`
    );
  }
}
if (rows.length !== observed.size) failures.push('duplicate task results in final Oracle jobs');

const report = {
  generatedAt: new Date().toISOString(),
  expected: expected.size,
  observed: observed.size,
  passes: rows.filter((row) => row.reward === 1 && row.exception === null).length,
  failures,
  rows: rows.sort((a, b) => a.task.localeCompare(b.task)),
};
fs.writeFileSync(
  path.join(root, 'targeted-parity-3x', 'oracle-final-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 && rows.length === expected.size ? 0 : 1;
