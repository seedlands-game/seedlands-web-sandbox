#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${HERE}/../../../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/npc-gateway-production-startup}"
RUN_ID="$$"
CONTAINER_NAME="npc-gateway-startup-${RUN_ID}"
MOCK_PID=""
GATEWAY_PID=""

free_port() {
  node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

cleanup() {
  docker stop --time 5 "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  if [[ -n "${GATEWAY_PID}" ]]; then
    kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
    wait "${GATEWAY_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MOCK_PID}" ]]; then
    kill "${MOCK_PID}" >/dev/null 2>&1 || true
    wait "${MOCK_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

wait_http() {
  local url="$1"
  for _ in $(seq 1 180); do
    if curl --silent --fail --max-time 1 "${url}" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  return 1
}

mkdir -p "${OUTPUT_DIR}"
MOCK_PORT="$(free_port)"
GATEWAY_PORT="$(free_port)"
MOCK_PROVIDER_PORT="${MOCK_PORT}" MOCK_PROVIDER_LOG="${OUTPUT_DIR}/provider.jsonl" \
  node "${HERE}/mock-provider.mjs" >"${OUTPUT_DIR}/provider.log" 2>&1 &
MOCK_PID="$!"
wait_http "http://127.0.0.1:${MOCK_PORT}/state"

env -i PATH="${PATH}" HOME="${HOME}" \
  MODEL_GATEWAY_IMAGE="seedlands-model-gateway:litellm-1.100.0" \
  MODEL_GATEWAY_CONTAINER_NAME="${CONTAINER_NAME}" \
  MODEL_GATEWAY_PORT="${GATEWAY_PORT}" \
  MODEL_GATEWAY_TOKEN="sk-local-startup-only" \
  MODEL_FLASH_NAME="mock-flash-backend" \
  MODEL_PRO_NAME="mock-pro-backend" \
  DEEPSEEK_API_KEY="fake-provider-key" \
  DEEPSEEK_API_BASE="http://host.docker.internal:${MOCK_PORT}/v1" \
  "${PROJECT_ROOT}/scripts/model-gateway/start.sh" >"${OUTPUT_DIR}/gateway.log" 2>&1 &
GATEWAY_PID="$!"
wait_http "http://127.0.0.1:${GATEWAY_PORT}/health/liveliness"

curl --silent --fail-with-body \
  --header "Authorization: Bearer sk-local-startup-only" \
  --header "Content-Type: application/json" \
  --data '{"model":"flash","messages":[{"role":"user","content":"CASE:TEXT"}]}' \
  "http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions" >"${OUTPUT_DIR}/response.json"
curl --silent --fail "http://127.0.0.1:${MOCK_PORT}/state" >"${OUTPUT_DIR}/provider-state.json"

node - "${OUTPUT_DIR}" <<'NODE'
const fs = require('node:fs');
const output = process.argv[2];
const response = JSON.parse(fs.readFileSync(`${output}/response.json`));
const state = JSON.parse(fs.readFileSync(`${output}/provider-state.json`));
if (response.choices?.[0]?.message?.content !== 'TEXT:complete') throw new Error('unexpected response');
const starts = state.events.filter((event) => event.event === 'start');
if (starts.length !== 1 || starts[0].model !== 'mock-flash-backend') throw new Error('unexpected mapping');
console.log(JSON.stringify({ startup: true, calls: starts.length, backendModel: starts[0].model }));
NODE
