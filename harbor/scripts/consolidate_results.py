#!/usr/bin/env python3
"""Build a provenance-preserving Harbor evidence job from completed trials.

The Hub assigns each trial to a single job. Consolidated evidence therefore
receives fresh job and trial UUIDs while retaining every source artifact,
timestamp, score, trace, lock, and configuration. The generated analysis.md
records the original job and trial UUID for auditability.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from harbor.models.job.config import JobConfig
from harbor.models.job.result import JobResult, JobStats
from harbor.models.trial.result import TrialResult


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, default=str) + "\n")


def reward_of(result: TrialResult) -> float | int | None:
    if result.verifier_result is None or not result.verifier_result.rewards:
        return None
    rewards = result.verifier_result.rewards
    if "reward" in rewards:
        return rewards["reward"]
    if len(rewards) == 1:
        return next(iter(rewards.values()))
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, required=True)
    args = parser.parse_args()

    spec_path = args.spec.resolve()
    spec = load_json(spec_path)
    repo_root = spec_path.parents[2]
    output_dir = (repo_root / spec["output_dir"]).resolve()
    config_template_path = (repo_root / spec["config_template"]).resolve()

    if output_dir.exists() and any(output_dir.iterdir()):
        raise RuntimeError(f"Refusing to overwrite non-empty output: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    new_job_id = uuid4()
    copied: list[tuple[TrialResult, str, str, str]] = []
    used_trial_names: set[str] = set()

    for source in spec["sources"]:
        source_job_dir = (repo_root / source["job_dir"]).resolve()
        include_tasks = set(source.get("include_tasks", []))
        source_job_result = JobResult.model_validate_json(
            (source_job_dir / "result.json").read_text()
        )

        for child in sorted(source_job_dir.iterdir()):
            result_path = child / "result.json"
            if not child.is_dir() or not result_path.exists():
                continue
            original = TrialResult.model_validate_json(result_path.read_text())
            bare_task = original.task_name.removeprefix("supabase/")
            if include_tasks and bare_task not in include_tasks:
                continue
            if original.trial_name in used_trial_names:
                raise RuntimeError(f"Duplicate trial name: {original.trial_name}")
            used_trial_names.add(original.trial_name)

            destination = output_dir / original.trial_name
            shutil.copytree(child, destination)

            original_job_id = str(original.config.job_id)
            original_trial_id = str(original.id)
            new_trial_id = uuid4()
            result_data = original.model_dump(mode="json")
            result_data["id"] = str(new_trial_id)
            result_data["trial_uri"] = destination.as_uri()
            result_data["config"]["job_id"] = str(new_job_id)
            result_data["config"]["trials_dir"] = str(output_dir)
            provider_override = spec.get("model_provider_override")
            if (
                provider_override
                and result_data.get("agent_info", {}).get("model_info") is not None
            ):
                result_data["agent_info"]["model_info"]["provider"] = provider_override
            rewritten = TrialResult.model_validate(result_data)
            write_json(
                destination / "result.json",
                rewritten.model_dump(mode="json", exclude_none=False),
            )

            trial_config_path = destination / "config.json"
            trial_config = load_json(trial_config_path)
            trial_config["job_id"] = str(new_job_id)
            trial_config["trials_dir"] = str(output_dir)
            write_json(trial_config_path, trial_config)

            provenance = (
                "# Consolidated evidence provenance\n\n"
                f"- Source job: `{source_job_result.id}`\n"
                f"- Source trial: `{original_trial_id}`\n"
                f"- Consolidated job: `{new_job_id}`\n"
                f"- Consolidated trial: `{new_trial_id}`\n"
                "- Execution outputs, timestamps, reward, trace, and lock are unchanged.\n"
            )
            if provider_override:
                provenance += (
                    f"- Hub display provider normalized to `{provider_override}`; "
                    "the source result omitted only that display field.\n"
                )
            prior_analysis = destination / "analysis.md"
            if prior_analysis.exists() and prior_analysis.read_text().strip():
                provenance += "\n## Original analysis\n\n" + prior_analysis.read_text()
            prior_analysis.write_text(provenance)
            copied.append(
                (
                    rewritten,
                    str(source_job_result.id),
                    original_trial_id,
                    source.get("label", source_job_dir.name),
                )
            )

    expected = int(spec["expected_trials"])
    if len(copied) != expected:
        raise RuntimeError(f"Expected {expected} trials, selected {len(copied)}")

    trial_results = [item[0] for item in copied]
    stats = JobStats.from_trial_results(
        trial_results,
        n_total_trials=len(trial_results),
    )
    for eval_key, eval_stats in stats.evals.items():
        rewards = [
            reward_of(result)
            for result in trial_results
            if JobStats.format_agent_evals_key(
                result.agent_info.name,
                result.agent_info.model_info.name
                if result.agent_info.model_info
                else None,
                result.source or "adhoc",
            )
            == eval_key
        ]
        numeric = [float(value) for value in rewards if value is not None]
        if numeric:
            eval_stats.metrics = [{"mean": sum(numeric) / len(numeric)}]

    started_at = min(result.started_at for result in trial_results)
    finished_values = [
        result.finished_at for result in trial_results if result.finished_at is not None
    ]
    finished_at = max(finished_values) if finished_values else datetime.now()
    job_result = JobResult(
        id=new_job_id,
        started_at=started_at,
        updated_at=finished_at,
        finished_at=finished_at,
        n_total_trials=len(trial_results),
        stats=stats,
    )
    write_json(
        output_dir / "result.json",
        job_result.model_dump(mode="json", exclude={"trial_results"}),
    )

    config_data = load_json(config_template_path)
    config_data["job_name"] = spec["job_name"]
    config_data["jobs_dir"] = str(output_dir.parent)
    job_config = JobConfig.model_validate(config_data)
    write_json(
        output_dir / "config.json",
        job_config.model_dump(mode="json", exclude_defaults=True),
    )

    source_jobs = sorted({job_id for _, job_id, _, _ in copied})
    mean_reward = sum(float(reward_of(result) or 0) for result in trial_results) / len(
        trial_results
    )
    analysis_lines = [
        f"# {spec['title']}",
        "",
        spec["description"],
        "",
        f"- Trials: {len(trial_results)}",
        f"- Mean reward: {mean_reward:.3f}",
        f"- Source jobs: {', '.join(f'`{job_id}`' for job_id in source_jobs)}",
        "- Every included attempt is preserved with its original trace, verifier artifacts, timestamps, and reproducibility lock.",
        "- Fresh UUIDs are assigned only because Harbor Hub trials belong to one job; per-trial analysis records the original UUIDs.",
        "",
        "## Included trials",
        "",
    ]
    if spec.get("model_provider_override"):
        analysis_lines.insert(
            9,
            f"- Hub display provider normalized to `{spec['model_provider_override']}`; model identity, execution, and grading are unchanged.",
        )
    for result, source_job_id, source_trial_id, label in sorted(
        copied, key=lambda item: (item[0].task_name, item[0].started_at)
    ):
        analysis_lines.append(
            f"- `{result.trial_name}`: task `{result.task_name}`, reward `{reward_of(result)}`, source `{label}`, job `{source_job_id}`, trial `{source_trial_id}`"
        )
    (output_dir / "analysis.md").write_text("\n".join(analysis_lines) + "\n")
    (output_dir / "job.log").write_text(
        f"Consolidated {len(trial_results)} completed Harbor trials into job {new_job_id}.\n"
    )

    print(output_dir)
    print(new_job_id)
    print(f"trials={len(trial_results)} mean_reward={mean_reward:.6f}")


if __name__ == "__main__":
    main()
