# V2 Registered Needs Death 证据

阶段：`V2-DEATH-REGISTERED-NEEDS-01`
基线：`5fcdc1dffe3b4a7fbcf5e43c91ae45189ed10708`
状态：registered Needs producer 的确定性行为与静态验证完成；未暂存、未提交、未推送。

## 实施结果

- `GameplayRuntime` 构造 Needs port 时从当前 composition 一次解析只读 death policy；无 composition 显式 legacy，
  composed 缺 capability 不回退 legacy。无死亡批次不要求 policy，继续一次普通 entity series。
- Needs port 保持 creature/npc health/lifecycle readonly。只对 player `alive→dead` 选择 policy；survivor 以
  `{source,replacement}` 进入 public additional actor replacements，死亡 player 以原始 reference/health/完整
  components 为 source、拟 needs 与 `breakAction=null` 为 settlement components。
- 同批出现死亡时，所有 survivor 与 death candidate 只进入一次 public mixed settlement series；不再内联 inventory
  drop 或创建第二 entity participant。四容器 drop/retain 与 inventory revision 继续由公共 owner 决定。
- batch 另准备一次真实 `simulation.prepareDeaths(deathIds)`；entity/effects 全部 validate 后才按
  entity→effects→changed apply。missing policy 与 player despawn 都在任何 prepare/apply 前返回稳定 state conflict，
  包括先遍历 survivor 的批次也保持零写。
- player `actor:'despawn'` 返回 `needs-player-despawn-policy-unsupported`。当前 public settlement 只能删除 ECS，
  `GameplayRuntime.players` 私有 membership 仍由 imperative lifecycle helper 管理，缺少 prepared membership
  participant；本片未暗改 retain、未调用 imperative despawn。

## RED、GREEN 与回归

| 门禁                      | window                                             | 结果                       | 证明边界                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fixture RED 诊断          | `v2-death-registered-needs-red-01`                 | FAIL，4/4                  | 测试直接写冻结 actor access，未进入 schedule，不计行为 RED                                                                                                                      |
| 正式 schedule RED         | `v2-death-registered-needs-red-02`                 | FAIL，4/4                  | registered schedule 已执行；cursor/armor 未 drop、retain 被忽略、missing/despawn policy 未拒绝                                                                                  |
| 最终 Needs 矩阵           | `v2-death-registered-needs-final-behavior-03`      | PASS，1 file / 12 tests    | survivor-first mixed drop/retain、missing/despawn批次零写、无死亡、incoming combat effects、non-player readonly、source/effects stale、abandon、148 drops末端capacity、重复dead |
| existing registered Needs | `v2-death-registered-needs-nondeath-regression-01` | PASS，8 passed / 2 skipped | revision/cadence、无模块、NPC needs、restore/migration、creative；两个 death case等待Classic policy                                                                             |
| public mixed series       | `v2-death-registered-needs-mixed-regression-01`    | PASS，1 file / 13 tests    | survivor+death、大series、detach、stale、冲突、capacity、公开输入边界                                                                                                           |
| stdlib production types   | `v2-death-registered-needs-type-stdlib-final`      | PASS                       | 最终 producer 与 helper 类型                                                                                                                                                    |
| root test types           | `v2-death-registered-needs-type-root-final`        | PASS                       | 最终新增测试闭包                                                                                                                                                                |
| Classic test types        | `v2-death-registered-needs-type-classic-final`     | PASS                       | Classic 后续接线类型兼容                                                                                                                                                        |
| 定向 ESLint               | `v2-death-registered-needs-eslint-02`              | PASS                       | runtime max-lines 经同职责 helper 提取关闭，无 ignore                                                                                                                           |
| 最终 format/diff          | `v2-death-registered-needs-diff-delivery-frozen`   | PASS                       | 最终 TS/MD/JSON Prettier 与 tracked/untracked whitespace                                                                                                                        |

所有命令从仓库根目录经默认机器级锁运行：

```sh
SEEDLANDS_RESERVATION_RUN=<window> \
SEEDLANDS_RESERVATION_EVIDENCE=<evidence>/<name>-window.json.log \
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command>
```

关键命令，Vitest 均显式 `--maxWorkers=1`：

```sh
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/registered-needs-death.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-needs.test.ts -t 'does not overflow|rejects clock|uses registered|does not consume|uses the same five|keeps fractional|migrates the legacy|applies creative' --maxWorkers=1
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/death-inventory-mixed-series.test.ts --maxWorkers=1
pnpm --filter @seedlands/stdlib typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
pnpm exec eslint packages/stdlib/src/server/gameplay/modules/needs-state-port.ts packages/stdlib/src/server/gameplay/gameplay-runtime.ts packages/stdlib/tests/server/registered-needs-death.test.ts
pnpm exec prettier --check <本片 TS/MD/JSON>
```

## 原子性与失败历史

- 正式 missing-policy 与 player-despawn 用例均让 `a-survivor` 排在 `z-dying` 前，比较完整 entity/simulation/
  gameplay revision 与 player membership；此前已遍历的 survivor 不会泄漏 needs 写。配置为 missing/despawn 但
  无死亡时，两名 player 正常更新。
- source stale 用合法 survivor actor replacement；effects stale 用真实 `prepareDeaths` 后并发 interrupt Action；
  effects prepare 抛错时已准备 mixed entity series 被放弃。non-player malicious after-rule 改 health 在 host readonly
  校验拒绝，整批零写。
- > 128 drop 用 7 名 dying player 形成精确 148 个非空来源，`lifetimeHighWater=MAX-147` 使最后一个 spawn 越界；
  > survivor needs、全部 death state、drop 和 revisions 均保持。`matrix-01/02` 的唯一失败来自最初误估 player bag
  > capacity 为 36；诊断读回真实 24 槽后修正，原始回执保留。
- existing registered Needs 全文件 `regression-01` 为 8 PASS/2 FAIL；两个死亡 case 的 Classic-derived fixture 未安装
  death policy，按新合同得到 `death-inventory-policy-unavailable`。本片不改 Classic fixture，定向 8 项随后全过。

## 未覆盖与交付边界

- Classic death policy、迁移与既有 Classic registered Needs death tests 由 954 并行 owner；registered Combat、Direct
  Vitals、Autonomy、public settlement/mixed series、tasks/execution-state 均未在本片修改。
- 真正 player despawn 需要新的 prepared player-membership participant；当前只证明稳定 fail-closed，不宣称通用
  player despawn 已支持。
- 未运行 build、Browser、Cua、devserver、CI、完整 Classic headless 或全仓 suite，不能宣称完整 death/V2 或产品
  GREEN。
- 长期 docs baseline 未更新：本片只接通现有公共 mixed settlement 与 Needs producer，没有改变公共 API 或长期 owner。
  实际活跃墙钟约 0.5 小时；credits、API 等价费用、费率、额度分母与占比 unknown。
