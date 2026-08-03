#!/usr/bin/env bash
set -euo pipefail

# Runs every generated task that has a complete Harbor Oracle implementation.
# The final Oracle gate uses this same command after all 38 tasks become
# runnable; it intentionally refuses to treat scaffolds as passing tasks.

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
harbor_bin=${HARBOR_BIN:-harbor}
node_bin=${NODE_BIN:-node}
jobs_dir=${HARBOR_JOBS_DIR:-"$root/harbor-oracle-results"}
# Harbor jobs share a Docker build service and a results root. Keep the safe
# default sequential; callers can opt into limited parallelism explicitly.
parallelism=${HARBOR_PARALLELISM:-1}

if ! command -v "$harbor_bin" >/dev/null 2>&1; then
  printf 'Harbor executable not found: %s\n' "$harbor_bin" >&2
  exit 2
fi
if ! command -v "$node_bin" >/dev/null 2>&1; then
  printf 'Node executable not found: %s\n' "$node_bin" >&2
  exit 2
fi

task_ids=()
while IFS= read -r task_id; do
  [ -n "$task_id" ] && task_ids+=("$task_id")
done < <(
  "$node_bin" -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const task of manifest.tasks) {
      if (task.status === "runnable-pilot") console.log(task.id);
    }
  ' "$root/harbor/migration-manifest.json"
)

if [ "${#task_ids[@]}" -eq 0 ]; then
  printf 'No runnable Harbor Oracle tasks found.\n' >&2
  exit 1
fi

run_one() {
  local task_id="$1"
  "$harbor_bin" run \
    -p "$root/harbor/generated-tasks/$task_id" \
    -a oracle \
    --jobs-dir "$jobs_dir" \
    --job-name "$task_id-oracle" \
    -y
}
export harbor_bin jobs_dir root
export -f run_one
printf '%s\n' "${task_ids[@]}" | xargs -n 1 -P "$parallelism" bash -c 'run_one "$1"' _

"$node_bin" - <<'NODE' "$jobs_dir" "${task_ids[@]}"
const fs = require('fs');
const path = require('path');
const [jobsDir, ...taskIds] = process.argv.slice(2);
let failures = 0;
for (const taskId of taskIds) {
  const resultPath = path.join(jobsDir, `${taskId}-oracle`, 'result.json');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const trials = fs.readdirSync(path.join(jobsDir, `${taskId}-oracle`));
  const trialDir = trials.find((entry) => fs.existsSync(path.join(jobsDir, `${taskId}-oracle`, entry, 'result.json')));
  const trial = JSON.parse(fs.readFileSync(path.join(jobsDir, `${taskId}-oracle`, trialDir, 'result.json'), 'utf8'));
  const reward = trial.verifier_result?.rewards?.reward;
  if (reward !== 1) {
    console.error(`FAIL ${taskId}: Oracle reward ${String(reward)}`);
    failures += 1;
  } else {
    console.log(`PASS ${taskId}: Oracle reward 1`);
  }
  void result;
}
process.exit(failures ? 1 : 0);
NODE
