#!/bin/sh
set -e

echo "Starting backend container..."

# Fix storage permissions (volume mounts or docker cp may set root ownership)
chown -R appuser:appuser /app/storage 2>/dev/null || true

# Check if AUTO_MIGRATE is enabled
if [ "${AUTO_MIGRATE}" = "true" ]; then
    echo "Running database migrations..."
    /app/migrate || {
        echo "Migration failed, but continuing startup..."
    }
fi

# Start the server as appuser
echo "Starting server..."
exec su -s /bin/sh appuser -c "/app/server"
