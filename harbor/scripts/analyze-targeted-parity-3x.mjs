import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'targeted-parity-3x');

const groups = {
  skills: {
    upstreamExperiment: 'codex-gpt-5.6',
    tasks: [
      'build-cli-003-pg-cron-queue-workflow',
      'investigate-auth-001-deleted-user-access',
    ],
    harborSources: [
      {
        job: path.join(OUT, 'harbor-skills', 'targeted-parity-3x-skills'),
        tasks: ['build-cli-003-pg-cron-queue-workflow'],
        label: 'original-targeted-run',
      },
      {
        job: path.join(
          OUT,
          'harbor-skills-postfix',
          'targeted-parity-3x-skills-postfix'
        ),
        tasks: ['investigate-auth-001-deleted-user-access'],
        label: 'post-judge-transport-fix',
      },
    ],
  },
  noskills: {
    upstreamExperiment: 'codex-gpt-5.6-no-skills',
    tasks: [
      'build-cli-003-pg-cron-queue-workflow',
      'investigate-realtime-001-subscribed-no-events',
      'build-functions-005-dual-auth-user-secret',
      'investigate-auth-001-deleted-user-access',
    ],
    harborSources: [
      {
        job: path.join(OUT, 'harbor-noskills', 'targeted-parity-3x-noskills'),
        tasks: [
          'build-cli-003-pg-cron-queue-workflow',
          'build-functions-005-dual-auth-user-secret',
        ],
        label: 'original-targeted-run',
      },
      {
        job: path.join(
          OUT,
          'harbor-noskills-postfix',
          'targeted-parity-3x-noskills-postfix'
        ),
        tasks: [
          'investigate-realtime-001-subscribed-no-events',
          'investigate-auth-001-deleted-user-access',
        ],
        label: 'post-judge-transport-fix',
      },
    ],
  },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values) {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
      (values.length - 1)
  );
}

function summary(values) {
  const sd = sampleSd(values);
  return { values, mean: mean(values), sd, sem: sd / Math.sqrt(values.length) };
}

function pooledSd(a, b) {
  const aSd = sampleSd(a);
  const bSd = sampleSd(b);
  const degrees = a.length + b.length - 2;
  if (degrees <= 0) return 0;
  return Math.sqrt(
    ((a.length - 1) * aSd ** 2 + (b.length - 1) * bSd ** 2) / degrees
  );
}

function upstreamSamples(groupName, group) {
  const byTask = Object.fromEntries(group.tasks.map((task) => [task, []]));
  for (let run = 1; run <= 3; run += 1) {
    const runLabel = String(run).padStart(2, '0');
    for (const task of group.tasks) {
      const file = path.join(
        OUT,
        'upstream',
        `run-${runLabel}`,
        groupName,
        `${task}.json`
      );
      const result = readJson(file);
      byTask[task].push({
        run,
        passed: Boolean(result.passed),
        checks: result.checks ?? [],
        stoppedReason: result.stoppedReason ?? null,
      });
    }
  }
  return byTask;
}

function harborSamples(group) {
  const byTask = Object.fromEntries(group.tasks.map((task) => [task, []]));
  for (const source of group.harborSources) {
    for (const entry of fs.readdirSync(source.job, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const resultPath = path.join(source.job, entry.name, 'result.json');
      if (!fs.existsSync(resultPath)) continue;
      const result = readJson(resultPath);
      const task = String(result.task_name ?? '').replace(/^supabase\//, '');
      if (!source.tasks.includes(task)) continue;
      if (result.exception_info) continue;
      const sourceScorePath = path.join(source.job, entry.name, 'verifier', 'source-score.json');
      let sourceScore = null;
      if (fs.existsSync(sourceScorePath)) {
        sourceScore = readJson(sourceScorePath);
        const notes = (sourceScore.checks ?? [])
          .map((check) => String(check.notes ?? ''))
          .join('\n');
        if (
          sourceScore.infrastructureError === true ||
          notes.includes('HARBOR_JUDGE_INFRASTRUCTURE_ERROR:') ||
          /judge[^\n]*(?:HTTP )?404|modal\.run[^\n]*404/i.test(notes)
        ) {
          throw new Error(
            `refusing to treat judge infrastructure failure as a score: ${result.trial_name}`
          );
        }
      }
      const reward = Number(result.verifier_result?.rewards?.reward);
      if (!Number.isFinite(reward)) continue;
      byTask[task].push({
        startedAt: result.started_at,
        passed: reward === 1,
        reward,
        trialName: result.trial_name,
        costUsd: Number(result.agent_result?.cost_usd ?? 0),
        agentVersion: result.agent_info?.version ?? null,
        source: source.label,
        checks: sourceScore?.checks ?? [],
      });
    }
  }

  for (const task of group.tasks) {
    byTask[task].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    if (byTask[task].length !== 3) {
      throw new Error(
        `expected three scored Harbor samples for ${task}, found ${byTask[task].length}`
      );
    }
  }
  return byTask;
}

function runScores(byTask, tasks) {
  return [0, 1, 2].map((index) =>
    mean(tasks.map((task) => (byTask[task][index].passed ? 1 : 0)))
  );
}

function compare(groupName, group) {
  const upstream = upstreamSamples(groupName, group);
  const harbor = harborSamples(group);
  const upstreamRuns = runScores(upstream, group.tasks);
  const harborRuns = runScores(harbor, group.tasks);
  const up = summary(upstreamRuns);
  const hb = summary(harborRuns);
  const pooled = pooledSd(upstreamRuns, harborRuns);
  const difference = Math.abs(up.mean - hb.mean);
  return {
    name: groupName,
    tasks: group.tasks,
    upstream,
    harbor,
    upstreamSummary: up,
    harborSummary: hb,
    difference,
    pooledSd: pooled,
    withinOnePooledSd: difference <= pooled + Number.EPSILON,
    taskRates: group.tasks.map((task) => ({
      task,
      upstream: mean(upstream[task].map((sample) => (sample.passed ? 1 : 0))),
      harbor: mean(harbor[task].map((sample) => (sample.passed ? 1 : 0))),
    })),
  };
}

function combine(comparisons) {
  const upstreamRuns = [0, 1, 2].map((index) =>
    mean(
      comparisons.flatMap((comparison) =>
        comparison.tasks.map((task) =>
          comparison.upstream[task][index].passed ? 1 : 0
        )
      )
    )
  );
  const harborRuns = [0, 1, 2].map((index) =>
    mean(
      comparisons.flatMap((comparison) =>
        comparison.tasks.map((task) =>
          comparison.harbor[task][index].passed ? 1 : 0
        )
      )
    )
  );
  const up = summary(upstreamRuns);
  const hb = summary(harborRuns);
  const pooled = pooledSd(upstreamRuns, harborRuns);
  const difference = Math.abs(up.mean - hb.mean);
  return {
    upstreamSummary: up,
    harborSummary: hb,
    difference,
    pooledSd: pooled,
    withinOnePooledSd: difference <= pooled + Number.EPSILON,
  };
}

function cli002Diagnostic() {
  const samples = [];
  for (let run = 1; run <= 3; run += 1) {
    const runLabel = String(run).padStart(2, '0');
    const file = path.join(
      OUT,
      'upstream',
      `run-${runLabel}`,
      'cli002-diagnostic',
      'build-cli-002-declarative-schema.json'
    );
    const result = readJson(file);
    samples.push({
      run,
      passed: Boolean(result.passed),
      failedChecks: (result.checks ?? [])
        .filter((check) => !check.passed)
        .map((check) => ({ name: check.name, notes: check.notes ?? null })),
    });
  }
  return {
    samples,
    summary: summary(samples.map((sample) => (sample.passed ? 1 : 0))),
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function summaryText(value) {
  return `${percent(value.mean)} ± ${percent(value.sd)} SD (${percent(value.sem)} SEM)`;
}

function markdown(report) {
  const lines = [
    '# Targeted three-run parity results',
    '',
    'The statistic below covers only the six historically variable task/configuration pairs. It is not a replacement for the full 19-task benchmark score.',
    '',
    '| Slice | Upstream mean ± SD | Harbor mean ± SD | Absolute difference | Pooled SD | Within one pooled SD? |',
    '| --- | ---: | ---: | ---: | ---: | :---: |',
  ];
  for (const comparison of [...report.comparisons, { name: 'combined', ...report.combined }]) {
    lines.push(
      `| ${comparison.name} | ${summaryText(comparison.upstreamSummary)} | ${summaryText(comparison.harborSummary)} | ${percent(comparison.difference)} | ${percent(comparison.pooledSd)} | ${comparison.withinOnePooledSd ? 'Yes' : 'No'} |`
    );
  }

  lines.push('', '## Per-task pass rates', '');
  lines.push('| Configuration | Task | Upstream | Harbor | Difference |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  for (const comparison of report.comparisons) {
    for (const row of comparison.taskRates) {
      lines.push(
        `| ${comparison.name} | \`${row.task}\` | ${percent(row.upstream)} | ${percent(row.harbor)} | ${percent(Math.abs(row.upstream - row.harbor))} |`
      );
    }
  }

  lines.push('', '## Failed sample diagnostics', '');
  for (const comparison of report.comparisons) {
    for (const task of comparison.tasks) {
      for (const sample of comparison.upstream[task]) {
        if (sample.passed) continue;
        const failed = sample.checks
          .filter((check) => !check.passed)
          .map((check) => check.name)
          .join('; ');
        lines.push(
          `- Upstream ${comparison.name} run ${sample.run}, \`${task}\`: ${failed || 'source scorer returned false'}`
        );
      }
      comparison.harbor[task].forEach((sample, index) => {
        if (sample.passed) return;
        const failed = sample.checks
          .filter((check) => !check.passed)
          .map((check) => check.name)
          .join('; ');
        lines.push(
          `- Harbor ${comparison.name} sample ${index + 1}, \`${task}\`: ${failed || 'source scorer returned false'}`
        );
      });
    }
  }

  lines.push('', '## Upstream no-skills `build-cli-002` diagnostic', '');
  lines.push(`Pass rate: ${summaryText(report.cli002.summary)}.`);
  for (const sample of report.cli002.samples) {
    lines.push(
      `- Run ${sample.run}: ${sample.passed ? 'pass' : 'fail'}${sample.failedChecks.length ? `; failed checks: ${sample.failedChecks.map((check) => check.name).join('; ')}` : ''}`
    );
  }

  lines.push(
    '',
    '## Method note',
    '',
    'Each side contributes three independent samples per task/configuration. Run-level scores are the mean of the included binary task outcomes. Harbor samples are ordered by task start time to form three comparable run indices. Sample SD uses the n-1 denominator; SEM is SD divided by sqrt(3). The requested primary check compares the absolute difference in means with the pooled sample SD. Infrastructure exceptions are excluded only when Harbor transparently retries them to a scored result; score-zero outcomes remain failures.',
    '',
    'The first targeted Harbor job reached an undeployed judge transport and recorded HTTP 404s as zeros. Those artifacts are preserved as pre-fix evidence but excluded from statistical comparison. Only the affected Auth and Realtime task/configuration pairs were replaced with three clean post-fix samples after an Oracle reward-1 smoke test; unaffected scored samples were retained.'
  );
  return `${lines.join('\n')}\n`;
}

const comparisons = Object.entries(groups).map(([name, group]) =>
  compare(name, group)
);
const report = {
  generatedAt: new Date().toISOString(),
  comparisons,
  combined: combine(comparisons),
  cli002: cli002Diagnostic(),
};

fs.writeFileSync(
  path.join(OUT, 'analysis.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
fs.writeFileSync(path.join(OUT, 'report.md'), markdown(report));
console.log(markdown(report));
