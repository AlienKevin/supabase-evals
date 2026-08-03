#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
tasks_root="$repo_root/harbor/generated-tasks"

pilots=(
  investigate-db-001-table-row-counts
  investigate-logs-001-top-error-function
  investigate-reliability-001-error-rate-spike
  investigate-reliability-002-subtle-error-spike
)

cleanup_dirs=()
cleanup() {
  for dir in "${cleanup_dirs[@]:-}"; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      rm -rf "$dir"
    fi
  done
}
trap cleanup EXIT

for id in "${pilots[@]}"; do
  task="$tasks_root/$id"
  sandbox="$(mktemp -d)"
  cleanup_dirs+=("$sandbox")
  mkdir -p "$sandbox/app" "$sandbox/logs"
  cp -R "$task/environment/seed/local/." "$sandbox/app/"
  mkdir -p "$sandbox/app/remote"
  cp -R "$task/environment/seed/remote/." "$sandbox/app/remote/"

  HARBOR_WORKDIR="$sandbox/app" HARBOR_LOGS_DIR="$sandbox/logs" \
    bash "$task/tests/test.sh" >/dev/null
  nop_reward="$(tr -d '[:space:]' < "$sandbox/logs/verifier/reward.txt")"
  if [ "$nop_reward" != "0" ]; then
    printf 'FAIL NOP control %s: expected reward 0, got %s\n' "$id" "$nop_reward" >&2
    exit 1
  fi

  HARBOR_WORKDIR="$sandbox/app" bash "$task/solution/solve.sh"
  HARBOR_WORKDIR="$sandbox/app" HARBOR_LOGS_DIR="$sandbox/logs" \
    bash "$task/tests/test.sh" >/dev/null
  oracle_reward="$(tr -d '[:space:]' < "$sandbox/logs/verifier/reward.txt")"
  if [ "$oracle_reward" != "1" ]; then
    printf 'FAIL Oracle control %s: expected reward 1, got %s\n' "$id" "$oracle_reward" >&2
    exit 1
  fi

  printf 'PASS %s (NOP=0, Oracle=1)\n' "$id"
done

printf 'PASS Harbor no-LLM Oracle smoke (%s tasks)\n' "${#pilots[@]}"

