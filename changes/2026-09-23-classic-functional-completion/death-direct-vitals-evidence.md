# V2 Direct Vitals Death 证据

阶段：`V2-DEATH-DIRECT-VITALS-01`
基线：`9f5a6ff49cccb1e5ecb9fae9ae0ab9277f42769e`
状态：direct player Vitals producer 的确定性行为与静态验证完成；未暂存、未提交、未推送。

## 实施结果

- `GameplayRuntime.applyDamage` 仍通过 difficulty 与通用 armor policy 选择实际 damage。survival facade 现在把
  post-hit armor 传入 Vitals，不再在成功返回后另行 `replaceArmor`。health、needs、armor 由同一个 prepared actor
  replacement 写入，实质 armor 变化继续由既有 owner 只推进一次 `inventoryRevision`。
- Vitals 在 domain adapter 构造时一次解析当前 composition 的只读 death policy。无 composition 显式选择 legacy；
  有 composition 显式选择 composed，缺 capability 不回退 legacy。nonfatal 与 heal 不要求 capability；composed
  lethal 返回稳定 `death-inventory-policy-unavailable`，legacy `advanceNeeds` 无返回通道时抛同名 Error。
- composed lethal 用原始 reference、health、完整 components 作 source，以拟 needs、post-hit armor 与
  `breakAction=null` 作 settlement components，调用一次公共 death candidate/series。bag、cursor、crafting、armor
  按 policy drop/retain；durability=1 的 helmet 在本次减伤后破损不掉落，chestplate 以 durability=4 掉落或保留。
- lethal 同时准备真实 `simulation.prepareDeaths([id])`。entity 与 effects 均 validate 后才按 entity→effects→touch
  apply；原 `assertCanCancelCombat → entity.apply → cancelCombat` 和 facade 的 `apply → replaceArmor` 两条 after-write
  路径已删除。

## RED、GREEN 与回归

| 门禁                     | window                                         | 结果                       | 证明边界                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式 applyDamage RED     | `v2-death-direct-vitals-red-01`                | FAIL，3/3                  | drop policy 未掉 post-hit armor、retain 被忽略、composed 缺 capability 仍成功；正常 collection 并进入 Vitals                                                                                  |
| 最终 direct Vitals 矩阵  | `v2-death-direct-vitals-final-behavior-05`     | PASS，1 file / 11 tests    | drop/retain/no-policy、post-hit armor、single revision、nonfatal/creative/heal、Action effects、source revision/lifetime/effects stale、capacity、prepare failure、needs、legacy、repeat dead |
| stdlib Vitals/food 回归  | `v2-death-direct-vitals-stdlib-regression-01`  | PASS，2 files / 15 tests   | direct suite 与既有 food/health consumer                                                                                                                                                      |
| legacy player Vitals     | `v2-death-direct-vitals-legacy-delivery`       | PASS，4 passed / 1 skipped | uncomposed lethal/starvation allocator fail-close、heal-to-max、death drop；跳过非 player combat fixture                                                                                      |
| survival 受影响切片      | `v2-death-direct-vitals-survival-scoped-01`    | PASS，3 passed / 8 skipped | 长/切片 needs 一致、damage range/cooldown、legacy death/respawn                                                                                                                               |
| Classic armor 非致命切片 | `v2-death-direct-vitals-classic-nonlethal-01`  | PASS，5 passed / 1 skipped | armor 注册、nonfatal durability、creative/invalid、policy math/crafting；不冒充 Classic death wiring                                                                                          |
| stdlib production types  | `v2-death-direct-vitals-type-stdlib-delivery`  | PASS                       | 最终 production 类型                                                                                                                                                                          |
| root test types          | `v2-death-direct-vitals-type-root-delivery`    | PASS                       | 最终测试闭包类型                                                                                                                                                                              |
| Classic test types       | `v2-death-direct-vitals-type-classic-delivery` | PASS                       | Classic test 闭包兼容                                                                                                                                                                         |
| 最终 ESLint              | `v2-death-direct-vitals-eslint-final-02`       | PASS                       | 本片四个 production 文件与新增测试                                                                                                                                                            |
| 最终 format/diff         | `v2-death-direct-vitals-diff-delivery-frozen`  | PASS                       | 最终 TS/MD/JSON Prettier 与 tracked/untracked whitespace                                                                                                                                      |

所有命令都从仓库根目录经默认机器级锁运行：

```sh
SEEDLANDS_RESERVATION_RUN=<window> \
SEEDLANDS_RESERVATION_EVIDENCE=<evidence>/<name>-window.json.log \
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command>
```

关键命令如下，Vitest 均显式 `--maxWorkers=1`：

```sh
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/direct-vitals-death.test.ts --maxWorkers=1
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/direct-vitals-death.test.ts packages/stdlib/tests/server/food-health.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/gameplay-atomic-vitals.test.ts -t 'rejects lethal damage|rejects starvation death|caps healing|commits lethal health' --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/survival-gameplay.test.ts -t 'long and sliced|target range and cooldown|drops the full inventory' --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-armor.test.ts -t '护甲物品|正式装备槽|创造模式|护甲按点数|全套铁甲' --maxWorkers=1
pnpm --filter @seedlands/stdlib typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
pnpm exec eslint <本片四个 production 文件与新增测试>
pnpm exec prettier --check <本片 TS/MD/JSON>
```

## 失败历史与原子性

- `type-stdlib-01` 把 armor callback 类型误放到 `applyDifficultyDamage`，导致一次 TypeScript FAIL；修正为只扩
  `applySurvivalDamage` 后 `type-stdlib-02` 及最终 types 均 PASS。
- `matrix-01/02/03/04` 的未通过项只发生在 effects fixture：先后使用裸 creature、第二 player、autonomous actor
  和底层 combat request，但 composed runtime 分别拒绝 invalid target、combat unavailable 或 origin required。最终不
  伪造 origin，改用同一真实 `ActionRuntime` participant；`matrix-05` 起通过。所有原始失败保留。
- effects stale 用真实 `prepareDeaths` 后并发 interrupt Action；source stale 用合法 needs+armor prepared replacement，
  同时推进 inventory revision；lifetime stale 用 EntityStore restore；capacity 用 sequence exhaustion；effects prepare
  抛错时已准备 entity candidate 被放弃。每项都比较完整 entity/simulation/gameplay revision，未观察到部分写。
- `legacy-regression-01` 与 `foundation-01` 各有一个未触及的 `grazer` profile setup failure；定向 player Vitals 和
  survival 切片随后通过，不修改并行 fixture。`survival-regression-01` 的 crafting 与 consume reason 两项也与本片无关。
- 完整 `classic-armor-01` 唯一 death case 因 Classic composition 尚未安装 policy，首次 lethal 按新合同 fail-closed，
  后续重复 dead 前提不成立；五个非致命/creative case 已独立通过，该失败是后续 Classic wiring 边界。

## 未覆盖与交付边界

- 本片只处理 direct player Vitals。registered combat 生产/测试字节保持冻结；公共 settlement/series 与 mixed
  predecessor 由 954 并行 owner，本片只消费接口；registered Needs、非 player Needs/Autonomy、Classic policy、
  runtime wiring、存档组合均未实现。
- 未运行 build、Browser、Cua、devserver、CI、完整 Classic headless 或全仓测试，不能宣称完整 death/V2 或产品
  GREEN。
- 长期 docs baseline 未更新：未改变 Kernel/stdlib/Playbook/Web owner 或公共合同，只在当前 change 内接通既有
  capability 与 prepared effects。实际活跃墙钟约 0.6 小时；credits、API 等价费用、费率、额度分母与占比 unknown。
