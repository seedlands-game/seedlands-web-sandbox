# Seedlands 开发约定

## 项目边界

- 这是 TypeScript / Vite / PlayCanvas 的 Web 3D voxel sandbox。`src/voxel.ts` 是坐标、体素注册和确定性基础世界的源头；`src/world-worker.ts` 负责后台生成与网格化；`src/main.ts` 负责 streaming、编辑、渲染和玩家。
- 维持核心不变量：同一 `seed + generatorVersion` 的基础世界与加载顺序无关；体素数据是紧凑数值；世界编辑只经 `World.edit()`；渲染单位是优化后的 Chunk Mesh，不是逐体素 Entity。
- `README.md` 是运行方式、操作和当前能力的唯一说明；`package.json` 是可执行命令的唯一来源。不要在此重复它们。
- `.env`、`node_modules/`、`dist/`、`midscene_run/` 不得纳入版本控制或交付证据。不得读取、输出或提交密钥。
- 新增或修改的 Midscene YAML 必须放在所属 `changes/<change-id>/midscene/` 下，与 spec 一起追溯；根目录现有 `midscene/` 仅为 SDD 建立前的历史 smoke，不作为新变更范式。

## 轻量 SDD

每一个会改变产品行为、架构、配置或测试口径的需求，都必须有 `changes/<YYYY-MM-DD>-<kebab-name>/spec.md`。change 是交付记录而非默认的前置审批：对范围清晰、风险低的小改动，智能体应根据用户输入直接判断、实现、测试和准出，再在同一交付中补齐短 spec；无需先向用户展示 SDD 流程、索取澄清或等待 review。只有范围不清、授权不足，或涉及持久化格式、世界生成/Chunk/渲染管线、公开契约、跨模块重构、不可逆数据风险的变更，才先形成设计并等待用户 review 后实现。即使是小改动，spec 也要存在，但可以很短；不要求额外的 proposal、task ledger 或独立测试文档。

`spec.md` 必须包含以下可恢复信息：

1. `Context & Goal`：问题、用户价值和完成态。
2. `Scope & Non-goals`：本次会做与明确不做的事项。
3. `Decisions`：关键取舍；小改动可写 `Direct implementation` 及原因。
4. `Behaviour`：用可验证的 Given / When / Then 描述规则、边界和失败路径。
5. `Acceptance & Evidence`：每项准出条件、所需证据类型与实际结果。
6. `Tasks & Current State`：最小可执行拆分、当前阶段、阻塞项。
7. `Delivery Snapshot`：交付时补充变更路径、验证命令/结果、已知限制和相关 SHA（如有）。

## 开发与准出

1. 先读取当前代码、已有 active change 和用户需求；新实现不得绕开已有 world / edit / worker 边界。范围清晰的小改动不阻塞于 spec：直接完成“判断 → 实现 → 测试 → 准出 → 记录”。
2. 设计默认可选。仅当范围不清、授权不足，或涉及持久化格式、世界生成/Chunk/渲染管线、公开契约、跨模块重构、不可逆数据风险时，先完成 `Decisions` 和必要设计，等待用户 review 后实现。
3. 实现后测试是必需门槛。至少运行受影响的确定性检查和项目构建；可见 UI、输入或渲染行为优先补充/运行 Midscene。数据与算法正确性仍应使用确定性测试，不能只以视觉 smoke 代替。
4. 将真实通过、失败或环境阻塞的证据写回 spec；静态构建、Midscene smoke、手动游玩和设备验证必须分别陈述，不能互相替代。
5. 交付前更新 `Delivery Snapshot`。未满足的准出条件保持未完成并说明最小下一步；不伪造通过。每个已完成的 change 在准出后自动执行：仅暂存该 change 的文件、创建语义化 Git commit，并推送当前分支的已配置 upstream。若无远端/upstream 或推送被拒绝，必须在 spec 中记录阻塞和最小下一步；不得自行创建远端、改写历史或强推。

## 新会话恢复

恢复时先读 `AGENTS.md`、`README.md`、最近相关的 `changes/*/spec.md`、当前 Git 状态和实际源码；spec 是需求意图与进度的权威记录，代码与测试输出是实现和验证的权威记录。
