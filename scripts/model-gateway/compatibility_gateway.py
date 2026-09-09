from __future__ import annotations

import os

from litellm.proxy.proxy_server import app as litellm_app

from model_gateway.gateway_middleware import ModelGatewayMiddleware


def positive_float(name: str, default: float) -> float:
    value = float(os.environ.get(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


app = ModelGatewayMiddleware(
    litellm_app,
    concurrency=int(os.environ.get("MODEL_GATEWAY_PROVIDER_CONCURRENCY", "2")),
    pending_limit=int(os.environ.get("MODEL_GATEWAY_PENDING_LIMIT", "32")),
    max_body_bytes=int(os.environ.get("MODEL_GATEWAY_MAX_BODY_BYTES", str(4 * 1024 * 1024))),
    body_timeout_seconds=positive_float("MODEL_GATEWAY_BODY_TIMEOUT_SECONDS", 10),
    tier_deadlines={
        "flash": positive_float("MODEL_GATEWAY_FLASH_DEADLINE_SECONDS", 60),
        "pro": positive_float("MODEL_GATEWAY_PRO_DEADLINE_SECONDS", 300),
    },
)
