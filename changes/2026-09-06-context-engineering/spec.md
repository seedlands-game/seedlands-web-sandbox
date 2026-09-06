# 仓库上下文工程与归档

**状态：Delivered；Agile flow。** 本轮用户明确授权在 `codex/context-engineering` 的独立 worktree 内进行不改变业务语义的目录重构、规则与文档更新、已交付 change 的本地可恢复归档；该授权只适用于本 change，不构成后续 Breaking/Exploration 审核豁免。

## 背景与目标

`app` 和 `client` 已有稳定职责，却仍有大量平铺文件；长 AGENTS 也混合了少数必要不变量与可按需查阅的细则。已交付 change 会持续占用日常上下文，但仍需完整可恢复。目标是让源码、规则和文档成为足够的工作上下文，保留权威、世界、存档和证据边界。

## 范围与非目标

聚合现有 app 的场景、世界 streaming、输入和 gameplay 表现文件，以及 client 的 authority、compute、persistence、presentation 文件簇；同步活动源码、长期测试、脚本和 Worker URL。建立显式 ZIP 归档工具、索引和首批安全归档。精简 AGENTS 并把细则放入 docs，补充模型路由、协作成本记录与 skill 晋升准则。

不改变算法、协议、运行行为、世界/存档格式或视觉；不预建 engine/plugins；不改写 Delivered/Archived 需求用例；不归档 Active、未完成或被当前运行入口直接引用的 change；不配置自动任务或外部服务。

## 决策

- 目录以现有状态所有者和运行生命周期聚合，不新增抽象层。历史需求若仍使用旧源码路径，以极少量兼容 re-export 保持冻结；活动和长期代码改为新路径。
- `src/world`、`physics`、`runtime`、`server` 与 Worker 执行边界维持；新增 app/client 归属规则通过 ESLint 正反例证明，不能只依赖文字。
- 归档命令只接受显式 change 路径和目标 ZIP，要求 spec 明示 Delivered、路径在 `changes/` 内、没有受保护运行引用、目标 ZIP 不存在。ZIP 内 manifest 记录原路径与 SHA-256；验证每项后才删除源目录。
- AGENTS 只保留不可替代约束和阅读路由；可重复的 SDD/E2E/证据细则进入 docs。每个 change 的准出写明 docs baseline 是否更新及理由。

## 行为

- Given 现有浏览器或 Worker 启动链路，When 使用重组后的模块，Then 同一模块被加载，Worker URL、动态 import、权限与生命周期不变。
- Given app/client 代码，When 放入新子目录，Then app 不成为 client 的反向依赖，client 不导入 app；world/server/纯逻辑既有边界继续受 ESLint 约束。
- Given 一个候选归档，When 它不是明确 Delivered、路径越界、被运行入口引用或 ZIP 已存在，Then 工具拒绝且不删除源目录。
- Given 一个合法归档，When ZIP 写入完成，Then manifest 的每个路径和 SHA-256 都可验证，之后才移走完整 change；索引给出原路径和提取方式。

## 验证设计

- `ARCHIVE-01`（Vitest，先 RED）：临时仓库中的 Delivered change 归档后可逐文件验证并恢复同一内容。
- `ARCHIVE-02`（Vitest，先 RED）：Active change、越界路径、已存在 ZIP 与运行入口引用被拒绝且保留源目录。
- `LAYOUT-01`（Static，先 RED）：ESLint 对 client→app 反向 import 报错，对同层 client/server DTO 与 app→client 适配允许。
- `LAYOUT-02`（Static）：长期测试和活动源码采用新路径；冻结需求仅由兼容入口维持。
- `CTX-01`（Static/Build/Playwright-baseline）：`pnpm verify:static`、`pnpm build` 与 `pnpm test:e2e` 通过。无可见行为改动，Midscene 为 N/A。

## 准出条件与证据

- [x] 目录迁移与 Worker/dynamic import 审计：81 个 rename 的模块文字归一化审查、5 个 Worker `new URL` 与 `game-harness` 动态 import 均只改变路径；`pnpm build`、长期 Playwright 9/9 通过。
- [x] 归档工具的 roundtrip 与拒绝用例：初始 RED 为缺少工具的 1 项失败、client→app 反向 import 未被拒绝的 1 项失败；实现后 `tests/scripts/change-archive.test.ts`、`tests/governance/client-app-boundary-eslint.test.ts` 与治理测试共 16 项 GREEN。首批 ZIP manifest 逐文件验证，SHA-256 为 `0cc93587de3d894152986d046ceeb28e4124a3c06510d808d6f7f47056cdb461`。
- [x] 规则和文档：AGENTS 改为触发式阅读路由；目录规范、代码地图、开发治理、协作路由、归档索引和项目内 evidence skill 已同步。skill-creator 的系统 Python 缺少 PyYAML；父级用隔离临时依赖完成 `quick_validate.py`，结果为 valid，未改仓库依赖。
- [x] `pnpm verify:static`：151 文件 760 passed、4 skipped，`src/world/**` 行覆盖率 96.37%，格式、ESLint、ls-lint、TypeScript 均通过。
- [x] `pnpm build`：通过；保留既有大 bundle warning。
- [x] `pnpm test:e2e`：长期基线 9/9 通过。Midscene：N/A，本 change 没有可见行为或视觉语义变更。
- [x] docs baseline：已更新，因为目录、证据操作、归档、协作路由和 skill 是跨 change 的长期上下文。

## 任务与当前状态

1. [x] 阅读 AGENTS、代码地图、目录规范、长期对齐、近期执行记录与 package scripts。
2. [x] 建立合同和 RED 设计。
3. [x] 添加归档与目录边界 RED 用例。
4. [x] 执行迁移、归档、规则和文档更新。
5. [x] 完成静态、构建、长期浏览器基线与本地提交。

## 交付快照

生产语义未改：81 个 app/client 文件移入 `app/{scene,world,player,gameplay}` 与 `client/{authority,compute,persistence,presentation}`。所有活动源码、长期测试、Worker URL、动态 import、ESLint 路径和代码地图已更新；仅 `src/app/player-view-offsets.ts`、`src/client/performance-telemetry.ts` 保留为当前未归档 Delivered change 的两条冻结路径兼容入口，调用方和退出条件已写入 AGENTS。

首批归档为 `archives/changes/2026-09-03-foundation-delivered.zip`，含 8 个明示 Delivered、人工确认无当前/Active 依赖的 2026-09-03 change；原路径、manifest hash、恢复命令和受保护的保留目录见 `docs/change-archive.md`。工具拒绝 Active、越界、覆盖、受保护入口引用和 symlink 祖先；归档验证成功后才移走源目录，删除阶段失败仍保留 ZIP。

本次协作路由记录为 Terra/high worker 实施，父级独立验收源码、链接和 ZIP；任务包括 81 文件迁移及 8 change 归档。规模和完成情况已记录；墙钟、模型输入/缓存/输出 token、实际额度、API 价估算与订阅消耗均为 `unknown`，未编造成本或模型优势测量。已创建本地语义化 commit；最终 SHA 以 `git log -1` 为准。未 push、未合并原工作区。
