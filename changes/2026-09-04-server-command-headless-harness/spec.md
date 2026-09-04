# 服务端命令与无头 Harness

**状态：** Breaking flow，本地实现及除 Midscene 外的准出已完成；用户接受已知证据缺口并授权合并到本地主分支

## 背景与目标（Context & Goal）

`GameServer` 已经持有权威 voxel、事务化 `editBatch()`、实体、世界时钟和 Chunk snapshot persistence，但这些能力仍由浏览器客户端、内部测试和专用 benchmark 分别调用。当前没有一套消费者无关的正式命令合同，也没有能从终端真实启动、解析命令、修改、查询和保存世界的无头入口。

本变更建立“结构化 Server Command → 权限钩子 → `GameServer` 正式 API”的唯一命令路径，并把 slash syntax 定位为人类输入适配器。完成后，Headless Harness、终端 REPL、浏览器 Debug Shell、未来 Agent tool、管理 UI 和网络适配器可复用同一结构化命令，而不直接修改 Chunk、实体或时钟内部状态。用户进一步要求客户端也提供一个可直接操作的简易 Debug Shell，方便在实际渲染世界中调试同一命令边界；首轮实现验证后，用户反馈 Shell 无法用鼠标选择、复制和粘贴文本，也不能像常规 shell 一样通过上下方向键快速浏览命令历史，本修订将这些能力纳入完成态。

## 范围与明确不做（Scope & Non-goals）

### 范围

- 定义 `SetBlock`、`Fill`、`Teleport`、`TimeGet`、`TimeSet`、`Seed`、`Save`、`InspectVoxel`、`InspectChunk` 的 discriminated union 结构化命令。
- 定义 `CommandSource`、`CommandCategory`、capability 权限钩子、结构化成功 / 失败结果与每次执行的观测记录。
- 建立异步 `ServerCommandExecutor`；mutation、query、administrative command 分别只调用 `GameServer.editBatch()`、正式 query/entity/clock API 与 persistence port。
- 建立不会抛出到消费者的 slash parser / driver，支持 `/setblock`、`/fill`、`/tp`、`/time get|set`、`/seed`、`/save`、`/inspect voxel|chunk`。
- 建立 `pnpm server:headless` 的 Node REPL；非交互输入输出逐行 JSON，交互 TTY 可显示简洁提示符。
- 在浏览器运行中的世界加入默认隐藏的简易 Debug Shell：`F4` 开关、单行 slash 输入、Enter 执行、Esc 关闭、最多保留最近 20 条命令及结构化摘要。
- Debug Shell 恢复原生鼠标文本交互、选择、复制、粘贴和右键菜单；日志与状态文本可选择，输入框保持浏览器原生编辑与剪贴板语义。
- Debug Shell 维护本次页面世界会话内最近 20 条已提交命令；输入框用上下方向键浏览、在边界处停留，并在回到最新位置时恢复尚未执行的草稿。
- 浏览器 mutation command 将同一个 `WorldCommitResult` 交给 `World` 的公开消费入口，以触发既有聚合 remesh；Teleport / Time command 同步本地相机 / streaming 与可见环境时间。
- 将现有 1 / 1k / 10k / 100k fill Harness 改为直接执行结构化 `Fill` command；payload 构造和 slash parsing 不计入 commit benchmark，并保留 transaction 分阶段指标。
- 更新 README / README.zh-CN 的运行方式、F4 操作和命令语法。

### 非目标

- 不实现网络协议、RPC、远程管理服务、多人输入复制、Agent runtime/tool transport、脚本语言或 mod API。
- 不实现完整用户 / 角色 / ACL 数据库、审计数据库、跨刷新或跨世界的命令历史持久化、剪贴板数据库或授权 UI；第一版只提供显式 capability 和可替换 permission hook。
- 不新增聊天、自动补全、建议树、富文本编辑器、可拖拽窗口或 Minecraft command 全兼容。
- 不改变 Chunk snapshot 格式、world revision 的进程期语义、世界生成、事务 commit、客户端 remesh 或浏览器 persistence 架构。
- 不把 slash 字符串作为底层 Server contract，也不允许 command 直接写 `chunk.voxels`、实体 Map 或 clock 字段。

## 关键决策（Decisions）

1. **结构化命令是合同，slash parser 只是适配器。** `ServerCommandExecutor.execute(source, command)` 是所有消费者共用入口；Headless Harness 与性能测试直接构造结构化命令，REPL 才调用 parser。当前不设计 wire schema 或稳定的序列化兼容承诺。
2. **命令分类与能力先于完整 ACL。** Query 包含 `Seed`、`Inspect*`、`TimeGet`；Mutation 包含 `SetBlock`、`Fill`、`Teleport`、`TimeSet`；Administrative 包含 `Save`。`CommandSource` 含 `actorId`、`sourceType`、可选 `entityId` 与 capabilities。默认本地开发者拥有三类能力；自定义 hook 可拒绝命令，拒绝发生在任何世界读取或写入前。当前 Integrated Mode 的浏览器本就持有同进程权威对象，因此 F4 shell 不构成新的远程安全边界；未来网络服务端不得信任客户端自报 capability。
3. **命令层表达意图，不复制权威实现。** `SetBlock` 和 `Fill` 构造 mutation buffer 并各提交一次 `editBatch()`；`Teleport` 调用 `updateEntity()`；`TimeSet` 调用 `setWorldTime()`；`Save` 调用 `flushDirtyChunks()`；inspect 只读正式服务端查询。命令模块不得直接持有或改写 canonical buffer。
4. **Executor 全部返回 Promise 和结构化结果。** persistence 是异步边界，因此统一执行面为异步。成功结果含 `success`、`message`、`data`、`affectedChunks`、`worldRevision` 与 `observation`；失败结果含 parse / validation / permission / execution 分类、稳定 code、message 与 observation。预期输入错误和底层执行错误均不得逃逸并打崩 driver / REPL。
5. **解析严格，当前实体来自 source seam。** voxel 名称采用不区分大小写的 `air|grass|dirt|stone|wood|leaves|sand|snow|water`；坐标必须为 int32；`/tp <x> <y> <z>` 使用 `CommandSource.entityId`，结构化 `Teleport` 仍可显式指定 `entityId`；位置允许有限小数；`/time set` 接受有限数并交给现有 24 小时归一化；多余或缺失参数一律 parse error。
6. **Fill 继续复用既有安全与性能门禁。** inclusive / reversed AABB、BigInt 分配前体积检查和 `MAX_FILL_VOXELS=1,000,000` 保持为唯一实现。命令 observation 记录端到端时长；transaction metrics 继续区分 validation、resolve、apply、commit、dirty Chunk、结构事件和 mesh invalidation，不能把 parser / console I/O 混入核心 commit 指标。
7. **观测是一次执行记录，不是长期日志。** Executor 为每次命令生成 `commandType`、category、source、duration、success / error kind、affected Chunk、world revision、mutation count，并可同步送入注入的 sink。sink 失败不得改变已经完成的世界操作结果，也不在本变更建立日志数据库。
8. **无头入口保持可移植核心与 Node I/O 分离。** `src/server/commands/` 保持无 DOM、PlayCanvas、Worker 和 console/readline 依赖；`scripts/server-headless.mjs` 负责 Node readline、Vite SSR 加载和 JSON-line 展示。默认使用进程内 `MemoryChunkPersistence` 和固定 `headless-player` seam，因此 `/save` 可验证 persistence boundary，但进程退出后的文件持久化不在本变更范围。
9. **浏览器 Shell 是薄客户端适配器。** 独立 `DebugCommandShell` 只负责 DOM、焦点、有限历史和结果展示；它复用 parser / executor，不解释或执行 command。打开时释放 Pointer Lock、清空移动键并把焦点交给输入框；输入事件不得触发移动、材质快捷键或时间热键，关闭后不自动重新捕获鼠标。
10. **服务端 commit 与客户端表现显式桥接。** Command result 保留 mutation 的 `WorldCommitResult`，浏览器将其交给 `World.consumeServerCommit()`；该入口只消费已提交结果，不二次执行 mutation。Teleport 成功后相机、streaming center 与 ServerPlayer 一次同步；TimeSet 成功后环境立即读取服务端时钟。Headless 和未来非渲染消费者可忽略这些表现适配。
11. **Shell 简洁但可访问。** Shell 使用有明确名称的 dialog、日志区、命令 textbox 与 status；成功 / 错误不只靠颜色区分。布局位于 HUD 上方但不覆盖整个世界，窄屏可用，新增样式放在独立 `debug-command-shell.css`，不扩张现有 HUD 模块职责。
12. **文本操作采用浏览器原生语义，历史游标独立于输出记录。** Shell 自身显式恢复 `pointer-events` 与文本选择，不接管 `copy`、`paste` 或 `contextmenu`，从而保留系统剪贴板和输入法行为。每个非空提交都进入独立的命令历史，包括执行失败和重复命令；首次按上方向键保存当前草稿并载入最新命令，继续上翻 / 下翻时在首尾钳制，回到末尾恢复草稿。用户直接编辑输入后结束当前历史浏览；载入历史后插入点位于末尾。历史只存在于当前 `DebugCommandShell` 实例，关闭再打开保留，页面或世界重建后清空。

## 行为（Behaviour）

- **Given** 有 mutation capability 的本地开发者，**When** 执行结构化 `SetBlock` 或 `Fill`，**Then** 只发生一次 `editBatch()` commit，并返回一次聚合结构变化；100k fill 不得产生逐 voxel 结构事件、save 或 remesh。
- **Given** 只有 query capability 的 source，**When** 请求 mutation 或 administrative command，**Then** 返回 permission error，world revision、entity、clock、dirty state 和 persistence 写入均不变化。
- **Given** 任意结构化命令含非法坐标、voxel、entity、time 或超大 fill，**When** executor 验证，**Then** 返回 validation error，不向调用方抛异常，也不留下部分 mutation。
- **Given** persistence 在 `/save` 时失败，**When** command 执行，**Then** 返回 execution error，相关 Chunk 继续 dirty 且下一条 REPL 命令仍可执行。
- **Given** 合法 `/setblock`、`/fill`、`/tp`、`/time`、`/seed`、`/save` 或 `/inspect` 文本，**When** parser 执行，**Then** 产生与直接构造等价的结构化命令；未知命令、参数个数错误、非数值或不支持 voxel 返回 parse error。
- **Given** 一个无 DOM / Canvas / PlayCanvas 的 Node 进程，**When** 通过 stdin 连续执行 setblock、inspect、save 和无效命令，**Then** 每行得到独立 JSON 结果，无效命令不终止进程，保存后的 snapshot 可由共享 persistence 上的新 `GameServer` 精确重载。
- **Given** inspect voxel / Chunk、seed 或 time get，**When** 执行，**Then** 不推进 world revision、不设置 dirty，也不产生 mutation count。
- **Given** sink 自身抛错，**When** 世界命令已经执行完成，**Then** executor 仍返回该命令的真实结果；观测故障不能重试或回滚已提交 mutation。
- **Given** 玩家已进入浏览器世界，**When** 按 F4，**Then** Debug Shell 打开、Pointer Lock 释放、移动键清空且输入框获得焦点；再次按 F4 或在输入框按 Esc 时关闭，不自动重新捕获鼠标。
- **Given** Shell 输入 `/setblock` 或 `/fill`，**When** 命令成功，**Then** Server 只提交一次，Shell 显示成功摘要，World 消费同一 commit 并按 Chunk 聚合刷新可见 mesh。
- **Given** Shell 输入 `/tp x y z` 或 `/time set value`，**When** 命令成功，**Then** 当前 `CommandSource.entityId` 对应的 ServerPlayer、相机 / streaming 或服务端时钟、可见环境时间保持一致，不在下一帧被旧客户端状态覆盖。
- **Given** Shell 输入未知或非法命令，**When** 返回 parse / validation / permission / execution error，**Then** Shell 保持打开、显示可读错误类型与消息，并允许下一条合法命令继续执行。
- **Given** 输入框拥有焦点，**When** 用户输入包含 W/A/S/D、数字、P、T、M 或括号的命令，**Then** 键盘事件不进入玩家移动、材质、地图或时间快捷键路径。
- **Given** Shell 已打开，**When** 用户用鼠标选择日志 / 状态文本或在输入框中点击、拖动、右键、复制和粘贴，**Then** Shell 接收指针事件并保留浏览器原生选择、剪贴板、插入点和上下文菜单行为，不把点击穿透给 Canvas，也不重新取得 Pointer Lock。
- **Given** 已提交成功、失败或重复命令，**When** 输入框中存在未提交草稿且用户按上方向键，**Then** 最近命令进入当前输入；继续按上方向键依次查看更早的最近 20 条命令并在最早一条停留，插入点始终位于载入文本末尾。
- **Given** 用户正在浏览历史，**When** 按下方向键，**Then** 依次返回较新的命令并在越过最新命令时恢复进入历史前的草稿；到达末尾后继续按下不清空或改变草稿，直接编辑输入会结束本次历史浏览。
- **Given** Shell 被 F4 或 Esc 关闭后仍处于同一世界会话，**When** 再次打开并按上方向键，**Then** 本次会话的最近命令仍可召回；页面刷新或新建世界不要求保留历史。

## 测试设计（Test Design）

- `tests/server/server-command.test.ts` 在实现前写入并预期 RED：覆盖九种结构化命令、分类 / capability、直接结构化 Harness、slash 等价解析、strict token/numeric/voxel 校验、parse / validation / permission / execution 四类错误、错误后继续执行、观测字段与 sink 隔离。
- 同一文件覆盖 setblock / fill 只经 transaction 的可观察不变量：一次 world revision、一个结构事件、Chunk 级 dirty / mesh 去重；`Save` 后用同一 `MemoryChunkPersistence` 创建新实例并精确 inspect。
- `tests/server/server-headless-cli.test.ts` 在实现前写入并预期 RED：子进程运行 `pnpm --silent server:headless -- --seed command-cli-test --json`，通过 stdin 输入多条命令，断言 JSON-line 数量、invalid command 后继续、setblock / inspect roundtrip 与 save result；子进程环境不提供 DOM、Canvas 或 PlayCanvas。
- `changes/2026-09-04-server-command-headless-harness/e2e/debug-command-shell.spec.ts` 在实施前写入并预期 RED：真实浏览器进入确定性世界，F4 打开带可访问名称的 Shell，经 textbox 执行 setblock / inspect / invalid / tp / time / save，断言错误后继续、Server/World/相机/streaming/环境同步、Pointer Lock 释放、Esc 关闭以及输入焦点不泄漏到 gameplay shortcut。
- 交互修订先新增 `tests/app/command-history.test.ts` 并预期 RED：覆盖最近 20 条、失败命令与重复命令、上下方向键顺序与首尾钳制、未提交草稿恢复和编辑后重置浏览；该纯状态测试不代替浏览器事件与剪贴板证据。
- 同一 change Playwright 在交互修订实现前扩展并预期 RED：检查 Shell 的有效 `pointer-events: auto` 与 `user-select: text`，用真实鼠标双击输出产生 Selection，再经平台对应的复制 / 粘贴快捷键把非空文本写入输入框；同时验证失败命令也进入历史、上下方向键顺序、草稿恢复和关闭重开后的会话历史。不得用程序直接给输入框赋复制结果冒充剪贴板行为。
- `changes/2026-09-04-server-command-headless-harness/midscene/debug-command-shell.yaml` 在实施前定义可见语义：Shell 是紧凑、可读、与游戏世界区分清楚的开发工具；命令、成功 / 错误输出和帮助提示不重叠、不截断，关闭后正常 HUD 仍清晰。
- `scripts/run-harness.mjs` 在实现阶段把既有 fill benchmark 的消费入口切换到 `ServerCommandExecutor` 的结构化 `Fill` command，并继续采集 1 / 1k / 10k / 100k 的 transaction metrics、端到端 command duration、结构事件、dirty Chunk、mesh invalidation 和 Node heap 代理。既有同机 100k batch ≥ 2x sequential 门禁保持不变。
- 现有 Playwright baseline 继续证明普通 gameplay 无回归，但不能替代 change E2E 的 Shell 交互和 Midscene 的视觉语义证据。

## 验收与证据（Acceptance & Evidence）

- [x] **Vitest / RED：** `node_modules/.bin/vitest run tests/server/server-command.test.ts tests/server/server-headless-cli.test.ts --reporter=verbose` 得到 2 个 test file RED：结构化命令生产模块不存在；`server:headless` script 不存在。
- [x] **Playwright-change / RED：** 沙箱内首次运行因 `listen EPERM` 无法取得产品证据；按最小权限在本机 `127.0.0.1:4197` 重跑后，3 次均在 F4 后等待 Pointer Lock 释放处超时，证明当前客户端没有 Debug Shell 键盘 / 焦点路径，且未进入后续断言。
- [x] **Review：** 用户已明确批准 Breaking-flow 合同，批准绑定实施前 SHA-256 `6df6868a5d8e64aff942259906bd6b8596444bbc1d6170b76fae9ae2ad9c6457`。
- [x] **Vitest：** 九种结构化命令都通过统一 executor，并严格复用 world transaction、entity、clock、query 和 persistence 正式 API；权限 hook 抛错时 fail closed。交互修订后的完整静态准出共 122/122 tests 通过，另有 4 个既有性能条件用例按默认配置 skipped。
- [x] **Vitest：** parser 与直接结构化 command 等价；parse / validation / permission / execution 错误均结构化返回且不留下越权或部分状态。
- [x] **Vitest：** query 不修改状态；100k fill 只有一次 world revision、一个结构事件和 Chunk 级去重副作用；save + 新服务端重载得到精确 voxel。
- [x] **Vitest / Manual supplement：** `tests/server/server-headless-cli.test.ts` 子进程通过 `pnpm --silent server:headless` 在无浏览器环境完成 setblock、inspect、save、invalid rejection 后继续执行。浏览器手工补充实际执行 `/seed` 并检查可访问树与截图，命令和成功摘要清晰可读。
- [x] **Harness：** 交互修订后的 `CI=true SEEDLANDS_E2E_PORT=4214 pnpm harness` 全部 PASS。1 / 1k / 10k / 100k fill 通过结构化 command driver；100k command p50/p95 为 `3.128/3.210 ms`，transaction commit 为 `1.842 ms`，16 个 dirty Chunk、50 个去重 mesh invalidation、1 个结构事件。100k batch 相对 sequential 为 `15.08x`。当前 Node `v24.14.0` 与旧绝对基线 `v24.20.0` 不同，因此 single-edit 绝对比较如实标记 `NOT_COMPARABLE`；同进程硬门禁仍通过。
- [x] **Playwright-change：** F4 / Esc、焦点与 Pointer Lock、setblock / inspect / invalid 后继续、tp、time、save 均通过真实浏览器 Shell；mutation 可见刷新，ServerPlayer / 相机 / streaming 与服务端 / 环境时间一致。修正“设时后仍自然走时”的测试口径后连续重复 3/3 通过。
- [x] **Playwright-baseline：** 独立回归 8/8 通过；交互修订后的完整 Harness 的 regression + browser benchmark 为 9/9，load/input/player/interaction/streaming/persistence 全部 PASS，初始世界就绪样本 `1287.44 ms`。
- [x] **Static：** `CI=true pnpm verify:static` 通过：Prettier、ESLint、ls-lint、122 个 Vitest 与 TypeScript 全绿；`src/world/**` 行覆盖率 `95.70%`，server purity 与 500 行规则保持通过。
- [x] **Build：** `CI=true pnpm build` 通过；保留既有主 bundle 大于 500 kB 的非阻塞 Vite warning。
- [ ] **Midscene：** YAML 已建立并包含历史 / 草稿可见预期；交互修订后复跑 `CI=true pnpm midscene:verify-model`，仍在启动视觉用例前因缺少 `MIDSCENE_MODEL_NAME` 失败。手工截图补充确认 Shell、输入、最近输出、`↑↓ 历史` 提示和 HUD 无重叠或截断，但不冒充 Midscene。最小下一步是配置项目的 Midscene 模型环境后执行本 change YAML。
- [x] `git diff --check` 通过。
- [x] **Vitest / 交互修订 RED：** `node_modules/.bin/vitest run tests/app/command-history.test.ts --reporter=verbose` 因尚不存在 `src/app/command-history.ts` 而加载失败，证明独立历史状态尚未实现。
- [x] **Playwright-change / 交互修订 RED：** `CI=true SEEDLANDS_E2E_PORT=4204 pnpm exec playwright test changes/2026-09-04-server-command-headless-harness/e2e/debug-command-shell.spec.ts --workers=1 --reporter=line` 连同 2 次 retry 均稳定失败；实际计算样式为 `pointer-events: none`，与鼠标无法选择、复制和粘贴的反馈精确一致。该首个失败发生在历史断言前；独立 Vitest RED 已覆盖历史状态缺口。
- [x] **Review / 交互修订：** 用户已明确批准交互修订合同，批准绑定实施前 SHA-256 `c723cb9b03cf5d2b3799e7a57eda06dca5ae026dcaea68bcff87b4ef72e0cb0d`。
- [x] **Vitest / 交互修订 GREEN：** `tests/app/command-history.test.ts` 的 4 个用例通过；覆盖无历史不清空、最近 20 条、失败 / 重复命令、首尾钳制、草稿恢复和浏览重置。
- [x] **Playwright-change / 交互修订 GREEN：** 最终用例在 `127.0.0.1:4217` 连续重复 3/3 通过。真实鼠标双击产生非空 Selection，原生 `ControlOrMeta+C/V` 完成复制粘贴；输入点击不重新取得 Pointer Lock，上下历史、插入点末尾、草稿恢复与关闭重开保留均通过，并复跑原有命令旅程。
- [x] **Static / Build / Baseline / Harness：** 交互修订后已重新执行完整准出，122 个 Vitest、生产构建和 9 个浏览器基线全部通过；Midscene 仍按独立证据项保持阻塞。

## 任务与当前状态（Tasks & Current State）

1. [已完成] 已读取用户提供的 Change 7 需求、AGENTS 约定、README、前序 Change 4–6 spec、当前源码、测试、Harness 和 Git 状态。
2. [已完成] 已选择 Breaking flow：本变更新增消费者可复用的 Server contract、权限 seam、Node command 入口并跨 `server/scripts/tests`。
3. [已完成] 已建立合同和预期 RED 用例。`node_modules/.bin/vitest run tests/server/server-command.test.ts tests/server/server-headless-cli.test.ts --reporter=verbose` 得到 2 个 test file RED：结构化命令 suite 因生产模块 `server-command-executor` 尚不存在而加载失败；CLI suite 因 `server:headless` 尚不存在而退出码为 1。失败发生在预期缺口，未修改生产代码。
4. [已完成] 用户在审核前补充浏览器简易 Debug Shell；原合同 hash 因 Scope、Decisions、Behaviour、Test Design 与 Acceptance 实质变化失效，已补充浏览器交互与视觉预期。
5. [已完成] 已建立 Playwright-change 与 Midscene 可观察预期。Playwright 在允许本地监听后取得真实 RED：F4 后 Pointer Lock 未释放并连续 3 次超时；这与当前客户端没有 Shell 的缺口一致。
6. [已完成] 用户已批准新的精确 spec SHA-256 `6df6868a5d8e64aff942259906bd6b8596444bbc1d6170b76fae9ae2ad9c6457`。
7. [已完成] 已实现结构化命令、权限 / 错误 / 观测合同、Node REPL、浏览器 F4 Shell、客户端 commit / Teleport / Time 表现同步与 Harness 接入。
8. [已完成] Vitest、静态检查、构建、change Playwright、浏览器基线、完整 Harness 和手工视觉补充均已通过。
9. [已知缺口] Midscene 模型配置缺少 `MIDSCENE_MODEL_NAME`，无法执行唯一剩余视觉模型准出。该项保持未通过并如实保留；用户在检查现有实现后接受本次证据缺口，不要求它继续阻塞本地合并。
10. [已完成] 用户在首轮验证后反馈无法鼠标选择 / 复制 / 粘贴，也无法通过上下方向键浏览历史；该反馈实质修改交互合同，原批准 hash 随之失效。
11. [已完成] 已补充交互修订 Behaviour、纯历史状态测试、真实浏览器选择 / 剪贴板 / 历史用例和 Midscene 可观察预期；Vitest 与 Playwright 已取得和现有缺口一致的 RED。
12. [已完成] 用户批准新 hash 后，已实现原生指针 / 文本选择、可聚焦日志、命令历史游标、插入点定位与帮助提示；补充的无历史下方向键边界不会清空现有草稿。
13. [已完成] 交互修订的 Vitest、change Playwright 连续 3/3、静态门禁、生产构建、完整 Harness 9/9 和手工浏览器补充均已通过；仅 Midscene 保持环境阻塞。
14. [已批准] 用户确认当前交互“看起来没啥问题”，明确授权在 Midscene 未执行的已知状态下创建本地语义化 commit，并合并到本地 `main`；未授权 push。

## 交付快照（Delivery Snapshot）

### 变更路径

- `src/server/commands/command-contract.ts`、`server-command-executor.ts`、`slash-command-parser.ts`：结构化 command、分类 / capability、四类错误、执行观测、严格 slash adapter。
- `scripts/server-headless.mjs`、`package.json`：Vite SSR 加载纯服务端模块的 Node REPL 与 `server:headless` 命令。
- `src/app/command-history.ts`、`debug-command-shell.ts`、`styles/debug-command-shell.css`、`index.html`、`app-elements.ts`：F4 / Esc Shell、会话命令历史 / 草稿、原生文本与指针交互、最近 20 条结果、可访问状态和响应式布局。
- `src/app/game.ts`、`player-controller.ts`、`world-runtime.ts`：输入隔离、Pointer Lock 释放、同一 commit 的表现消费，以及 Teleport / Time 的客户端同步。
- `scripts/run-harness.mjs`：1 / 1k / 10k / 100k fill 通过结构化 executor 运行并报告 command 总时长。
- README 中英文镜像、Server/CLI 与命令历史 Vitest、change Playwright 与 Midscene YAML。

### 验证摘要

`pnpm verify:static`、`pnpm build`、交互修订后的 change Playwright 连续 3/3、浏览器回归 8/8、完整 Harness 9/9 均通过。最终 Harness 的 world mutation、browser E2E 和 browser benchmark 全部为 PASS；100k 结构化 Fill command p50/p95 为 `3.128/3.210 ms`，产生 1 个结构事件，batch speedup `15.08x`。

手工浏览器补充确认：Shell 在运行中世界底部居中显示，保留主要世界视野；标题、输入、`↑↓ 历史` 帮助、命令历史及成功 / 错误状态可读，`/seed` 返回当前 seed；上方向键召回 `/unknown`，下方向键恢复“未执行草稿”，正常 HUD、准星、地图按钮与快捷栏没有重叠。

### 已知限制与剩余工作

- Headless 首版使用进程内 `MemoryChunkPersistence`；`/save` 真实经过 persistence port，但进程退出后不生成世界文件。
- 浏览器是同进程 Integrated Mode，本地 developer capability 不是远程安全边界；未来网络服务端不得信任客户端自报权限。
- 当前 Node 版本与旧绝对性能基线不完全相同，single-edit 绝对比较不可比；同进程 batch 门禁有效且通过。
- Midscene 因模型配置缺失未执行；用户已检查当前实现并明确接受该已知证据缺口用于本地合并。此授权不把 Midscene 标为通过，也不包含 push 或其他外部发布。
- 命令历史只保留当前页面世界会话的最近 20 条提交；刷新页面或重建世界后清空，不做跨会话持久化。
