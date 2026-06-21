#!/bin/sh
set -eu

PUBLIC_PORT="${N8N_PORT:-5678}"
INTERNAL_PORT="${N8N_INTERNAL_PORT:-5680}"

export N8N_PORT="$INTERNAL_PORT"
export N8N_PROXY_PORT="$PUBLIC_PORT"
export N8N_PROXY_TARGET="http://127.0.0.1:$INTERNAL_PORT"

echo "Starting n8n on internal port $INTERNAL_PORT"
n8n start &
N8N_PID="$!"

echo "Starting frame proxy on public port $PUBLIC_PORT"
node /home/node/frame-proxy.js &
PROXY_PID="$!"

shutdown() {
  kill "$N8N_PID" "$PROXY_PID" 2>/dev/null || true
}

trap shutdown INT TERM

while kill -0 "$N8N_PID" 2>/dev/null && kill -0 "$PROXY_PID" 2>/dev/null; do
  sleep 2
done

shutdown
wait
