# Web、Node 与游戏核心三包迁移

状态：Delivered（实现与验收记录冻结；PR 交棒仍以最新 HEAD 必要 CI 和 ready 状态为准）。类型：Breaking；本会话用户在确认三包边界后明确要求“现在请你开始落地完成”，该直接实施授权适用于本合同，不再次索取相同范围许可。原 Dedicated 大合同不因本次结构交付被宣称完成。

## 目标与范围

先将 origin/main 5557f34 合入 Node 8144135 的后继功能分支，保留普通 merge 历史；再建立 pnpm 三包 workspace：apps/web（@seedlands/web）、apps/node-server（@seedlands/node-server）、packages/game-core（@seedlands/game-core）。各包拥有依赖、类型检查、构建和测试入口，根目录负责统一编排与共享工具。用户明确要求及时 commit 与推送，稳定阶段即保存至 origin/codex/node-monorepo，最终 PR 交人类审核。

## 决定

- Web 与 Node 只依赖 game-core，不互相依赖；核心不依赖两端、DOM/WebWorker 全局、Node builtin 或 Node ambient types。包边界使用 workspace:*、明确 exports 和静态正反例验证，禁止跨包相对路径和未声明依赖。不要生成全量巨大 barrel。
- game-core 保留 world、physics、runtime、server 的职责约束，包含浏览器与 Node 共用的权威规则、协议、数据算法、存档编解码和纯计算任务。现有 worker 目录中的纯计算实现按真实依赖提取，浏览器 Worker 启动/消息适配归 Web。
- Web 拥有 Svelte/PlayCanvas/Tone、客户端镜像/预测、浏览器 Worker/IndexedDB、网页资产及 Vite。Node 拥有 CLI/线程/子进程、磁盘/锁/网络平台适配及 Node 打包。运行依赖不得全部留在根包制造伪隔离。
- 核心与 Node 可不安装 Web 包完成检查和 Node 构建；隔离验证在临时目录执行，Node 五入口产物仍可脱离仓库运行。根目录保留一个 lockfile 及通用质量工具；无需新增 Nx/Turbo。
- 保留 main 的 Wasm 默认、ready 握手/回退、TS 优化和预渲染/加载可见就绪行为；Node 仍用 TS。Rust 源码和采用策略暂不迁移，只修复必要资产/构建路径。
- 保留取消/epoch/错误回调再入安全和资源物理结算；完整 Authority 输入不能重新触发客户端生成。保留 task queue 的 logic lane/预算和 main 的失效处理。
- 本次不改变游戏算法、生成版本、存档或 wire 格式，不新增远端可玩/GUI/部署，不宣称性能收益。不重写历史证据；Active 测试迁移路径并记录，Delivered/Archived 保留冻结语义，通过新 change 明确现行回归入口。

## 行为与测试设计

| Given / When                                    | Then / 验收                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| 只准备 core 与 Node 的声明依赖并执行各自命令    | 不要求 Svelte、Vite、PlayCanvas 或 Web 源码；Node 可构建并真实启动/保存/恢复 |
| 核心编译配置无 DOM/WebWorker/Node ambient types | 核心检查通过；注入非法平台依赖的反例必须失败                                 |
| 两端引用共享逻辑                                | 经 game-core 声明导出；跨包相对路径/反向引用的反例必须失败                   |
| Web 默认与 wasm=off 启动游戏                    | 最新启动页、加载/首块可见就绪、本地交互与 Worker 生命周期通过真实浏览器回归  |
| Authority 完整基线经消费/调度/Worker            | 缺项拒绝、无生成回退、过期结果拒绝、transfer 不 detach 缓存、资源结算保持    |
| Node 线程/子进程启动、关停或恢复                | 使用真实进程/产物验证，存储锁与最后 durable 恢复保持                         |

实施前记录可执行 RED：三包 manifest/包边界缺失与 Node 构建依赖全仓 Svelte。新增有意义的架构/隔离检查，并先在迁移前执行观察失败。不以纯字符串替换自证算法或部署正确性。

## 阶段与准出

- [x] M0：合同、RED、main 合入，相关语义检查及兼容构建；独立 commit/push。
- [x] M1：源码和依赖三包迁移、清晰 exports/平台类型边界，独立 commit/push。
- [x] M2：测试、产物、浏览器、隔离构建与 CI 收口，独立复核与修复。
- [x] M3：README、代码地图、目录规则、AGENTS、交付记录与独立验收完成，已建立 PR #15。最后文档提交后的必要 CI、无冲突与 ready 状态由 root 在交棒前核对并记录于 PR；不自动合并。

基础证据分别执行 verify:static、Web build、Node build；命令以迁移后 package.json 为准。浏览器使用项目现行 regression 和本 change 必要用例，Node 使用真实五入口/进程恢复用例；完整基线链路保留实消费证据。独立验证冻结源码后进行，失败返回实施者闭环，不堆叠重复全量检查。无性能改动，本次不进行正式 benchmark。

新增 TS fallback 用例进入常规 Chromium regression 前，按开发治理请求实施者之外的 Sol/xhigh 独立评审，冻结 47f3ad7，结论通过。评审覆盖长期价值、与默认/性能旅程的重复度、确定性、真实 postrender 断言、运行代价和维护负担，见 [基线评审](baseline-review.md)。该用例暂留本 change，由显式脚本持续执行；未来归档必须同步迁移此基线文件与入口。

## 工作量与预算

见 estimates.md。用户允许使用可用额度，但不授权购买、兑换 reset 或自动合并。每阶段记录实际可观测数据，及时提交推送；不能把未知 credits 或费用写成零。

## Delivery Snapshot

三包结构、声明 exports、平台端口、跨包反例、Active Node 类型入口、隔离构建及 Web 默认/TS 回退已落地。迁移前清单中的 239 个 `tests/` 测试文件与 101 个 change-local 测试文件均未删除；本 change 新增 1 个显式 TS fallback Playwright 用例。依赖 `/tmp` 冻结语料的历史用例仍 fail closed，本轮不宣称全部执行。

长期 docs baseline 已更新：README、代码地图、目录规范、AGENTS 和治理文档现在记录三包职责、依赖方向、产物路径与验证入口。根级 PlayCanvas/Svelte/Tone 仅供根整合测试解析；包内产品依赖和 Node 隔离证据单独成立。历史 Node 大合同仍 Active，远端网络、GUI 与性能准出没有随本次结构迁移扩张。

独立 Terra/high 最终验收通过，源码绑定、18 份日志和隔离报告 hash 均匹配，详见 [交付记录](delivery.md) 与 [独立验收](independent-validation.md)。

最终运行时冻结为 e41aa17：47f3ad7 之后仅修复 CI 捕获的 Node 控制端口关闭错误类型竞态。精确终态归一化和三份定向日志另经独立增量复核通过；旧 manifest 不改写为新源码的证据。
