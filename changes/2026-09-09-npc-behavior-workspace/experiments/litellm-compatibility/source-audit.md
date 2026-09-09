# LiteLLM 1.100.0 兼容边界审计

固定基础为 `ghcr.io/berriai/litellm@sha256:c8756e7b9a61fe45df2ccb5b781d388c3b2f3a21ef9e4956630caef20f9f03aa`。镜像 OCI revision 是 `e4f25265704e2b2c6cf6e81be2e4c5cffff896f4`，安装包版本为 `1.100.0`。

源码检查表明 LiteLLM 的 Router 已拥有别名、供应商转换、重试、Retry-After、tool/reasoning/opaque 字段和 deployment replacement。本次原始 NO-GO 的缺口位于 HTTP 请求范围：`general_settings.global_max_parallel_requests` 的现有 limiter 未在实际跨别名负载中形成一个共享后端许可池；单 deployment 的 `max_parallel_requests` 也不能表达跨别名总配额。`proxy_cli.py` 的 uvicorn app target 固定为 `litellm.proxy.proxy_server:app`，没有配置型 ASGI middleware hook。

兼容扩展只把该 target 改为 `compatibility_gateway:app`。wrapper 在完整 LiteLLM FastAPI app 外层持有一个单进程共享 gate：active=2、pending=32，并从读取请求体之前建立一个 5 秒绝对 deadline。它并行监听 ASGI `http.disconnect`，取消当前 LiteLLM request task；由原有 HTTPX 调用把取消继续传到 mock provider。wrapper 不解析或改写 JSON，Router 仍是 retry 和协议字段的唯一 owner。模型 deployment 上不再配置独立 `max_parallel_requests`，避免双重 admission owner。

该做法的运维约束是必须以一个 uvicorn worker 运行；多 worker 会各自持有 gate，无法形成进程间共享总配额。当前本地单宿主合同满足该约束。若未来需要多进程或多副本，应迁移到网关自身的分布式 limiter，而不是把供应池移入 Agent。

一手源码：

- [LiteLLM v1.100.0 proxy CLI](https://github.com/BerriAI/litellm/blob/v1.100.0/litellm/proxy/proxy_cli.py)
- [LiteLLM v1.100.0 proxy server](https://github.com/BerriAI/litellm/blob/v1.100.0/litellm/proxy/proxy_server.py)
- [LiteLLM v1.100.0 Router](https://github.com/BerriAI/litellm/blob/v1.100.0/litellm/router.py)
- [ASGI HTTP disconnect event](https://asgi.readthedocs.io/en/latest/specs/www.html#disconnect-receive-event)
