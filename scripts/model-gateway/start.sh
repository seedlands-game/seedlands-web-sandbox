#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_TAG="${MODEL_GATEWAY_IMAGE:-seedlands-model-gateway:litellm-1.100.0}"
CONTAINER_NAME="${MODEL_GATEWAY_CONTAINER_NAME:-seedlands-model-gateway}"
PORT="${MODEL_GATEWAY_PORT:-4000}"

: "${MODEL_GATEWAY_TOKEN:?MODEL_GATEWAY_TOKEN is required}"
: "${MODEL_FLASH_NAME:?MODEL_FLASH_NAME is required}"
: "${MODEL_PRO_NAME:?MODEL_PRO_NAME is required}"

if [[ -n "${DEEPSEEK_API_KEY:-}" || -n "${DEEPSEEK_API_BASE:-}" ]]; then
  : "${DEEPSEEK_API_KEY:?DEEPSEEK_API_KEY and DEEPSEEK_API_BASE must be supplied together}"
  : "${DEEPSEEK_API_BASE:?DEEPSEEK_API_KEY and DEEPSEEK_API_BASE must be supplied together}"
elif [[ -n "${MIDSCENE_MODEL_API_KEY:-}" || -n "${MIDSCENE_MODEL_BASE_URL:-}" ]]; then
  : "${MIDSCENE_MODEL_API_KEY:?MIDSCENE_MODEL_API_KEY and MIDSCENE_MODEL_BASE_URL must be supplied together}"
  : "${MIDSCENE_MODEL_BASE_URL:?MIDSCENE_MODEL_API_KEY and MIDSCENE_MODEL_BASE_URL must be supplied together}"
  export DEEPSEEK_API_KEY="${MIDSCENE_MODEL_API_KEY}"
  export DEEPSEEK_API_BASE="${MIDSCENE_MODEL_BASE_URL}"
else
  echo "A matching provider key/base URL pair is required." >&2
  exit 2
fi

export MODEL_GATEWAY_FLASH_ROUTE="openai/${MODEL_FLASH_NAME}"
export MODEL_GATEWAY_PRO_ROUTE="openai/${MODEL_PRO_NAME}"

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "MODEL_GATEWAY_PORT must be an integer from 1 to 65535." >&2
  exit 2
fi
if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "Container ${CONTAINER_NAME} already exists; refusing to replace it." >&2
  exit 2
fi
if ! node -e 'const n=require("node:net");const p=Number(process.argv[1]);const s=n.createServer();s.once("error",()=>process.exit(1));s.listen(p,"127.0.0.1",()=>s.close())' "${PORT}"; then
  echo "Loopback port ${PORT} is already in use." >&2
  exit 2
fi

exec docker run --rm --name "${CONTAINER_NAME}" \
  --publish "127.0.0.1:${PORT}:4000" \
  --env DEEPSEEK_API_KEY \
  --env DEEPSEEK_API_BASE \
  --env MODEL_GATEWAY_TOKEN \
  --env MODEL_GATEWAY_FLASH_ROUTE \
  --env MODEL_GATEWAY_PRO_ROUTE \
  --volume "${HERE}/config.yaml:/app/config.yaml:ro" \
  "${IMAGE_TAG}" --config /app/config.yaml --port 4000 --num_workers 1
