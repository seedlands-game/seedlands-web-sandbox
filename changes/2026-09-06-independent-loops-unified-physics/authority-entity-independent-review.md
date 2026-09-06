# Authority 实体统一物理独立审查

## 审查范围

- 审查配置：请求使用与实现者独立的 `gpt-5.6-sol`、`xhigh`，只读审查。
- 批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，复算 SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 审查提交：`aac278ca2573f5a749331c205399e701bfedc4ad` 与 `91e4f2eed5fdf3d409c1e2de154672cc48419280`。
- 重点路径：`src/server/authority/authority-session.ts`、`src/physics/step-body.ts`、`src/physics/geometry.ts`、`src/physics/body-registry.ts`、`tests/server/authority-entity-physics.test.ts`。
- 限制：未修改生产代码或仓库测试，未启动浏览器；独立反例只写入 `/tmp/seedlands-authority-review.test.ts`。

## 结论

批准本模块在当前审查范围内准入。`9b2ec2203021165a29a2f2e073335c377edfbb3d` 已解除恢复请求击穿权威唤醒的 P1；`c4a0c64edcb38adeb9e1faedd3243747990c91b3` 以跨物理步的固定分页关闭第 9 个范围内可达目标永久饥饿的 P2，同时保留每页最多 8 次 swept-AABB 查询。此结论不代替整个 change 的浏览器、视觉、静态与构建准出。

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

当次复验结论：P1 批准关闭，P2 继续阻断本模块准入。最低修复要求是在不增加每页 8 次 sweep 预算的前提下，以有界轮转、游标或等价公平机制保证范围内候选最终获得检查机会；不能以限制端口只返回任意 8 个目标规避复数目标合同。以下最终复验取代此阶段结论。

## `c4a0c64` 最终复验

- 回修为每个活跃物件保存非负分页游标；按距离、再按 id 得到稳定候选序列，每页长度为 `min(8, 范围内候选数)`。本页没有可达目标时游标增加 8，下一物理步从后续候选开始；目标出现时保留本页，避免吸附方向无故轮换。游标表最多保留 512 个物件，超出表容量的物件改用 `physicsTick` 生成同样有界的页起点，消失物件的游标会清理。
- 原单次 helper 反例要求一次调用同时跳过 8 个阻挡目标并检查第 9 个，与每页 8 次查询预算互斥，不能作为公平性合同。独立反例已改为跨步验证：第一页恰好触发 8 次 `querySolids` 并返回 `null`；`startIndex=8` 的下一页只触发 1 次查询并选中 `clear-ninth`。
- 同一 `/tmp/seedlands-authority-review.test.ts` 另以真实 `AuthoritySession`、体素墙和 9 个目标验证接线：第一物理步物件横向速度为 0，第二物理步变为负值并朝第 9 个可达玩家吸附。四项独立反例全部通过，包括最大恢复距离预算降级、隔墙多目标选择和非法碰撞箱错误不被掩盖。
- 可达性选择仍只让一页最多 8 个候选进入完整路径检查；进入拾取半径后，`processPickups()` 对同一个已选目标再做一次必要的当前位置路径复核。两部分均为常量上界，没有把候选 sweep 扩大为无界工作。目标的距离与 id 排序会遍历端口返回的目标集合，属于原有数据枚举；本回修没有增加同步 Chunk 生成或恢复搜索预算。
- 实际执行 `pnpm exec vitest run --root /tmp --globals /tmp/seedlands-authority-review.test.ts --reporter=verbose`：1 个文件、4 项全部通过。定向回归 `tests/physics/reachability.test.ts`、`step-body.test.ts`、`body-registry.test.ts`、`tests/server/authority-entity-physics.test.ts`、`authority-session.test.ts`、`authority-runtime.test.ts`、`authority-game-server-port.test.ts`：7 个文件、58 项全部通过。`git diff --check c4a0c64^..c4a0c64` 通过。

最终结论：P1、P2 均关闭，批准 Authority 实体统一物理模块进入主线后续准出。保留的风险是公平性保证以多个物理步为时间边界；候选持续高速增删时只能保证每步工作有界，不能对任意对抗性动态集合承诺固定步数到达，这不影响静态或正常移动目标的最终进展合同。
