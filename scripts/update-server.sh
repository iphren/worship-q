#!/usr/bin/env bash
# Updates the church server to the latest commit and restarts it.
# Run on the server from anywhere inside the repository:  scripts/update-server.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
compose=(docker compose -f apps/server/compose.yaml)

git pull --ff-only
"${compose[@]}" up -d --build
docker image prune -f >/dev/null

port=$(sed -n 's/^WORSHIP_Q_PORT=//p' apps/server/.env 2>/dev/null || true)
for _ in $(seq 30); do
  if info=$(curl -fsS "http://127.0.0.1:${port:-8080}/api/v1/info" 2>/dev/null); then
    echo "Server is up: $info"
    exit 0
  fi
  sleep 1
done
echo "Server did not answer within 30 seconds. Recent logs:" >&2
"${compose[@]}" logs --tail 50 worship-q >&2
exit 1
