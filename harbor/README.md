# Harbor adapter architecture

The adapter packages the Supabase eval corpus as Harbor v0.20 tasks without
rewriting the benchmark. The source `PROMPT.md`, fixtures, skills, and
`EVAL.ts` scorer remain authoritative.

## Mapping

| Supabase eval | Harbor v0.20 |
| --- | --- |
| `PROMPT.md` body | `instruction.md` |
| Prompt frontmatter | `task.toml` metadata |
| `local/` fixture | Initial `/app` workspace |
| `remote/` fixture | Verifier-only platform-lite seed |
| `EVAL.ts` | Hidden source scorer executed by `tests/test.sh` |
| Experiment | Harbor agent, model, skills, and environment config |
| Result | Harbor job, trial, trajectory, reward, and artifacts |

The agent sees the original instruction and normal Harbor workspace. Harbor
captures its trajectory and final assistant message automatically, so no
adapter-specific submission paragraph is appended to the prompt.

## Runtime tracks

### Tools and MCP

The task starts platform-lite with the original remote fixture, starts the
Supabase MCP server, and exposes that MCP surface to the agent. Before grading,
the verifier synchronizes final state and executes the upstream scorer.

### Local stack and CLI

The task preserves the source local workspace and starts the real Supabase CLI
and requested services. Modal VM runtime is recommended because each task can
own an isolated Docker daemon and network.

## Source scorer and judge

Set `HARBOR_SOURCE_SCORER=1` for parity runs. The verifier then executes the
copied upstream scorer through `harbor/source-runtime/run-source-scorer.mjs`.

When that scorer calls the upstream `judge(...)` helper, it sends the original
input and rubric through `HARBOR_JUDGE_COMMAND`. The Modal judge service pins
the same model, provider settings, structured output schema, and package
versions as the source implementation. Transport failures raise verifier
exceptions rather than becoming false score-zero outcomes.

## Generate and validate

From the repository root:

```bash
pnpm harbor:generate
pnpm harbor:validate
pnpm harbor:smoke
```

Or run all three:

```bash
pnpm harbor:check
```

The generated task count must be 38. Prompt and scorer SHA-256 values in
`harbor/migration-manifest.json` detect accidental source drift.

## Reproducible configurations

- `jobs/oracle-final-tools-v2.json`: 25 tools/MCP Oracles on Modal
- `jobs/oracle-final-local-v2.json`: 13 local-stack Oracles on Modal
- `jobs/sol-final-skills.json`: full GPT-5.6 Sol skills matrix
- `jobs/sol-final-noskills.json`: full GPT-5.6 Sol no-skills matrix
- `jobs/targeted-parity-3x-*.json`: focused three-attempt variance study

See the root [`README.md`](../README.md) for exact local and Modal commands.

## Evidence

- [38/38 source-scored Oracle gate](https://hub.harborframework.com/jobs/22c7dd72-c84a-4d01-bdd7-eaf3c8865c74)
- [Final GPT-5.6 Sol parity trials](https://hub.harborframework.com/jobs/d4023397-3a5e-4899-b486-c15ee34155f6)
- [`PARITY_STATUS.md`](PARITY_STATUS.md) for the complete audit ledger
