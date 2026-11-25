"""Mutation tests against the real normalized Compose, using synthetic env only."""

import copy
import subprocess
import unittest
import sys

sys.dont_write_bytecode = True
from lib.deployment_fixture import ROOT, isolated_config, preflight


class DeploymentPreflightTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.canonical = isolated_config()

    def test_canonical_compose_passes_even_with_developer_loopback_host(self):
        preflight.check(self.canonical)
        production = self.canonical["services"]["api"]["environment"]
        self.assertEqual(production["ORBIT_DEPLOYMENT"], "production")
        self.assertEqual(production["STORAGE_PROVIDER"], "R2")
        self.assertEqual(production["STORAGE_PUBLIC_API_URL"], "https://portal-orbit.com.br/api/v1")

    def test_staging_uses_only_a_shared_local_volume(self):
        config = isolated_config(staging=True)
        preflight.check(config)
        staging = config["services"]["api"]["environment"]
        self.assertEqual(staging["STORAGE_PUBLIC_API_URL"], "https://orbit.allblue-labs.com/api/v1")
        for service in ("api", "worker", "documents"):
            runtime = copy.deepcopy(config)
            runtime["services"][service]["environment"]["R2_ACCESS_KEY_ID"] = "private-canary"
            with self.assertRaisesRegex(preflight.UnsafeDeployment, "volume de mídia"):
                preflight.check(runtime)

    def test_regressions_are_rejected(self):
        mutations = [
            ("pgbouncer", lambda s: s.update(ports=[{"published": "6432", "target": 6432}])),
            ("pgbouncer", lambda s: s["environment"].update(POSTGRES_PASSWORD="private-canary")),
            ("worker", lambda s: s["environment"].update(DIRECT_DATABASE_URL="private-canary")),
            (
                "worker",
                lambda s: s["environment"].update(DATABASE_URL="private-canary"),
            ),
            ("documents", lambda s: s["environment"].update(ORBIT_PROCESS_ROLE="api")),
            (
                "documents",
                lambda s: s["environment"].update(JOBS_WORKER_ENABLED="false"),
            ),
            ("worker", lambda s: s.update(profiles=["manual"])),
            (
                "worker",
                lambda s: s.update(ports=[{"published": "5001", "target": 5001}]),
            ),
            ("documents", lambda s: s.update(healthcheck={})),
            (
                "api",
                lambda s: s["environment"].update(
                    DATABASE_URL="postgresql://fixture_admin:private-canary@postgres/fixture_db"
                ),
            ),
            (
                "api",
                lambda s: s["environment"].update(
                    PLATFORM_ADMIN_PASSWORD="private-canary"
                ),
            ),
            (
                "api",
                lambda s: s["environment"].update(
                    DATABASE_ENFORCE_RESTRICTED_ROLE="false"
                ),
            ),
            ("api", lambda s: s["environment"].update(HOST="127.0.0.1")),
            ("api", lambda s: s.update(user="0:0")),
            ("api", lambda s: s.update(read_only=False)),
            ("api", lambda s: s.update(cap_add=["SYS_ADMIN"])),
            ("api", lambda s: s.update(mem_limit=0)),
            (
                "api",
                lambda s: s.update(
                    ports=[{"host_ip": "0.0.0.0", "published": "6001", "target": 5001}]
                ),
            ),
            (
                "api",
                lambda s: s.update(
                    volumes=[
                        {
                            "type": "bind",
                            "source": "/var/run/docker.sock",
                            "target": "/var/run/docker.sock",
                        }
                    ]
                ),
            ),
            (
                "postgres",
                lambda s: s.update(ports=[{"published": "5432", "target": 5432}]),
            ),
            ("migrate", lambda s: s.update(read_only=False)),
            (
                "migrate",
                lambda s: s["environment"].update(OWNER_PASSWORD="private-canary"),
            ),
            ("bootstrap-admin", lambda s: s.update(profiles=[])),
            (
                "frontend",
                lambda s: s["environment"].update(
                    AWS_SECRET_ACCESS_KEY="private-canary"
                ),
            ),
            ("frontend", lambda s: s.update(image="example.invalid/app:latest")),
            ("frontend", lambda s: s.update(build={"context": "."})),
            ("frontend", lambda s: s.update(networks={"orbit_private": None})),
        ]
        for name, mutate in mutations:
            with self.subTest(service=name, mutation=mutations.index((name, mutate))):
                config = copy.deepcopy(self.canonical)
                mutate(config["services"][name])
                with self.assertRaises(preflight.UnsafeDeployment) as error:
                    preflight.check(config)
                self.assertNotIn("private-canary", str(error.exception))

    def test_parser_never_echoes_invalid_input(self):
        result = subprocess.run(
            ["python3", str(ROOT / "deploy/staging/bin/deployment_preflight.py")],
            input="private-canary",
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("private-canary", result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
