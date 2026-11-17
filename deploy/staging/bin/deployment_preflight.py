#!/usr/bin/env python3
"""Check normalized `docker compose --profile admin config --format json`.

Receives secrets only on stdin, never logs config/values. No third-party packages.
Shared by deploy and isolated CI qualification. Production images require digests;
local image tags are allowed only by the explicit CI caller via check(..., False).
"""

import json
import re
import sys
from urllib.parse import urlsplit


class UnsafeDeployment(ValueError):
    pass


def check(config, require_digests=True):
    def require(condition, message):
        if not condition:
            raise UnsafeDeployment(message)

    services = config.get("services", {})
    require(
        all(
            name in services
            for name in ["api", "frontend", "postgres", "migrate", "bootstrap-admin"]
        ),
        "Inclua os serviços canônicos e o profile admin no preflight.",
    )
    api, web, pg, migrate, bootstrap = [
        services[k]
        for k in ["api", "frontend", "postgres", "migrate", "bootstrap-admin"]
    ]
    runtime = api.get("environment", {})
    require(bool(runtime.get("APP_DATABASE_URL")), "api: APP_DATABASE_URL obrigatório.")
    for key in [
        "DATABASE_URL",
        "POSTGRES_PASSWORD",
        "PLATFORM_ADMIN_PASSWORD",
        "OWNER_PASSWORD",
    ]:
        require(not runtime.get(key), "api: credencial administrativa proibida: " + key)
    try:
        app_url = urlsplit(runtime["APP_DATABASE_URL"])
        admin_url = urlsplit(migrate.get("environment", {}).get("DATABASE_URL", ""))
        require(
            bool(
                app_url.username
                and app_url.password
                and app_url.hostname
                and app_url.path
            ),
            "api: conexão PostgreSQL incompleta.",
        )
        require(
            app_url.scheme in ["postgres", "postgresql"],
            "api: conexão deve usar PostgreSQL.",
        )
        require(
            bool(admin_url.username) and app_url.username != admin_url.username,
            "api: o papel deve diferir do migrator.",
        )
    except ValueError:
        raise UnsafeDeployment("api: conexão PostgreSQL inválida.") from None
    require(
        runtime.get("DATABASE_ENFORCE_RESTRICTED_ROLE") == "true",
        "api: verificação do papel restrito obrigatória.",
    )
    require(
        runtime.get("HOST") == "0.0.0.0" and str(runtime.get("PORT")) == "5001",
        "api: use a interface e porta internas canônicas.",
    )
    require(
        web.get("environment", {}).get("ORBIT_API_URL") == "http://api:5001/api/v1",
        "frontend: upstream interno inválido.",
    )
    for key in web.get("environment", {}):
        require(
            not re.match(
                r"^(?:AWS_|R2_|FIREBASE_|DATABASE_|APP_DATABASE_|POSTGRES_|PLATFORM_ADMIN_|OWNER_|STRIPE_SECRET)",
                key,
            ),
            "frontend: credencial de backend proibida: " + key,
        )
    require(not pg.get("ports"), "postgres: publicar portas é proibido.")
    require(
        config.get("networks", {}).get("orbit_private", {}).get("internal") is True,
        "A rede do banco deve ser interna.",
    )
    require(
        set(api.get("networks", {})) == {"orbit_private", "orbit_public"},
        "api: redes incorretas.",
    )
    require(
        set(web.get("networks", {})) == {"orbit_public"},
        "frontend: não deve acessar a rede do banco.",
    )
    for name, service in services.items():
        if service.get("profiles") and not set(service["profiles"]).intersection(
            {"admin"}
        ):
            continue  # Offline migration profiles are not started by this deploy.
        require("build" not in service, "Build no servidor não permitido: " + name)
        require(
            not service.get("privileged") and not service.get("cap_add"),
            "Privilégios extras proibidos: " + name,
        )
        require(
            service.get("network_mode") != "host" and service.get("pid") != "host",
            "Namespaces do host proibidos: " + name,
        )
        require(not service.get("devices"), "Dispositivos do host proibidos: " + name)
        require(
            not any(v.get("type") == "bind" for v in service.get("volumes", [])),
            "Bind mounts do host proibidos: " + name,
        )
        if require_digests:
            require(
                bool(re.search(r"@sha256:[a-f0-9]{64}$", service.get("image", ""))),
                "Use imagem por digest: " + name,
            )
        require(
            int(service.get("mem_limit", 0)) > 0
            and float(service.get("cpus", 0)) > 0
            and int(service.get("pids_limit", 0)) > 0,
            "Limites de memória, CPU e processos obrigatórios: " + name,
        )
        require(
            "no-new-privileges:true" in service.get("security_opt", []),
            "no-new-privileges obrigatório: " + name,
        )
        if name == "postgres":
            require(
                set(service.get("networks", {})) == {"orbit_private"},
                "postgres: rede incorreta.",
            )
            continue  # Official PostgreSQL entrypoint drops privileges after volume init.
        require(
            service.get("user") in ["1000:1000", "1001:1001"],
            "UID/GID sem root obrigatório: " + name,
        )
        require(
            service.get("read_only") is True and "ALL" in service.get("cap_drop", []),
            "Filesystem somente leitura e cap_drop ALL obrigatórios: " + name,
        )
        require(
            bool(service.get("tmpfs"))
            and all(
                "noexec" in mount and "nosuid" in mount for mount in service["tmpfs"]
            ),
            "tmpfs limitado e protegido obrigatório: " + name,
        )
        if name in ["api", "frontend"]:
            ports = service.get("ports", [])
            require(
                len(ports) == 1 and ports[0].get("host_ip") == "127.0.0.1",
                "Upstream deve publicar somente em loopback: " + name,
            )
            require(
                str(ports[0].get("published")) == ("6001" if name == "api" else "7070")
                and ports[0].get("target") == (5001 if name == "api" else 3000),
                "Porta incompatível com Nginx: " + name,
            )
            require(
                not service.get("volumes"),
                "Runtime não deve persistir arquivos: " + name,
            )
        else:
            require(
                not service.get("ports")
                and set(service.get("networks", {})) == {"orbit_private"},
                "Jobs administrativos devem permanecer na rede privada: " + name,
            )
    require(
        bootstrap.get("profiles") == ["admin"] and bootstrap.get("restart") == "no",
        "Bootstrap deve exigir profile explícito e ser efêmero.",
    )
    require(
        bootstrap.get("command") == ["node", "dist/src/scripts/seed-platform-admin.js"],
        "Bootstrap deve executar somente o seed explícito.",
    )
    require(migrate.get("restart") == "no", "Migrator deve ser efêmero.")
    require(
        not any(
            key.startswith(("OWNER_", "PLATFORM_ADMIN_"))
            for key in migrate.get("environment", {})
        ),
        "Migrator não pode receber credenciais de contas.",
    )


if __name__ == "__main__":
    try:
        check(json.load(sys.stdin))
    except UnsafeDeployment as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, TypeError, KeyError):
        # Never serialize an exception originating in a parser with secret input.
        print(
            "Contrato de implantação recusado; execute os testes locais de preflight para diagnosticar.",
            file=sys.stderr,
        )
        sys.exit(1)
    print("Contrato de menor privilégio validado; nenhum segredo foi exibido.")
