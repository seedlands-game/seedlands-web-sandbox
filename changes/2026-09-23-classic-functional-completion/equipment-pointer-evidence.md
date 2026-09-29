# V2 Equipment Pointer 行为证据

阶段：`V2-EQUIPMENT-POINTER-01`（I2.1a）

基线：`7030adac5ea234319bfe032185828287ee07b85d`

结论：私有 equipment pointer 候选与非 Classic registered inventory pointer 第一项 GREEN；station registered host、armor-only revision、死亡结算、UI 与产品体验不计入本阶段 GREEN。

## RED

公共 spine 已提供 equipment target/origin、完整 armor projection/candidate 与 registered inventory replacement，但 `inventory-pointer-slot-state.ts` 对 equipment 一律返回 `invalid-pointer-slot`。

纯模型 RED：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/equipment-pointer-behavior.test.ts --maxWorkers=1 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/model-red.log'
```

窗口 `887c187a-dbb6-4a68-98d8-6ba5866307e1` 为 `FAIL/exit 1`，结果 `9 failed / 6 passed`。四槽合法 click、occupied swap、quick-move、hotbar 与 close 均在行为期失败；非法组合和 no-op 已 fail-closed。stdout SHA256 为 `93db0ffdf970b1d1c3a4baf2acb93afce0636392a5b589ce43d15e6187be5b0f`。

非 Classic registered RED：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/equipment-spine-red.test.ts --maxWorkers=1 -t "equips a non-Classic registered visor through the real inventory pointer action" 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/registered-red.log'
```

窗口 `851c9e65-a733-49ab-8aa0-eb3251575a17` 为 `FAIL/exit 1`，结果 `1 failed / 2 skipped`，返回精确 `{ success:false, reason:'invalid-pointer-slot' }`；测试正常 collection/import 并进入正式 registered pointer 行为。stdout SHA256 为 `7ce556a838472428eca68161df77a8b4a91e00d4ad88f6b69d27665a6d8d3efa`。

## 实现

- `inventory-pointer-slot-state.ts` 在 detached mutable armor 上统一读写 equipment slot；写入必须 `count=1`，输入 stack/instance 深复制，输出 equipment/armor/stack/instance 递归冻结。
- `inventory-pointer-model.ts` 通过注册 `armor` capability 严格校验 slot，不识别 Classic item ID。左右 click 支持穿、脱、单件放置和 occupied 原子交换。
- 无 station 的 bag `quick-move` 在匹配槽为空时先装备一件，再按既有 bag 分区 merge-first/empty-second 顺序移动余量；槽已占用不替换。equipment source 按既有 bag 顺序取出，满包 `destination-full`。
- `hotbar` 支持从 equipment 取出或用同槽 armor 交换；非 armor/错槽拒绝。`distribute` 的 equipment target 与 `collect` 的 equipment source 明确 `invalid-pointer-slot`；equipment-origin cursor 可以 distribute/collect bag，但 collect 不扫描 armor。
- `close` 先尝试合法 equipment 原位，再走既有 bag merge/empty，最后保留正式 drop 语义；`drop` 继续只处理 cursor。empty close 为 `changed=false` 且 revision 不变。wrong slot、non-armor、unknown item、multi-item equipment/cursor 和满包失败都不修改输入。
- station context 的 equipment click、equipment→bag quick-move 与 equipment-origin close 已由纯 candidate 测试覆盖。该候选供 954-owned `RegisteredStationRuntime` replacement 使用，本片未改 host 或把其组合测试计作自己的 GREEN。

## GREEN 与回归

最终 stdlib 行为命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/equipment-pointer-behavior.test.ts packages/stdlib/tests/server/equipment-pointer-station-candidate.test.ts packages/stdlib/tests/server/inventory-pointer-model.test.ts packages/stdlib/tests/server/station-action-model.test.ts --maxWorkers=1 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/final-behavior.log'
```

窗口 `520e859a-e352-4dfc-a7e8-374531f58a4a` 为 `PASS/exit 0`，结果 `4 files / 35 tests`。覆盖四槽、左右键、occupied swap、单件容量、instance/durability、quick-move 优先级与满包、hotbar、distribute、collect、close/drop、no-op、输入不变、递归冻结和 station 纯候选。stdout SHA256 为 `5a440e3a7a0ff622b15f427b22dbf2ee8adfff55efe3fe1d79c83ef325a7992c`。

非 Classic registered 第一项最终命令与 RED 相同，仅执行指定 `-t`。窗口 `7ceca85c-50e6-416c-b101-917691d1d711` 为 `PASS/exit 0`，结果 `1 passed / 2 skipped`；正式返回包含 `inventoryRevision=3`、`cursorRevision=2`，最终 helmet 为 `sample:visor`、durability `37`。其余 armor-only revision 与 death 两项未修改、未执行。stdout SHA256 为 `712eb46b5cca8b1010b3986d96b0015e147d85ae525415cabccb94bd04856643`。

最终静态结果：

- source Prettier：窗口 `6ca4cd18-d507-49ad-bf07-90b4b67dd95e`，PASS。
- stdlib typecheck：窗口 `8e09f6b1-be78-4d69-87aa-34765ac72ce5`，PASS。
- root test typecheck：最终窗口 `276a5d5c-59b3-4600-8bd0-0a901307858e`，PASS。
- Classic test typecheck：窗口 `94fc51a2-0e7b-4321-a063-3dc3967c3de2`，PASS。
- 五个改动 TS 的 ESLint：窗口 `eb724004-3390-4c63-ab9a-3306e33b65d6`，PASS。

对应可重放命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm --filter @seedlands/stdlib typecheck 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/frozen-stdlib-typecheck.log'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec tsc -p tsconfig.test.json --noEmit 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/final-root-test-typecheck.log'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm typecheck:classic 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/frozen-classic-test-typecheck.log'
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c 'pnpm exec eslint packages/stdlib/src/server/gameplay/modules/inventory-pointer-model.ts packages/stdlib/src/server/gameplay/modules/inventory-pointer-slot-state.ts packages/stdlib/tests/server/equipment-pointer-behavior.test.ts packages/stdlib/tests/server/equipment-pointer-station-candidate.test.ts apps/web/tests/integration/runtime/server/composition/equipment-spine-red.test.ts 2>&1 | tee changes/2026-09-23-classic-functional-completion/evidence/v2-equipment-pointer-01/frozen-eslint.log'
```

历史失败均原样保留：registered 首次 GREEN 实际已成功提交，但旧测试用 `toEqual({success:true})` 错拒绝带正式 `value` 的响应，改为完整 receipt 精确断言后 GREEN。stdlib typecheck 初次仅报 equipment 已在循环前排除后的冗余比较，删除不可达分支后 PASS。root test typecheck 窗口 `24237891-8d36-4b74-a341-dd10644c9fe4` 曾仅因 954-owned `registered-station-equipment-host.test.ts` 四个 unused symbol 失败；954 收口后同命令最终 PASS。

既有 Web `gameplay-inventory-pointer.test.ts` 窗口 `0230d8c0-11ab-4795-9a13-c618d158ae2b` 为 `9/9 FAIL`，全部在 test setup 的 `assembleOverworldPacks` 被并行 Classic Pack resource integrity 变更阻断，未进入 pointer 行为。本阶段未改该 fixture，也不把这次结果计作 pointer 回归；既有 stdlib pointer/station `12` 项已包含在最终 `35/35`。

## 范围与后续

本阶段仅修改两个 pointer 私有实现、新增两个独立行为测试，并只修改 `equipment-spine-red.test.ts` 第一项的成功 receipt 断言。未修改公共 contract/protocol/projection/exports、registered host、prepared mutation、death/combat、Classic pack、UI、spec/tasks/execution-state。

交接时 `RegisteredStationRuntime` 的真实 equipment prepared replacement 缺失；root 已把该 host 修复与组合测试交给 954。本阶段只提供并验证 station 纯候选，不把当前并行 host 修改计作自己的 GREEN。pointer command union 没有独立 cancel 命令，正式 host prepare/cancel/receipt/V4 restore 更广组合留 I2.1b。未运行 build、Browser、Cua、devserver、CI 或 Git。

最终文件 SHA256：

- `packages/stdlib/src/server/gameplay/modules/inventory-pointer-model.ts`：`ed625fee3ab30eb78617a1eaa3e615c79f9feb87d75d7c3e129b54de60aad2f6`
- `packages/stdlib/src/server/gameplay/modules/inventory-pointer-slot-state.ts`：`3511692ec9f0c7b834f3ce1c68d9aba09cedea6ba65ec8c9e005e4992c0f1f1b`
- `packages/stdlib/tests/server/equipment-pointer-behavior.test.ts`：`b23d7a987c0a528921d1788bfecaa2100d0e25607d2d310b204401ee4f626c72`
- `packages/stdlib/tests/server/equipment-pointer-station-candidate.test.ts`：`eeed870ef86a166adeb733963ae2525e8ce9501488f437177021a5f5a3196c1d`
- `apps/web/tests/integration/runtime/server/composition/equipment-spine-red.test.ts`：`a91a72f365dcbd0dcfcb5ed8044e51fc5b1624a8d1a528c3a7b37db9358db07a`
- `changes/2026-09-23-classic-functional-completion/equipment-pointer-contract.md`：`d113f62669d9fcc310ce4a7187ad7d944b104085f0ca0f10c62616e01bfb99d1`

长期 docs baseline 未更新：这是当前 change 内的私有 pointer 行为闭环，不改变架构或通用 Harness 合同。
