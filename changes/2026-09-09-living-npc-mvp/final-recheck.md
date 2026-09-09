# Living NPC MVP 最终增量复核

冻结范围：`4fe7d32..5dc9c0f6b6b60b9065b5075e9931b5f81ebd1c8e`。`contracts/final-recheck.json` SHA-256 已核对为 `88ae0089d97f9a821fc5cce043413591a7cbd8cdd15ecaf8b13734709f6ea76f`。本报告仅审阅该 delta；此前 `/tmp/living-npc-integrated-review.md` 覆盖完整 114-file 集成范围。未运行 Git、测试、浏览器、provider、依赖安装或生产写操作。

## 覆盖

读取并审阅本 delta 的全部 28 个路径：`apps/web/src/app/ui/companion-panel.svelte`；character core 的 `character-goal-runtime.ts`、`character-runtime-types.ts`、`character-runtime-validation.ts`、`character-runtime.ts`；`tests/server/character-control-runtime.test.ts`；`changes/2026-09-09-living-npc-mvp/{contracts/integrated-review.json,contracts/target-bound-fix.json,delivery.md,e2e/controller-connection.spec.ts,e2e/real-cognition.spec.ts,estimates.md,evidence/browser-controller-green.json,evidence/browser-world-green.json,evidence/companion-dialogue-layout.png,evidence/companion-early.png,evidence/companion-middle.png,evidence/companion-restored.png,evidence/model-contract.md,evidence/provider-usage.json,evidence/real-browser-green.json,evidence/real-browser-input-red.json,evidence/real-companion-0.png,evidence/real-companion-1.png,evidence/real-companion-followed.png,evidence/real-companion-walking.png,integrated-review.md,spec.md,target-bound-fix.md}`。

## Prior P1：已解决

- `CHARACTER_MAX_TARGETS = 128` 写入 runtime type，snapshot validation 在 `character-runtime-validation.ts:141-145` 拒绝超过上限；`:187-207` 还要求每个 ref 为正 `target-N` 且 `targetSequence` 恰等于最大 N。`CharacterRuntime.restore()` 继续先构造 `next` map，再 swap，故超限/伪造序号失败不会部分替换当前 records。
- observe 在 `character-runtime.ts:326-359` 预先收集本轮实际投影的 entity/POI 和 `executionTargetId`，传给 `reference()`；`:405-419` 满 128 时优先淘汰最早的非保护 binding，并用单调的新 ref 分配。因此当前 observation 所返回的 refs 和该调用时的执行 target 不会被同轮 observation 淘汰；旧 ref 不会因同 id 再可见而复活。
- pickup 在 `character-goal-runtime.ts:146-159` 现在在 `consumeWorldItemUnit()` 前取得 event ref，不再为已 despawn item 分配新 ref。新增测试覆盖 116 个轮换 observation、20 个真实拾取、128 上限、旧 ref 重新可见仍拒绝，以及超限/伪造 target sequence restore 的状态不变；实现者报告其 RED/GREEN focused tests 和 core/test typechecks。
- `applyIntent()` 在 `character-runtime.ts:249-290` 先验证 `requestId`、revision、goal 和 `say`（`:255-259`），才 interrupt action、更新 revision/goal/requestIds 或记录事件。新增 malformed type/oversized speech snapshot-equality 用例验证 JSONL/core 入口不再留下半次 intent。

## 其余增量

- Companion CSS 已将泛用 button/input/select 等规则限定到 `#companion`，并设置自身 z-index；controller E2E 增加交流 input 宽度断言。真实路径从直接 `exitPointerLock()` 改为 T 交流动作，避免正常暂停被误判为产品失败。该等改动与代码意图一致；未在本审阅中运行浏览器或检查图像。
- provider evidence 明确区分了先前 Pointer Lock 测试 RED 和后续正式路径的 GREEN；`model-contract.md` 对 Pro 公共 transcript 的证据范围仍保持有限、没有将短样本扩张成长期质量结论。

## 未验证边界

只读合约禁止本审阅重复运行 Root 正在执行的静态/浏览器/provider gates；其 reported GREEN 是支持性证据而非本 subagent 的执行结果。长期高 churn checkpoint 性能、256K 真实 provider 质量和跨 restore 后 UI 自动重连仍未由本 delta 单独证明。

## Findings（最后列出）

### P2 — 满表受击路径仍可淘汰当前执行 follow 的引用

`packages/game-core/src/server/simulation/character-runtime.ts:160-172` 的 `recordAttacked()` 以默认空 `protectedTargets` 调用 `reference(record, 'entity', attackerId)`。当 `targets` 已有 128 个条目，`:409-414` 因而会淘汰数组中第一个 binding；它可以恰好是 active follow 的 `executionTargetId` 所对应 ref，或当前仍可见的另一个 ref。此时 Actor 可能仍用原始 `executionTargetId` 继续移动，但模型依据旧 observation 重放同一 follow target 会在 `resolveVisibleTarget()`（`:379-388`）收到 `CHARACTER_TARGET_UNAVAILABLE`，即使目标仍在可见范围内。

触发：填满 target table，建立一个 follow 目标使其 binding 位于最早未保护位置，然后在有攻击者时调用 `recordAttacked()`；受击事件分配 attacker ref 时淘汰该 follow binding。影响有限于满表/受击交错，但与本修复声明的“execution/current refs retained”不一致，造成无需发生的 intent rejection。建议抽取并复用 observe 的 visible + `executionTargetId` protection set，至少让 `reference()` 默认保护 execution target；并补 128 refs + active follow + attack + same-follow retry 的回归。

原 P1 已解决；未发现 P0 或其他可证实 P1。
