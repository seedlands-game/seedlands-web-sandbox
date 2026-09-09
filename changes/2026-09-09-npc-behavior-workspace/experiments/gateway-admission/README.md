# G：本地网关准入实验

本实验只验证网关候选，不接触真实供应商、真实密钥或 `.env`。受控 Node 服务模拟 OpenAI Chat Completions，并记录安全的场景、模型、尝试次数、并发数和工具往返字段；它不记录请求头。

候选固定为 LiteLLM Proxy `1.100.0`，镜像固定到：

```text
ghcr.io/berriai/litellm@sha256:c8756e7b9a61fe45df2ccb5b781d388c3b2f3a21ef9e4956630caef20f9f03aa
```

## 运行

需要 Docker、Node.js 和 curl。脚本动态选择本机端口，只启动名称以 `npc-gateway-admission-` 开头的本次容器，退出时只清理这些容器。所有鉴权值都是仓库内明确标记的假值。

```bash
./run.sh
```

结果默认写到 `/tmp/npc-gateway-admission-run-<timestamp>`。可用 `OUTPUT_DIR` 指向另一个目录。运行约 40 秒，其中包含等待客户端取消后的下游行为观测。`summarize.mjs` 从原始 JSON 得到逐项布尔结论；它不会把失败门槛改写成通过。

## 已保存证据

`results/` 是 2026-09-09 的实际本地 Docker 运行结果：

| 门槛                                                                | 结果                                               | 证据                                    |
| ------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| flash/pro 完整工具往返，保留 tool call ID、reasoning 与 opaque 字段 | PASS                                               | `router.json`                           |
| 同一 deployment 后端并发 2，慢 A 不阻塞 B/C                         | PASS                                               | `router.json`                           |
| 429 遵守 Retry-After，最多 3 次尝试                                 | PASS                                               | `router.json`                           |
| flash/pro 别名及 flash 同层替换                                     | PASS                                               | `router.json`, `replacement.json`       |
| flash+pro 总后端并发 2                                              | FAIL：观测到 3                                     | `global.json`                           |
| 有界队列 32 与溢出背压                                              | FAIL：35/35 均被接受                               | `global.json`                           |
| 含重试的单一总截止时间                                              | FAIL：2 秒配置成为每次尝试超时，最终约 10.7 秒     | `router.json`                           |
| 客户端断连立即取消下游                                              | FAIL：客户端约 206 ms 返回，后端仍执行 3 次约 8 秒 | `router.json`, `cancellation-late.json` |

因此 LiteLLM `1.100.0` **不通过 G 准入**，不得据此开始 B 产品宿主集成。`global_max_parallel_requests: 2` 在本次真实跨别名请求中没有限制住总后端并发；单 deployment 的 `max_parallel_requests` 只能证明该 deployment 的局部上限。

LiteLLM 当前可保留为协议候选。若继续使用它，需要在网关侧以受支持的插件或中间件实现一个覆盖 flash/pro 的共享许可池、最多 32 个等待者、单调总截止时间和断连取消，并对该扩展重跑本套实验。这个逻辑不能下沉到 Agent。1.100.0 的公开 Router Plugin 合同只在选 deployment 前修改路由上下文，没有覆盖 HTTP 断连至下游取消的完整生命周期；本次未找到可仅靠 YAML 注册、又能满足四项缺口的已发布 admission 插件，因此不能把“可自定义插件”记成已支持方案。

Bifrost 仅进入下一候选验证。其文档明确提供**每 provider** 的 concurrency、buffer 和溢出策略，但这仍不能证明跨 flash/pro 的共享总池、工具字段、重试总截止时间或断连取消满足本合同；必须用同一 mock 和判定器实测后再决定。

## 文件

- `config-router.yaml`：别名、每 deployment 并发、重试和缩放超时。
- `config-global.yaml`：在相同配置上加入 LiteLLM 全局并发设置的验证组。
- `config-replacement.yaml`：不改客户端的 flash 同层后端替换。
- `mock-provider.mjs`：受控工具、429、慢响应和取消观测端。
- `run-suite.mjs`：通过真实 `/v1/chat/completions` 发请求。
- `summarize.mjs`：从原始结果计算准入结论。
- `framework-inspection.md`：G 通过后 B 的最小标准框架接入建议。

来源：[LiteLLM releases](https://github.com/BerriAI/litellm/releases)、[Bifrost performance tuning](https://docs.getbifrost.ai/providers/performance)。
