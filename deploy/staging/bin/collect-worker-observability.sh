#!/usr/bin/env bash
# Execute on the host with read access to Docker logs and the pooler container.
set -Eeuo pipefail
umask 077
root=${ORBIT_STACK_DIR:-/opt/stacks/orbit}
cd "$root"
compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.lock.yml)
pool=$(mktemp)
trap 'rm -f "$pool"' EXIT
"${compose[@]}" exec -T pgbouncer sh -ec '
    test -n "$PGBOUNCER_STATS_PASSWORD"
    export PGPASSWORD="$PGBOUNCER_STATS_PASSWORD" PGCONNECT_TIMEOUT=2
    exec psql -Xq --csv -h 127.0.0.1 -p 6432 -U orbit_stats -d pgbouncer -c "SHOW POOLS"
' > "$pool"
"${compose[@]}" logs --since 3m --no-color --no-log-prefix api worker documents |
    python3 "$(dirname "$0")/worker-observability.py" --pool-csv "$pool" "$@"
