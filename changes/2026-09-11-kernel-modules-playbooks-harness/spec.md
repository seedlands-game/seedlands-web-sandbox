# Change — Kernel / 标准模块 / Playbook 迁移与职责化 Harness 重构

> Change ID：`2026-09-11-kernel-modules-playbooks-harness`
>
> 状态：**Proposed / S0_PREPARING / AWAITING_HASH_REVIEW**；本文件是实施合同，当前进展见 [S0 记录](s0-status.md)，不表示迁移完成。
>
> 类型：**Breaking / Architecture + Test Governance**。目标为一次 change、一个集成分支、一个最终 PR；允许按阶段提交，不把基础设施拆成多个不完整交付。
>
> 实施窗口：**约 6 小时**，包含集成、回归、规则更新与交付收尾；这是附件提出的规划窗口；本轮用户只要求“阅读、拆解、执行”，尚未将六小时设为硬截止，亦不是完成时间保证。
>
> 冻结基线：`seedlands-game/seedlands-web-sandbox` 的 `main`，SHA **`c18a890c7f97f76421e13565ec628d8c50a942da`**，提交时间 **2026-09-11 07:06:07 UTC**，提交标题 `feat: 建立可组合 NPC 行为与认知基线 (#32)`。[S01]
>
> 本方案依据：上述 main 的实际源码、构建/测试配置与项目规则，以及本轮用户确认的三层架构、唯一 Classic 浏览器线路、两层 benchmark。文中目标目录、新命令及新合同均为**待实施设计**，不冒充现状。

---

## 0. 交付合同

### 0.1 一句话目标

**保持当前可观察行为，把现有实现迁移为“小 Kernel → 第一方标准模块 → 独立 Playbook Packs”，同时把“全量历史回归”改为“按职责与依赖选取必要契约测试 + 唯一 Classic 真实游戏线路”，并用可执行规则约束后续演进。**

完成后必须同时成立：

| 交付面 | 可验证结果                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------- |
| 架构   | Kernel 不再包含默认玩法；标准模块可显式装配；Playbook 从 game-core 与历史 change 中移出         |
| 行为   | 当前世界生成、玩法、NPC 执行、权威边界、存档/认知配对等既有合同保持；有意变更与历史缺陷单独登记 |
| 回归   | 默认入口生成可解释的影响计划；只跑必要有效测试，不再拼接历史 change 列表                        |
| 浏览器 | 全仓只有一条受维护的 Playwright 游戏线路，使用 Classic 与真实生产产物                           |
| 性能   | 局部 benchmark 与真实线路 benchmark 分离；复用现有 telemetry，不建立第二套浏览器性能场景        |
| 治理   | 文档、AGENTS、Evidence Skill、CI、脚本与静态规则一致；新增代码和测试必须有 owner                |

**只搬目录、只改 package 名、只删历史测试、只把全量命令改名，都不构成交付。**

### 0.2 范围边界

本次迁移**已经存在的能力与资产**，不是在六小时内重写游戏或完成全部未来路线。

| 本次必须做                                                          | 本次不做                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| Kernel / stdlib / Playbook 的真实依赖与状态责任拆分                 | 新 Utility 算法、新 NPC 职业/预设或“活人感”优化        |
| Classic 承接当前主线的稳定机械玩法与当前既有 NPC 能力               | 重新平衡、改变生成器、升级物理算法、重写战斗规则       |
| 迁移已存在的 Pack、扩展样例与测试夹具，切断对 `changes/` 的运行依赖 | 新建模组市场、不可信 JS 沙箱、通用热更新框架           |
| 重构 Harness、测试选择、唯一浏览器线路与 benchmark 入口             | 新增 Modern 画面/玩法、LOD、异世界内容生成             |
| 保持 Agent 服务及其协议/工作区兼容，迁移 imports 与必要测试         | 接入 LangSmith、改 Agent 调度、重做模型/记忆策略       |
| 更新长期规则及可执行架构门禁                                        | 恢复 Node Dedicated、切换 WebGPU、引入新的 GPU compute |

**Modern 与 Isekai 是后续两个第一方 Playbook 的明确归属，不是本次必须伪造可运行产物的两个空包。**本次为其写清目录归属、目标和接入合同；仅在确有现存实现时迁移对应代码，不把占位 README 计作游戏交付。

### 0.3 Classic 的语义基准

用户希望最终锁定一个早期 Minecraft 版本作为机械玩法参照。**本次已读取来源未提供一个已经冻结的具体版本及完整对齐矩阵**；不能自行声称现有实现已经对齐 Alpha、Beta 或其他版本。

本次采用如下明确假设，避免架构重构混入玩法重写：

- `classic` 是本次迁出的第一方回归 Playbook 名称，不等同于官方 Minecraft Classic 产品。
- 行为兼容 oracle 是冻结 main `c18a890…` 的现有规则、内容、配置与显式合同。
- 若实施开始时能找到已经批准的历史版本对齐文档，引用并保留其范围；与当前行为的差异必须单列，不在迁移过程中暗改。
- 若仍未锁定版本，在 Classic 说明中写 `referenceMinecraftVersion: 未冻结` 的语义说明；此项后续单独对齐，不用一个猜测版本制造完成声明。
- 现有现代交互或 NPC 扩展不能因“Classic 应更简单”而直接删除。可以作为现有可选模块保留；默认世界行为不得无记录变化。

---

## 1. 最新 main 的实际迁移起点

以下为已经读取的事实，不是目标设计。

| 现状                                          | 源码证据                                                                            | 对本次实施的约束                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| #32 已合入 main                               | 分支读回为 `c18a890…` [S01]                                                         | 不再以旧 NPC 分支作为实施 base                                        |
| 架构文档已定义 Kernel、Module、Pack、Playbook | Playbook 是占据唯一组合根位置的 Pack，不是第四种产品格式 [S03]                      | 沿用术语，不另造“Playbook 外再包主 Mod”的强制层                       |
| `packages/game-core` 仍混合多层               | package 同时依赖 `bitecs`、`mistreevous`，有多组通配 exports [S08]                  | 必须拆依赖闭包与公开 API，而不是把旧包整体改名 Kernel                 |
| `GameServer` 继承玩法 facade                  | `GameServer extends GameServerGameplayFacade`，并直接接入工位、流体、玩法保存 [S13] | 是重点解耦位置；通用 owner 不能靠继承默认玩法来运行                   |
| 模组公开入口混合通用合同和默认系统工厂        | `mod-api.ts` 同时导出 Pack 注册、行为树、库存、需求、战斗等 [S14]                   | 分开 Kernel 注册合同与 stdlib 工厂，禁止 Kernel 反向 re-export stdlib |
| Overworld 在 game-core 内                     | `server/gameplay/playbooks/overworld/pack.ts` 装配内容和标准模块 [S11]              | 迁入独立 Classic workspace，继续作为普通 API 消费者                   |
| 构建依赖历史 change                           | builder / click-conversion 从 `changes/.../examples` 构建 [S12]                     | 迁移有效 fixture，清除构建对历史路径的硬依赖                          |
| 浏览器测试存在多入口                          | 根 scripts 调用多个历史 E2E；Playwright `testMatch` 扫描 `changes/*/e2e` [S04][S05] | 切换为唯一受维护线路和唯一启动实现                                    |
| 常规 CI 是文档/全量二选一                     | classifier 对非文档与 main push 返回 full [S21]                                     | 改为影响计划，处理 base/head、删除、移动与未知路径                    |
| world 覆盖率仅限旧目录                        | V8 coverage 包含 `packages/game-core/src/world/**/*.ts`，行阈值 80 [S09]            | 移动后重新映射同一语义集合，不让空目录导致“通过”                      |
| Harness 同样依赖历史数据                      | `run-harness.mjs` 直接读取历史 World Mutation baseline [S19]                        | 迁入有 owner 的有效性能基线；历史证据不再是运行依赖                   |
| 存档绑定完整组合身份                          | `playbookId + packLock + definitionMap`，并有精确旧摘要兼容分支 [S22]               | 代码移动引起的打包字节变化也必须显式处理                              |
| 当前正式后端是 WebGL2                         | AGENTS 明确不切 WebGPU / GPU compute [S02]                                          | 默认真实线路验证 WebGL2 与当前 Wasm/Worker；不展开新后端矩阵          |

附件编制时未重跑验证。本轮已经执行的源基线检查另见 [S0 记录](s0-status.md)。历史测试数字、旧分支 GREEN、PR 已合并均不能代替迁移后新 SHA 的证据。

---

## 2. 目标架构与术语

```text
Playbook Pack（第一方 Gameplay / 内容 / 配置 / 资产组合根）
        ↓ 使用公开合同并显式装配
标准库（第一方可复用 Module 集合）
        ↓ 依赖通用运行保证
Kernel（确定性状态、ECS 基础、事务、事件、调度、授权、版本）

Web Host / Agent Server / Headless Harness
        → 通过已声明端口消费或装配上述能力
        → 不成为第四层游戏规则，不另持有权威世界
```

### 2.1 固定定义

| 名称       | 本次定义                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------- |
| Kernel     | 所有合法 Seedlands 世界共同遵守的最小运行保证；不内置具体游戏规则，不绑定 UI             |
| Module     | 可注册、消费、调度和释放的能力单元；不是每个 helper，也不天然等于一个 npm 包             |
| 标准库     | 第一方 Module 集合；提供可靠默认机制，但使用者可以不装配，或经公开合同使用替代实现       |
| Pack / Mod | 可分发产物单元；manifest 声明模块、依赖及所需分面                                        |
| Playbook   | 满足玩法成立合同、承担唯一组合根位置的 Pack；第一方维护 Classic、Modern、Isekai 三个方向 |
| Harness    | 跨层验证设施；测试职责来自被测 owner，不拥有另一套世界或规则                             |

不增加强制的 `game-runtime → gameplay-mod → product-wrapper` 三重包装，也不为尚无消费者的能力预建框架。

### 2.2 目标目录

以下为本 change 的默认落地拓扑。内部细分按实际依赖决定；若调整命名，应在 S0 一次性记录理由和映射，不能保持两个同义 owner。

```text
apps/
  web/                          # PlayCanvas / Svelte / 输入 / 音频 / 浏览器 Worker / 存储适配
  agent-server/                 # 现有认知服务、模型、PG 与网络宿主

packages/
  kernel/                       # @seedlands/kernel
    src/
      ecs/                      # 通用身份、组件存储与 schema 注册
      execution/                # clock / tick / 阶段 / operation receipt
      transaction/              # 候选、校验、提交、revision 与事件
      registry/                 # Module / Pack / capability 基础合同
      authorization/            # 通用授权机制，不内置职业和玩法权限表
      state/                    # checkpoint envelope / codec 注册 / 生命周期
      spatial/                  # 体素数值存储、坐标、空间查询等必要基础
      runtime/                  # 纯 job / buffer / telemetry / 窄平台端口
    tests/

  stdlib/                       # @seedlands/stdlib；按职责导出，不一 helper 一包
    src/
      physics/
      worldgen/
      fluid/
      items/
      inventory/
      crafting/
      stations/
      needs/
      combat/
      actions/
      perception/
      navigation/
      behavior/
      persistence/              # 所属模块 codec / 迁移，不是第二份状态
    tests/

  cognition-protocol/           # 保留既有纯协议包，依赖明确的公开合同

playbooks/
  classic/                      # @seedlands/playbook-classic；本期真实迁移产物
    package.json
    src/                        # Pack 定义、内容、规则参数、初始化与展示配置
    assets/                     # 本 Playbook 专属资产的源文件
    tests/                      # 内容与装配合同，不包含第二套 Playwright
    scenarios/                  # 唯一真实旅程的版本化场景/路线数据
    README.md
  modern/                       # 现存实现迁入；否则仅路线说明，标记未实施
  isekai/                       # 同上；后续 Creator Harness 验证产品

harness/
  contracts.json                # owner / 路径 / 依赖 / 测试 / 实验入口的最小注册表
  baselines/                    # 按 owner、环境、scenario version 分组
  results/                      # 忽略的运行产物

scripts/harness/                # 影响分析、执行、结果汇总；复用已有脚本能力
  ...
tests/
  architecture/                 # 依赖、公开 API、测试入口与治理规则
  integration/                  # 无浏览器跨模块/宿主协议测试
  fixtures/packs/                # 有效装配正反例；不作为额外第一方游戏维护
  e2e/classic-runtime.spec.ts    # 唯一受维护 Playwright spec / canonical journey
changes/<change-id>/            # spec、迁移说明、证据索引；不被生产或默认回归 import
```

约束：

- `pnpm-workspace.yaml` 增加 `playbooks/*`；Kernel、stdlib、已实现 Playbook 各自有 package manifest、依赖、类型检查和测试入口。
- `packages/game-core` 的活跃生产职责迁移完毕后退出 workspace。不得留下“旧大核 + 新空包”或永久全量兼容 facade。
- 可在实施中短暂使用迁移转发入口，但最终默认生产/测试图不依赖它；历史路径按来源保留或归档，不要求它们在新树上仍可 import。
- Modern / Isekai 尚无产物时，不创建假成功 build、不进入可玩产品枚举，不计作已实现。
- 不额外引入 Nx、Turborepo、数据库或新 CI 平台作为本次前置；复用现有 pnpm、TypeScript、Vitest、Playwright 和脚本。

---

## 3. Kernel：收紧到运行保证，而不是把所有纯 TS 都放进来

### 3.1 归属判据

只有满足“所有合法世界共同需要、不能由玩法绕过”的责任才进入 Kernel。**纯逻辑、执行频繁、位于旧 core、使用 Wasm，都不是充分理由。**

| Kernel 保留                                                     | 移入标准模块或 Playbook                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| 稳定 EntityId、生命周期、通用组件 schema/codec 注册和存储 owner | Health / Hunger / Inventory / Character / Station 的具体组件与规则 |
| 确定性逻辑时钟、调度阶段、有界作业与提交回执                    | MoveTo、Attack、技能、前后摇、Utility/行为树执行策略               |
| 通用候选验证、事务协调、版本、事件顺序与失效信息                | 掉落、消耗、伤害、工作台、熔炉、流体、觅食等业务解释               |
| Pack/Module 生命周期、依赖和 capability 注册机制                | Overworld 默认装配、具体 item/recipe/actor 目录                    |
| 通用 principal/resource 授权机制                                | Classic 的宿主许可清单、职业规则与默认权限配置                     |
| 紧凑体素、坐标与必要空间基础；生成器 provider 入口              | 地形/群系/矿物/树木的具体生成实现及配置                            |
| 通用 checkpoint 容器、版本与迁移注册接口                        | 某个 Playbook 旧摘要表、Inventory/NPC 具体数据迁移                 |
| 纯任务、buffer 所有权和 telemetry 基础合同                      | 浏览器 Worker 创建、Wasm 宿主实例化、PlayCanvas/GPU 对象           |

ECS 基础存储可以继续使用已准入的 `bitecs`。`mistreevous` 应归属行为模块，不能成为 Kernel 的传递依赖。[S08]

### 3.2 必须证明“没有默认游戏也能运行”

新增一个**测试专用最小组合**：注册一个通用组件和确定性系统，执行读写、事件、检查点和恢复。

它必须在不导入/注册以下内容时工作：食物、饥饿、库存、战斗、行为树、默认地形、NPC、PlayCanvas、Agent Server。

这不是另做一个第一方游戏，而是 Kernel 的合同 fixture。若 Kernel 构造器仍要求完整 `GameplayContent`、固定 player/npc 类型或默认规则集，视为拆分失败。

### 3.3 状态与执行保持单一 owner

- 迁移 ECS 组件定义，不复制活体状态；实体的库存、位置、行为状态仍只有一个权威持有者。
- stdlib 通过注册合同参与同一个 tick 与提交，不自行创建第二套权威定时器。
- 通用事务负责跨资源的一致提交；领域模块定义前置条件和候选更新，不绕开授权直接改其他模块状态。
- 物理、流体、工位等按显式装配接入，不再由 Kernel 隐式构造。
- 候选世界恢复必须先校验，再原子替换；失败保留旧 owner，旧 epoch/回调不得写入新世界。
- 保留 TypedArray/SoA 热路径和批量提交；不得为分层改成逐体素 RPC、接口调用、事件广播或每 tick 全量对象转换。

---

## 4. 标准库：现有机制成为可复用模块

### 4.1 迁移方式

按**状态 owner、操作合同、生命周期、消费者**拆模块，不按文件数量拆包。

同一模块内保留必要 helpers；模块之间通过公开合同通信。公共边界必须同时覆盖类型、运行时、状态恢复和失败语义，而不是只导出一个对象然后允许消费者读取其全部内部字段。

模块至少声明适用字段：

| 类别 | 最小内容                                                       |
| ---- | -------------------------------------------------------------- |
| 身份 | Module ID、版本、所属 Pack/标准库来源                          |
| 依赖 | required / optional capabilities、独占 provider 选择及兼容条件 |
| 状态 | 单一 owner、schema/codec、默认值、恢复/移除语义                |
| 执行 | 调度阶段、时钟、操作、授权目标与取消/失败回执                  |
| 验证 | contract ID、无浏览器测试入口、关联集成边界                    |

不强制无状态工具实现空的 `tick/save/dispose`，也不强制每个模块成为 npm 包。

### 4.2 现有能力必须全部有去向

| 现有区域                                    | 目标责任                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `server/gameplay/modules/*` 及相关 runtime  | 按 inventory / crafting / needs / combat / station 等进入 stdlib          |
| `server/simulation/character-*`、导航与感知 | stdlib behavior / navigation / perception / actions；保留现有树语义       |
| `physics/*`                                 | stdlib physics；纯算法可同时被权威物理与客户端预测消费                    |
| `world/*`                                   | 拆开基础体素/坐标、worldgen、mesh/渲染派生计算与 codec，不整目录迁 Kernel |
| `server/fluid/*`                            | stdlib fluid，Kernel 仅提供受控提交与空间合同                             |
| 固定 `GameplayContent` 与默认内容 fallback  | 默认内容进入 Classic；通用内容/目录机制留在对应标准模块                   |
| `server/composition/*`                      | 通用注册/装配/授权进入 Kernel；具体行为目录与玩法桥接留在 stdlib          |
| `compute/*` 与 Rust/Wasm 集成               | 通用任务门禁留 Kernel；算法归实际模块；浏览器实例化/传输留 Web            |

已有 Rust `world-kernels` 名称是计算产物名称，**不表示其中所有算法都属于新的架构 Kernel**。本次不改 Rust 算法、SIMD 策略、ABI 或工具链；只有迁移造成的路径/构建关联需要更新，并核对实际产物身份。

### 4.3 公共 API 的拆法

建议入口：

```text
@seedlands/kernel/mod-api       → definePack、通用 Module/能力/事务注册合同
@seedlands/stdlib/<domain>      → 该方向的标准系统工厂及受版本约束的公开类型
```

关键约束：

- Kernel 不得重导出 stdlib 工厂，否则依赖图仍然倒置。
- 无 `./server/* → 全私有目录` 一类兜底 exports；显式公开经过消费者验证的入口。
- 宿主确需访问的装配端口与普通 Pack API 分开；宿主 API 不是给 Pack 的后门。
- type-only import、动态 import、re-export、require 同样受边界检查。
- 模块数据和能力通过 registry 合同发现，不跨 Pack 读取私有源码。
- 打包可以包含纯模块实现，但 Pack 不得创建自己的 Authority、ECS 世界或权威调度器。

---

## 5. Playbook / Pack 迁移

### 5.1 Classic 是本次唯一新增独立的真实产品 workspace

将现有 Overworld 内容与装配迁入 `playbooks/classic`：方块、物品、配方、战斗参数、Actor profiles、starter ecology、工位内容、行为配方、默认规则以及本产品专属展示配置。[S11]

为了避免不必要的存档破坏，默认：

- 源码目录/包名使用 `classic`；**持久化 Playbook ID 暂保留 `seedlands:overworld`**。
- 旧 item storageId、VoxelId、Module ID、Actor 身份、生成器版本保持。
- 更新构建器，使目录名、产物 entry 与稳定 manifest ID 不必机械相等；不要继续依赖 `seedlands:${目录名}` 推导身份。[S12]
- 不复制一份 Overworld 留在 Kernel 作为 fallback。
- 默认进入世界与旧存档选择继续可用；产品装配由 Web/Headless host 显式传入。

### 5.2 资产与表现的边界

PlayCanvas、材质/网格实现、Svelte 组件、输入和音频设备生命周期继续属于 `apps/web`。Classic 负责内容映射、默认主题/画质配置、物品外观数据与专属资源，而不是拥有第二份 renderer。

本次不强制把整个 UI 改造成通用可热插拔框架，但应移除通用表现代码对 Classic 私有目录的依赖：通过已有 catalog/投影或一个窄配置入口注入内容。

资产迁移必须：保留源字节与逻辑身份、更新打包复制路径、验证 Pages 子路径、检查模型/贴图/声音引用；构建生成目录不作为第二份人工维护源。

### 5.3 现有样例不增加第一方游戏数量

builder、click-conversion、camp-work 等若仅作为装配或能力正反例，迁入 `tests/fixtures/packs/`，保留独立 ESM 构建与正常准入验证。[S12]

若某个入口目前属于已公开产品，应登记并保留其调用兼容；不能仅因它以前位于 `changes/` 就删除功能。测试 fixture 不在产品 UI 中冒充第四个长期维护 Playbook。

### 5.4 Agent 的位置保持不变

`apps/agent-server` 和 `packages/cognition-protocol` 留在原职责层。迁移到新公开 imports，维持绑定、会话、窗口、journal、预算、取消、权限和配对 checkpoint 语义。

本次不改模型决策；正常基线不启动外部模型或网关。Agent 服务、PG、真实 Node 入口仍可有**无 Playwright 的定向集成测试**；没有 Docker/PG 时必须报告 `BLOCKED` 或明确未运行，不能把它们当作纯函数 mock 后声称等价覆盖。

---

## 6. 迁移前冻结语义，迁移后证明兼容

### 6.1 先做一次源/测试责任盘点

S0 生成本 change 的迁移记录，至少包含：

```text
旧路径/职责 → 新 owner/路径 → 公共入口 → 保留的 contract ID
旧测试/重要断言 → 新测试/观察点 → 证据层级 → 去留理由
旧 Pack/资源/存档身份 → 新身份或明确迁移规则
```

优先覆盖所有活跃生产路径、构建入口、默认 CI 测试及与上述路径关联的有效历史依赖。机器可以生成文件清单；人工审阅重点是责任、断言和依赖，不逐文件写无价值长文。

### 6.2 兼容不变量

| ID     | 必须保持的可观察语义                                                      |
| ------ | ------------------------------------------------------------------------- |
| INV-01 | 相同 seed、generatorVersion、坐标和输入，生成结果不因加载/Worker 顺序变化 |
| INV-02 | 一个权威 owner；候选失败不产生部分世界/库存修改                           |
| INV-03 | 事务、revision、语义事件、资源归属与幂等回执保持                          |
| INV-04 | EntityId、Actor incarnation、Action 关联与旧 epoch 拒绝保持               |
| INV-05 | 物品消耗、制作、耐久、伤害、死亡/恢复和工位规则不因迁移改变               |
| INV-06 | 现有行为树的 RUNNING、guard、中断、目标保持与恢复合同保持                 |
| INV-07 | 实际 Worker/Wasm 结果被正确消费，权威缓冲不被错误 transfer/detach         |
| INV-08 | 旧世界及配对认知恢复遵守已有支持范围，不能读到另一条 timeline 的回执      |
| INV-09 | Web 输入、可见编辑反馈、保存重进及浏览器资源生命周期保持                  |
| INV-10 | 默认装配不产生隐式模块、第二份状态或全局可重配 registry                   |

### 6.3 Characterization 不等于把 bug 永久冻结

对既有规则优先保留现有直接断言，再补必要的固定输入、状态与事件序列对照。比较应针对稳定公共语义，而不是私有对象布局。

允许归一化：墙钟时间、随机 runId、构建路径等非语义字段。实体/Action ID 若因重建需映射，必须验证一一对应和引用关系；不能把所有身份字段删除后宣称一致。数值容差沿用既有合同，不为通过测试临时放宽。

发现历史缺陷时，登记 `KNOWN_BASELINE_FAILURE` 与最小复现；非迁移阻塞的修复留在后续 change。与本次移动造成的回归必须区分。不能把旧失败改成预期成功，也不能因为这次是重构顺手改变产品行为。

### 6.4 明确的 Breaking 面，不伪装成零变化

本 change **有意改变源码包名、import 路径、公开 exports、测试命令及测试组织方式**；这些属于已经声明的开发者接口迁移。给出旧入口→新入口对照，更新仓库所有活跃消费者，不承诺任意旧外部源码无需修改即可重新编译。

保持不变的是既有有效的游戏行为、状态所有权、支持范围内的存档语义与权限边界。旧 Pack 二进制是否可继续加载，按其实际依赖、准入与兼容合同核验；不能因源码路径迁移就放宽产物摘要检查，也不无限承诺兼容未准入外部 Pack。

---

## 7. 存档、Pack 摘要与回滚

### 7.1 源码移动不保证二进制身份不变

当前存档校验直接绑定完整 `packLock` 与 `definitionMap`；现有源码还包含特定旧 Overworld 摘要的兼容分支。[S22]

实施必须分别维护：

| 维度               | 处理                                                             |
| ------------------ | ---------------------------------------------------------------- |
| 当前加载产物完整性 | 始终校验实际 manifest/entry/resource 字节；不能忽略摘要          |
| 逻辑内容身份       | 尽量保留 Playbook、Module、item、recipe、actor 的稳定 ID         |
| 存档迁移           | 只接受已捕获并验证的精确旧组合身份，映射到当前准入组合           |
| 模块状态           | codec/version/在途动作恢复继续检查，不能遇到不兼容就重置默认状态 |

S0 使用冻结 main 的正式构建与公开保存路径生成代表性旧存档：包含被编辑 Chunk、库存/耐久、工位、一个运行中 NPC 行为；认知配对部分用确定性 fixture/隔离测试数据库，不调用真实模型。

### 7.2 去掉 Kernel 中的特定产品迁移知识

通用 envelope、完整性与迁移调度归 Kernel；Overworld/Classic 的旧摘要、内容映射和特定迁移函数归 Classic 或对应 stdlib owner，并经可信 host 显式准入。

Pack 不能通过自报“兼容任意摘要”授权自身。未知旧摘要、篡改资源、错误 Module/state 版本必须拒绝，且不破坏当前活世界。

### 7.3 恢复验收与回滚边界

必须证明：旧存档副本 → 新架构恢复 → 继续推进 → 再保存 → 新架构再恢复。库存不丢失、工位/行为不重复产出、旧请求不能重放。

**不要求旧二进制读取新存档**；代码回滚需配套 S0 保存的旧存档副本。不得覆盖用户真实存档或用户 PG 卷。测试导入使用独立世界/timeline/数据库命名空间并负责清理。

---

## 8. Harness 的职责模型

### 8.1 三类验证，只有一类启动浏览器

| 类别                    | 内容                                                                        | 环境                                |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Contract                | Kernel、stdlib、内容、算法、协议、状态机、失败与边界                        | Node / 纯逻辑；需要时执行真实 Wasm  |
| Headless Integration    | 模块装配、同一 Authority、跨域事务、存档、Node 入口、PG/WS 等真实外部边界   | 无浏览器；真实依赖按 owner 显式启用 |
| Classic Runtime Journey | 真实生产 Web 游戏、输入、Worker、Wasm、WebGL2、持久化、少量视觉及端到端性能 | 唯一 Playwright 线路                |

Kernel/标准模块的业务边界条件不使用 Playwright。Wasm 数值等价和消息门禁优先局部测；浏览器中的加载、实际执行、消费、释放才进入 Classic。

“不使用 Playwright”不等于“全部 mock”，也不等于“真实外部集成没有成本”。

### 8.2 每个新测试必须回答

1. 谁是语义 owner？
2. 验证哪个 contract，失败代表什么？
3. 为什么不能在更低成本的边界完成？
4. 哪些源码、配置、资产或 capability 变更必须选择它？
5. 它替代/补充哪项既有保护，有没有重复责任？

不限制测试总数的任意上限；限制的是无 owner、无合同、重复昂贵初始化和隐式历史依赖。

---

## 9. 影响分析与最小充分回归

### 9.1 先可解释，再谈少跑

复用现有 Git diff、TypeScript/包依赖能力与轻量脚本，建立一个仓库级 `harness/contracts.json`。最小注册粒度是职责模块，不要求一函数一条配置。

注册表至少表达：

```text
ownerId
sourcePaths / configurationPaths / assetPaths
required / optional / capability / build dependencies
contractIds → concrete test entrypoints
integration boundary subscriptions
local benchmark entrypoints
classic runtime impact
```

文件、测试和边必须可校验；避免手写另一个无法对账的“架构宇宙”。现有 imports 能推导的依赖不重复手抄；动态注册、数据引用和生成产物需显式补边。

### 9.2 选择流程

```text
冻结 base/head
→ 读取新增/修改/删除/重命名的两侧路径
→ 解析 owner 与源/配置/资产/能力依赖
→ 取受影响责任与反向消费者闭包
→ 选择直接契约及相关集成边界
→ 判断是否需要 Classic / 局部 bench / 完整新基线
→ 输出机器可读计划及每项原因
→ 执行并生成覆盖账本
```

不能只使用“修改文件所在文件夹”。尤其要处理：type-only API、barrel re-export、共享 fixture、锁文件、Rust/Wasm 输入、动态 module registry、Pack manifest、资源、Vite/SSG/Worker 路径和测试选择器自身。

### 9.3 正常选择示例

| 变更                                                | 必选                                                                        | 默认不选                         |
| --------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| 普通说明文档                                        | 文档/链接/路径检查                                                          | 逻辑、构建、浏览器               |
| Kernel 提交/时钟/状态 API                           | Kernel 契约、受影响模块和集成、Classic                                      | 无关局部性能实验、真实模型       |
| stdlib 纯验证器内部变化                             | 所属及依赖合同；若影响用户链路再选 Classic                                  | 无关模块、其他历史 E2E           |
| 导航/行为执行影响角色移动                           | 导航/行为/动作契约及 Classic 对应观察                                       | 音频资产矩阵、Agent 记忆质量评测 |
| Web Worker/Wasm/渲染接线                            | 相关纯逻辑合同、产物构建、Classic                                           | 另一套专用浏览器场景             |
| Classic 配方/资产/装配                              | Classic 内容合同、相关模块、构建与 Classic                                  | Agent provider / PG 测试         |
| Agent 上下文内部逻辑                                | Agent 契约及受影响服务集成                                                  | 无关浏览器和真实模型             |
| 共享认知协议或 Web bridge                           | 协议/bridge/宿主集成；浏览器侧受影响时选择 Classic 已覆盖部分并说明剩余边界 | 把未测 UI 宣称通过               |
| selector、contract registry、根 build/lock/边界规则 | 保守运行完整**新有效基线**、构建、Classic                                   | 全部历史 change 的旧入口         |

依赖闭包不确定时允许选择更大集合；不能为追求少跑而漏测。这里的示例不是仅凭文件名自动豁免的白名单。

### 9.4 Fail closed 与选择器自我保护

- 未知路径、缺失 owner、未解析动态依赖、缺失 base、无效计划：保守选择完整新有效基线；计划错误必须可见，不能空跑成功。
- 删除/移动同时使用 base 与 head 的归属；依赖移除不能让本次改动自动逃过旧消费者测试。
- PR 使用 base 侧可信选择策略，并结合经校验的 head 图补充新路径。不能只相信 PR 自己删减后的 registry。
- 修改选择策略/注册表时，使用 base/head 影响并集，禁止候选规则降低自己的必要验证范围。
- 本迁移 PR 是 bootstrap：先保留旧策略的风险认识，再通过断言迁移账本验证新集合；不能把“旧策略要求 full”解释为必须永远执行历史 Playwright 矩阵。
- main push 按实际 before/after 计算影响；缺少可靠 before 时保守 full-new，不再无条件由 `event=push` 触发历史全量。
- required check 名称继续保持 `Static verification`、`Production build`、`Chromium regression`。不修改外部分支保护；未选择的检查输出明确理由，不冒充已测 PASS。[S07][S10]

### 9.5 覆盖率与测试选择不能相互造假

当前 world 80% 行阈值应映射到迁移后同一受保护源码集合，不因目录变化变成空集合。[S09]

按 owner 选择完整相关测试组，计算对应覆盖口径；不得把只跑子集得到的数字标作全仓覆盖率。未受影响模块的历史结果注明来源 SHA，不冒充当前实测。

本次全局拆分影响几乎全部 owner，**最终允许且需要执行一次完整新有效契约基线**。后续普通 change 使用 affected 模式；`--all` 仅用于跨层变更、选择器变更、无法判定影响或显式审计，不在每个阶段重复运行。

### 9.6 最小计划输出

```json
{
  "schemaVersion": 1,
  "baseSha": "<base>",
  "headSha": "<head>",
  "mode": "affected",
  "changedOwners": ["stdlib.navigation"],
  "selectedContracts": ["navigation.reachability", "actions.cancel"],
  "selectedIntegrations": ["npc.navigation-action"],
  "classic": { "required": true, "reasons": ["runtime movement consumer"] },
  "localBenchmarks": [],
  "fallbackReason": null
}
```

实际实现可增补字段；此 JSON 是目标输出示意，不是当前已有接口。

---

## 10. 唯一 Classic Runtime Journey

### 10.1 唯一性的精确定义

- 一个长期维护的 Playwright spec、一个 canonical 旅程定义、一个启动/执行实现。
- 默认使用一个浏览器上下文、一个固定初态与行动序列；保存后重新加载是同一旅程的一部分。
- 正确性、性能、诊断和必要参数对照复用同一场景及阶段，不维护复制出来的第二条线路。
- 不把历史所有 E2E 包进一个入口，假装变成“一条”。
- `changes/*/e2e` 不再被默认发现，不新增 Playbook 专属常驻 Playwright；脚本、直接 `chromium.launch` 和其他浏览器工具旁路同样受检查。
- 未来接入 LangSmith 等 Agent trace/eval 工具时，不得借此恢复第二套隐形浏览器回归。

### 10.2 启动与身份

使用**正式生产构建产物 + preview**，不是 Vite dev server。构建产物与测试读取同一份：记录 source SHA、工作树是否有未提交改动及 diff hash、lockfile hash、Web/Pack/Wasm artifact hash、scenario version、配置和 runId。

CI 优先下载并校验 build job 产物，避免两次独立构建后混用证据；确需重建时以产物 hash 区分，不直接声称同产物。

保留 strictPort、失败时不复用未知服务、资源/进程清理、`failOnFlakyTests` 和失败证据。诊断重试可取得 trace，但重试通过不覆盖原失败。[S05][S07]

### 10.3 固定路线

S0 从当前可用场景确定 `seed / generatorVersion / 初态 / 坐标 / 输入 / 路线版本`，写入 Classic 的场景数据。禁止跑不通后不断换 seed 选容易样本。

| 阶段          | 实际操作                                                      | 主要验证                                                      |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| C0 启动       | 打开生产页面，选择 Classic、固定 Seed，进入世界               | Pack 准入、部署子路径、Worker/Wasm 资源、真实后端、ready 状态 |
| C1 行动       | Pointer Lock、移动、转向、跳跃、越过 Chunk 边界               | 输入→Authority→物理→快照→画面，近场加载和任务消费             |
| C2 采集制作   | 挖掘、看到掉落、拾取、打开库存、使用已有配方                  | 方块/物品/库存/制作与可见反馈；不得 Harness 代挖              |
| C3 建造生存   | 放置简单结构、消费已有食物，执行当前基线已有生存/战斗交互     | 消耗、碰撞/伤害/恢复等实际规则与 UI 投影                      |
| C4 活体与资源 | 在同一场景观察已有默认 NPC 的一个完整活动；离开局部区域再返回 | 无模型行为、任务推进、资源卸载与重建、可观察网格/光影更新     |
| C5 保存恢复   | 保存、退出/重新加载同一世界，再执行一次实际交互               | 修改/库存/实体身份/行为恢复、旧消息隔离、输入和 UI 新鲜度     |

流程不承担三昼夜 soak、全部配方排列、所有背包手势、工坊每项操作或真实模型任务；这些规则下沉到所属合同。确需证明的浏览器专属效果选少量稳定观察点，不能把 C4 扩张成无限测试大厅。

### 10.4 Playwright 操作，Harness 观察

关键被测操作走正式键鼠/UI。Harness 提供权威状态、事件、回执与 telemetry；它不能把“命令直接写入成功”替代“玩家操作成功”。

场景准备可通过正式开发接口完成，但必须在初态冻结和计数起点之前，显式记录。执行途中不补资源、不传送、不换树、不绕过碰撞帮助任务通过。

逻辑测试可快进模拟；正式帧性能段用正常时间倍率。不得把快进 1800 模拟秒的墙钟当作实际游玩帧性能。

### 10.5 Worker / Wasm / PlayCanvas 必须有实际执行证据

| 对象     | 不足证据                        | 合格观察                                                                        |
| -------- | ------------------------------- | ------------------------------------------------------------------------------- |
| Worker   | enabled / 创建数                | 当前旅程任务的派发、接收、完成与结果被消费；绑定 taskId/epoch/revision          |
| Wasm     | checkbox / 初始化成功           | 实际产物、目标内核调用增量、对应结果进入后续流程；保留 TS 对等局部测试          |
| WebGL2   | 配置字符串                      | 实际上下文/后端与资源提交结果；少量关键画面验证                                 |
| 网格更新 | Authority voxel 已变化          | 对应 dirty/revision 被处理且新结果已呈现                                        |
| 资源释放 | 调用了 dispose                  | 源/目标资源计数或生命周期回执收敛；浏览器不能精测的内存标 estimated/unavailable |
| NPC      | 人形模型存在 / 树 revision 改变 | 同一 Action 的开始、推进、终态及真实身体/物品后果                               |

计数必须从目标操作的正式完成边界取基线并关联结果，不能用全局任意增长冒充对应动作成功。

### 10.6 覆盖边界

唯一线路不是整个引擎的证明。对未被实际激活的 kernel、renderer 分支、Agent UI 或 Modern 专属视觉，输出 `NOT_COVERED / NOT_RUN`，不能被一个总 PASS 吞掉。

历史浏览器独有断言的去向必须逐项登记：适合主旅程的迁入观察点；纯逻辑下沉；不能无损替代的明确覆盖缺口或做本次人工验收，未经批准不宣称同等自动保护。**这类缺口不能通过悄悄恢复第二条 Playwright 线路解决，也不能靠删测试消失。**

---

## 11. 性能基线：局部实测与真实路径

### 11.1 两个层级

| 层级              | 范围                                                                | 结论上限                               |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------- |
| Local benchmark   | 单函数、算法、内核或模块；含必要准备/复制/边界成本的 component 测量 | 证明所测局部对象的性能或确定性资源变化 |
| Runtime benchmark | 使用第 10 节同一 Classic 线路，在固定环境按阶段采样                 | 证明该环境和工作负载上的用户路径表现   |

“局部快 50%”不能写成“游戏快 50%”。局部选型有效但端到端收益未见时，分别记录结论；未测消费者不补造收益。

### 11.2 本次做测量体系迁移，不顺手优化算法

保留已测算法、Rust/Wasm/标量回退和调度策略。把现有 benchmark 按 owner 拆成可选入口，不再每次把 worldgen、mutation、storage、autonomy 等全部跑一遍。[S19]

本次至少迁通一个代表性局部 benchmark（优先既有网格/计算数据路径）与 Classic runtime benchmark，其他有效 benchmark 迁移其归属和调用入口，不要求每个都重做性能实验。

### 11.3 Runtime 采样

复用现有游戏 telemetry，不以 Playwright 总执行时间代替游戏成本。

| 维度          | 指标                                                        |
| ------------- | ----------------------------------------------------------- |
| 帧            | 正常游玩段 frame p50/p95/p99、长帧数量                      |
| 交互          | input→authority、input→visible 分开                         |
| Streaming     | request→visible、排队/计算/提交分解                         |
| Worker / Wasm | 已执行任务/内核数、耗时、队列、缓冲字节与实际产物           |
| 资源          | Chunk/mesh/实体资源峰值与返回后的保留情况、可获得的内存指标 |
| 存储/产物     | 保存字节、加载/保存耗时、bundle/asset 体积                  |

截图、readPixels、详细 trace 与语义视觉分析安排在正式计时段之外。正式性能采样不得与并发构建、大型测试、其他 agent 的高负载任务竞争。[S15]

### 11.4 普通回归不等于完整性能实验

- 普通 affected 回归只收集低成本 telemetry 与确定性资源不变量，不默认执行多轮 A/B。
- 本次迁移比较至少检查明显资源/路径退化；若没有足够匹配设备样本，只报告诊断与未验证边界，不称性能准出。
- 以性能为采纳理由时，预注册 A/A 噪声、交错 A/B、样本数、主指标、否决项与停止线；沿用现有性能窗口规则。[S16][S15]
- CI SwiftShader 结果只用于功能/集成与资源断言，不与本机实体 GPU 的帧阈值直接比较。[S07]
- 默认后端维持 WebGL2；TS/Wasm 或标量/SIMD 对照仅在相关改动时，用同一线路参数化运行，不自动展开全矩阵。

### 11.5 基线写入必须显式

将旧 baseline 拆入新 owner/profile 时保留 source SHA、环境、scenario/corpus、测量边界与单位。只有口径相同才做数值比较。

新线路与旧 benchmark 不同，允许建立**新的版本化基线**，但旧数据标 `NOT_COMPARABLE` 并保留；不能通过重设 baseline 隐藏已观察到的退化。

正常测试不写 baseline。显式更新需提供本次 runId/source/artifact、diff 与原因；候选生成和人工/合同授权后的接受分开。

---

## 12. 历史回归迁移与退出机制

### 12.1 不按数量删，按断言责任迁移

| 处理        | 条件                                                           |
| ----------- | -------------------------------------------------------------- |
| Keep / Move | 保护有效合同，迁到实际 owner，修正入口不改断言语义             |
| Lower       | 原浏览器断言实际是规则/协议矩阵，下沉并证明正反例仍被捕获      |
| Integrate   | 必须经过浏览器的少量证据进入 Classic 现有阶段观察点            |
| Deduplicate | 有同一语义、同一有效边界的替代，记录替代 contract ID           |
| Retire      | 产品/合同已明确退出，或测试已被等价保护替代；记录范围与依据    |
| Gap         | 没有等价替代且唯一线路不覆盖，明确剩余风险，不算迁移完成的保护 |

一个相同业务风险可以有低层反例和少量跨层观察；“同样经过库存”不自动构成重复。

### 12.2 历史证据保留，活跃依赖清零

- `changes/` 保存当时 spec、失败、准出与原始身份，不随重构改写为新语义。
- 当前生产、构建、默认测试、benchmark、Skill 可执行链接不能 import/读取历史 change 作为必需输入。
- 旧 E2E 不再出现在默认 testMatch/scripts/CI；仅明确的历史恢复过程可在原 SHA/归档 checkout 中运行。
- 无需为了本次完成重打包全仓全部历史 ZIP；优先切断活跃依赖并更新归档索引/退出说明。
- 原先绑定旧路径的兼容 shim 随有效消费者迁出而删除；不得继续以历史用例为由强迫 Kernel 永久保留旧布局。

### 12.3 切换方式

S0 读回已有精确 SHA 的历史 CI/证据并运行必要 characterization，不再无条件全量重跑历史 E2E。

S1–S4 使用受影响的定向检查；S5 对全局迁移执行一次完整新有效基线、生产构建与 Classic。通过后旧入口退出。切换账本须证明重要断言有去向，而不是只比较新旧测试条数。

---

## 13. 命令和 CI 目标合同

以下命令为**待实现接口**，实施后由根 `package.json` 提供；不要在文档中把未存在命令当成可立即执行。

| 命令                                             | 行为                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `pnpm harness:plan --base <sha> --head <sha>`    | 只输出影响计划、必要性原因与环境需求，不启动游戏                 |
| `pnpm verify:affected --base <sha> --head <sha>` | 执行计划中的静态、contract 与无浏览器集成；返回完整选择/结果账本 |
| `pnpm harness:classic`                           | 唯一浏览器线路；校验构建身份、正式 preview、输出阶段结果         |
| `pnpm bench:local --owner <id>`                  | 运行已注册的局部 benchmark，不启动浏览器                         |
| `pnpm bench:runtime`                             | 同一 Classic 线路的正式性能模式，不另建 spec                     |
| `pnpm verify:all`                                | 显式运行完整新有效基线及必要产物/Classic；不扫描全部历史 change  |
| `pnpm harness:baseline:accept --run <id>`        | 只接受已经生成并被批准的候选数据，不边测试边覆盖                 |

可以保留少量旧命令作为清晰的兼容 alias，但必须转发至同一实现，不能继续暗跑旧线路。`verify:static` 的新含义在 README/AGENTS 中明确；避免开发者以为它仍等于全量回归。

CI：

```text
可信影响计划
  ├─ Static verification：所选静态/契约/无浏览器集成 + 治理门禁
  ├─ Production build：受影响产物，输出身份清单
  └─ Chromium regression：仅需时消费同产物并执行 Classic
```

计划失败或必选环境不可用不得静默绿灯。未选记录 `NOT_SELECTED(reason)`；选中但没执行是 `BLOCKED/NOT_RUN`。生产发布继续遵守既有权限与 main 流程，本方案不授权修改外部规则或部署设置。

---

## 14. 长期 Harness 规则：必须同步文档与代码

### 14.1 应沉淀的规则正文

建议将下列内容作为 `docs/harness-contracts.md` 的精简规则核心，其他文档链接它，不复制多份略有差异的全文。

1. **职责先于目录。** Kernel 只持有通用运行保证；业务系统归标准模块，内容与默认装配归 Playbook。
2. **测试必须有 owner 和 contract。** 新增源码、配置、资产和测试均进入可校验影响图。
3. **默认最小充分回归。** 使用 affected 计划；full-new 只用于广泛影响、未知影响或显式审计。
4. **历史不是默认依赖。** 活跃生产、测试、构建和 benchmark 不依赖 `changes/` 运行。
5. **浏览器只有 Classic 一条线路。** 新边界优先低层合同；真实平台证据进入既有线路观察点，不复制 E2E。
6. **相同结果不等于相同证据。** mock、Headless、产物构建、真实浏览器与实体 GPU 各自限定结论。
7. **输入与观察分离。** 被测用户操作走真实入口；Harness 不代操作、不在途中补给或修复状态。
8. **配置开启不等于执行。** Worker/Wasm/backend 必须报告实际路径与结果，fallback 明确归属。
9. **性能分局部与真实路径。** 局部倍率不外推，正式采样与高成本诊断分离。
10. **不自动改绿基线。** 语义/阈值/场景变化需显式差异；旧失败和不可比较数据保留。
11. **选择器不能豁免自己。** base/head、删除、动态依赖和治理文件变更保守处理，unknown fail closed。
12. **保护有退出责任。** 每次交付更新 contract/owner；冗余测试必须说明替代，覆盖缺口必须可见。

### 14.2 需要修改的现有规则入口

| 文件                                                  | 本次要替换/更新的内容                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `AGENTS.md`                                           | 移除 game-core 万能归属；指向三层架构、affected 回归与唯一 Classic 规则 |
| `docs/composable-gameplay-architecture.md`            | 区分本次已迁移事实与未来能力；保留 Playbook=Pack 定义                   |
| `docs/repository-structure.md`                        | 新 workspace/测试归属；替换“每个 change 新建 E2E”的旧默认               |
| `docs/code-map.md`                                    | 新入口、状态 owner、装配与运行链，不复制所有源文件                      |
| `docs/ci-testing.md`                                  | 新选择计划、有效保障、覆盖率口径、唯一线路和明确缺口                    |
| `docs/development-governance.md`                      | 需求测试优先所属合同；change 保存证据不成为永久执行目录                 |
| `.agents/skills/seedlands-evidence/SKILL.md`          | 新 runner/plan、证据分层、唯一入口与 baseline 更新规则                  |
| Evidence Skill 的 references/scripts 链接及包装测试   | 跟随真实源文件更新，不留下旧 runner 或断链                              |
| `.agents/skills/seedlands-code-review/` 的相关路由    | 评审检查 owner、影响选择、保护迁移、公开 API 和数据兼容                 |
| README、根 scripts、Vitest/Playwright/ESLint/tsconfig | 命令、入口、产物与静态执行范围同步                                      |

本 change 明确替换“每次生产改动都必须全量历史回归”的旧执行方式，但保留其语义正确、失败可见、精确 SHA 和禁止篡改证据的原则。

### 14.3 可执行防腐检查

| Gate              | 必须拒绝的情况                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- |
| G01 依赖方向      | Kernel→stdlib/Playbook/app；stdlib→具体 Playbook；Web↔Agent 互导；跨包私有路径         |
| G02 纯逻辑        | Kernel/逻辑 stdlib 引入 DOM、PlayCanvas、浏览器 Worker、Node ambient 或模型/数据库依赖 |
| G03 装配独立      | 无默认内容无法启动 Kernel；某模块不选仍被构造；两个世界共享可变 registry               |
| G04 历史依赖      | 活跃生产/build/test/bench import 或读取 `changes/*`                                    |
| G05 浏览器唯一性  | 多个活跃 spec/启动实现；脚本/Skill/Midscene/Puppeteer 绕过 canonical 线路              |
| G06 影响图完整    | 新活跃源码或测试无 owner；必需依赖未声明；已选择测试空匹配                             |
| G07 选择器可靠性  | 删除、移动、资产、schema、selector 自身变化漏选，或失败返回空 PASS                     |
| G08 证据有效      | requested 冒充 effective、旧 SHA/其他产物复用、未跑标 PASS、覆盖率空集合               |
| G09 baseline 安全 | 普通测试写基线、无身份的数据接受、同一 PR 自行降低门槛绕过审阅                         |

静态门禁不是任意恶意代码沙箱，也不能完全证明语义归属；还需最小运行例和定向反例。不要用大量脆弱字符串断言替代实际依赖解析和行为测试。

Kernel 新增职责必须说明“为什么不能做成模块”，并提供无默认游戏的消费者证明；标准库抽取须至少有当前真实消费者或明确的替代组合 fixture。不能为了目录对称创建空模块。

---

## 15. 实施阶段与约 6 小时窗口

这是一个集成 change，阶段是检查点，不是六个独立功能 PR。建议一个集成 owner 维护公共 API、存档与最终规则；有多 Agent 执行条件时，只并行互不冲突的领域迁移/测试归属盘点，性能采样仍串行。

| 阶段                | 规划窗口  | 工作                                                                                 | 阶段退出条件                                               |
| ------------------- | --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| S0 冻结             | 0:00–0:30 | 读最新 main/规则、独立 worktree、责任映射、行为/产物身份、Classic 路线与存档 fixture | base 固定；范围、关键 API 与兼容合同清晰；新边界负例可执行 |
| S1 Kernel / stdlib  | 0:30–2:00 | 拆状态/事务/注册基础与标准模块；解除 GameServer 继承/隐式装配耦合                    | 裸 Kernel 和一个真实模块组合运行；无反向依赖、无双 owner   |
| S2 Playbook / hosts | 2:00–2:45 | Classic workspace、样例/资产/build 迁移、Web/Agent/Headless 接线、精确存档兼容       | 正式构建可用；旧存档副本恢复；活跃图不依赖历史目录         |
| S3 Harness 选择     | 2:45–3:45 | owner/contracts 注册、base/head 影响选择、纯逻辑测试归属、coverage 口径              | 选择器成功/失败/删除/移动等反例通过；能输出可解释计划      |
| S4 唯一线路         | 3:45–5:00 | Classic 生产旅程、Worker/Wasm/WebGL2 观察、两层 bench 接口、旧 E2E 去向              | 唯一线路可跑；错误对照被捕获；不另开浏览器 benchmark       |
| S5 规则与收尾       | 5:00–6:00 | 完整新有效基线一次、产物与迁移核验、规则/Skill/CI 同步、独立审阅和交付               | DoD 逐项有证据；失败/缺口保留；PR 交给人类                 |

规则和测试应随阶段同步更新，不等到最后一小时才开始写；S5 负责最终一致性检查与预留返工。

### 15.1 时间与范围控制

6 小时是 timebox，不是降低验收门槛的理由。S0/S2/S4 重估剩余关键路径；如果超过窗口，停止追加新能力、保留可恢复提交和当前失败说明。不能把“迁了一半”“新增空包”或“删掉失败测试”标成完整交付。

可优先压缩的是非必要美化、未来模块接口泛化、全仓历史 ZIP 重打包和额外 benchmark 矩阵；不能压缩单 owner、存档安全、边界负例、唯一生产线路与规则一致性。

仓库治理要求 Breaking 合同按精确文档 hash 审核。[S16] 当前用户已要求阅读、拆解并执行。本轮先落地 S0 审核材料、现状 characterization 与负例；按仓库现行规则，生产迁移在用户审核本文件精确 SHA-256 后开始。附件中关于过去用户确认、预算或只读任务的叙述不是本轮独立授权。本任务不自动创建 Goal 或六小时后台任务。

### 15.2 工作量与预算（规划估计，非实测）

| 项目                              | 估计/约束                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| 传统工程量                        | 约 7–12 PD，低置信度；含跨包迁移、存档、测试选择、浏览器收敛与审阅，不按固定 AI 倍率换算       |
| AI 墙钟目标                       | 约 6h；正常规划关键路径约 5h，另预留约 1h，缓冲仅计一次                                        |
| 可行性假设                        | 依赖已可安装、现有生产流程可运行、主要工作是迁移而非规则重写；没有新的 provider/数据库功能开发 |
| Agent 并发                        | 默认单集成 owner；是否有辅助执行者、模型与 effort 在实施环境登记，不靠未授权并发保证工期       |
| 活跃 Agent 工时                   | 单 owner 规划约 4–6h；工具执行和外部 CI 等待单列，不能把它们都算模型生成时间                   |
| 编码模型 credits/token/API 等价费 | **UNKNOWN，待执行器从实际 usage 和已核验费率登记**；不虚构额度分母和金额                       |
| 游戏内真实模型预算                | **计划调用 0 次**；禁止为了重构验收自动调用 Flash/Pro 或新建付费服务                           |
| PG/容器/构建环境                  | 使用隔离临时环境；不可用明确标记；不删除用户卷，不修改 registry/供应链策略绕过失败             |
| 外部 CI 墙钟                      | 依 runner 和排队情况实报；本窗口内未完成远端检查不得标成已完成                                 |

六小时是当前目标，不是已经验证的保守上限。若首阶段测得剩余估算 ×120% 已超过剩余窗口，记录偏差与收尾计划，不能伪造“保证六小时”。估算格式沿用现有预算规范。[S17]

---

## 16. TDD 与验收矩阵

所有状态初始为 `NOT_RUN`。旧测试已有有效 RED/GREEN 可引用原证据；本次新增边界/修复必须取得自己的反例，不能补写从未执行的 RED。

| ID  | Given / When                                                            | Then                                                        | 边界                         |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| T01 | 无 stdlib/Classic/Agent，启动最小 Kernel，注册一个组件并推进            | 状态、事务、事件、保存恢复成立，无隐式玩法                  | Kernel contract              |
| T02 | Kernel 引入行为/库存或 app；Pack 使用私有路径，包括 type/dynamic import | 静态门禁拒绝；合法公开消费通过                              | Architecture                 |
| T03 | 两个世界选择不同模块，卸载/缺失一个可选 provider                        | registry 和状态隔离；未选择模块不执行；缺必需依赖有明确错误 | Headless composition         |
| T04 | 冻结输入在 base/迁移后推进事务、物理、库存、动作与树                    | 可观察状态/事件兼容，字段映射无丢失                         | Contract / characterization  |
| T05 | 新架构恢复 base 的真实存档副本及在途动作                                | 身份、库存、世界编辑正确，不重复产出                        | Headless persistence         |
| T06 | 篡改 Pack digest、state version 或旧 timeline/epoch                     | 明确拒绝，原世界不受污染                                    | Kernel + module integration  |
| T07 | 不依赖 game-core/历史源码，从正式输出构建和加载 Classic                 | Pack/资源准入和 Web/Headless 装配正常                       | Build + composition          |
| T08 | 只改某个模块、公共类型、共享 fixture、资产或 Wasm 输入                  | plan 选择正确 owner/消费者；每项解释原因                    | Selector contract            |
| T09 | 删除/移动文件，修改 selector/registry，丢失 base 或未知路径             | 不漏掉旧消费者；保守 full-new，不空跑 PASS                  | Selector negative cases      |
| T10 | 显式制造无关模块变化与已知局部变化                                      | 无关重型项不被选择；无法证明无关时保守扩大                  | Selection sufficiency        |
| T11 | 正式产物按 Classic 固定线路完成 C0–C5                                   | 真实操作、规则、可见反馈、保存恢复通过                      | 唯一 Playwright              |
| T12 | 阻断对应 Worker 结果、让 Wasm 只初始化不调用、让修改不提交可见网格      | 相关最小反例/同一线路故障模式能检测，不被配置或无关计数骗过 | Contract + same journey      |
| T13 | 指定 Wasm 实际回退 TS，或复用其他 SHA/产物数据                          | 报告实际路径；候选专项不能标 PASS；身份不符拒绝             | Evidence contract            |
| T14 | 只运行 local bench                                                      | 不启动浏览器，输出 corpus/环境/单位与局部结论               | Benchmark contract           |
| T15 | 运行 runtime bench                                                      | 复用 Classic；计时段无截图/重 trace 干扰；无新 E2E          | Same journey / configuration |
| T16 | 未授权 baseline 写入、覆盖率目标空集合、新测试未登记 owner              | 门禁失败；不能生成虚假绿色                                  | Governance                   |
| T17 | 新增第二个 Playwright spec/直接 launch/旧历史入口                       | 唯一线路门禁拒绝；正常别名只转发一次                        | Governance                   |
| T18 | Agent/认知协议迁移后执行确定性服务与配对恢复测试                        | 不调用模型，保持取消、幂等、窗口/回执与配对隔离             | No-browser integration       |
| T19 | 根 scripts、CI、Skill 链接与文档核对                                    | 无失效链接、旧路径扫描或“每 change 建浏览器 E2E”的冲突规则  | Governance                   |
| T20 | 运行最终完整新有效基线并检查迁移账本                                    | 活跃职责/重要断言有归属；未测/退役/缺口可区分               | Delivery audit               |

T12 的浏览器故障复现也只能参数化同一线路，不新增长期独立 spec。局部反例足以证明的检查不重复支付浏览器成本。

---

## 17. 结果格式与证据身份

每次执行至少输出：

```text
runId
baseSha / sourceSha / dirty-tree identity
planHash / scenarioVersion / configHash
Web / Pack / Wasm artifact identities
selected contracts + reasons
PASS / FAIL / BLOCKED / NOT_RUN / NOT_SELECTED / UNSUPPORTED
per-stage outcomes + failed causal boundary
requested/effective execution paths
telemetry + measurement environment + comparability
artifacts + failure/retry history
```

阶段依赖失败，后续标 `BLOCKED`。正常跳过和环境缺失不能同记为 PASS。结果汇总不得扫描目录捡取旧 `browser-e2e.json` 充当当前回执。

结构化数据是单一来源，人类摘要从同一结果生成；不再手写另一份含糊“全部通过”的总结。

---

## 18. Definition of Done

### 18.1 架构

- [ ] Kernel 可独立启动；无默认物品、饥饿、战斗、NPC/行为树或 UI 依赖。
- [ ] 现有可选机制迁入 stdlib，能力注册、操作、codec 与测试按 owner 组织。
- [ ] Classic 是独立 workspace Pack；旧 Overworld 不留在 Kernel 作为默认后门。
- [ ] `game-core` 活跃生产职责退出；Web、Agent、Headless 使用新公开入口。
- [ ] 无反向/循环包依赖、无私有跨包通配出口、无第二份世界状态。
- [ ] 现有角色、资源与产品行为没有未经声明的改动。

### 18.2 Harness

- [ ] 默认按影响计划选取必要契约/集成，选择器有正反例与 fail-closed。
- [ ] 活跃构建/回归/bench 不依赖历史 change。
- [ ] 只有一条受维护 Playwright 线路，使用 Classic 和生产产物。
- [ ] 该线路真实执行主玩法并有 Worker/Wasm/WebGL2 的执行与消费证据。
- [ ] 局部和真实 benchmark 入口分离、线路复用、环境与结论边界明确。
- [ ] coverage 原有语义集合没有因搬目录丢失；新 effective 测试集没有空通过。
- [ ] 历史关键断言去向可查，非等价下沉与浏览器覆盖缺口不被隐藏。

### 18.3 兼容与交付

- [ ] base 存档副本可恢复，精确摘要/版本/权限校验没有被放宽。
- [ ] 在途动作、工位结果、认知配对恢复不会复制副作用。
- [ ] 根脚本、CI、AGENTS、长期 docs、Evidence/Review Skill 与包装测试同步。
- [ ] 完整新有效基线、构建与 Classic 的新 SHA 证据齐全；不复用旧 GREEN。
- [ ] 六小时结束时记录实际完成、失败、未跑项、资源/成本未知与剩余工作。
- [ ] PR 只包含本 change，保留必要分阶段提交；远端检查未结束如实说明，不自动合并。

**若关键架构迁移、旧存档安全、唯一生产线路或重要保护去向尚未闭合，状态保持 Implementing / Blocked，不标 Delivered。**

---

## 19. 实施任务与 Delivery Snapshot 模板

### 19.1 初始任务表

| 阶段                       | 状态                   | 证据                           |
| -------------------------- | ---------------------- | ------------------------------ |
| S0 冻结与映射              | PREPARING / 部分已验证 | [实际状态与缺口](s0-status.md) |
| S1 Kernel / stdlib         | NOT_STARTED            | 待执行                         |
| S2 Playbook / hosts / 存档 | NOT_STARTED            | 待执行                         |
| S3 影响选择与合同迁移      | NOT_STARTED            | 待执行                         |
| S4 Classic / bench         | NOT_STARTED            | 待执行                         |
| S5 规则、审阅与交付        | NOT_STARTED            | 待执行                         |

### 19.2 最终交付记录

```text
Base SHA:
Final HEAD / dirty state:
Spec SHA-256:
Elapsed wall time / active Agent time / external waits:

Architecture:
  removed legacy owners:
  new packages / public APIs:
  remaining exceptions:

Compatibility:
  source save identities:
  migration results:
  unknown / rejected cases:

Harness:
  selected / executed / passed / failed / blocked:
  single browser journey identity:
  historical assertion migration and gaps:
  coverage scope:

Performance:
  local benchmark evidence:
  runtime benchmark environment:
  comparable / not comparable:
  no unsupported speedup claim:

Governance:
  AGENTS / docs / skills / scripts / CI updated:
  executable gates:

Usage:
  coding model usage / credits / API equivalent / unknown:
  game model dispatches: expected 0, actual:

Remote:
  PR / checks at exact HEAD:
  not merged automatically:

Next:
  model-free Utility NPC → preset library → Agent observability / editing
```

---

## 20. 本次读取的固定来源

以下链接均固定在 `c18a890c7f97f76421e13565ec628d8c50a942da`，用于说明现状。源码按职责抽样深读，不构成全仓逐行审阅或运行验收。实施前必须重新读取 main；若已前进，先登记差异并更新冻结身份，不能静默沿用旧事实。

[S01]: https://github.com/seedlands-game/seedlands-web-sandbox/commit/c18a890c7f97f76421e13565ec628d8c50a942da
[S02]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/AGENTS.md
[S03]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/docs/composable-gameplay-architecture.md
[S04]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/package.json
[S05]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/playwright.config.ts
[S07]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/docs/ci-testing.md
[S08]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/packages/game-core/package.json
[S09]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/vitest.config.ts
[S10]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/.github/workflows/ci.yml
[S11]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/packages/game-core/src/server/gameplay/playbooks/overworld/pack.ts
[S12]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/scripts/build-gameplay-packs.mjs
[S13]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/packages/game-core/src/server/game-server.ts
[S14]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/packages/game-core/src/server/composition/mod-api.ts
[S15]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/.agents/skills/seedlands-evidence/SKILL.md
[S16]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/docs/development-governance.md
[S17]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/docs/change-estimation.md
[S18]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/docs/repository-structure.md
[S19]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/scripts/run-harness.mjs
[S20]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/pnpm-workspace.yaml
[S21]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/scripts/ci-change-scope.mjs
[S22]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/packages/game-core/src/server/composition/checkpoint-identity.ts
[S23]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/packages/game-core/src/server/composition/gameplay-composition.ts
[S24]: https://github.com/seedlands-game/seedlands-web-sandbox/blob/c18a890c7f97f76421e13565ec628d8c50a942da/scripts/run-playwright-harness.mjs

| 来源                                     | 内容                                     |
| ---------------------------------------- | ---------------------------------------- |
| [S01]                                    | 最新 main 合并基线                       |
| [S02]、[S03]、[S18]                      | 项目不变量、已确认架构、当前目录规则     |
| [S04]、[S05]、[S07]、[S09]、[S10]、[S21] | 实际测试入口、CI、覆盖率与选择器         |
| [S08]、[S13]、[S14]、[S23]               | 旧 core 依赖及世界/玩法/公开 API 耦合    |
| [S11]、[S12]、[S20]、[S22]               | Pack/Playbook 构建、workspace 和存档身份 |
| [S15]、[S16]、[S17]                      | 证据、开发治理与预算规则                 |
| [S19]、[S24]                             | 现有性能聚合与浏览器 Harness 入口        |

---

**最终约束：游戏机制可以继续增长，Kernel 的必需责任不能随之增长；测试保护可以变强，默认回归成本不能由历史 change 数量决定。**

## 21. 本轮执行冻结补充

以下是源基线核查后的具体实施边界；与附件中的规划性陈述有冲突时，以本节为准。它们一并进入本文件 hash 审核。

- 基线 main 已 live readback，仍为 `c18a890c7f97f76421e13565ec628d8c50a942da`。功能分支为 `codex/kernel-modules-playbooks-harness`；原工作树干净。
- 复用当前 pnpm/TypeScript/Vitest/Playwright、bitecs 和 mistreevous；本次属于已有产品职责迁移，不新增 ECS、任务调度框架或测试平台。购买/替换整套引擎不满足保留既有行为与存档的合同，故不作为本轮可比候选。
- `assembly/contracts/execution-origin` 必须先切断对具体物品、Action、GameServer 的类型回流；不能以类型导入不生成 JS 为理由豁免 Kernel。
- ECS identity/storage 与具体 actor/item/station 组件分开：注册 schema/codec 及实例状态接入同一 owner；stdlib 不创建第二个 bitecs world。原 EntityStore facade 是迁移对象，不直接改名成 Kernel。
- `world/voxel.ts` 同时拥有数值空间、具体方块/材质与生成器；必须拆责任。Kernel 保留紧凑数值/坐标和 provider 端口，Classic 选择稳定内容 ID，stdlib 保留现有生成算法及版本支持。基础存储不依赖具体矿物/群系或 FaceMaterial。
- 当前 `GameServer` 和 `AuthorityRuntime` 必须拆除默认玩法依赖；通用 clock/frontier/queue/候选提交归 Kernel，玩法命令/玩家物理/快照投影接线经 stdlib 的显式宿主组合入口。允许同一 stdlib 包中的宿主集成入口，禁止另一套 authority 或第四层强制产品包装。
- 产品权限和旧摘要准入由可信宿主选择 Classic 的固定策略，未知 Pack 不得通过自身 manifest 扩权。精确摘要、Module/state version、epoch 和在途副作用检查不放宽。
- 唯一 Classic 线路以真实 C0-C5 为目标；Hydration、工坊、地图、诊断、PG/WS、视觉专属旧断言各自登记迁移或缺口。`无浏览器集成` 不允许暗中运行 headless Chromium。不能把浏览器缺口审批等同于等价保护证明。
- `changes/` 历史归档工具可处理历史数据，它不是游戏运行依赖；其机械正反例用临时目录内合成 fixture。新的默认 build/test/bench 不得读取仓库历史 change 作为必需输入。S0 探针和旧源码捕获器是本次过渡证据，S3 必须让有效测试/fixture 有稳定 owner，捕获器后续仅在冻结旧 SHA 使用。
- 原主线 CI 含已观测 flaky，S5 必须区分已知基线失败与本次回归；绝不能删除连招断言或放宽 flaky 规则获得 GREEN。
- 不做速度提升承诺。测试选择先证明必要保护完整；计时改善若要作为采纳收益，另按本 spec 的受控 A/A、A/B 取得相同合同集合下的证据。
- 计划、责任分工和剩余任务见 [执行拆解](execution-plan.md)，预算假设见 [估算](estimates.md)。这些状态记录不替代本 spec 的 Behaviour/Test Design/Acceptance。

### 21.1 唯一运行组合根合同

本节定义语义，不要求新增同名框架或类。

1. 可信 host 先验证 Pack 实际产物、权限 admission、注册分面及 provider 闭合，冻结每世界 definitions；Kernel runtime 接收这些冻结定义、窄平台端口、世界身份和初始状态/候选 checkpoint。构造参数不接受 `GameplayContent`、player/npc 默认类型或默认模块清单。
2. 一个 runtime 拥有一份实体身份/组件存储、一条逻辑时钟、一套 epoch/revision/提交序号及事务事件提交器。纯 spatial chunk owner 可被同 runtime 的受控空间端口消费；stdlib 只能注册状态与候选参与者，不创建第二个 authority、ECS world 或权威 timer。
3. 生命周期固定为 `验证/依赖闭合 → 建立未发布候选 → 初始化或恢复全部参与者 → 原子发布 owner → 按确定顺序推进 → 同 frontier 冻结/保存 → 释放`。模块在当前阶段和依赖拓扑排序；相同依赖位次使用已锁定系统顺序与稳定 ID 决胜，不用 import 顺序。保留现有物理/玩法/流体频率与先后关系，不因拆分改 tick 行为。
4. 初始化或恢复失败时逆序释放候选资源，旧 owner/epoch/状态保持可用；成功替换时递增 epoch 并失效旧引用、消息与回调。跨域候选必须在任何写入前完成校验、容量和输出构造；提交部分不能再次调用可失败的领域计算或任意用户 callback。
5. 旧 `GameServer`/`GameServerGameplayFacade` 的继承路径最终删除。通用 runtime 原语迁到 Kernel；真实玩法宿主组合函数位于 stdlib 显式 `host` 出口，Web/Headless 均注入 Classic 的已批准装配。该出口只编排同一 runtime，不复制旧大核，也不从 Kernel 反向 re-export。
6. 验证：正例为无玩法的组件/系统执行与恢复，再加一个真实 inventory 组合；负例为缺必需模块、不同世界共享 registry、候选恢复中第二参与者失败及旧 epoch 结果回流。结果分别要求明确拒绝、原状态完整、旧消息不可提交。

### 21.2 ECS 组件注册与恢复合同

- 注册项为稳定 namespace component ID、schema version、所属 module、声明依赖、存储工厂、初始化/删除生命周期及 codec。无状态模块不被迫注册空组件；每个有状态组件只有一个 module owner。
- 存储工厂接收本世界 Kernel 的受限存储分配端口；具体 actor/health/needs/inventory/character/station 的字段、typed arrays/对象布局及校验归 stdlib。Kernel 不从具体 schema 推导玩家、怪物或工具规则。
- 稳定 EntityId/lifetime 与内部可回收 bitECS EID 分离；后者永不进入网络/存档。外部读取用受授权、带 epoch/revision 的只读投影；可写引用只在本 owner 的受控候选/提交中使用，不泄漏底层可变数组。
- 注册在启动前冻结；重复 ID、schema 冲突、codec 缺失、未满足依赖拒绝。查询采用明确注册 ID/能力，不能靠默认 entity-type 枚举推断所有合法世界的组件。
- 恢复先验证 envelope、逻辑身份及各 codec，再在同一候选 owner 建立稳定 ID/lifetime 映射，验证所有跨组件引用，最后一次发布。缺失必需 schema、未知版本或非法引用不得静默删字段、默认初始化或部分替换。
- V4 gameplay/entityStore 的具体 decoder 归 stdlib persistence；新保存可采用版本化 envelope + module state payload，旧格式只经精确可信迁移转换。不得把旧二进制读新存档列入兼容承诺。
- 验证：正例注册一个不含 Health/Inventory 的 `test:counter` 并恢复其值/事件顺序；反例在第二组件 codec 验证失败时确认旧实体身份、第一组件值及事件未变。真实 inventory/behavior/station 另保留既有恢复断言。

### 21.3 组合注册分面与身份合同

- Kernel 的中性注册分面覆盖 components、module-state codecs、systems、operations、rules、resources/capabilities、exclusive providers；引用只使用稳定 ID/version、受约束中性数据和窄执行端口，不导入 ItemStack、ActorAction、GameServer 或完整 GameplayContent。
- item/recipe/actor/behavior/worldgen 内容目录由对应 stdlib 模块通过 capability 建立；Classic 只选择显式模块与内容。删除从单个 `gameplay-content` capability 取回完整默认玩法作为通用构造前置的路径。
- 新组合定义图使用明确的新 schema version，记录每一分面的 ID/version、来源 module/Pack、系统/规则顺序、provider 选择与配置摘要。确定性 canonicalization、完整字段和边界限制必须保留；不能因为 schema 增加而移除历史身份字段。
- 当前实际载入 Pack 仍验证 manifest/entry/resource 全字节 SHA-256。旧存档 admission 是可信 host 选择的单独政策：精确旧 `playbookId + packLock + definitionMap`、旧 save/schema version → 已验证的新定义图和模块 codec 转换。只认已捕获完整身份与已有明确支持的历史分支，不以 Pack ID 相同、版本范围匹配或自报兼容替代。
- 新迁移函数与目标图必须列入可信宿主可选择的固定集合，Pack 自身不能任意增加旧摘要许可。字节校验、调用者权限和恢复 admission 是三道不同检查。
- 验证：同一批准旧组合可恢复到新图；改变任一 digest、删 operation/state codec、换 provider/config、跨 timeline 回执，均在替换旧 owner 前拒绝。目标版本更改需产生不同组合身份，而非规范化时忽略新增字段。

### 21.4 跨线程生成器 provider 合同

- provider 显式声明 ID、实现版本、配置摘要、支持的 `generatorVersion` 与可执行产物身份；Classic 保留当前支持的 g2/g3/g4、数值内容和同 seed 结果，不借迁移新增算法或改版本含义。本次新增身份字段用于验证同一实现/配置，没有许可让同一 seed/generatorVersion 得到另一套地形。
- provider 负责确定性 chunk 生成和边界 voxel/halo 采样的同一语义。Kernel 仅持空间数据与受控端口；无 provider 的裸 Kernel 可以运行组件/事务，但任何需生成新 chunk 的请求明确失败，不隐式生成 Overworld。
- runtime options、Worker task、canonical acceptance、派生/持久化缓存和 checkpoint 都绑定同一 provider identity；缓存键包含影响结果的身份，恢复或切换时失效。任务返回 provider/task/epoch/revision 不一致时丢弃且不提交。
- GameServer 懒生成、world compute、mesh halo 与 persistence worker 的恢复基底必须消费同一 provider。mesh 只接收完整 canonical+halo 输入，或显式调用已验证的同一 provider；禁止保留私下 `makeChunk/macroAt/baseVoxel` 默认后门。
- TS 与 Wasm 执行选择维持原数值对等与显式回退。Worker 缺少可执行 provider/产物不等于退回默认地形；应给出明确失败。权威拥有的 buffer 不得被 transfer detach。
- 验证：相同 seed/version/identity 在主线程、Worker、halo、持久化恢复产生相同数值；测试专用带标记 provider 检测绕过注入的 fallback。反例为不同 config digest 的旧缓存/Worker result、缺 provider 和被篡改的产物，均不得进入可见/持久状态。

### 21.5 审核与执行顺序

独立只读复核发现上述四份合同缺失，因此原附件不直接作为实施冻结版本；本节补齐后提交本地精确 hash 供用户审核。复核意见记录于 [S0 状态](s0-status.md)，当前没有复核者对补充稿的再次通过声明。

上述正反例是实施前测试设计；当前已执行的负例仅为源依赖闭包 RED，现存行为 characterization 和真实旧 checkpoint roundtrip。S0 尚缺的工位/配对存档样本与固定浏览器初态必须在相关生产迁移前补齐；S1 先取得裸 Kernel 与一个真实模块的正反例，未通过不能批量搬迁。任何需实质改变本节合同的发现重新冻结审核，不以工期绕过。
