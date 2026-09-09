# Bifrost v2.1.0 源码边界审计

固定 tag `transports/v2.1.0` 解析到 annotated tag object `5e349341a7efac51f392fdb9aefc7ca6cb6908e7`，再解析到 commit `b211fdaed3b6829e126edaeb6b43503849c062a0`。GitHub codeload tarball 的本次 SHA-256 为 `454c594252c557f7f593df31df12935c1f3057f2834807809c5c2d07d4613571`。

阻塞调用链：

1. `transports/bifrost-http/handlers/middlewares.go:691-694` 从 `*fasthttp.RequestCtx` 创建无 deadline 的 Bifrost context。
2. `core/schemas/context_native.go:7-11` 明确把 `*fasthttp.RequestCtx` 识别为 `Done()` 永不因请求取消而关闭的 non-cancelling context。
3. `core/providers/utils/utils.go:353-365` 明确说明 Bifrost context 即使取消，底层 fasthttp provider 请求仍继续；返回的 wait 必须等它完成，避免 req/resp 池竞态。
4. `core/bifrost.go:5771-5782` 已有队列/worker 等待的 `ctx.Done()` 分支，但入站客户端断连不会关闭该 ctx，因此该分支无法处理 unary 客户端 AbortSignal。

另外三处有局部修补路径，但不能绕开上述入站信号缺失：

- Retry-After：`core/bifrost.go:6346-6350` 只计算固定 jitter backoff 并直接 `time.Sleep`；OpenAI handler 已把 provider headers 放入 context，可增加 delta-seconds/HTTP-date floor 和 cancellable timer。
- 总 deadline：可在 provider 选定后基于独立 total-timeout 配置派生 Bifrost context，使 queue send、worker wait、backoff 和 attempts 共享同一截止；不能复用单次 provider timeout，否则 32 个等待位的验收负载会被过早取消。
- opaque：`core/providers/openai/types.go:167-184` 与 neutral assistant message 缺少 `provider_specific_fields` 的 `json.RawMessage` carrier；转换函数 `core/providers/openai/utils.go:226-231` 只复制 refusal/reasoning/annotations/tool_calls。可增加窄 raw carrier 双向复制。

要获得真实 unary disconnect 信号，需切换/并行引入会取消 `Request.Context()` 的 `net/http` ingress，或引入 socket peek、响应 heartbeat/whitespace 等非标准机制。前者是 HTTP transport 重构，后者是自定义协议并有连接复用、TLS、JSON 客户端兼容风险；两者均超过本合同的最小兼容补丁边界。

一手参考：

- [Bifrost v2.1.0 release](https://github.com/maximhq/bifrost/releases/tag/transports%2Fv2.1.0)
- [Bifrost v2.1.0 tag ref API](https://api.github.com/repos/maximhq/bifrost/git/ref/tags/transports%2Fv2.1.0)
- [fasthttp README](https://github.com/valyala/fasthttp#fasthttp-best-practices)
- [fasthttp client disconnect issue](https://github.com/valyala/fasthttp/issues/468)
