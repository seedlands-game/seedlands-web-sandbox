# Seedlands local model gateway

This directory builds a single-worker LiteLLM 1.100.0 gateway from the fixed upstream image digest in `Dockerfile`. The public API is intentionally small:

- `POST /v1/chat/completions`, with model `flash` or `pro`
- `GET /health/liveliness`
- `GET /health/readiness`

Every accepted model call crosses one shared two-request provider gate. At most 32 calls wait; further calls receive 429. The four MiB request limit supports the 128K-token workspace budget while bounding buffering. Request-body reads have a ten-second deadline. The total deadline starts when the request reaches the gateway and defaults to 60 seconds for `flash` and 300 seconds for `pro`, including queue time, up to three LiteLLM attempts, and Retry-After waits. Client disconnect cancels the LiteLLM request task and its provider request.

Build:

```sh
scripts/model-gateway/build.sh
```

Run in the foreground after supplying the local gateway token, the two actual tier mappings, and one matching provider key/base pair:

```sh
MODEL_GATEWAY_TOKEN=... \
MODEL_FLASH_NAME=deepseek-v4-flash-vision-exp \
MODEL_PRO_NAME=deepseek-v4-pro \
DEEPSEEK_API_KEY=... \
DEEPSEEK_API_BASE=... \
scripts/model-gateway/start.sh
```

If the DeepSeek pair is absent, `start.sh` accepts `MIDSCENE_MODEL_API_KEY` only together with `MIDSCENE_MODEL_BASE_URL` and passes the pair exclusively into the gateway container. It never prints either value and never reads an `.env` file. The Agent receives only `http://127.0.0.1:4000/v1` and `MODEL_GATEWAY_TOKEN`; it uses the logical `flash` or `pro` name and performs no transport retry.

The image fixes LiteLLM to production mode so its CLI does not load dotenv files. The script binds loopback only, refuses to replace an existing container, checks that the port is free, and fixes LiteLLM to one uvicorn worker. Both model names are required. `pro` has no default and no fallback to `flash`.

The generic OpenAI-compatible routes explicitly allow the standard `reasoning_effort` field. LiteLLM's model-name heuristic otherwise rejects it before contacting the backend. Factory uses `low` with automatic tool selection; cognition and compaction retain their default reasoning settings. The configured backend must support this field (the selected DeepSeek V4 backend does). Forced tool choice is not used for Factory: the selected backend rejected it with HTTP 400 in real integration.
