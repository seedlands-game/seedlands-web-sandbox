# Authority 实体统一物理独立审查

## 审查范围

- 审查配置：请求使用与实现者独立的 `gpt-5.6-sol`、`xhigh`，只读审查。
- 批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，复算 SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 审查提交：`aac278ca2573f5a749331c205399e701bfedc4ad` 与 `91e4f2eed5fdf3d409c1e2de154672cc48419280`。
- 重点路径：`src/server/authority/authority-session.ts`、`src/physics/step-body.ts`、`src/physics/geometry.ts`、`src/physics/body-registry.ts`、`tests/server/authority-entity-physics.test.ts`。
- 限制：未修改生产代码或仓库测试，未启动浏览器；独立反例只写入 `/tmp/seedlands-authority-review.test.ts`。

## 结论

本模块暂不批准。角色、物件的 Authority 固定步接线、一次三维外部加速度、完整 AABB 拾取路径、失败拾取退避、墙约束角色推离、最终静态接触探测与未知 Chunk 保守阻挡已有对应实现和 GREEN 证据，但合法的恢复请求可击穿整个权威物理唤醒。这违反显式有界恢复不能拖垮持续物理产出的合同。

## P1：恢复核心的候选预算异常会终止整个 Authority 物理步

`requestBodyRecovery()` 公开接受 `0..8` 的有限距离。`processRecoveryQueue()` 随后直接调用 `recoverBody()`；当附近固体使三轴候选笛卡尔积超过核心固定上限 `8192` 时，后者抛出 `RangeError`，接线层没有将容量失败转换成 `blocked` 诊断，也没有隔离该实体后继续本步。结果是一项合法请求让 `AuthoritySession.wake()` 整体失败，固定的每步四项预算和最近 32 条诊断都失去作用。

独立反例把玩家脚底置于 `y=-0.5`，`y<=0` 为稠密实心体素，提交 `maxDistance=8` 的 `external-geometry-change` 恢复。以下命令实际得到 2 项失败，其中本项收到 `RangeError: 恢复候选超过固定预算；调用方必须缩小恢复范围。`：

```bash
pnpm exec vitest run --root /tmp --globals /tmp/seedlands-authority-review.test.ts --reporter=verbose
```

最低修复要求：单个实体的恢复容量失败不得终止 Authority 唤醒；必须产生可观察的失败诊断并保留固定每步预算，其他身体仍能继续物理步。补充稠密体素、合法最大距离、同批后续请求继续处理的 RED→GREEN。修复不能取消恢复上限、扩大为无界搜索或在热路径同步生成 Chunk。

## P2：隔墙的较小 id 目标会遮蔽另一侧可达拾取目标

`itemAttraction()` 对按 id 排序的目标使用第一个半径内匹配项，不判断完整身体路径；`processPickups()` 同样只检查第一个拾取半径内目标，路径阻挡后直接跳过该物件。反例使用两个真实玩家：`a-blocked` 位于实心墙另一侧，`b-clear` 位于物件同侧，两者距物件均为 2 格。物件始终朝 `a-blocked` 加速并停在墙前 `x=0.95`，运行 120 个 60Hz 物理步后仍未转向可达的 `b-clear`。

当前浏览器 MVP 为单玩家，因此此项不单独提升为本次阻断；但 Authority 端口和实际适配器已经返回复数玩家，不能把该行为记录成普遍正确的多目标拾取合同。后续应按稳定顺序选择可达候选，并让吸附和提交使用一致目标；路径检查继续复用完整 AABB 和有界世界查询。

## 已确认的正向证据与边界

- `pnpm exec vitest run tests/server/authority-entity-physics.test.ts tests/server/authority-session.test.ts tests/server/authority-runtime.test.ts tests/server/authority-game-server-port.test.ts tests/physics/step-body.test.ts tests/physics/body-registry.test.ts`：6 个文件、52 项全部通过。
- 对审查路径执行 Prettier check 与 ESLint：通过；`git diff --check aac278c^..91e4f2e`：通过。
- 角色两两推离会经同一静态世界 sweep 限制，推离后用纯接触探测刷新最终地面/墙面接触；现有墙—角色—角色与查询顺序用例未复现穿墙。
- 掉落物吸附通过 `externalAcceleration` 进入一次 `stepBody()`；流体阻力、浮力、重力和三轴 sweep 没有第二条 Authority 积分分支。灯笼横向与底面薄碰撞箱、未知 Chunk 和失败后第 15 tick 重试均有真实 `VoxelCollisionWorld` 回归。
- Authority 的玩法到期调用 `advanceGameplayRules()`，实际映射到不含旧实体物理的 `advanceRules()`，因此该运行路径没有再次执行旧掉落物重力。旧 `advanceGameplay()` 与 `EntityPhysics` 仍留给旧公开路径，其最终删除和全 change 的 A1/A10 准出不属于这两个提交已经完成的证据。

修复 P1 后需按同一 spec hash 和本反例复审；P2 应在启用多玩家目标前关闭或明确收窄端口合同。
