#!/usr/bin/env bash
# starfold needs http, not file://, because it uses a worker and fetches the
# demo data. Nothing leaves this machine.
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "starfold on http://127.0.0.1:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
