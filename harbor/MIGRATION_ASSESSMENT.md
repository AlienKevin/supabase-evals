# Migration assessment

## Executive view

Supabase's eval semantics fit Harbor well, but the current harness combines
three concerns that Harbor separates: agent execution, environment lifecycle,
and verification. The migration is therefore mostly an environment and scorer
port, not a prompt rewrite.

The corpus currently contains 38 evals and 18 experiment definitions. Based on
the checked-out revision, 25 evals use the lightweight tools runtime and 13 use
the local-stack runtime (a union of `interface: cli` and `local/` fixtures).

Harbor task generation is structural: it copies the source prompt, local and
remote fixtures, and the exact source `EVAL.ts` into the hidden verifier
payload. The adapter must not replace source checks with answer strings. The
four report-oriented tasks remain useful smoke controls, but their Oracle
results are only adapter smoke evidence until the source scorer bridge runs.

## Effort estimate

| Workstream | Estimate | Main work |
| --- | ---: | --- |
| Adapter and metadata mapping | 2–3 engineer-days | Discovery, task generation, provenance, CI checks |
| Tools/MCP runtime (25 evals) | 8–12 engineer-days | Package platform-lite, MCP wiring, stateful verifier helpers, transcript/report contract |
| Local-stack runtime (13 evals) | 10–15 engineer-days | Supabase CLI image, service topology, nested-Docker or sidecars, hosted-project bridge |
| Scorer parity and oracle fixtures | 4–6 engineer-days | Run the unchanged source scorer, preserve partial diagnostics, and keep LLM judges in the hidden verifier path |
| CI, results mapping, docs, rollout | 3–5 engineer-days | Job matrix, artifact retention, comparison reports, contributor workflow |
| **Total** | **27–41 engineer-days** | Roughly 5–8 engineer-weeks |

A practical staffing plan is two engineers for 3–5 calendar weeks, followed
by one week of parallel-run observation. The estimate assumes the existing
TypeScript harness remains available during parity testing and that Harbor's
local Docker environment is the first supported backend.

## Complexity by scorer dependency

The adapter detects the following dimensions from each `EVAL.ts`:

- report-only regex checks: low effort and fully represented by the four pilots;
- platform state (`query`, Supabase clients, Management API): medium effort;
- edge-function deployment/invocation: medium-to-high effort;
- transcript or tool-history checks: medium effort, requiring an explicit
  Harbor trajectory-to-verifier input contract;
- LLM-as-judge checks: medium effort; Harbor supports them in hidden verifier
  tests, so the source prompt/rubric/model route must be preserved. A no-key
  Oracle smoke job may be separate, but it cannot be called parity evidence.
- local-stack commands, files, Vite/Vitest, and hosted links: high effort.

## Recommended rollout

### Phase 1 — credible pilot

- Land the adapter and four source-backed smoke tasks.
- Add a reusable verifier helper that invokes the unchanged source scorer and
  emits `reward.txt` plus structured check details.
- Run `oracle` and `nop` in CI on Linux with Docker.

Exit criterion: four Oracle passes, four NOP failures, with the source scorer
still available as the authority (the no-key smoke path is only a control).

### Phase 2 — tools/MCP parity

- Containerize `platform-lite` once and reuse it as a Compose sidecar.
- Declare the Supabase MCP server through `[[environment.mcp_servers]]`.
- Run the 25 unchanged tools-mode scorers against the Harbor sidecar, starting
  with SQL/RLS and logs, then edge functions.
- Parallel-run a small real-agent matrix in both harnesses only after Oracle
  parity is green.

Exit criterion: all tools-mode scores agree with the original harness; judge
calls are executed with the source rubric rather than reported separately.

### Phase 3 — local-stack parity

- Choose and document the isolation model: Docker-in-Docker or Harbor-native
  service sidecars.
- Recreate selective Supabase service startup and fixed CLI versions.
- Port Vite/Vitest scoring and mocked hosted-project linking.

Exit criterion: all 13 local-stack Oracle tasks pass and resource cleanup is
reliable under concurrency.

### Phase 4 — cutover

- Export Harbor results into the existing Supabase web view during the
  transition, or replace it with Harbor's viewer after stakeholder sign-off.
- Compare pass rates, runtime, cost, and flakes across at least three repeated
  runs per agent/model pair.
- Freeze the old harness after parity, then remove duplicated orchestration.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Nested Docker makes local-stack tasks fragile | Prefer explicit sidecars where possible; serialize fixed host ports during the first iteration |
| LLM judges hide deterministic regressions | Split deterministic reward from judge metrics; keep no-key Oracle CI |
| Transcript checks couple to agent implementations | Normalize Harbor trajectories once in a shared verifier helper |
| Duplicate result formats confuse contributors | Provide one conversion command and one canonical CI job |
| Platform-lite packaging bloats every task | Build one pinned image and reference it by digest |

## Decision

Proceed with a staged migration. The tools/MCP track can show meaningful value
quickly; the local-stack track is feasible but should not gate the initial
Harbor adoption pitch.
