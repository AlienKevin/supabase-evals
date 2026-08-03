# Supabase evals Harbor Oracle smoke gate

The generated adapter targets Harbor v0.20 and contains 38 structurally valid
task packages. The Harbor schema validator passes all 38 packages. The Oracle
results below are adapter smoke evidence only; they are not source-eval parity
until the hidden verifier invokes the upstream `EVAL.ts` scorer (including its
LLM judges where applicable).

The evidence is split only because two verifier wording defects were corrected
after the initial batch:

- `harbor-oracle-results-v3/`: the original full 38-task Docker batch. Thirty-six tasks passed on the first run.
- `harbor-oracle-results-v7/`: fresh Docker reruns of `build-rls-003-org-roles-permissions` and `resolve-storage-001-upsert-missing-update-policy`; both passed after the verifier contracts were corrected.

The final audit selects the v7 result for those two task IDs and the v3 result
for the other 36 IDs. It checks each trial's Harbor `verifier_result.rewards.reward`
and rejects missing trials, non-one rewards, or exceptions.

The generated tasks and their Oracle solutions remain reproducible through
`harbor/scripts/generate.mjs`; `harbor/scripts/validate.mjs` and
`harbor/scripts/validate_with_harbor.py` both validate the Harbor packaging.

As a separate source-scored gate, the final no-LLM tools Oracle batch passed
14/14 with zero exceptions in
`harbor-source-oracle-deterministic-final/no-llm-source-oracles-final`. This
batch invokes the unchanged upstream `EVAL.ts` scorers against live
platform-lite state; judge-dependent agent parity remains a separate result.
