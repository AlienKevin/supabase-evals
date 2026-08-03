"""Temporary Modal transport for the unchanged source eval LLM judge.

The Node worker uses the exact AI SDK packages, model, prompt, structured
output contract, and provider settings from ``packages/core/src/index.ts``.
The app is deployed only for a bounded remote Harbor parity run.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

import modal


app = modal.App("supabase-eval-judge")

# The secret is created once by the deploy command and resolved by name in both
# the local deploy process and Modal's remote module-import context.
_judge_secret = modal.Secret.from_name(
    "supabase-eval-judge-secret",
    environment_name="main",
    required_keys=["OPENAI_API_KEY"],
)

_image = (
    modal.Image.debian_slim()
    .apt_install("nodejs", "npm")
    .pip_install("fastapi")
    .run_commands(
        "mkdir -p /opt/judge",
        "cd /opt/judge && npm init -y",
        "cd /opt/judge && npm install --save-exact "
        "ai@6.0.174 @ai-sdk/openai@3.0.69 zod@4.4.3",
    )
    .add_local_file(
        Path(__file__).with_name("source-judge.mjs"),
        "/opt/judge/source-judge.mjs",
        copy=True,
    )
)


def _extract_object(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Codex judge returned no JSON object")
    value = json.loads(text[start : end + 1])
    if not isinstance(value, dict) or not isinstance(value.get("passed"), bool):
        raise ValueError("Codex judge JSON lacks boolean passed")
    return {"passed": value["passed"], "notes": str(value.get("notes", ""))}


@app.function(
    image=_image,
    secrets=[_judge_secret],
    timeout=300,
    max_containers=8,
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST", label="supabase-eval-judge")
def judge(payload: dict[str, Any]) -> dict[str, Any]:
    command = ["node", "/opt/judge/source-judge.mjs"]
    last_error = "source judge did not run"
    for attempt in range(3):
        result = subprocess.run(
            command,
            cwd="/opt/judge",
            capture_output=True,
            text=True,
            input=json.dumps(payload),
            timeout=240,
            check=False,
        )
        if result.returncode == 0:
            try:
                return _extract_object(result.stdout)
            except (ValueError, json.JSONDecodeError) as exc:
                last_error = f"invalid source judge output: {exc}"
        else:
            detail = result.stderr.strip().replace("\n", " ")[-500:]
            last_error = f"source judge subprocess failed ({result.returncode}): {detail}"
        if attempt < 2:
            time.sleep(2**attempt)
    raise RuntimeError(last_error)
