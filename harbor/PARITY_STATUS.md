# Supabase eval → Harbor v0.20 parity evidence

Finalized 2026-08-02. This ledger distinguishes adapter correctness, the
single-sample benchmark measurements, and targeted resamples. It does not
silently replace failed model outcomes with retries.

## Source fidelity

- Harbor version: v0.20; execution: Modal VM runtime with cached task images.
- Generated tasks: 38/38 (25 tools/MCP and 13 local-stack).
- Generated `instruction.md` bodies match the upstream `PROMPT.md` bodies
  exactly after removing source frontmatter. No Harbor submission paragraph is
  appended to the agent prompt.
- Hidden `EVAL.ts` files are exact upstream copies. The source scorer bridge
  executes them directly; it does not translate their checks.
- Source `judge({ input, rubric })` calls remain live judge calls with their
  original rubrics. Judge results and notes are retained in each trial's
  `verifier/source-score.json`.
- GPT-5.6 Sol ran at medium reasoning through Codex account auth. The launch
  process explicitly removed `OPENAI_API_KEY`; no user API key was used.
- Skills trials used the two upstream skills; no-skills trials did not.

## Final Oracle gate

Every final task has a source-scored Oracle reward of 1 with no exception:

| Evidence | Result |
| --- | ---: |
| `harbor-source-oracle-final-live-mount/oracle-final-live-mount-all` | 37/38 reward 1; frontend exposed the hidden dependency-mount defect |
| `harbor-source-oracle-final-frontend/oracle-final-frontend` | Corrected remaining frontend task, reward 1 |
| Combined final task set | **38/38 reward 1** |

The frontend correction snapshots image-installed dependencies after `npm
install`, so the live workspace mount no longer hides `node_modules`. The
local-stack workspace is mounted at the same absolute `/app` path seen by the
agent and Supabase sibling containers, matching the upstream harness's live
bind behavior.

## Recorded upstream benchmark

The published benchmark subset has 19 tasks per configuration:

| Configuration | Upstream score |
| --- | ---: |
| GPT-5.6 Sol + skills | 19/19 |
| GPT-5.6 Sol without skills | 18/19 |

The upstream no-skills failure is `build-cli-002-declarative-schema`.

## Clean primary matrices

Both 19-task matrices completed on Modal with zero final exceptions. The
skills job had one transient missing-artifact-path exception that Harbor
retried successfully; no scored outcome came from the failed attempt.

| Configuration | Primary score | Exact upstream outcome matches | Cost |
| --- | ---: | ---: | ---: |
| No skills | 14/19 | 15/19 | $11.653049 |
| Skills | 17/19 | 17/19 | $19.817477 |

Primary jobs:

- `harbor-parity-postfix-noskills/parity-baseline-postfix-noskills`
- `harbor-parity-postfix-skills/parity-baseline-postfix-skills`

## Discrepancy investigation and resampling

The repeated `build-cli-003` 503 was traced to the adapter's nested-Docker
workspace boundary. After the live mount correction, both no-skills and skills
produced clean reward-1 trials with the unchanged scorer. The corrected Oracle
also scored 1.

Other primary misses were model rollout choices, not infrastructure failures:

| Configuration / task | Targeted result | Classification |
| --- | ---: | --- |
| Skills `build-cli-003` | reward 1 on second post-fix sample | Recovered; first post-fix sample wrote invalid `config.toml` |
| Skills `investigate-auth-001` | reward 1 on second sample | Recovered |
| No-skills `build-cli-003` | reward 1 | Recovered after adapter fix |
| No-skills `investigate-realtime-001` | reward 1 | Recovered; primary diagnosed but did not apply the MCP change |
| No-skills `build-functions-005` | reward 1 on third sample | Recovered; earlier samples hand-rolled auth instead of using required `@supabase/server` |
| No-skills `investigate-auth-001` | reward 0 in all three samples | Reproducible model-result divergence |

The remaining no-skills Auth divergence is specific: all three runs diagnosed
the soft-delete bug but stopped short of deleting the Auth identity and
revoking its sessions/refresh tokens. The same final task and scorer are
solvable: its Oracle passes, and the skills resample passes.

Final comparison after transparent targeted sampling:

| Configuration | Exact upstream outcome matches | Interpretation |
| --- | ---: | --- |
| Skills | **19/19 at pass@2** | Full observed parity |
| No skills | **18/19 at pass@3** | One reproducible model-result divergence (`investigate-auth-001`) |

The upstream expected no-skills zero on `build-cli-002` was reproduced. The
selected primary and discrepancy runs recorded $42.031473 of Codex-reported
model cost in total; Modal compute and judge cost are not included.

## Final evidence jobs

- Primary matrices listed above.
- `harbor-parity-postfix-noskills-rerun/parity-noskills-discrepancy-rerun`
- `harbor-parity-postfix-skills-rerun/parity-skills-auth-rerun`
- `harbor-parity-cli003-live-noskills/cli003-live-mount-noskills`
- `harbor-parity-cli003-live-skills/cli003-live-mount-skills`
- `harbor-parity-cli003-live-skills-final/cli003-live-mount-skills-final`
- `harbor-parity-noskills-final-resample/parity-noskills-final-resample`

Each job retains the agent trajectory, source scorer output, judge notes, reward,
configuration, task snapshot metadata, logs, timing, token counts, and cost.

## Harbor Hub uploads

All 38 task revisions and the evidence jobs below were uploaded privately.
The two consolidated views are the recommended links for review:

- Consolidated Oracle gate: `https://hub.harborframework.com/jobs/22c7dd72-c84a-4d01-bdd7-eaf3c8865c74`
- Consolidated GPT-5.6 Sol parity trials: `https://hub.harborframework.com/jobs/d4023397-3a5e-4899-b486-c15ee34155f6`

Source tasks and component jobs remain available for provenance:

- Tasks: `https://hub.harborframework.com/tasks/supabase/<task-name>`
- Primary no-skills: `https://hub.harborframework.com/jobs/b7dbc5ad-ae53-4f69-a044-2627ed1082f3`
- Primary skills: `https://hub.harborframework.com/jobs/dddda4dc-61d5-40d4-ae6a-740af30818c0`
- Full Oracle sweep: `https://hub.harborframework.com/jobs/f0e357ec-7068-4385-92bd-8a1dbf49f0c9`
- Corrected frontend Oracle: `https://hub.harborframework.com/jobs/53d9230d-102e-4a39-bdcb-24ae9b3b81f7`
- No-skills discrepancy set: `https://hub.harborframework.com/jobs/66e423e6-c377-4e24-b12c-2466606117b3`
- Skills Auth recovery: `https://hub.harborframework.com/jobs/10aa0bd5-5a56-42a7-b862-e790b428e6ce`
- No-skills CLI recovery: `https://hub.harborframework.com/jobs/95646d47-833e-4804-ae10-3ea0fe5043b3`
- Skills CLI failed sample: `https://hub.harborframework.com/jobs/9bfc33b9-00da-4d08-b6b3-4379468b9a59`
- Skills CLI recovery: `https://hub.harborframework.com/jobs/a2b7ebdd-4029-4a02-abaa-11a1f60e3d6f`
- No-skills final resample: `https://hub.harborframework.com/jobs/dfb02718-c731-4f5e-9aae-ca948c6698c0`
