#!/bin/sh
set -eu
umask 077

if [ "${1:-}" = healthcheck ]; then
  PGPASSWORD="$APP_DATABASE_PASSWORD" PGCONNECT_TIMEOUT=3 psql -XAtq \
    -h 127.0.0.1 -p 6432 -U orbit_app -d "$POSTGRES_DB" \
    -c 'SELECT 1' | grep -qx 1
  exit
fi

host=${PGBOUNCER_DB_HOST:-postgres}
port=${PGBOUNCER_DB_PORT:-5432}
case "$host" in ''|*[!a-zA-Z0-9._-]*) exit 1 ;; esac
case "$POSTGRES_DB" in ''|*[!a-zA-Z0-9_]*) exit 1 ;; esac
for value in "$port" "${PGBOUNCER_MAX_CLIENT_CONN:-300}" "${PGBOUNCER_DEFAULT_POOL_SIZE:-16}" \
  "${PGBOUNCER_RESERVE_POOL_SIZE:-4}" "${PGBOUNCER_MAX_DB_CONNECTIONS:-40}" "${PGBOUNCER_QUERY_WAIT_TIMEOUT:-5}"; do
  case "$value" in ''|*[!0-9]*) exit 1 ;; esac
done

write_user() {
  case "$2" in *[!a-zA-Z0-9_.~-]*) exit 1 ;; esac
  test "${#2}" -ge 12
  printf '"%s" "%s"\n' "$1" "$2"
}

{
  write_user orbit_app "$APP_DATABASE_PASSWORD"
  write_user orbit_worker "$WORKER_DATABASE_PASSWORD"
  write_user orbit_documents "$DOCUMENTS_DATABASE_PASSWORD"
} > /run/pgbouncer/users.txt

stats_users=
if [ -n "${PGBOUNCER_STATS_PASSWORD:-}" ]; then
  write_user orbit_stats "$PGBOUNCER_STATS_PASSWORD" >> /run/pgbouncer/users.txt
  stats_users=orbit_stats
fi

cat > /run/pgbouncer/pgbouncer.ini <<EOF
[databases]
$POSTGRES_DB = host=$host port=$port dbname=$POSTGRES_DB

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
unix_socket_dir =
auth_type = scram-sha-256
stats_users = $stats_users
auth_file = /run/pgbouncer/users.txt
pool_mode = transaction
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN:-300}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE:-16}
reserve_pool_size = ${PGBOUNCER_RESERVE_POOL_SIZE:-4}
reserve_pool_timeout = 2
max_db_connections = ${PGBOUNCER_MAX_DB_CONNECTIONS:-40}
query_wait_timeout = ${PGBOUNCER_QUERY_WAIT_TIMEOUT:-5}
max_prepared_statements = 200
log_connections = 0
log_disconnections = 0
EOF

exec pgbouncer /run/pgbouncer/pgbouncer.ini
