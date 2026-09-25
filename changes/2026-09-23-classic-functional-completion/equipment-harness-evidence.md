# V2 Equipment Harness Oracle 证据

阶段：`V2-EQUIPMENT-HARNESS-ORACLE-01`
基线：`484ddf39d7e3bb881dd3d3cbaec775bd091c220d`
状态：实现与本域门禁完成；Classic test types 被并行 scenario/E2E 文件阻塞，已报告 root。

## 实现结果

- `HarnessApi.equipmentSnapshot()` 只读取当前 `BrowserAuthorityClient` 的公开 `AuthorityGameplayView`。固定返回
  runtime epoch、gameplay/inventory revision、actor lifetime reference、bag slots、四槽 armor、cursor、player
  health/lifecycle 与 `armorPoints`；缺失 armor points 显式映射为 `null`。
- 每次调用先固定 client、epoch 和 gameplay 对象，完成复制后再次校验同一 client、`isReady`、epoch 与 gameplay
  对象身份；任一变化返回 `null`，不循环重试、不缓存旧 world。client 缺失、未 ready 或空 epoch 在读取会抛错的
  gameplay getter 之前返回 `null`。
- actor、slots、stack instance、四槽 armor、cursor stack/origin/station reference/craftingGrid 与 player 子对象均
  脱离源引用并递归冻结。实现不 export checkpoint、不调用 Authority action、不持久化，也不新增协议或写接口。
- `createRuntimeHarnessApi` 已有 spread 接入同一个 observability facade 和当前 authority provider，因此
  `apps/web/src/app/game-harness.ts` 无需修改；既有 geometry、rendered mesh 与 media API 保持原路径。

## RED 与 GREEN

- RED window `29fc24ee-927a-4fae-96dd-c7352a846c2f`：`2 failed / 6 passed`。临时
  `equipmentSnapshot: () => null` 使有效投影与新 epoch 新数据断言失败；既有 4 项 observability 及新增 unavailable/
  freshness 负例可执行，不是 missing import 或测试未收集。
- 初版 GREEN window `c61b2482-e282-400e-ad72-885db1d93efc`：`8/8 PASS`。随后收紧断言，要求 client、epoch、
  gameplay 三类同轮换代均实际发生第二次读取，并检查 cursor stack、station reference、crafting stack 与 armor stack
  的脱别名/冻结。
- 最终行为 window `d147e350-ac2d-402c-aebc-fe8771d314ca`：格式后 `8/8 PASS`。中间
  `0601eb3c-7a8f-479b-bcf1-b25db44746db` 的 `2 failed / 6 passed` 仅是测试期望误把 `toMatchObject` 的嵌套数组
  当部分匹配并误写 count=2；生产实现已返回正确数据，修正断言后通过。

## 类型与静态

- Web/Svelte types 最终 window `84e77631-c574-4c7d-b646-1b16a4de9eb4` PASS，Svelte 0 errors / 0 warnings。
  初次 window `3a53253c-3964-4537-a1ac-5aafe3dd10bd` 暴露私有 stdlib subpath import；改从公开
  `AuthorityInventoryView` 推导类型后关闭。
- root test types 最终 window `a3e03794-454b-4a00-bfeb-20a73925e119` PASS。目标 ESLint 最终 window
  `512add6c-8898-4c70-a6a9-822fc9d462d7` PASS；Prettier 最终 window
  `bb45e76b-c7b8-472b-8eec-5c4719cc17fd` PASS；scoped diff window
  `0f260551-903e-4a7e-bafc-ad349af4b437` PASS。
- Classic test types 首次 window `8f916e1f-a4b5-4987-8083-6266814b88cc` 被 761 的
  `scenario.test.ts:72` 语法错误阻塞；修正后有界复验 window `4e8b992e-ce1c-4916-9a30-123cbfe0d238` 仍只报
  `classic-support/harness.ts:171` 的本地 `HarnessApi.equipmentSnapshot` 缺失，以及 `scenario.test.ts:129` 的
  `StationRecipe.inputs` union/两个 implicit-any。均位于 761 独占写域，本片未越权修改，已报告 root。

## 边界与预算

- 未运行 build、Browser、Cua、CI、Git 或部署。unit oracle GREEN 不等于真实装备旅程 GREEN，也不证明页面输入、
  HUD 或保存恢复旅程已完成。
- 长期 docs 不更新，因为 Authority/Web/Harness owner 边界未改变；本片只是现有 BrowserProductHarness 的只读
  observability 扩展。
- 传统工程量估算 `0.5-1 PD`；AI 预计 `2-3h`、120% 预算 `3.6h`，实际活跃约 `0.5h`。credits、API 等价费用、
  费率、额度分母与占比均为 `unknown`。
