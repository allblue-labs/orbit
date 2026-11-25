#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
cd /opt/stacks/orbit
exec 9>/run/lock/orbit-backup.lock
flock -n 9 || { echo 'Outro backup do Orbit está em execução.' >&2; exit 1; }

export ORBIT_BACKUP_IMAGE
ORBIT_BACKUP_IMAGE=$(python3 -c 'import json,re; ref=json.load(open("release.json"))["images"]["backup"]["digest"]; assert re.fullmatch(r"docker.io/allbluelabs/orbit-api@sha256:[a-f0-9]{64}",ref); print(ref)')
cadence=daily
[[ $(date -u +%u) != 7 ]] || cadence=weekly
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml -f docker-compose.backup.yml --profile backup)
"${compose[@]}" pull backup
"${compose[@]}" run --rm --no-deps -T backup backup "$cadence"
