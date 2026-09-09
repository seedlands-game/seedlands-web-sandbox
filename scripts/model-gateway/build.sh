#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_TAG="${MODEL_GATEWAY_IMAGE:-seedlands-model-gateway:litellm-1.100.0}"
docker build --tag "${IMAGE_TAG}" "${HERE}"
docker image inspect "${IMAGE_TAG}" --format '{{.Id}}'
