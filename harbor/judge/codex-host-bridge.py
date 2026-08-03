#!/usr/bin/env python3
"""Optional verifier-only bridge for the source eval's live LLM judge.

Harbor's agent auth injection is intentionally scoped to the agent container.
When a parity run must use the local Codex session rather than an
OPENAI_API_KEY, start this bridge on the host and point the hidden verifier's
HARBOR_JUDGE_COMMAND at its /judge endpoint. It binds to loopback only and
removes OPENAI_API_KEY from the Codex subprocess environment.

The request body is the JSON payload emitted by source-runtime/core-shim.mjs:
{ "input": string, "rubric": string }.
The response is the source judge shape: { "passed": boolean, "notes": string }.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


CODEX = os.environ.get(
    "CODEX_BIN", "/Applications/ChatGPT.app/Contents/Resources/codex"
)
MODEL = os.environ.get("HARBOR_JUDGE_MODEL", "gpt-5.5")
SYSTEM = "You are a strict eval judge. Return only the requested structured judgment."


def extract_object(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Codex judge returned no JSON object")
    value = json.loads(text[start : end + 1])
    if not isinstance(value, dict) or not isinstance(value.get("passed"), bool):
        raise ValueError("Codex judge JSON lacks boolean passed")
    return {"passed": value["passed"], "notes": str(value.get("notes", ""))}


def run_judge(payload: dict) -> dict:
    input_text = str(payload.get("input", ""))
    rubric = str(payload.get("rubric", ""))
    prompt = (
        "Return exactly one JSON object with string field `notes` and boolean "
        "field `passed`; do not use tools or markdown.\n\n"
        f"System instruction: {SYSTEM}\n\n"
        f"Rubric:\n{rubric}\n\nInput:\n{input_text}"
    )

    with tempfile.TemporaryDirectory(prefix="harbor-codex-judge-") as tmp:
        output = Path(tmp) / "last-message.txt"
        env = os.environ.copy()
        env.pop("OPENAI_API_KEY", None)
        env["CODEX_FORCE_AUTH_JSON"] = "1"
        result = subprocess.run(
            [
                CODEX,
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--model",
                MODEL,
                "-o",
                str(output),
                prompt,
            ],
            cwd=tmp,
            env=env,
            capture_output=True,
            text=True,
            timeout=240,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError("Codex judge subprocess failed")
        return extract_object(output.read_text(encoding="utf-8"))


class Handler(BaseHTTPRequestHandler):
    server_version = "supabase-evals-harbor-judge/1"

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/judge":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length))
            response = run_judge(payload)
            body = json.dumps(response, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            self.send_error(502, "judge unavailable")

    def log_message(self, *_args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
