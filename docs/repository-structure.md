# 仓库结构规范

本页规定新增文件的组织方式，并记录现有布局的整理方向。当前代码入口见[代码地图](code-map.md)；开发门禁以 [AGENTS](../AGENTS.md)、[ESLint](../eslint.config.mjs) 和[命名配置](../.ls-lint.yml)为准。

## 审计结论

2026-09-08 的 monorepo 分离成果继续保留；2026-09-09 Node Dedicated MVP 归档退出，当前活跃 workspace 为 `@seedlands/web` 与 `@seedlands/game-core`。Web 经 core 的声明 subpath exports 消费逻辑；core 不依赖产品适配，也不获得 DOM、WebWorker 或 Node ambient types。退役 Node 路径仍是禁止 Web/core 反向导入的边界；Headless 工程宿主位于 scripts。

迁移前基线 `f245493` 的 `changes` 有 330 个文件，属于变更合同与历史证据；根目录的 26 个受跟踪文件主要是工具配置和社区入口。主要改进点是功能导航和源码职责聚合，根目录配置及历史证据不应仅为减少数量而搬迁或删除。

这些数字是固定基线的审计快照，不是持续增长的目录上限。

## 顶层归属

| 位置                      | 应放什么                                   | 归属提醒                                              |
| ------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| 根目录                    | workspace 编排、共享检查配置及社区入口文档 | 产品运行依赖归所属包；根 devDependencies 是共享工具   |
| `apps/web/`               | 浏览器产品、Vite/SSG、公开资产与 Web 入口  | 可依赖 game-core；不得依赖 node-server                |
| `packages/game-core/`     | 跨端权威规则、协议、世界、物理与纯计算     | 不依赖 apps 或平台 ambient；能力通过窄实例端口注入    |
| `tests/`                  | 单元测试、架构门禁、长期浏览器基线         | 通常按被测模块归属组织；需求 E2E 遵守 change 生命周期 |
| `changes/<日期>-<名称>/`  | Active 或未归档的变更合同、需求测试与证据  | 历史路径按交付时保留，不为追随当前目录而静默改写      |
| `archives/changes/`       | 明确 Delivered change 的可恢复 ZIP         | manifest 保存原路径和 SHA-256；恢复方式见归档索引     |
| `docs/`                   | 多次变更共用的目标、路线、代码导航和约定   | 不复制 README 的运行说明，不替代具体 spec             |
| `scripts/`                | 工程任务、证据汇总和启动包装               | 产品规则留在所属源码模块                              |
| `apps/web/public/assets/` | 通过静态 URL 加载的图片等公开资源          | 资产来源与许可见 [ASSETS](../ASSETS.md)               |
| `harness/baseline.json`   | 版本化基线                                 | 与忽略的 `harness/results/` 运行产物区分              |

`node_modules/`、`dist/`、`coverage/`、`midscene_run/`、`playwright-report/`、`test-results/` 和 `harness/results/` 是依赖或运行产物；不作为源码组织的一部分，不因目录整理而提交它们。密钥规则继续以 AGENTS 为准。

## 新增源码的归属顺序

1. **先找已有功能所有者。** 在代码地图中定位同类行为及调用链。权威规则放服务端领域模块；客户端快照和碰撞镜像是派生数据，不另建一套真值。
2. **再区分算法与平台适配。** 世界算法放 `packages/game-core/src/world`，共享物理解算放 core 的 `physics`，通用时钟和调度放 core 的 `runtime`。浏览器装配、输入、PlayCanvas、Svelte、客户端适配和浏览器 Worker 在 `apps/web/src`；Headless 开发宿主的 Node builtin/I/O 位于 `scripts/`，不进入 core/Web。未来 Agent Server 单独经审阅选择应用目录，不复用退役产品目录。
3. **把同一职责的辅助文件放在一起。** 接口类型、策略和局部工具靠近实际所有者。不要因为文件短就平铺到上层，也不要为了满足行数规则拆成无语义的编号片段。
4. **出现稳定文件簇时建立领域子目录。** 以生命周期、状态或功能为单位，能用一句话说明该目录负责什么。移动已有文件属于独立迁移工作；当前已有 app/client 的职责目录应优先复用。
5. **确有跨端复用时进入 core。** 先指出 Web 与 Headless 的实际调用方及稳定契约，经 `@seedlands/game-core` 的声明 subpath export 使用；不要通过相对文件路径绕过包边界，也不预建包罗万象的 `shared`、`common` 或 `utils`。

纯 `world-compute-task.ts` 与完整 Authority 输入门禁位于 `packages/game-core/src/compute`；浏览器 Worker 启动、消息与 Wasm adapter 位于 `apps/web/src/worker` 和 `apps/web/src/compute`。

Headless 是工程宿主，复用 core 中的 Authority、世界规则与模拟；Node 专属 Dedicated Worker、文件存储、世界 WebSocket 与生命周期仅在[归档 tag](change-archive.md#node-dedicated-server-研究归档)保留。当前不存在 Node 隔离构建门禁。Node 工程运行时的存在不等于 Node 世界产品重新进入 workspace。

## 文件名、导出与测试

- 新文件和目录使用有语义的 kebab-case。文件名应指出对象或职责，例如 `authority-snapshot-gate.ts`，不要使用 `helper2.ts`。
- 局部契约靠近使用模块；真正的跨端协议需要明确版本、所有者和消费者。不要把所有类型倒进一个顶层 `types.ts`。
- 不为每层目录自动添加 `index.ts` 重导出。只有需要明确公共入口时才使用；现有 `physics/index.ts` 是入口示例，目录分组本身不要求增加公共 API。
- 新单元测试按实现所有者归入 `tests/<领域>/`。测试位置变化应跟随正式迁移，现存跨目录测试不因规范发布被判为错误。
- `tests/e2e/` 只承载已准入的长期基线；单次需求的 Playwright / Midscene 留在所属 `changes/<change-id>/e2e/` 与 `midscene/`。本规范不改变准入评审和证据要求。
- `apps/web/src/app/ui/styles/start-screen.css` 是启动页与运行期共享的首屏样式单一来源，由 Web `index.html` 在 module script 前直接加载；不要在运行期 CSS 中再维护一套启动页几何。
- `apps/web/src/app/ui/generated/prerendered-start-screen.html` 是 `AppRoot` 的确定性 SSR 生成物，不手工编辑；修改首屏组件后运行 `pnpm ssg:update`，`pnpm ssg:check` 会拒绝陈旧生成物。

## 哪些已有自动检查

| 规则                                      | 当前执行来源                                                                                                                                                         | 覆盖边界                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 命名                                      | [.ls-lint.yml](../.ls-lint.yml)                                                                                                                                      | 检查配置中列出的源码、测试、脚本和 change 模式；不等于所有文件后缀和目录职责均已覆盖     |
| 格式                                      | [.prettierrc.json](../.prettierrc.json)                                                                                                                              | 统一格式；没有模块归属判断                                                               |
| 单文件规模                                | [ESLint](../eslint.config.mjs)、[测试](../tests/governance/module-size-eslint.test.ts)                                                                               | 受配置覆盖的代码最多 500 个有效行，忽略空行与注释；不能用原始行数或 CSS 行数直接判断违规 |
| 世界纯逻辑、服务端及 runtime/physics 边界 | [ESLint](../eslint.config.mjs)、[世界边界测试](../tests/governance/world-purity-eslint.test.ts)、[运行时边界测试](../tests/governance/runtime-purity-eslint.test.ts) | 已配置的导入模式与全局对象限制；并非任意间接依赖的完整证明                               |
| 权威所有权与 UI 表现边界                  | [所有权测试](../tests/governance/authority-ownership-eslint.test.ts)、[UI 测试](../tests/governance/ui-presentation-boundary-eslint.test.ts)                         | 浏览器权威实例和 UI 写入的已定义约束                                                     |
| app/client 文件归属                       | [ESLint](../eslint.config.mjs)、[归属测试](../tests/governance/client-app-boundary-eslint.test.ts)                                                                   | client 不导入 app；app/client 顶层只允许显式组合入口，其他文件必须进入职责目录           |
| workspace 包边界                          | [ESLint](../eslint.config.mjs)、[包边界测试](../tests/governance/monorepo-package-boundaries.test.ts)                                                                | 拒绝跨包相对路径、反向/互相依赖、未声明依赖和未导出的 core subpath                       |

目录粒度仍是评审取舍，不等于完整依赖 DAG。后续强化边界必须先补规则的正反例测试并遵守 SDD，不能把文档目标写成已经验证的能力。

## 当前职责目录

| 目录                                | 负责什么                                                   |
| ----------------------------------- | ---------------------------------------------------------- |
| `apps/web/src/app/scene/`           | PlayCanvas 场景、材质、昼夜、光照、反射和水面视觉资源      |
| `apps/web/src/app/world/`           | 浏览器 World、streaming、网格调度、Chunk GPU 资源与提交    |
| `apps/web/src/app/player/`          | Pointer Lock、玩家控制、碰撞调试、第一人称表现和输入门控   |
| `apps/web/src/app/gameplay/`        | 浏览器 gameplay 表现、实体资源、目标/破坏 overlay 与水体验 |
| `apps/web/src/client/authority/`    | Authority/Logic 客户端、epoch、快照、镜像和传输            |
| `apps/web/src/client/compute/`      | 浏览器计算运行时、池与网格快照                             |
| `apps/web/src/client/persistence/`  | 浏览器存档、加载、指标、基准与 persistence Worker 契约     |
| `apps/web/src/client/presentation/` | 客户端表现计算、性能遥测、模型定义、命中体和公开资产 URL   |

`apps/web/src/app/` 顶层的 `.ts`、`.svelte` 文件以及 `apps/web/src/client/` 顶层的 `.ts` 文件不作为短文件堆放处。仅明确的组合入口可保留；新增例外必须同时更新 ESLint allowlist、正反例测试和代码地图。不要为这套分组创建 `engine`、`plugins` 或全局 `shared`。

## 维护责任

新增一级模块、移动地图中的入口、改变状态所有者或运行链路时，在同一个 change 中更新代码地图；只有目录规则发生变化时才修改本规范。交付快照应列出迁移范围和验证结果。历史 change 继续作为当时的合同和证据，不追随每次目录调整重写。

## 可组合玩法新增职责

`packages/game-core/src/server/composition/` 负责每世界装配、描述符校验、注册与宿主授权接线。作者公开入口为 `@seedlands/game-core/mod-api`；宿主工厂与内部实现不是模组 API。标准机制的内部实现归 `server/gameplay/modules/`，第一方 Pack/Playbook 按包归 `server/gameplay/playbooks/<pack>/`；本期只在存在消费者时创建目录。

Playbook 代码只能从显式 `mod-api` 或自己的包目录导入。`seedlands/pack-api-boundary` 对静态 import/re-export、动态 import、require 与 import type 做正反例检查；无法静态定位的导入拒绝。这里约束的是仓库内受检源码，不是恶意 JavaScript 沙箱，也不自动给任意外部源码加隔离。跨 Pack 能力通过注册合同消费，不导入另一 Pack 的私有文件。

发布 Pack 的字节/路径/摘要校验属于 `scripts/pack-integrity.mjs` 工程适配；core 只校验已接收描述的业务合同，不加入 Node 文件系统或摘要计算依赖。ECS 准入实验与未批准的适配方案保留在当前 change，不因实验通过就增加生产依赖。
