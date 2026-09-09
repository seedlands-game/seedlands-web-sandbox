#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_REF="ghcr.io/berriai/litellm@sha256:c8756e7b9a61fe45df2ccb5b781d388c3b2f3a21ef9e4956630caef20f9f03aa"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/npc-gateway-admission-run-$(date +%Y%m%dT%H%M%S)}"
RUN_ID="$$"
MOCK_PID=""
CONTAINER_NAME=""

free_port() {
  node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

cleanup() {
  if [[ -n "${CONTAINER_NAME}" ]]; then
    docker stop --time 5 "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MOCK_PID}" ]]; then
    kill "${MOCK_PID}" >/dev/null 2>&1 || true
    wait "${MOCK_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

wait_http() {
  local url="$1"
  for _ in $(seq 1 150); do
    if curl --silent --fail --max-time 1 "${url}" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  return 1
}

mkdir -p "${OUTPUT_DIR}"
MOCK_PORT="$(free_port)"
MOCK_PROVIDER_PORT="${MOCK_PORT}" MOCK_PROVIDER_LOG="${OUTPUT_DIR}/provider.jsonl" \
  node "${ROOT_DIR}/mock-provider.mjs" >"${OUTPUT_DIR}/provider.stdout.log" 2>&1 &
MOCK_PID="$!"
wait_http "http://127.0.0.1:${MOCK_PORT}/state"

run_phase() {
  local phase="$1"
  local config="$2"
  local gateway_port
  gateway_port="$(free_port)"
  CONTAINER_NAME="npc-gateway-admission-${RUN_ID}-${phase}"
  docker run --detach --name "${CONTAINER_NAME}" \
    --add-host host.docker.internal:host-gateway \
    --publish "127.0.0.1:${gateway_port}:4000" \
    --env "MOCK_PROVIDER_BASE_URL=http://host.docker.internal:${MOCK_PORT}/v1" \
    --volume "${ROOT_DIR}/${config}:/app/config.yaml:ro" \
    "${IMAGE_REF}" --config /app/config.yaml --port 4000 \
    >"${OUTPUT_DIR}/${phase}.container-id"
  wait_http "http://127.0.0.1:${gateway_port}/health/liveliness"
  GATEWAY_BASE_URL="http://127.0.0.1:${gateway_port}" \
    MOCK_PROVIDER_URL="http://127.0.0.1:${MOCK_PORT}" \
    node "${ROOT_DIR}/run-suite.mjs" "${phase}" "${OUTPUT_DIR}/${phase}.json"
  if [[ "${phase}" == "router" ]]; then
    sleep 9
    curl --silent --fail "http://127.0.0.1:${MOCK_PORT}/state" >"${OUTPUT_DIR}/cancellation-late.json"
  fi
  docker logs "${CONTAINER_NAME}" >"${OUTPUT_DIR}/${phase}.gateway.log" 2>&1 || true
  docker stop --time 5 "${CONTAINER_NAME}" >/dev/null
  docker rm "${CONTAINER_NAME}" >/dev/null
  CONTAINER_NAME=""
}

run_phase router config-router.yaml
run_phase global config-global.yaml
run_phase replacement config-replacement.yaml
node "${ROOT_DIR}/summarize.mjs" "${OUTPUT_DIR}" "${OUTPUT_DIR}/summary.json"
echo "Gateway admission evidence: ${OUTPUT_DIR}"
