# Supabase Evals on Harbor

This repository is a fidelity-preserving Harbor v0.20 adaptation of
[`supabase/evals`](https://github.com/supabase/evals). It keeps the upstream
prompts, fixtures, skills, and `EVAL.ts` scorers authoritative, and adds the
Harbor task packaging and runtime bridge needed to run the same benchmark
locally or on Modal.

Upstream source snapshot: [`supabase/evals@8c145f4`](https://github.com/supabase/evals/commit/8c145f42def067bdeff1952cef7c23592f315d9c).
The benchmark source files are retained; this fork replaces the upstream
scheduled maintenance workflows with a no-model Harbor adapter contract check.

## Current status

- 38/38 upstream evals are packaged in `harbor/generated-tasks/`.
- 38/38 source-scored Oracle trials pass with reward `1`.
- GPT-5.6 Sol targeted three-run parity is within the observed upstream
  variance. The combined Harbor mean is 88.9% versus 83.3% upstream.
- Source LLM judges remain live LLM judges. They are not replaced with
  deterministic approximations.

Evidence:

- [All Oracle trials](https://hub.harborframework.com/jobs/22c7dd72-c84a-4d01-bdd7-eaf3c8865c74)
- [GPT-5.6 Sol parity trials](https://hub.harborframework.com/jobs/d4023397-3a5e-4899-b486-c15ee34155f6)
- [Example published task](https://hub.harborframework.com/tasks/supabase/investigate-auth-001-deleted-user-access/latest)

Harbor Hub sign-in may be required for private evidence jobs.

## Repository layout

| Path | Purpose |
| --- | --- |
| `evals/` | Unchanged upstream prompts, fixtures, and scorers |
| `packages/` | Original Supabase eval framework and platform-lite runtime |
| `harbor/generated-tasks/` | The 38 generated Harbor task packages |
| `harbor/scripts/` | Generation, validation, Oracle, and parity tooling |
| `harbor/jobs/` | Reproducible Harbor v0.20 job configurations |
| `harbor/judge/` | Transport for the unchanged source LLM judge contract |

## Prerequisites

- Node.js 22+
- pnpm 10.24
- Python 3.12+
- Docker Desktop for local execution
- [Modal](https://modal.com/) credentials for Modal execution
- Provider or Codex credentials for live agent and judge runs

Clone and install:

```bash
git clone --recurse-submodules https://github.com/AlienKevin/supabase-evals.git
cd supabase-evals

corepack enable
pnpm install --frozen-lockfile

python3.12 -m venv .venv
source .venv/bin/activate
pip install 'harbor[modal]==0.20.0'

cp .env.example .env
```

## Validate the adapter without model calls

Generation and contract checks do not require an API key:

```bash
pnpm harbor:check
```

This regenerates all 38 tasks, checks source hashes and packaging invariants,
then runs the no-model NOP and Oracle smoke controls.

## Run locally

Start Docker, then run one source-scored Oracle task:

```bash
harbor run \
  -p harbor/generated-tasks/investigate-logs-001-top-error-function \
  -a oracle \
  -e docker \
  --ve HARBOR_SOURCE_SCORER=1 \
  --jobs-dir jobs/local-oracle \
  --yes
```

The expected reward is `1`. This task has a deterministic upstream scorer and
does not require an LLM judge. Tasks whose original scorer calls `judge(...)`
also need a judge transport. On a Mac with the Codex app signed in, start the
included local bridge in another terminal:

```bash
python3 harbor/judge/codex-host-bridge.py --port 8765
```

Then add this verifier environment variable to the Harbor command:

```bash
--ve 'HARBOR_JUDGE_COMMAND=curl --fail --silent --show-error --data-binary @"$HARBOR_JUDGE_PAYLOAD_FILE" http://host.docker.internal:8765/judge'
```

Local-stack tasks start Supabase services through nested Docker. Run them at
low concurrency and stop any existing local Supabase stack first.

## Run the full Oracle gate on Modal

Modal VM runtime is the recommended path for all 38 tasks because it isolates
each task's Docker and Supabase service topology.

Authenticate Modal and choose your environment:

```bash
modal setup
modal profile activate <your-profile>
```

Create the judge secret from your local environment and deploy the judge
transport. The service executes the original GPT-5.5 judge prompt and schema.

```bash
modal secret create supabase-eval-judge-secret \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  --env main

modal deploy harbor/judge/modal-judge-app.py \
  --env main \
  --strategy recreate
```

Run the tools and local-stack partitions. Together they cover all 38 tasks:

```bash
harbor run -c harbor/jobs/oracle-final-tools-v2.json --yes
harbor run -c harbor/jobs/oracle-final-local-v2.json --yes
```

Audit the resulting rewards:

```bash
node harbor/scripts/audit-final-oracles.mjs \
  targeted-parity-3x/oracle-final-tools-v2/oracle-final-tools-v2 \
  targeted-parity-3x/oracle-final-local-v2/oracle-final-local-v2
```

Stop the temporary judge service when finished:

```bash
modal app stop supabase-eval-judge --env main --yes
```

## Run GPT-5.6 Sol parity on Modal

The full skills and no-skills matrices are configured here:

```bash
harbor run -c harbor/jobs/sol-final-skills.json --yes
harbor run -c harbor/jobs/sol-final-noskills.json --yes
```

The focused three-attempt variance study is reproducible with:

```bash
harbor run -c harbor/jobs/targeted-parity-3x-skills-postfix.json --yes
harbor run -c harbor/jobs/targeted-parity-3x-noskills-postfix.json --yes
```

These Codex jobs use GPT-5.6 Sol at medium reasoning. Agent authentication is
handled by Harbor's Codex integration; the separate source judge transport
uses the Modal secret above.

## Fidelity guarantees

- `instruction.md` contains only the upstream prompt body.
- The hidden `EVAL.ts` is an exact upstream copy and is executed directly.
- The upstream remote fixture seeds platform-lite but is not exposed to the
  agent as an editable answer file.
- The upstream local fixture is copied into the Harbor workspace.
- Skills and no-skills configurations remain separate.
- Infrastructure exceptions may be retried. A valid reward-zero model outcome
  is retained and is never retried away.

See [`harbor/README.md`](harbor/README.md) for adapter architecture and
[`harbor/PARITY_STATUS.md`](harbor/PARITY_STATUS.md) for the evidence ledger.

## Upstream usage

The original Supabase harness remains intact. A single upstream run still
works as before:

```bash
pnpm eval -- \
  --eval resolve-dataapi-001-empty-results \
  --experiment codex-gpt-5.6
```

## License and provenance

This adaptation retains the upstream repository's license and credits. The
Supabase source remains authoritative for benchmark semantics; Harbor provides
the portable execution and evidence layer.
