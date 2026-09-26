# B1 Structure 纯候选证据

状态：GREEN，等待 B2 host/runtime 原子组合。
范围：仅纯 Structure place/toggle/break plan 与 Classic bearing→closed-state policy；不写 World/ECS，不接 host/runtime/Authority/Pack，不新增 durable state。

## RED

1. place 从 registry 的 placement item定义解析 Structure，使用可信目标 state，稳定生成完整 footprint edits；survival消费1，creative消费0。
2. place 对 footprint unknown、非replaceable、support unknown/非solid、blocking part与player collision分别失败；不产生部分 plan。
3. toggle 从任一 part解析当前 Structure，只走 definition transition graph；四朝向closed/open与上下half都保持朝向并生成完整 edits。关闭到blocking state时collision失败。
4. break 从任一 part生成全 footprint→Air；survival只在dropOwnerRole位置产生一个drop，creative无drop。
5. 合法legacy pair可toggle/break；isolated、三连和歧义legacy fail closed。
6. Classic纯策略把可信 bearing `north/east/south/west` 映射为对应closed state；未知bearing拒绝。

## B2停止线

B1 candidate只含冻结plan与observations。B2仍需registered Structure operation/state port、Authority/runtime注入、inventory/world/drop/receipt/cancellation/dependent-removal prepared participants与一次原子apply；A1未准出前禁止接线。

## 实现

- 新 `structure-operation-model.ts` 输出深冻结 `StructureOperationPlanV1`，仅包含可信 actor/mode、definition/root/state、完整 expected/from/to edits、consume/drop/support intents。
- place：按 registry placement item与可信stateId构建完整footprint；逐格校验known+replaceable，校验support known+solid，只对blocking part调用collision policy；survival consume 1，creative consume 0。
- toggle：从任一part通过A2 resolver获得唯一current Structure，复用既有 `buildStructureTransitionCandidateV1`，只走transition graph；关闭到blocking state时collision policy可拒绝。
- break：从任一part生成全footprint→Air；survival只在`dropOwnerRole`位置生成一个definition-owned drop，creative无drop。
- registered与合法legacy pair均可构造；unknown、stale、isolated、三连/歧义fail closed。模型不写World/ECS、不推进revision、不产生receipt。
- Classic `classicWoodenDoorClosedStateForBearing` 只接受四个可信bearing并映射为对应closed state；未读取camera/yaw。

## RED / GREEN

- stdlib初始RED：模型文件不存在，suite无法加载。实现后首轮 `37 passed / 1 failed`；isolated legacy fixture遗漏第二候选support cell，被正确分类为 unavailable。补齐已知范围后GREEN。
- Classic初始RED：四个方向均因策略函数不存在失败（`4 failed / 1 passed`）；实现后GREEN。
- 最终stdlib：`structure-operation-model` + 既有 `structure-multi-edit-model`，`2 files / 56 tests passed`。覆盖四朝向×closed/open×上下half toggle/break，四朝向×survival/creative place，以及失败矩阵。
- 最终Classic：placement policy + declaration control，`2 files / 10 tests passed`。
- stdlib production typecheck：PASS。root `tsconfig.test.json`：PASS。Classic test typecheck：PASS。targeted ESLint：PASS。targeted Prettier：PASS。`git diff --check`：PASS。

注意：曾运行一次 `node benchmark-window ... -- pnpm --filter stdlib typecheck && pnpm exec vitest ...`；shell的`&&`后Vitest不在benchmark child内，因此该次测试明确不计锁内证据。上述最终每条测试/typecheck/lint/format命令均分别、独立由benchmark-window持锁执行。

## 可重放命令

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/structure-operation-model.test.ts packages/stdlib/tests/server/structure-multi-edit-model.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config playbooks/classic/vitest.config.ts playbooks/classic/tests/structure-placement-policy.test.ts playbooks/classic/tests/structure-declarations.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/structure-operation-model.ts packages/stdlib/tests/server/structure-operation-model.test.ts playbooks/classic/src/structures.ts playbooks/classic/tests/structure-placement-policy.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check changes/2026-09-23-classic-functional-completion/a2-target-routing-evidence.md changes/2026-09-23-classic-functional-completion/b1-structure-candidates-evidence.md packages/stdlib/src/server/gameplay/modules/structure-operation-model.ts packages/stdlib/tests/server/structure-operation-model.test.ts playbooks/classic/src/structures.ts playbooks/classic/tests/structure-placement-policy.test.ts
git diff --check
```

## 文件与 SHA-256

```text
edd909cf6566caeb9f61bada866c845d125f9fdceaa6fa6c386db3d8a7a3d464  packages/stdlib/src/server/gameplay/modules/structure-operation-model.ts
6d7fc4268fe461a2be2fbf97fa5c2d95674b3cd4271aa24dbc6aff61ec1517b7  packages/stdlib/tests/server/structure-operation-model.test.ts
40b85524c9101e2137fb38f4ac09cbc7329b85c35fe00a8162ea5fe23de49b8d  playbooks/classic/src/structures.ts
7a123a42f9fc20549ec9106610058f2206b0171f125009c71b91b68f08023a87  playbooks/classic/tests/structure-placement-policy.test.ts
```

复用但未修改：

```text
35cdf9edd2200d4583d868be907ce33163b877120e36c46cb1521e36220e22bc  packages/stdlib/src/server/gameplay/modules/structure-multi-edit-model.ts
8a0c902dfe696f4b8f895fd361feba71511e2321c58e2093c5d33e5806afbc71  packages/stdlib/tests/server/structure-multi-edit-model.test.ts
```

## B2接口与缺口

- `StructureOperationPlanV1`、`StructureOperationActorV1`、`StructurePlaceActorV1`、`StructureDropIntentV1`为B2可直接消费的公开纯类型。
- B2必须从registered Structure state port重算当前actor/selection、target、support、replaceable、collision并重建plan；不能信任客户端或旧candidate。
- 将plan.edits转换为A1 `ExpectedWorldVoxelEdit`，与survival inventory consume或drop spawn、slot cancellation、media dependent removal、receipt组成同一次prepared transaction；全部validate后才apply。
- B2需定义Structure resource/operations并由共享runtime/composition owner注入A2 `AuthorityStructureTargetPort`和preparation resolver。
- 本阶段未修改definition registry/schema、descriptors、pack、mod-api、host/runtime/Authority/Web/A1，未执行browser/build/CI/commit/push。
