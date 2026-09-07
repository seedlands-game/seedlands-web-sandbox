# Web、Node 与游戏核心三包迁移

状态：Active。类型：Breaking；本会话用户在确认三包边界后明确要求“现在请你开始落地完成”，该直接实施授权适用于本合同，不再次索取相同范围许可。原 Dedicated 大合同不因本次结构交付被宣称完成。

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
- [ ] M2：测试、产物、浏览器、隔离构建与 CI 收口，独立复核与修复。
- [ ] M3：更新 README、代码地图、目录规则、AGENTS 路径和交付记录；PR 最新提交必要 CI 通过、无冲突、ready for review；不自动合并。

基础证据分别执行 verify:static、Web build、Node build；命令以迁移后 package.json 为准。浏览器使用项目现行 regression 和本 change 必要用例，Node 使用真实五入口/进程恢复用例；完整基线链路保留实消费证据。独立验证冻结源码后进行，失败返回实施者闭环，不堆叠重复全量检查。无性能改动，本次不进行正式 benchmark。

## 工作量与预算

见 estimates.md。用户允许使用可用额度，但不授权购买、兑换 reset 或自动合并。每阶段记录实际可观测数据，及时提交推送；不能把未知 credits 或费用写成零。

## Delivery Snapshot

待回填。长期 docs baseline 将更新：三包职责、依赖方向、构建/验证入口已形成跨 change 的规则。历史 Node 大合同仍 Active，网络与性能准出独立记录。
