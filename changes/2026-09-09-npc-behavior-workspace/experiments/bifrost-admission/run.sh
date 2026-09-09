#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IMAGE='ghcr.io/maximhq/bifrost@sha256:653b74a8410e5757375aa9a25ce21f90f4591fc11d65879451939b6172ce80ed'
RUN_DIR=${RUN_DIR:-"$(mktemp -d /tmp/npc-bifrost-admission.XXXXXX)"}
MOCK_PORT=${MOCK_PORT:-53767}
GATEWAY_PORT=${GATEWAY_PORT:-53768}
MOCK_PID=''
CONTAINER="npc-bifrost-admission-$$"

cleanup() {
  docker stop -t 3 "$CONTAINER" >/dev/null 2>&1 || true
  docker container rm "$CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$MOCK_PID" ]; then kill "$MOCK_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

for PORT in "$MOCK_PORT" "$GATEWAY_PORT"; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    printf 'Refusing to use occupied port %s\n' "$PORT" >&2
    exit 1
  fi
done

mkdir -p "$RUN_DIR/data"
MOCK_PROVIDER_PORT="$MOCK_PORT" MOCK_PROVIDER_LOG="$RUN_DIR/mock.jsonl" \
  node "$HERE/mock-provider.mjs" >"$RUN_DIR/mock-startup.log" 2>&1 &
MOCK_PID=$!

for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$MOCK_PORT/state" >/dev/null 2>&1 && break
  kill -0 "$MOCK_PID" 2>/dev/null || { cat "$RUN_DIR/mock-startup.log"; exit 1; }
  sleep 0.1
done

start_gateway() {
  SOURCE_CONFIG=$1
  cp "$SOURCE_CONFIG" "$RUN_DIR/data/config.json"
  node -e "const fs=require('fs');const p=process.argv[1];const port=process.argv[2];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('53767',port))" \
    "$RUN_DIR/data/config.json" "$MOCK_PORT"
  docker run -d --name "$CONTAINER" --add-host=host.docker.internal:host-gateway \
    -p "127.0.0.1:$GATEWAY_PORT:8080" -e APP_DIR=/app/data -e APP_PORT=8080 \
    -e APP_HOST=0.0.0.0 -e LOG_LEVEL=info -e LOG_STYLE=json \
    -e MOCK_PROVIDER_KEY=fake-provider-key -v "$RUN_DIR/data:/app/data" "$IMAGE" >/dev/null
  for _ in $(seq 1 150); do
    curl -fsS "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null 2>&1 && return
    running=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)
    [ "$running" = true ] || { docker logs "$CONTAINER"; exit 1; }
    sleep 0.1
  done
  docker logs "$CONTAINER"
  exit 1
}

stop_gateway() {
  LOG_NAME=$1
  docker logs "$CONTAINER" >"$RUN_DIR/$LOG_NAME" 2>&1
  docker stop -t 3 "$CONTAINER" >/dev/null
  docker container rm "$CONTAINER" >/dev/null
}

start_gateway "$HERE/config.json"
GATEWAY_BASE_URL="http://127.0.0.1:$GATEWAY_PORT" MOCK_PROVIDER_URL="http://127.0.0.1:$MOCK_PORT" \
  node "$HERE/run-suite.mjs" main "$RUN_DIR/main.json"
stop_gateway main-gateway.log

start_gateway "$HERE/config-replacement.json"
GATEWAY_BASE_URL="http://127.0.0.1:$GATEWAY_PORT" MOCK_PROVIDER_URL="http://127.0.0.1:$MOCK_PORT" \
  node "$HERE/run-suite.mjs" replacement "$RUN_DIR/replacement.json"
stop_gateway replacement-gateway.log

node "$HERE/summarize.mjs" "$RUN_DIR/main.json" "$RUN_DIR/replacement.json" "$RUN_DIR/summary.json"
printf 'Evidence: %s\n' "$RUN_DIR"
