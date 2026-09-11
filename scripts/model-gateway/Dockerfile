FROM ghcr.io/berriai/litellm@sha256:c8756e7b9a61fe45df2ccb5b781d388c3b2f3a21ef9e4956630caef20f9f03aa

COPY gateway_middleware.py /app/model_gateway/gateway_middleware.py
COPY compatibility_gateway.py /app/compatibility_gateway.py
RUN touch /app/model_gateway/__init__.py && python - <<'PY'
from pathlib import Path

path = Path("/app/.venv/lib/python3.13/site-packages/litellm/proxy/proxy_cli.py")
source = path.read_text()
old = '"app": "litellm.proxy.proxy_server:app"'
new = '"app": "compatibility_gateway:app"'
if source.count(old) != 1:
    raise SystemExit("unexpected LiteLLM proxy_cli app target")
path.write_text(source.replace(old, new))
PY

ENV LITELLM_MODE=PRODUCTION \
    MODEL_GATEWAY_PROVIDER_CONCURRENCY=2 \
    MODEL_GATEWAY_PENDING_LIMIT=32 \
    MODEL_GATEWAY_MAX_BODY_BYTES=4194304 \
    MODEL_GATEWAY_BODY_TIMEOUT_SECONDS=10 \
    MODEL_GATEWAY_FLASH_DEADLINE_SECONDS=60 \
    MODEL_GATEWAY_PRO_DEADLINE_SECONDS=300
