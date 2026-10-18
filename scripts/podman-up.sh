#!/usr/bin/env bash
# Rootless Podman launcher: runs Postgres + the dashboard in one pod (no compose provider needed).
#
#   scripts/podman-up.sh           build the image if missing, then (re)start the pod
#   scripts/podman-up.sh --build   force an image rebuild first
#   scripts/podman-up.sh --down    stop and remove the pod (the Postgres volume is kept)
#
# Env overrides: BIND_ADDR (default 127.0.0.1; use 0.0.0.0 for LAN access), HOST_PORT (default 3000).
# Note: POSTGRES_PASSWORD only takes effect when the noc_dash_pgdata volume is first created.
set -euo pipefail
cd "$(dirname "$0")/.."

POD=noc_dash_pod
BIND_ADDR=${BIND_ADDR:-127.0.0.1}
HOST_PORT=${HOST_PORT:-3000}

if [ "${1:-}" = "--down" ]; then
  podman pod rm -f "$POD" >/dev/null 2>&1 || true
  echo "🛑 Pod removed (volume noc_dash_pgdata kept)."
  exit 0
fi

if [ ! -f .env.local ]; then
  echo "❌ .env.local not found. Copy .env.dist to .env.local and fill it in."
  exit 1
fi

PG_PASS=$(grep -E '^POSTGRES_PASSWORD=' .env.local | cut -d= -f2- || true)
if [ -z "$PG_PASS" ]; then
  echo "❌ POSTGRES_PASSWORD is missing from .env.local."
  exit 1
fi

if [ "${1:-}" = "--build" ] || ! podman image exists noc_dash:latest; then
  echo "🐳 Building noc_dash:latest (runs type-check, lint and the test suite)..."
  podman build -t noc_dash:latest -f Containerfile .
fi

podman pod rm -f "$POD" >/dev/null 2>&1 || true
podman pod create --name "$POD" -p "$BIND_ADDR:$HOST_PORT:3000" -p "127.0.0.1:5432:5432" >/dev/null

echo "🐘 Starting Postgres..."
podman run -d --pod "$POD" --name noc_dash_db --restart always \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB=noc_dash \
  -v noc_dash_pgdata:/var/lib/postgresql/data \
  docker.io/library/postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  podman exec noc_dash_db pg_isready -U postgres -d noc_dash >/dev/null 2>&1 && break
  sleep 1
done

# Inside the pod 127.0.0.1 is the pod itself, so point Ollama at the host unless configured
EXTRA_ENV=()
if ! grep -qE '^OLLAMA_BASE_URL=' .env.local; then
  EXTRA_ENV+=(-e OLLAMA_BASE_URL=http://host.containers.internal:11434)
fi

echo "🚀 Starting dashboard..."
podman run -d --pod "$POD" --name noc_dash --restart always \
  --env-file .env.local -e NODE_ENV=production -e HOSTNAME=0.0.0.0 -e PORT=3000 \
  "${EXTRA_ENV[@]}" \
  noc_dash:latest >/dev/null

echo "✅ Running: http://$BIND_ADDR:$HOST_PORT   (logs: podman logs -f noc_dash)"
