#!/usr/bin/env bash
set -e

# =============================================================================
# scripts/start-production.sh
# Production entrypoint for LandAlert-Nexus on Render
# - Spawns Django DRF Gunicorn server on 127.0.0.1:8000
# - Proxies API traffic from TanStack Start Node SSR server on public $PORT
# =============================================================================

echo "[Production Startup] Starting Django REST Framework (Gunicorn) on 127.0.0.1:8000..."
gunicorn --chdir backend config.wsgi:application \
  --bind 127.0.0.1:8000 \
  --workers "${GUNICORN_WORKERS:-2}" \
  --threads 2 \
  --timeout 120 \
  --daemon

# Ensure background Gunicorn is terminated when script exits
cleanup() {
  echo "[Production Startup] Shutting down Django..."
  pkill -f "config.wsgi:application" || true
}
trap cleanup EXIT SIGINT SIGTERM

# Give Gunicorn up to 5 seconds to bind
for i in $(seq 1 5); do
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/ml/health', timeout=1)" >/dev/null 2>&1; then
    echo "[Production Startup] Django backend is healthy and ready on 127.0.0.1:8000."
    break
  fi
  sleep 1
done

# Set backend URL so src/server.ts routes /api/* to Django
export DJANGO_BACKEND_URL="http://127.0.0.1:8000"
export HOST="0.0.0.0"

echo "[Production Startup] Starting Node.js SSR server on public port ${PORT:-3000}..."
exec node .output/server/index.mjs
