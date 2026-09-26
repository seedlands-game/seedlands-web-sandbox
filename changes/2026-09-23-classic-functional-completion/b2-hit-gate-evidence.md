# B2 Registered Structure Hit Gate 证据

状态：direct registered-operation 的 hit loaded/targetable 安全门已完成定向实现和验证。本文件不声明 public Authority、Classic Web fixture、浏览器、build 或 CI 已验收。

## 范围与冻结边界

- 生产只修改 `packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts`。未改 `registered-structure-runtime.ts` 接口、FACT transaction 顺序、world/Kernel、public Authority/Gameplay、Pack 或 Web。
- 新增 `registered-structure-hit-validation.test.ts`；为真实命中测试，只在既有 B2 测试组合增加一个 `targetable:false` voxel semantics，并为 test fixture 增加显式 cell override/unavailable seam。
- 原四向 place fixture 过去把 Air 当 hit。本次改为真实 targetable Stone，并把 actor 放到被点击面的外侧。north/west 外侧位于负水平 Chunk 且视线跨 y=31/32，因而显式加载对应水平 Chunk 的 y=0/y=1 两层；没有删除或放宽 adjacent LOS。
- `hit`/`adjacent` 正交校验、hit+adjacent 两点 range、双 LOS、own-structure-cell 处理、participant 顺序和 fact delivery 均保持。

## RED

通过 `createRegisteredOperationRuntime` 的直接注册操作调用，不经过 public Authority adapter。命令经默认全机锁、Vitest `--maxWorkers=1`：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- \
  pnpm exec vitest run --config packages/stdlib/vitest.config.ts \
  packages/stdlib/tests/server/registered-structure-hit-validation.test.ts \
  packages/stdlib/tests/server/registered-structure-runtime.test.ts --maxWorkers=1
```

首轮结果：`2 files / 21 tests`，`8 failed / 13 passed`。

- 新 hit suite 的 6 个负例错误返回 `ok:true`：Air、已加载但 `targetable:false`、已加载但 semantics 未注册、unknown，以及 prepare 后变 Air/unknown。合法 targetable 正例原本通过。
- 同轮另有 north/west 两个既有四向正例报 `chunk-unavailable`：改成真实点击面外侧 actor 后，fixture 未加载负水平 Chunk 的完整 y=31/32 LOS 域。仅补全 fixture 加载，不改 LOS 合同。

所有失败场景都断言 world/gameplay/inventory revision、inventory slots、ECS entities、目标 Structure cells、dependent-removal apply、cancellation apply、receipt 和 fact batch 与本事务前完全一致。

## 实现

- 新增私有 `assertTargetableHit(hit, readCell, semantics)`：`readCell(hit) === null` 报 `chunk-unavailable`；semantics 缺失或 `targetable !== true` 报 `structure-hit-not-targetable`。unknown 不解释为 Air，Air/未注册 semantics 不获得默认 targetable。
- 初次 host prepare 在任何 Structure candidate、inventory、dependent removal、world/receipt/gameplay/fact participant 准备之前执行 gate。
- final `validateCondition` 在 participant validate-all 之前再次执行 gate；prepare 后 hit 变 Air 或 unavailable 会在任何 apply 前拒绝。
- apply 阶段未增加读取或 post-commit 检查。既有顺序仍是 mutation/cancellation/removals/world/receipt/gameplay/delivery 的 validate-all，再按同序同步 apply-all。

## 定向覆盖

- 直接 registered place：Air、loaded non-targetable、unknown、loaded unregistered semantics 均 fail closed。
- loaded targetable Stone 正例成功，生成 Structure commit 和空 fact delivery batch。
- prepare 后、final validate 前把 hit 改为 Air 或 unknown，均拒绝且本事务零写。
- 四 bearing 使用真实 targetable hit、点击面外侧 actor 和完整加载 LOS 域，保留 cross-Chunk y=31/32 单 world/gameplay/inventory advance。
- 既有 B2/FACT 回归保留 dependent removal、legacy、selection/lifetime/world stale、range、双 LOS、receipt/fact capacity、validate failure 和 delivery 顺序断言。

## 最终验证

所有重命令均独立经 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...`，Vitest `--maxWorkers=1`。

- `structure-actions-module.test.ts`、`registered-structure-runtime.test.ts`、`registered-structure-fact-delivery.test.ts`、`registered-structure-hit-validation.test.ts`：`4 files / 31 tests passed`。
- `pnpm --filter @seedlands/stdlib typecheck`：PASS。
- `pnpm exec tsc -p tsconfig.test.json --noEmit`：首轮发现两个新增 fixture 类型过窄诊断，显式标注 cell map 和 tuple 索引后最终 PASS；未放宽类型。
- targeted ESLint：PASS。
- targeted Prettier：PASS。
- owned files `git diff --check`：PASS。
- 未运行：browser、build、CI、Git 写入、14 个 Web fixture。

## 冻结 SHA-256

```text
structure-host-commit.ts                    b5800c0e86051bbb16f8bc8e76c9a96e2604f9d81b61615662e618f8056e9389
registered-structure-hit-validation.test.ts 20897a4d6f38a39213202841a53f30668eff26ddf4cdff8a8ce0fa7798126e22
registered-structure-runtime.test.ts        d595e04889a1978492827499d3d9529f6a7d1d2e9cf0c69864ef46c8ff7ddda4
registered-structure-fact-delivery.test.ts  699e44ad93956b10aeddcd058d98dafce8f70380dcf78980537c3f988b0da371
registered-structure-runtime-fixture.ts     b529f5dbb8f7d8f78fa5970c756b20a26766f18f5c827673839ce2292b9507a6
structure-runtime-test-composition.ts       8235bf0b76d27a4e76c059a451a91e7ebbc2f5deff2ba7fc77ddff5433f0471d
```
