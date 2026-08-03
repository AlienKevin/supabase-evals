#!/usr/bin/env python3
"""Validate generated task.toml files with Harbor's current Pydantic model."""

from pathlib import Path

from harbor.models.task.config import TaskConfig


ROOT = Path(__file__).resolve().parents[2]
TASKS_ROOT = ROOT / "harbor" / "generated-tasks"


def main() -> None:
    task_dirs = sorted(path for path in TASKS_ROOT.iterdir() if path.is_dir())
    for task_dir in task_dirs:
        TaskConfig.model_validate_toml((task_dir / "task.toml").read_text())
    print(f"Harbor schema validation passed for {len(task_dirs)} tasks.")


if __name__ == "__main__":
    main()

