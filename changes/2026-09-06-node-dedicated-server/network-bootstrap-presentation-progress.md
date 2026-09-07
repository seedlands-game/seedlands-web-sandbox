# Welcome v2 参考投影进度

## 本切片范围

本切片只实现 [启动呈现与世界提交 v2 参考投影计划](network-bootstrap-presentation-plan.md)中的 Welcome v2。新增平台无关的纯投影和 synthetic 单元边界，不修改 v1 `WelcomeReference`、`AuthorityRuntime.ready()`、生产 Host 或浏览器客户端，也不采集真实 corpus。

## RED

先新增 `tests/server/network-reference-bootstrap-presentation.test.ts`，覆盖当前 snapshot 绑定、启动锚点、身份、世界时间、持久化序号、body/camp 副本与 attach 状态边界。用 Node 22 执行：

```text
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run tests/server/network-reference-bootstrap-presentation.test.ts
```

结果为预期 RED：测试文件加载失败，缺少 `src/server/protocol/network-reference-bootstrap-presentation.ts`，退出码 1，0 项测试执行。该结果证明测试先于实现存在。

## GREEN

新增 `src/server/protocol/network-reference-bootstrap-presentation.ts`，导出：

```ts
WELCOME_PRESENTATION_REFERENCE_VERSION;
WelcomePresentationReferenceV2;
projectWelcomePresentationReference(ready, currentSnapshot, context);
```

实现保持 v1 配置、频率、limits、capability 与文本边界，并增加以下门禁：

- 当前 snapshot 必须与 ready 启动锚点同 epoch、同 player。
- `physicsTick`、`activeTimeMs`、`commitSequence` 与 `worldRevision` 不得回退。
- `worldTime`、body 和 `initialCheckpoint` 全部来自同一个当前 snapshot；`worldTime` 按生产范围 `[0, 24)` 校验。由于它会循环或被命令设置，不比较新旧数值大小。
- body position/velocity 必须 finite，grounded 必须为 boolean；camp 固定输出三元组副本或 `null`。
- `ready.isNew` 只投影为 `authorityStartPlayerWasCreated`，表示 Authority 启动时创建玩家。输出不声明 `firstAttach`、`reconnect` 或一次性朝向已经处理。
- durable commit sequence 允许 `-1`，但不得超过当前 checkpoint。

相同 Node 22 定向命令结果为 1 个测试文件、14 项测试全部通过，退出码 0。

目标 Prettier、ESLint 与 `git diff --check` 均通过。本切片未运行全仓 coverage、完整静态检查或构建，由主线统一集成验证。

## Welcome v2 真实 Host 语料

新增：

- `e2e/support/network-bootstrap-welcome-recorder.ts`
- `e2e/network-bootstrap-welcome-corpus.test.ts`
- `e2e/vitest.bootstrap-welcome-corpus.config.ts`

先运行独立 config，因 recorder 模块不存在取得预期 RED：1 个测试文件加载失败、0 项测试执行、退出码 1。完成 recorder 后，先格式化全部 source-bound 文件，再以 Node 22 运行同一命令：

```text
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run --config changes/2026-09-06-node-dedicated-server/e2e/vitest.bootstrap-welcome-corpus.config.ts
```

首次结果为 1 个测试文件、1 项真实 Host 采集用例通过，退出码 0，输出在 `/tmp/seedlands-network-bootstrap-welcome-corpus-v2`。独立审查指出该 generation 只绑定七个关键文件，没有绑定 Git 基线和 tracked diff，且 writer 会覆盖同路径；因此保留它作为历史修正证据，不作为最终 source-bound generation。

修正后的 writer 输出到新目录 `/tmp/seedlands-network-bootstrap-welcome-corpus-v2-source-bound`：

- manifest 同时保存 Git SHA、整个 tracked worktree diff 的 SHA-256 和七个关键 source path 的逐文件 SHA-256。
- 目标目录或发布 claim 已存在时 fail closed；不会删除或覆盖已有 corpus。staging 只清理本次进程自己的路径。
- 同一测试在首次发布成功后再次调用 writer，明确得到“拒绝覆盖”错误，原内容保持不变。

全部 source-bound 文件先完成格式和 ESLint，再用 Node 22 一次性采集。结果仍为 1 个测试文件、1 项用例通过，退出码 0；当前磁盘复核 Git SHA、tracked diff、7/7 source hash、3/3 记录和 corpus hash 全部一致。

三条记录分别证明：

1. 新世界经真实 Dedicated compute 安全出生点与 starter ecology 初始化，`authorityStartPlayerWasCreated=true` 且 camp 存在。
2. 同 epoch 通过生产 `AuthorityRuntime.setPlayerPosition()` 移动，当前 body 为 `{x:2.5,y:21,z:3.5}`，明确不同于旧 ready 初始 `[0.5,20,0.5]`；v2 只输出当前 body。
3. 第一 Host 正式停止保存后，第二 Host 用同一 `MemoryGamePersistence` 恢复，位置保持且 `authorityStartPlayerWasCreated=false`。

每条记录保存规范化的真实 ready 启动锚点、当前 snapshot checkpoint/body/worldTime、完整 context 与 v2 metadata；`inputSha256`、`metadataSha256` 和 `contentSha256` 绑定内容。manifest 把 `attachDisposition` 标为 `NOT_COLLECTED`。

最终 source-bound 身份为：

- Git SHA：`6de696b16f214ec7d36f18b17fe118b5da4b8923`
- tracked source diff SHA-256：`f85d532996edd2296fd916c7a6ecf952d3813dbbc8a994c8133e9e99415948ec`
- manifest payload SHA-256：`451d09196c4bee9b58c02330568994896123e67222102877d2a7ec7f52ac1a8c`
- corpus SHA-256：`f5ed1371e5da251e905856d7398c5f26fabdf8ba75bf021cdf5b3b7fcf6d2190`

历史 generation 的 manifest/corpus hash 分别为 `52c096987dc3cf71ad3a6ccc46ab44cf8a995ae9e09d18f774192ee48713da53` 和 `1c9e5ab1969310dbfe4c95dd828e90aa42442fe9863f2fb967d153e0afd817a7`，仅用于说明修正前结果，不是当前准入证据。

## 已知限制

- 没有生产 session adapter，因此本投影不能证明首次 attach、重连或一次性营地朝向状态机。
- 已有三条真实 Host Welcome corpus；尚无 codec、wire、浏览器相机或网络连接证据。
- WorldCommit v2 尚未实施。

## 编解码接续证据

最终 source-bound 的三条记录已通过 C0/C1/C2 Node 22 完整流水线严格深相等，以及 Chrome 152 两个方向的相同校验。见 [呈现编解码证据](network-presentation-codec-evidence.json)。正式 session、开场朝向和重连应用仍未接线，不能以字段保真替代实际客户端旅程。
