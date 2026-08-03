#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const matter = require('../../packages/core/node_modules/gray-matter');
const TASKS_DIR = join(ROOT, 'harbor', 'generated-tasks');
const manifest = JSON.parse(
  readFileSync(join(ROOT, 'harbor', 'migration-manifest.json'), 'utf8')
);
const required = [
  'instruction.md',
  'task.toml',
  'environment/Dockerfile',
  'solution/solve.sh',
  'tests/test.sh',
];

const failures = [];

function relativeFiles(directory, base = directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const entry = join(directory, name);
      if (statSync(entry).isDirectory()) return relativeFiles(entry, base);
      const relativePath = entry.slice(base.length + 1);
      return relativePath === '.gitkeep' ? [] : [relativePath];
    });
}

function verifyCopiedTree(id, label, source, target) {
  const sourceFiles = relativeFiles(source);
  const targetFiles = relativeFiles(target);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    failures.push(`${id}: ${label} file list differs from upstream`);
    return;
  }
  for (const file of sourceFiles) {
    if (readFileSync(join(source, file)).compare(readFileSync(join(target, file))) !== 0) {
      failures.push(`${id}: ${label}/${file} differs from upstream`);
    }
  }
}

const taskDirs = readdirSync(TASKS_DIR).filter((name) =>
  statSync(join(TASKS_DIR, name)).isDirectory()
);

if (taskDirs.length !== 38) {
  failures.push(`expected 38 generated tasks, found ${taskDirs.length}`);
}
if (manifest.counts.total !== taskDirs.length) {
  failures.push(
    `manifest total ${manifest.counts.total} does not match ${taskDirs.length}`
  );
}
if (manifest.counts.runnablePilots !== 38) {
  failures.push(
    `expected 38 runnable Oracle tasks, found ${manifest.counts.runnablePilots}`
  );
}

for (const id of taskDirs) {
  const taskDir = join(TASKS_DIR, id);
  for (const path of required) {
    if (!existsSync(join(taskDir, path))) failures.push(`${id}: missing ${path}`);
  }

  const taskToml = readFileSync(join(taskDir, 'task.toml'), 'utf8');
  if (!taskToml.includes('schema_version = "1.0"')) {
    failures.push(`${id}: task.toml does not declare Harbor v0.20 schema 1.0`);
  }
  if (!taskToml.includes(`name = "supabase/${id}"`)) {
    failures.push(`${id}: task package name does not preserve eval id`);
  }

  const instruction = readFileSync(join(taskDir, 'instruction.md'), 'utf8');
  if (instruction.startsWith('---')) {
    failures.push(`${id}: YAML frontmatter leaked into instruction.md`);
  }
  const sourcePromptPath = join(ROOT, 'evals', id, 'PROMPT.md');
  const sourceScorerPath = join(ROOT, 'evals', id, 'EVAL.ts');
  if (!existsSync(sourcePromptPath)) {
    failures.push(`${id}: source PROMPT.md is missing`);
  } else {
    const sourcePrompt = readFileSync(sourcePromptPath, 'utf8');
    const sourceBody = `${matter(sourcePrompt).content.trim()}\n`;
    if (instruction !== sourceBody) {
      failures.push(`${id}: instruction.md differs from the source prompt body`);
    }
    if (
      readFileSync(join(taskDir, 'tests', 'source', 'PROMPT.md'), 'utf8') !==
      sourcePrompt
    ) {
      failures.push(`${id}: verifier PROMPT.md differs from the source file`);
    }
  }
  if (!existsSync(sourceScorerPath)) {
    failures.push(`${id}: source EVAL.ts is missing`);
  } else if (
    readFileSync(join(taskDir, 'tests', 'source', 'EVAL.ts'), 'utf8') !==
    readFileSync(sourceScorerPath, 'utf8')
  ) {
    failures.push(`${id}: verifier EVAL.ts differs from the source scorer`);
  }

  for (const fixture of ['local', 'remote']) {
    verifyCopiedTree(
      id,
      `${fixture} execution fixture`,
      join(ROOT, 'evals', id, fixture),
      join(taskDir, 'environment', 'seed', fixture)
    );
    verifyCopiedTree(
      id,
      `${fixture} verifier fixture`,
      join(ROOT, 'evals', id, fixture),
      join(taskDir, 'tests', 'source', fixture)
    );
  }
  verifyCopiedTree(
    id,
    'hidden tests',
    join(ROOT, 'evals', id, 'tests'),
    join(taskDir, 'tests', 'source', 'tests')
  );
  verifyCopiedTree(
    id,
    'source runtime',
    join(ROOT, 'harbor', 'source-runtime'),
    join(taskDir, 'environment', 'source-runtime')
  );

  for (const script of ['solution/solve.sh', 'tests/test.sh']) {
    const mode = statSync(join(taskDir, script)).mode;
    if ((mode & 0o111) === 0) failures.push(`${id}: ${script} is not executable`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${taskDirs.length} generated Harbor task structures and ${manifest.counts.runnablePilots} runnable Oracle tasks.`
);
