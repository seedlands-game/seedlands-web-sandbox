# A2.1 目标优先路由与输入链路证据

状态：A2.1 routing GREEN；真实 Structure operation/runtime 仍 RED，交给共享 owner/B。
范围：Structure 纯目标解析、composition item identity、Authority `interact.intent` 与可注入 target-first seam、Web hit/adjacent 转发。不实现 Structure operation/runtime，不修改 A1、GameServer、GameplayRuntime、Pack 或 geometry。

## 当前事实与停止线

- `StructureDefinitionRegistryV1` 已有 frozen `list/resolveTarget/resolvePlacementItem`，可纯读取 Chunk 投影。
- `AuthorityAction.interact` 目前没有 `intent`；现有 `dispatchItemInteraction` 在解析目标前读取 selected item，空手直接 `no-selected-item`。
- `AuthorityMutationPreparation` 只准备 hit/adjacent，没有 target resolver 返回的 footprint/support Chunk 二阶段 seam。
- `BrowserGameplay.useTarget` 只同步打开 station；`secondary-interaction` 只传 hit，随后同步 fallback held/place，丢失 adjacent。
- 当前允许范围没有 `GameServer`/`GameplayRuntime` 的 Structure registry getter，也没有 registered Structure operation host。A2.1 只能让注入式公共 routing fixture GREEN；真实 Classic 门继续 RED。禁止通过 `any`、反射或访问 private field 假装接通。

## RED

1. 纯 Structure target resolver：registered/legacy 完整结构为 `resolved`；非结构为 `not-structure`；候选 footprint 任一 unknown 为 `unavailable` 并返回 bounded footprint/support Chunk keys；残缺、错配或歧义为 `malformed`。
2. placement resolver：只通过 frozen composition definition ID↔storage ID resolver 找 placement definition；不得按 namespace 猜测。水平 face 优先；垂直 face 用 Authority actor body→placement cell center 的水平主轴，X/Z 相等固定 X 优先，完全重合为 malformed。
3. target-first router：四项 expectedSelection 先校验；空手或手持 bucket 点击已解析 Structure 都调用 target handler；只有 `not-structure` 进入 item fallback；`unavailable/malformed` 不 fallback。
4. protocol：`interact.intent` 必须是 `use|alternate`，canonical copy 保留它，缺失/非法值拒绝，客户端额外 item/operation/definition 字段仍拒绝于 Worker ingress。
5. Authority preparation：先准备 hit/adjacent，再调用 target preparation resolver；加载 bounded footprint/support Chunks 后重读。最终仍 unavailable 返回 false；malformed 不被当成普通目标 fallback。
6. Web：secondary interaction 向 `useTarget` 传完整 `{position, adjacent}` 并等待结果；`handled` 终止，`fallback` 才继续 held→place。Station local open保持优先，Authority 失败有反馈，成功动作不重复发送。

## 共享接线缺口

真实门 GREEN 仍需要共享 owner 提供：

```ts
type StructureTargetRuntimePort = {
  resolve(input: { actorId: string; intent: 'use' | 'alternate'; target: VoxelTarget; selectedItemId: string | null }):
    StructureTargetResolutionV1;
  invoke(input: ResolvedStructureTargetInvocationV1): PublicInteractionResult;
  prepare(input: ...): StructureTargetResolutionV1;
};
```

该 port 必须由 composition 的 `STRUCTURE_DEFINITIONS_CAPABILITY` 和 registered Structure operation host 构造，并注入 Authority action/preparation；客户端不提供 itemId、definitionId、stateId、orientation 或 operationId。

## 实现结果

- 新 `content-item-identity.ts` 从 frozen `definitionMap.items` 建立 definition ID↔storage ID 双向唯一映射；未知值返回 null，不做 namespace 截断或猜测。
- 新 `structure-target-dispatch.ts` 区分 `resolved/not-structure/unavailable/malformed`，收集 footprint+support Chunk keys，并在 target-first 前复核四项 selection、正交相邻、双 range、双 LOS/unknown。
- registered/legacy 完整目标可解析；候选 footprint/support unknown 返回 unavailable；残缺、错配、三连/重叠歧义返回 malformed。只有 not-structure 进入现有 item fallback。
- placement 仅以 storage ID→Pack definition ID→`resolvePlacementItem` 解析；水平 face优先。vertical face 用 Authority actor body 到 placement cell center 的水平主轴，X/Z 相等固定 X 优先；完全重合返回 `ambiguous-placement-orientation`。
- `AuthorityAction.interact` 新增必填 `intent:'use'|'alternate'`；network canonical copy、public message validator、request/receipt tests与真实 Worker ingress同步。客户端额外 item/operation/target字段仍拒绝。
- Authority action 暴露可选 `AuthorityStructureTargetPort` seam；注入时 Structure resolved 优先空手/桶，未注入时完整保留 V1.2 item dispatcher。可信 selected storage ID由已验证 actor state派生并传给 resolver。
- Authority mutation preparation 支持可选二阶段 Structure resolver：先 hit/adjacent，再仅加载新增 footprint/support keys，之后重读。re-resolve unavailable或变成 not-structure返回 false；malformed留给 dispatcher输出稳定失败。
- Web secondary input 传完整 hit+adjacent并等待 `handled|fallback`；普通右键=`use`，Shift右键=`alternate`。本地 station open 仅在 use 时优先；Authority成功/失败/transport reject都终止重复动作，只有 no-selected-item/item-no-interaction继续 held→place。

## RED / GREEN 证据

- stdlib首轮：7 files / 29 tests，1 failure；public network validator未接受新增 intent。修复后最终 7 files / 38 tests PASS。
- Web首轮：31 tests通过；secondary helper漏 `async`导致 suite transform RED。修复后因直接导入 BrowserGameplay触发A3未完成 wooden-door material；helper下沉到 `secondary-interaction.ts` 后最终 6 files / 40 tests PASS。
- 正式 water-bucket Authority control：1/1 PASS；证明 not-structure→selected-item binding未回归。Station包含于 Web GREEN 集合并通过。
- Classic fluid全文件：8/10通过。两条失败是A1后旧测试继续 spy public `server.prepareVoxelEdit`，而Gameplay合法事务已改用受控private port，spy不再注入unchanged/stale；A2.1不回退public Station gate。对应原子失败由A1 prepared participant suites覆盖，测试适配交给共享 owner。
- Classic door handoff：4/4 RED。toggle仍因未注入 Structure runtime得到 no-selected-item；placement仍走旧place并 item-not-placeable；跨Chunk upper未请求。A2.1未伪装门GREEN。
- stdlib production typecheck：在A2修改后曾PASS；最终共享树出现冻结A1并行变更错误（`fluid-candidate-validator` readonly candidate、`fluid-transaction`两个unused methods），本阶段不修改。
- root `tsconfig.test.json`：A2本域TS7024/request fixture/literal widening已修清；剩余仅外域 inventory-pointer缺craftingGrid与A3 geometry readonly tuple casts，原样记录。
- Web package typecheck：PASS，Svelte 0 errors/0 warnings。
- targeted ESLint/Prettier：PASS；BrowserGameplay与protocol max-lines均通过。

## 最小共享接线

总负责人/B owner需在共享 runtime/composition owner一次接线：

1. 从 `WorldComposition` 的 `STRUCTURE_DEFINITIONS_CAPABILITY` 与 `definitionMap.items` 构造 registry+identity resolver。
2. 通过公开 runtime/host port向 `AuthorityRuntime` 同时注入同一个 Structure target resolver与registered Structure operation invoker；不得让action/preparation各自读不同状态。
3. `AuthorityMutationPreparation` resolver调用需读取loaded-only voxel；operation invoke在await后用同一target再次复算 candidate。
4. B operation返回 `StructureTargetInteractionResultV1`，success value进入已有receipt acknowledge；malformed/unavailable零提交，不回退item/place/break。

未执行：build、browser/dev server、全仓测试、CI、commit/push。

## 最终验证

- stdlib routing/protocol/security：`7 files / 38 tests passed`。覆盖四态解析、空手/桶 target-first、四项 stale selection、正交/range/双LOS、identity、二阶段 footprint/support preparation、intent copy/message semantics与授权。
- Web input/ingress/fallback：`6 files / 40 tests passed`。覆盖 survival/creative expectedSelection、hit+adjacent、use/alternate、异步 handled/fallback、Authority rejection可见反馈、真实 Worker canonical ingress、receipt、non-Classic item fallback、Station和正式 water-bucket。
- 额外二阶段/tie-break回归：`2 files / 20 tests passed`。
- `pnpm --filter @seedlands/web typecheck`：PASS；Svelte 0 errors/0 warnings，后续 TS 命令退出 0。
- `pnpm --filter @seedlands/stdlib typecheck`：A2实现后曾PASS；最终共享树被A1 closing owner继续修改后，失败仅在冻结A1 `fluid-candidate-validator.ts` readonly candidate与 `fluid-transaction.ts`两个unused methods，本阶段未修改。
- root `tsconfig.test.json`：A2 TS7024、request union与literal widening均已清零；剩余仅A3 geometry tuple casts与外域 inventory-pointer `craftingGrid`。
- targeted ESLint：PASS，包括 BrowserGameplay/protocol max-lines。
- targeted Prettier：PASS。`git diff --check`：PASS。

保留失败证据：

- `classic-door-authority-red.test.ts`：`4/4 RED`。toggle为 `no-selected-item`，placement为 `item-not-placeable`，跨Chunk upper未请求；精确证明共享 Structure runtime/operation注入尚未完成。
- `classic-fluid-interactions.test.ts`：`8/10 passed`；两条旧 negative 通过 spy public `server.prepareVoxelEdit` 注入unchanged/stale，但A1已让Gameplay使用私有受控port，spy不再拦截。正式 bucket action与其余八条 selection/creative/occupied/source/full-inventory均通过；不为测试恢复public bypass。

最终命令均经默认全机锁：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/structure-target-dispatch.test.ts packages/stdlib/tests/server/content-item-identity.test.ts packages/stdlib/tests/server/item-interaction-security.test.ts packages/stdlib/tests/server/authority-interaction-preparation.test.ts packages/stdlib/tests/server/network-action-request-reference.test.ts packages/stdlib/tests/server/network-message-semantics.test.ts packages/stdlib/tests/server/world-resource-authorization.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/creative-container-input.test.ts apps/web/tests/unit/worker/authority-worker-ingress.test.ts apps/web/tests/integration/runtime/server/network-action-reference.test.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-block-stations.test.ts apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/composition/content-item-identity.ts packages/stdlib/src/server/gameplay/modules/structure-target-dispatch.ts packages/stdlib/src/server/authority/authority-mutation-preparation.ts packages/stdlib/src/server/authority/authority-player-action.ts packages/stdlib/src/server/protocol/authority-worker-protocol.ts packages/stdlib/src/server/protocol/network-action-reference-copy.ts packages/stdlib/src/server/protocol/network-action-reference.ts packages/stdlib/src/server/protocol/network-message-semantics.ts apps/web/src/app/gameplay/browser-gameplay.ts apps/web/src/app/player/secondary-interaction.ts apps/web/src/app/player/player-controller-types.ts apps/web/src/app/player/game-player-controller.ts packages/stdlib/tests/server/structure-target-dispatch.test.ts packages/stdlib/tests/server/content-item-identity.test.ts packages/stdlib/tests/server/item-interaction-security.test.ts packages/stdlib/tests/server/authority-interaction-preparation.test.ts packages/stdlib/tests/server/network-action-request-reference.test.ts packages/stdlib/tests/server/network-message-semantics.test.ts packages/stdlib/tests/server/world-resource-authorization.test.ts apps/web/tests/unit/client/creative-container-input.test.ts apps/web/tests/unit/worker/authority-worker-ingress.test.ts apps/web/tests/integration/runtime/server/network-action-reference.test.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check changes/2026-09-23-classic-functional-completion/a2-target-routing-evidence.md packages/stdlib/src/server/composition/content-item-identity.ts packages/stdlib/src/server/gameplay/modules/structure-target-dispatch.ts packages/stdlib/src/server/authority/authority-mutation-preparation.ts packages/stdlib/src/server/authority/authority-player-action.ts packages/stdlib/src/server/protocol/authority-worker-protocol.ts packages/stdlib/src/server/protocol/network-action-reference-copy.ts packages/stdlib/src/server/protocol/network-action-reference.ts packages/stdlib/src/server/protocol/network-message-semantics.ts apps/web/src/app/gameplay/browser-gameplay.ts apps/web/src/app/player/secondary-interaction.ts apps/web/src/app/player/player-controller-types.ts apps/web/src/app/player/game-player-controller.ts packages/stdlib/tests/server/structure-target-dispatch.test.ts packages/stdlib/tests/server/content-item-identity.test.ts packages/stdlib/tests/server/item-interaction-security.test.ts packages/stdlib/tests/server/authority-interaction-preparation.test.ts packages/stdlib/tests/server/network-action-request-reference.test.ts packages/stdlib/tests/server/network-message-semantics.test.ts packages/stdlib/tests/server/world-resource-authorization.test.ts apps/web/tests/unit/client/creative-container-input.test.ts apps/web/tests/unit/worker/authority-worker-ingress.test.ts apps/web/tests/integration/runtime/server/network-action-reference.test.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
git diff --check
```

## 精确文件与 SHA-256

生产文件：

```text
57cfdb061dc8df8458782049a6fbbb4f5246f78864193a1a88c527aedce8fb94  packages/stdlib/src/server/composition/content-item-identity.ts
b27f61fbf35311f381cc4935f1273c4b26a2cee5738fe1d53761490f833c0cc1  packages/stdlib/src/server/gameplay/modules/structure-target-dispatch.ts
30f118fbcad279f231c3781ef0b03966de47e8e5478bc721541610df28dd8cc2  packages/stdlib/src/server/authority/authority-mutation-preparation.ts
826dac793120a96bfd3de03b3a8878e0056abe29a5002036c1182bf58086bb5f  packages/stdlib/src/server/authority/authority-player-action.ts
b2f846ee7f5f3b11816f946760e51bcdb4415bddddeb71acf178159263512106  packages/stdlib/src/server/protocol/authority-worker-protocol.ts
0ac9a52e848c7c5c6236e5e8bb47d1c6d3a7f9e504394d6e37677bf54c52ce65  packages/stdlib/src/server/protocol/network-action-reference-copy.ts
149cf6c61b417a8aa424dcd9a4713413515716b3d394e9f361e59febb8e19f83  packages/stdlib/src/server/protocol/network-action-reference.ts
8a16999ff62a8c7d04ac4536b52209606a5fda51168f4b581b25a4bd91e48d50  packages/stdlib/src/server/protocol/network-message-semantics.ts
7596cdbcc1eaefeb4f920508e1659285f162c2603aae65f7b7174c9e5b721f9b  apps/web/src/app/gameplay/browser-gameplay.ts
17058249feebf7d246b685e39737cab882d89c8c8931b0a253aa2dc1e01241be  apps/web/src/app/player/secondary-interaction.ts
92289e7d40a37cc35768cac9be86b2356aa179b763552096aa9af275785654ed  apps/web/src/app/player/player-controller-types.ts
8368efe67bcdcebf200c369c602dce01f093fff8b0895504b84d727a8ec1285d  apps/web/src/app/player/game-player-controller.ts
```

测试文件：

```text
75a5e5cc62d7e8ede9859ee05988fd1be4d4d6f367cab8624912bca0fa62386c  packages/stdlib/tests/server/structure-target-dispatch.test.ts
2120a3ad13cd95591080957254234f3859ade6b62fa2cc2db955ccdb9231bf86  packages/stdlib/tests/server/content-item-identity.test.ts
aa8b5273c70a993671b78bb631f8d1a74ce55ae54d260cb8877bb4641dac50c1  packages/stdlib/tests/server/item-interaction-security.test.ts
ab2f80a84e41f76285fbde11d1f2ad917fe5c1609159115ca903118af9ce3849  packages/stdlib/tests/server/authority-interaction-preparation.test.ts
6db052928e793e8106bb0ee03f64875fa6c75e96909c222f93b5b7233882d614  packages/stdlib/tests/server/network-action-request-reference.test.ts
a5cda267cef028a0a750825ddf9a5a010263e02ab32b144ba7860406c220687a  packages/stdlib/tests/server/network-message-semantics.test.ts
3b9e2ddb85a188bb89684046ce52b5e3b2396f36bb9c70e889e9a15ca6683f64  packages/stdlib/tests/server/world-resource-authorization.test.ts
87543da5c9602cfeb13ad2041f47bf03b289261b56903fd946d84f3b4cc8e008  apps/web/tests/unit/client/creative-container-input.test.ts
e10af0477730152e5a59f42168a6dc605e225eec4daaa004e51f4349a2759802  apps/web/tests/unit/worker/authority-worker-ingress.test.ts
fb303890bbf64584171c544fedb71cb5b93d03fa4b827d3c5039077402374a3a  apps/web/tests/integration/runtime/server/network-action-reference.test.ts
5ead7ee828c48ab671ff5e15dacc3ccff2d352115cb070a0cfec81b82766d18b  apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts
81c4f71194941f8fe29898684bcefca58d485731a284e4f83f1b518fa348872b  apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts
83879b89dd4647b1b26d07412e671a11afdac948c64301eac23933624f6cf66c  apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts
6fc9bd148e43b3629970913f36641ca9737d3885af8955d539f400ba312fd045  apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
95997f1d9e2f6bf90cde7c5cbd5936ce8f466b2292c7183d7d2ff232eac42b14  apps/web/tests/integration/runtime/server/composition/gameplay-block-stations.test.ts
```

阶段墙钟约45分钟；token/credits/API费用不可从当前工具可靠读取。

## 共享树审计

A2开始时记录的A1 hashes中，以下三项在本阶段没有本worker成功编辑记录，但结束时因其他owner并行工作发生变化：

```text
world-transaction-commit.ts  8eeb7d6c... -> de4eed26...
fluid-transaction.ts         1e08e8c7... -> b7178182...
fluid-candidate-commit.ts    fa90342b... -> a0ea7499...
```

其余抽查A1 evidence/planner/runtime/single/prepared/fluid-sidecars/host/adapter/GameServer hashes保持起始值。本worker未写、回退或格式化上述A1文件。最终 stdlib typecheck 的三个错误也正位于该并行增量：`fluid-candidate-validator.ts` readonly `readSet`不兼容 `FluidCandidate`，以及 `fluid-transaction.ts` 的 `enqueueCleanup`/`scheduleRescan` unused。
