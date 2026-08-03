# Targeted three-run parity protocol

This study estimates model variance on the task/configuration pairs that were
non-deterministic in the first Supabase-to-Harbor parity pass. It is a targeted
diagnostic, not a replacement for the full 19-task benchmark score.

## Frozen controls

- Agent: Codex CLI 0.138.0 on both harnesses
- Model: GPT-5.6 Sol
- Reasoning effort: medium
- Three independent samples per task/configuration on each harness
- Original Supabase prompts, fixtures, skills, scorers, and live judge rubrics
- Harbor v0.20 on Modal VM runtime with cached task images
- Infrastructure exceptions may be retried, but score-zero model outcomes are
  retained and are not retried away

The remote judge endpoint is transport only. Its Node worker pins the same
`ai`, `@ai-sdk/openai`, and `zod` versions used by the source repository and
runs the source judge's exact GPT-5.5 model, low reasoning effort, low text
verbosity, prompt construction, structured schema, and 4096-token limit.
Judge transport or scorer-runtime errors produce no Harbor reward and therefore
surface as retryable verifier exceptions, never as model score zero.

## Targeted parity set

With skills:

- `build-cli-003-pg-cron-queue-workflow`
- `investigate-auth-001-deleted-user-access`

Without skills:

- `build-cli-003-pg-cron-queue-workflow`
- `investigate-realtime-001-subscribed-no-events`
- `build-functions-005-dual-auth-user-secret`
- `investigate-auth-001-deleted-user-access`

## Separate stable-failure diagnostic

The upstream no-skills `build-cli-002-declarative-schema` task is rerun three
times and reported separately. It is excluded from the targeted parity statistic
unless the new samples show that its outcome is variable.

## Reporting

For each harness and configuration, report the three run-level pass rates as
mean, sample standard deviation, and sample standard error. The primary
user-requested check is whether the absolute difference in means is no greater
than the pooled sample standard deviation. Per-task pass rates and paired
differences are also reported so aggregate agreement cannot hide a task-level
divergence.

## Preserved adapter incident

The initial targeted Harbor job reached an undeployed judge endpoint. Three
Auth samples in each configuration and three no-skills Realtime samples were
therefore HTTP 404 transport failures incorrectly recorded as zeros by the
first adapter revision. Those artifacts remain preserved as pre-fix evidence,
but they are excluded from the parity statistic. After the adapter fix passed
an Auth Oracle smoke test with reward 1, only those nine affected agent samples
were rerun; unaffected scored samples were retained.
