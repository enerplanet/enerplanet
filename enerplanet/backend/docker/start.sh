#!/bin/sh
set -e

# Container entrypoint: apply pending migrations, then serve the backend.
#
# Health probes call the server directly and must not run migrations (they
# fire every 30s), so they bypass the migration step.
case "$*" in
  *--health-check*) exec /app/server "$@" ;;
esac

# Apply pending migrations before serving. This is idempotent: files already
# recorded in schema_migrations are skipped (see cmd/migrate), so it is safe
# on every start or restart and guarantees the schema never lags the code
# after an update. A failed migration aborts startup by design — better to fail
# loudly than to serve on a stale or half-migrated schema.
#
# Set RUN_MIGRATIONS_ON_START=false to skip (e.g. an offline/debug start where
# the database is intentionally reset by hand).
if [ "${RUN_MIGRATIONS_ON_START:-true}" != "false" ]; then
  /app/migrate
fi

exec /app/server "$@"
