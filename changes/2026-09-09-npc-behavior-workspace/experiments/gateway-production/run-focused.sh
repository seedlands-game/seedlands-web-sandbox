#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${HERE}/../../../.." && pwd)"
IMAGE_TAG="${MODEL_GATEWAY_IMAGE:-seedlands-model-gateway:litellm-1.100.0}"

"${PROJECT_ROOT}/scripts/model-gateway/build.sh"
docker run --rm \
  --env PYTHONPATH=/app \
  --volume "${HERE}/test-gateway-middleware.py:/tmp/test-gateway-middleware.py:ro" \
  --entrypoint python \
  "${IMAGE_TAG}" /tmp/test-gateway-middleware.py -v
