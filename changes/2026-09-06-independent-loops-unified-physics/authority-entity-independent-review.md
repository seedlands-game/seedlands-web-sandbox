# Authority 实体统一物理独立审查

## 审查范围

- 审查配置：请求使用与实现者独立的 `gpt-5.6-sol`、`xhigh`，只读审查。
- 批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，复算 SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 审查提交：`aac278ca2573f5a749331c205399e701bfedc4ad` 与 `91e4f2eed5fdf3d409c1e2de154672cc48419280`。
- 重点路径：`src/server/authority/authority-session.ts`、`src/physics/step-body.ts`、`src/physics/geometry.ts`、`src/physics/body-registry.ts`、`tests/server/authority-entity-physics.test.ts`。
- 限制：未修改生产代码或仓库测试，未启动浏览器；独立反例只写入 `/tmp/seedlands-authority-review.test.ts`。

## 结论

当前模块仍暂不批准。`9b2ec2203021165a29a2f2e073335c377edfbb3d` 已解除恢复请求击穿权威唤醒的 P1，并关闭原始双玩家隔墙反例；但固定 8 个候选的实现会让第 9 个范围内可达目标在静态场景永久饥饿，P2 尚未关闭。

## P1：恢复核心的候选预算异常会终止整个 Authority 物理步

`requestBodyRecovery()` 公开接受 `0..8` 的有限距离。`processRecoveryQueue()` 随后直接调用 `recoverBody()`；当附近固体使三轴候选笛卡尔积超过核心固定上限 `8192` 时，后者抛出 `RangeError`，接线层没有将容量失败转换成 `blocked` 诊断，也没有隔离该实体后继续本步。结果是一项合法请求让 `AuthoritySession.wake()` 整体失败，固定的每步四项预算和最近 32 条诊断都失去作用。

独立反例把玩家脚底置于 `y=-0.5`，`y<=0` 为稠密实心体素，提交 `maxDistance=8` 的 `external-geometry-change` 恢复。以下命令实际得到 2 项失败，其中本项收到 `RangeError: 恢复候选超过固定预算；调用方必须缩小恢复范围。`：

```bash
pnpm exec vitest run --root /tmp --globals /tmp/seedlands-authority-review.test.ts --reporter=verbose
```

最低修复要求：单个实体的恢复容量失败不得终止 Authority 唤醒；必须产生可观察的失败诊断并保留固定每步预算，其他身体仍能继续物理步。补充稠密体素、合法最大距离、同批后续请求继续处理的 RED→GREEN。修复不能取消恢复上限、扩大为无界搜索或在热路径同步生成 Chunk。

## P2：隔墙的较小 id 目标会遮蔽另一侧可达拾取目标

`itemAttraction()` 对按 id 排序的目标使用第一个半径内匹配项，不判断完整身体路径；`processPickups()` 同样只检查第一个拾取半径内目标，路径阻挡后直接跳过该物件。反例使用两个真实玩家：`a-blocked` 位于实心墙另一侧，`b-clear` 位于物件同侧，两者距物件均为 2 格。物件始终朝 `a-blocked` 加速并停在墙前 `x=0.95`，运行 120 个 60Hz 物理步后仍未转向可达的 `b-clear`。

初审时因当前浏览器 MVP 为单玩家，此项没有单独提升为阻断；但 Authority 端口和实际适配器已经返回复数玩家，不能把该行为记录成普遍正确的多目标拾取合同。`9b2ec22` 复验进一步明确要求固定预算下也要保证候选最终进展，以下复验结论取代初审分级。

## 已确认的正向证据与边界

- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts tests/physics/step-body.test.ts tests/physics/body-registry.test.ts`：6 个文件、52 项全部通过。
- 对审查路径执行 Prettier check 与 ESLint：通过；`git diff --check aac278c^..91e4f2e`：通过。
- 角色两两推离会经同一静态世界 sweep 限制，推离后用纯接触探测刷新最终地面/墙面接触；现有墙—角色—角色与查询顺序用例未复现穿墙。
- 掉落物吸附通过 `externalAcceleration` 进入一次 `stepBody()`；流体阻力、浮力、重力和三轴 sweep 没有第二条 Authority 积分分支。灯笼横向与底面薄碰撞箱、未知 Chunk 和失败后第 15 tick 重试均有真实 `VoxelCollisionWorld` 回归。
- Authority 的玩法到期调用 `advanceGameplayRules()`，实际映射到不含旧实体物理的 `advanceRules()`，因此该运行路径没有再次执行旧掉落物重力。旧 `advanceGameplay()` 与 `EntityPhysics` 仍留给旧公开路径，其最终删除和全 change 的 A1/A10 准出不属于这两个提交已经完成的证据。

以上为 `9b2ec22` 之前的初审证据；回修后的实际状态如下。

## `9b2ec22` 回修复验

- 原 `/tmp/seedlands-authority-review.test.ts` 两项反例均已转为 GREEN。稠密地下的合法 `maxDistance=8` 恢复现在返回 `recovered:false`，Authority 记录 `blocked` 并继续同批请求和物理步；无效 Collider 仍抛出明确错误，没有被容量降级掩盖。
- 可达性选择先按距离、再按 id 排序，并在 `.slice(0, 8)` 后执行 swept-AABB，故每个物件每步至多 8 次路径查询；未发现通过放大为无界路径工作换取通过。
- 新增第 8/第 9 个边界反例：物件位于原点，墙后放 8 个更近但不可达的玩家，第 9 个可达玩家位于 `x=-2` 且仍在 2.25 格吸附半径内。当前函数先截断到前 8 个，返回 `null`；状态不变使每个后续 tick 重复同一集合，目标永久饥饿。
- 实际命令 `pnpm exec vitest run --root /tmp --globals /tmp/seedlands-authority-review.test.ts --reporter=verbose` 得到 4 项中 3 项通过、1 项失败，唯一失败为“八个较近阻挡目标不会让第九个范围内可达目标永久饥饿”。仓库定向回归 7 个文件、56 项全部通过，说明缺口位于现有覆盖之外。

复验结论：P1 批准关闭，P2 继续阻断本模块准入。最低修复要求是在不增加每步 8 次 sweep 预算的前提下，以有界轮转、游标或等价公平机制保证范围内候选最终获得检查机会；不能以限制端口只返回任意 8 个目标规避复数目标合同。修复后重跑保留在 `/tmp` 的四项反例。
