#!/usr/bin/env python3
"""Real production images + canonical Compose + disposable database.

Never reads developer .env, contacts AWS/R2/Stripe or publishes an image. Uses
synthetic credentials, local ports assigned by Docker and its own named volumes.
"""

import argparse
import sys

sys.dont_write_bytecode = True
import copy
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import urllib.error
import urllib.request
from lib.deployment_fixture import isolated_config, preflight

parser = argparse.ArgumentParser()
parser.add_argument(
    "--postgres-tmpfs",
    action="store_true",
    help="Disposable DB in RAM when local Docker disk is constrained",
)
parser.add_argument("--api-image", default="orbit-pr14-api:local")
parser.add_argument("--migrator-image", default="orbit-pr14-migrator:local")
parser.add_argument("--frontend-image", default="orbit-pr14-frontend:local")
parser.add_argument("--pgbouncer-image", default="orbit-pr14-pgbouncer:local")
args = parser.parse_args()
config = isolated_config()
preflight.check(config)
project = "orbit-pr14-" + secrets.token_hex(6)
config["name"] = project
for group in ["networks", "volumes"]:
    for name, value in config[group].items():
        value["name"] = project + "_" + name
services = config["services"]
if args.postgres_tmpfs:
    services["postgres"]["volumes"] = []
    services["postgres"]["tmpfs"] = [
        "/var/lib/postgresql/data:rw,nosuid,noexec,size=536870912"
    ]
for name, image in [
    ("api", args.api_image),
    ("worker", args.api_image),
    ("documents", args.api_image),
    ("migrate", args.migrator_image),
    ("bootstrap-admin", args.migrator_image),
    ("frontend", args.frontend_image),
    ("pgbouncer", args.pgbouncer_image),
]:
    services[name]["image"] = image
api_env = services["api"]["environment"]
for key in [
    "JWT_ACCESS_SECRET",
    "TRIAL_FINGERPRINT_SECRET",
    "AUTH_RATE_LIMIT_SECRET",
    "TRUSTED_PROXY_SECRET",
]:
    api_env[key] = secrets.token_hex(32)
import base64

for key in ["ENCRYPTION_KEY", "EMAIL_SUPPRESSION_HASH_KEY"]:
    api_env[key] = base64.b64encode(secrets.token_bytes(32)).decode()
api_env.update(
    {
        "FRONTEND_ORIGIN": "https://app.example.test",
        "IDENTITY_PUBLIC_WEB_URL": "https://app.example.test",
        "AWS_ACCESS_KEY_ID": "synthetic-access-key",
        "AWS_SECRET_ACCESS_KEY": "synthetic-secret-key",
        "AWS_REGION": "us-east-2",
        "AWS_SES_FROM_EMAIL": "no-reply@example.test",
        "R2_ACCOUNT_ID": "1" * 32,
        "R2_ENDPOINT": "https://" + "1" * 32 + ".r2.cloudflarestorage.com",
        "R2_PUBLIC_URL": "https://cdn.example.test",
        "R2_ACCESS_KEY_ID": "synthetic-access-key",
        "R2_SECRET_ACCESS_KEY": "synthetic-secret-key",
        "JOBS_WORKER_ENABLED": "false",
        "BILLING_EVENTS_WORKER_ENABLED": "false",
        "SUBSCRIPTION_DATA_RETENTION_ENABLED": "false",
        "ACCOUNT_EMAIL_DELIVERY_ENABLED": "false",
        "PUBLIC_CONTACT_DELIVERY_ENABLED": "false",
        "PUBLIC_CONTACT_ENABLED": "false",
        "PUSH_PROVIDER": "disabled",
        "STRIPE_ENABLED": "false",
        "AWS_SES_FEEDBACK_ENABLED": "false",
    }
)
for name in ("worker", "documents"):
    original = services[name]["environment"]
    services[name]["environment"] = {
        **api_env,
        "DATABASE_URL": original["DATABASE_URL"],
        "ORBIT_PROCESS_ROLE": name,
        "JOBS_WORKER_ENABLED": "true",
        "DATABASE_POOL_MAX": original["DATABASE_POOL_MAX"],
    }
services["frontend"]["environment"]["TRUSTED_PROXY_SECRET"] = api_env[
    "TRUSTED_PROXY_SECRET"
]
password = secrets.token_hex(24)
services["bootstrap-admin"]["environment"].update(
    {
        "PLATFORM_ADMIN_EMAIL": "admin@example.test",
        "PLATFORM_ADMIN_PASSWORD": password,
    }
)
fixture = copy.deepcopy(services["bootstrap-admin"])
fixture["profiles"] = ["fixtures"]
fixture["command"] = ["node", "dist/src/scripts/seed-owner.js"]
fixture["environment"] = {
    "NODE_ENV": "production",
    "DIRECT_DATABASE_URL": services["migrate"]["environment"]["DIRECT_DATABASE_URL"],
    "OWNER_EMAIL": "owner@example.test",
    "OWNER_PASSWORD": password,
    "OWNER_FIRST_NAME": "Owner",
    "OWNER_LAST_NAME": "Qualification",
    "OWNER_ORGANIZATION_NAME": "Isolated deployment qualification",
}
services["fixture-owner"] = fixture
for name in ["api", "frontend"]:
    services[name]["ports"][0]["published"] = "0"
# Never attach to named volumes/networks resolved under the developer project.
assert all(
    value["name"].startswith(project)
    for group in ["networks", "volumes"]
    for value in config[group].values()
)
process_env = {
    key: value
    for key, value in os.environ.items()
    if key in ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]
}
checks = []

with tempfile.TemporaryDirectory(prefix="orbit-deployment-proof-") as directory:
    directory = Path(directory)
    compose_file = directory / "compose.json"
    compose_file.write_text(json.dumps(config))
    os.chmod(compose_file, 0o600)
    empty = directory / "empty.env"
    empty.write_text("")
    compose = [
        "docker",
        "compose",
        "--env-file",
        str(empty),
        "--project-directory",
        str(directory),
        "-p",
        project,
        "-f",
        str(compose_file),
    ]

    def command(arguments, allow_failure=False):
        result = subprocess.run(
            arguments, env=process_env, capture_output=True, text=True, timeout=300
        )
        if result.returncode and not allow_failure:
            # Config and passwords are never printed, even when Docker reports an error.
            (directory / "failure.log").write_text(result.stdout + result.stderr)
            detail = result.stdout + result.stderr
            for service in services.values():
                for value in service.get("environment", {}).values():
                    if isinstance(value, str) and len(value) >= 8:
                        detail = detail.replace(value, "[redacted]")
            raise RuntimeError("Falha na qualificação Docker: " + detail[-4000:])
        return result

    def port(service, internal):
        return (
            command(compose + ["port", service, str(internal)])
            .stdout.strip()
            .split(":")[-1]
        )

    def request(base, path, body=None, token=None):
        headers = {
            "content-type": "application/json",
            "origin": api_env["FRONTEND_ORIGIN"],
        }
        if token:
            headers["authorization"] = "Bearer " + token
        req = urllib.request.Request(
            base + path,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    try:
        for image in [args.api_image, args.frontend_image, args.migrator_image,
                      args.pgbouncer_image]:
            metadata = json.loads(
                command(["docker", "image", "inspect", image]).stdout
            )[0]
            assert metadata["Config"]["User"] not in ["", "0", "root", "0:0"]
        print("Imagens sem root confirmadas.", flush=True)
        command(compose + ["up", "-d", "--wait", "--wait-timeout", "90", "postgres"])
        command(compose + ["run", "--rm", "migrate"])
        checks.append("migrations-and-catalogues-read-only-non-root")
        print("Migrations e catálogos concluídos.", flush=True)
        # No seed users may be created by migrations/catalogue initialization.
        sql = command(
            compose
            + [
                "exec",
                "-T",
                "postgres",
                "psql",
                "-U",
                "fixture_admin",
                "-d",
                "fixture_db",
                "-Atc",
                "SELECT count(*) FROM users",
            ]
        ).stdout.strip()
        assert sql == "0"
        command(compose + ["--profile", "admin", "run", "--rm", "bootstrap-admin"])
        command(compose + ["--profile", "fixtures", "run", "--rm", "fixture-owner"])
        checks.append("explicit-admin-and-owner-bootstrap-only")
        print("Bootstrap explícito concluído.", flush=True)
        command(
            compose
            + [
                "up",
                "-d",
                "--no-deps",
                "--wait",
                "--wait-timeout",
                "120",
                "pgbouncer",
                "api",
                "frontend",
            ]
        )
        checks.append("private-pgbouncer-transaction-pool-healthy")
        command(
            compose
            + [
                "up",
                "-d",
                "--no-deps",
                "--wait",
                "--wait-timeout",
                "120",
                "worker",
                "documents",
            ]
        )
        checks.append("dedicated-worker-containers-healthy")
        api = "http://127.0.0.1:" + port("api", 5001) + "/api/v1"
        web = "http://127.0.0.1:" + port("frontend", 3000)
        container = command(compose + ["ps", "-q", "api"]).stdout.strip()
        inspected = json.loads(command(["docker", "inspect", container]).stdout)[0]
        runtime_keys = {value.split("=", 1)[0] for value in inspected["Config"]["Env"]}
        assert not runtime_keys.intersection(
            {
                "DIRECT_DATABASE_URL",
                "APP_DATABASE_URL",
                "POSTGRES_PASSWORD",
                "PLATFORM_ADMIN_PASSWORD",
                "OWNER_PASSWORD",
            }
        )
        assert inspected["HostConfig"]["ReadonlyRootfs"] and inspected["HostConfig"][
            "CapDrop"
        ] == ["ALL"]
        # Root-owned code and a real OS permission denial, independent of read_only.
        command(
            compose
            + [
                "exec",
                "-T",
                "api",
                "node",
                "-e",
                "const f=require('fs');if(f.statSync('/app/dist/src/main.js').uid!==0||f.statSync('/app').uid!==0)process.exit(1);try{f.accessSync('/app/dist/src/main.js',f.constants.W_OK);process.exit(2)}catch(e){if(!['EACCES','EROFS'].includes(e.code))throw e}",
            ]
        )
        checks.append("api-production-without-administrative-credentials")
        qr_token = None
        for client in ["WEB", "MOBILE"]:
            session = request(
                api,
                "/identity/login",
                {
                    "email": "owner@example.test",
                    "password": password,
                    "client": client,
                    "deviceId": "isolated-pr14",
                },
            )["data"]
            token = session["accessToken"]
            request(api, "/identity/me", token=token)
            if client == "WEB":
                request(api, "/customers", token=token)
                request(api, "/assets", token=token)
                customer = request(
                    api,
                    "/customers",
                    {"type": "COMPANY", "legalName": "Deployment fixture customer"},
                    token,
                )["data"]
                unit = command(
                    compose
                    + [
                        "exec",
                        "-T",
                        "postgres",
                        "psql",
                        "-U",
                        "fixture_admin",
                        "-d",
                        "fixture_db",
                        "-Atc",
                        "SELECT id FROM business_units LIMIT 1",
                    ]
                ).stdout.strip()
                asset = request(
                    api,
                    "/assets",
                    {
                        "businessUnitId": unit,
                        "customerId": customer["id"],
                        "category": "EQUIPMENT",
                        "name": "Deployment fixture equipment",
                    },
                    token,
                )["data"]
                request(api, "/assets/" + asset["id"] + "/qr/ensure", {}, token)
                qr_token = command(
                    compose
                    + [
                        "exec",
                        "-T",
                        "postgres",
                        "psql",
                        "-U",
                        "fixture_admin",
                        "-d",
                        "fixture_db",
                        "-Atc",
                        "SELECT token FROM equipment_qr_identities LIMIT 1",
                    ]
                ).stdout.strip()
                assert qr_token
                checks.append("customer-equipment-create-with-restricted-role")
            else:
                request(api, "/mobile/field/home", token=token)
                request(api, "/mobile/field/work-queue", token=token)
                request(api, "/mobile/field/customers", token=token)
                request(api, "/assets/qr/" + qr_token, token=token)
                checks.append("mobile-equipment-qr-resolution")
            checks.append(client.lower() + "-login-profile-and-allowed-business-routes")
        with urllib.request.urlopen(web + "/login", timeout=15) as response:
            assert response.status == 200
        with urllib.request.urlopen(web + "/api/release", timeout=15) as response:
            assert response.status == 200
        # BFF reaches API over the Compose network, not a host loopback bypass.
        req = urllib.request.Request(
            web + "/api/auth/login",
            data=json.dumps(
                {"email": "owner@example.test", "password": password}
            ).encode(),
            headers={
                "content-type": "application/json",
                "origin": api_env["FRONTEND_ORIGIN"],
                "sec-fetch-site": "same-origin",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            assert response.status == 200 and "Secure" in "\n".join(
                response.headers.get_all("Set-Cookie", [])
            )
        checks.append("next-bff-login-and-secure-cookies")
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "postgresStorage": "tmpfs"
                    if args.postgres_tmpfs
                    else "named-volume",
                    "checks": checks,
                }
            ),
            flush=True,
        )
    except BaseException:
        detail = command(
            compose
            + ["logs", "--no-color", "--tail", "35", "postgres", "api", "frontend"],
            allow_failure=True,
        ).stdout
        for service in services.values():
            for value in service.get("environment", {}).values():
                if isinstance(value, str) and len(value) >= 8:
                    detail = detail.replace(value, "[redacted]")
        print(detail[-9000:], file=sys.stderr, flush=True)
        raise
    finally:
        # Only this randomly named project and its newly created volumes.
        result = command(
            compose
            + [
                "--profile",
                "fixtures",
                "--profile",
                "admin",
                "down",
                "--volumes",
                "--remove-orphans",
            ],
            allow_failure=True,
        )
        if result.returncode:
            raise RuntimeError("Limpeza do projeto descartável falhou: " + project)
