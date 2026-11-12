#!/usr/bin/env bash
# Snapshot consistente de banco e arquivos: janela curta de manutenção no staging.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
umask 077
cd /opt/stacks/orbit
compose=(docker compose --env-file .env -f docker-compose.yml)
[[ ! -f docker-compose.lock.yml ]] || compose+=(-f docker-compose.lock.yml)
exec 9>/run/lock/orbit-backup.lock
flock -n 9 || { echo 'Outro backup está em execução.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target=/var/backups/orbit/$stamp
mkdir -m 700 "$target"
api_running=$("${compose[@]}" ps --status running -q api)
if [[ -n "$api_running" ]]; then
    "${compose[@]}" stop -t 90 api
    trap '"${compose[@]}" start api >/dev/null' EXIT
fi
"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$target/database.dump"
"${compose[@]}" exec -T postgres sh -c 'pg_restore --list' < "$target/database.dump" > "$target/database.contents"
# R2 objects are not on this server. Back up buckets separately; the database
# snapshot preserves their keys and SHA-256 values. Legacy volumes remain untouched.
cp docker-compose.yml "$target/"
[[ ! -f docker-compose.lock.yml ]] || cp docker-compose.lock.yml "$target/"
# As chaves de criptografia/segredos devem ser preservadas separadamente no cofre.
find "$target" -type f ! -name SHA256SUMS -exec sha256sum {} + > "$target/SHA256SUMS"
touch "$target/COMPLETE"
# Retenção local de 14 dias; nunca apaga o único backup completo disponível.
count=$(find /var/backups/orbit -mindepth 2 -maxdepth 2 -name COMPLETE | wc -l)
if (( count > 1 )); then
    find /var/backups/orbit -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
fi
echo "Backup concluído: $target"
