"""Canonical deployment fixture with synthetic configuration only."""

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "deployment_preflight", ROOT / "deploy/staging/bin/deployment_preflight.py"
)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def isolated_config():
    compose = ROOT / "docker-compose.yml"
    required = re.findall(r"\$\{([A-Z][A-Z0-9_]*):\?", compose.read_text())
    env = {key: "isolated-fixture-value" for key in required}
    env.update(
        {
            "POSTGRES_USER": "fixture_admin",
            "POSTGRES_DB": "fixture_db",
            "POSTGRES_PASSWORD": "isolated-admin-password",
            "APP_DATABASE_PASSWORD": "isolated-runtime-password",
            "WORKER_DATABASE_PASSWORD": "isolated-worker-password",
            "DOCUMENTS_DATABASE_PASSWORD": "isolated-documents-password",
            "ORBIT_VERSION": "fixture",
            "API_HOST": "127.0.0.1",
            "FRONTEND_ORIGIN": "https://app.example.test",
            "AUTH_COOKIE_SECURE": "true",
        }
    )
    for key in ["ORBIT_API_IMAGE", "ORBIT_MIGRATOR_IMAGE", "ORBIT_FRONTEND_IMAGE", "ORBIT_PGBOUNCER_IMAGE"]:
        env[key] = "example.invalid/fixture@sha256:" + "a" * 64
    with tempfile.TemporaryDirectory(prefix="orbit-compose-fixture-") as directory:
        fixture = Path(directory) / ".env"
        fixture.write_text("\n".join(f"{key}={value}" for key, value in env.items()))
        os.chmod(fixture, 0o600)
        process_env = {
            key: value
            for key, value in os.environ.items()
            if key in ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]
        }
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                str(fixture),
                "-f",
                str(compose),
                "--profile",
                "admin",
                "config",
                "--format",
                "json",
            ],
            env=process_env,
            text=True,
            capture_output=True,
        )
        if result.returncode:
            raise RuntimeError(
                "Não foi possível resolver o Compose isolado: " + result.stderr
            )
        return json.loads(result.stdout)
