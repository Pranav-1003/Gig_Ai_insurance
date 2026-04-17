#!/bin/bash
# Creates all three Guardian databases in the Postgres container on first boot.
# Mounted at /docker-entrypoint-initdb.d/ — runs automatically on container init.
set -e

for db in guardian_workers guardian_admin guardian_analytics; do
    echo "[pg-init] Creating database: $db"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
        CREATE DATABASE $db;
        GRANT ALL PRIVILEGES ON DATABASE $db TO $POSTGRES_USER;
SQL
done

echo "[pg-init] All Guardian databases created."
