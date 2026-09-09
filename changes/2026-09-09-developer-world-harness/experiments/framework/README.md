# 隔离框架协议实验

这是 H1/H2 的研究证据，不是 workspace 应用，不进入生产依赖或根测试门禁。`probe.mjs` 使用 mock fetch，显式关闭 tracing；没有真实模型/费用/凭据。`result.json` 为 2026-09-09 运行结果，`registry.json` 为注册表快照；其中猜测包名 `@deepseek-ai/dsh-sdk` 的 404 仅为检索过程，真正 SDK 包为 `@deepseek-ai/dsh-sdk-client`。

在仓库根运行（临时目录替换为自己的唯一目录）：

```sh
mkdir -p /tmp/seedlands-framework-recheck
cp changes/2026-09-09-developer-world-harness/experiments/framework/{package.json,package-lock.json,probe.mjs} /tmp/seedlands-framework-recheck/
npm ci --prefix /tmp/seedlands-framework-recheck --ignore-scripts --no-audit --no-fund
node /tmp/seedlands-framework-recheck/probe.mjs
```

脚本默认把报告写入自身目录。预期两个默认 provider 都显示 outboundReasoningPreserved=false；这不是推荐生产放行，而是记录待避开的已复现缺口。LangGraph submitCountAfterResume=1，证明此 fixture 的节点拆分不重复调用提交；真实网络重连仍需世界 ledger。
