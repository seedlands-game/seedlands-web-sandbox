# V2 Registered Combat Armor 证据

阶段：`V2-REGISTERED-COMBAT-ARMOR-01`（I2.1c）
基线：远端 HEAD `e0594e0260b54274db1e570f632ae4a9b9042152`；源码 commit
`fe2fcc9f174848ef9d7419cb5df96209a2d25796`。
状态：fixture、确定性行为与静态验证完成；未暂存、未提交、未推送。

## 实施结果

- `RegisteredCombatRuntime` 仍让 registered ruleset 决定 raw damage 与 creative immunity。只有已通过
  origin/authorization/lifetime/range/LOS 且 raw damage 为正的 survival hit 才调用现有通用
  `prepareArmorDamage`。
- armor points 在命中前计算；每件带 instance 的装备耐久减 1，耐久 1 的装备在贡献本次减伤后清槽。
  23 点 sample 套装验证仍按既有 20 点上限计算。
- `prepareCombatDamage` 接受已选择的完整 armor replacement，并将它与 health 放入同一个
  `PreparedEntityMutation` actor replacement。现有 owner 对完整 actor snapshot、entity lifetime/epoch 与 store
  sequence 做 prepare/apply 双重 freshness 校验；armor 实质变化通过既有规则只使 `inventoryRevision +1`。
- 没有修改 combat protocol、ruleset、difficulty、Classic item ID、composition root 或公共 exports；
  `armor-equipment.ts` 仅复用，未修改。

## RED 与 GREEN

| 门禁                            | window                                              | 结果                            | 证明边界                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 无效 fixture 诊断               | `v2-registered-combat-armor-red-01`                 | FAIL，5/5                       | 第二个 player 不是 player attack 的合法 target；不计行为 RED，原始失败保留                                                                                                                                                                         |
| 正式行为 RED                    | `v2-registered-combat-armor-red-02`                 | FAIL，4 failed / 1 passed       | 正式 registered request→resolve 已命中；2 点 armor 与 23 点 armor 均实际扣 10，期望分别 9.2/2，证明 host 未接 armor。另两项是测试 mode facets/错误包装预期，未冒充产品缺陷                                                                         |
| 最终 armor 矩阵                 | `v2-registered-combat-armor-green-frozen2`          | PASS，1 file / 8 tests          | 非 Classic player→NPC 与 NPC→player、registered resolve value/lastResult/health delta、封顶、破损、revision/stale pointer、无装备、creative zero、真实 windup 后 miss、无效 target、无权限、rule reject、prepare 后 component/epoch stale、abandon |
| stdlib equipment 回归           | `v2-registered-combat-armor-stdlib-regression-01`   | PASS，3 files / 43 tests        | pointer、equipment contract、armor-only revision                                                                                                                                                                                                   |
| registered/prepared damage 回归 | `v2-registered-combat-armor-web-regression-01`      | PASS，2 files / 22 tests        | 既有 registered combat 与 detached damage producer                                                                                                                                                                                                 |
| combat frontier/effects 回归    | `v2-registered-combat-armor-frontier-regression-01` | PASS，3 files / 14 tests        | prepared combat request/frontier/effects 的 validate/apply 顺序                                                                                                                                                                                    |
| Classic armor compatibility     | `v2-registered-combat-armor-classic-armor-01`       | PASS，1 file / 6 tests          | 既有 armor policy 与旧 facade 未回归，不作为 Classic 产品验收                                                                                                                                                                                      |
| stdlib production types         | `v2-registered-combat-armor-stdlib-types-01`        | PASS                            | 修改后的 production 类型                                                                                                                                                                                                                           |
| root test types                 | `v2-registered-combat-armor-root-test-types-final`  | PASS                            | 最终新增测试字节                                                                                                                                                                                                                                   |
| Classic test types              | `v2-registered-combat-armor-classic-types-01`       | PASS                            | production 对 Classic test 闭包兼容                                                                                                                                                                                                                |
| 定向 ESLint                     | `v2-registered-combat-armor-eslint-final`           | PASS                            | 两个 production 文件与新增测试                                                                                                                                                                                                                     |
| 最终 static/diff                | `v2-registered-combat-armor-static-final2`          | PASS                            | 最终授权 TS/MD 的 ESLint、Prettier 与 tracked/untracked whitespace                                                                                                                                                                                 |
| 共享 death RED                  | `v2-registered-combat-armor-death-red-01`           | 预期 FAIL，1 failed / 2 skipped | combat death producer 仍未清空/掉落 armor；I2.2 边界保持                                                                                                                                                                                           |

中间 `green-01` 与 `green-final` 的唯一失败均来自尝试通过另一个短生命周期 operation runtime 订阅
内部 resolve publish；该 listener 不跨 `GameplayModuleRuntime.bind()` 创建的 runtime。最终测试改为同一正式
execution 返回的 resolve value、combat owner 已提交 `lastResult` 与 ECS health delta 三者精确一致，没有新增
观测 API 或降低结果断言。所有失败原件均保留。

## 实际命令

所有命令均从仓库根目录执行，外层统一为：

```sh
SEEDLANDS_RESERVATION_RUN=<window> \
SEEDLANDS_RESERVATION_EVIDENCE=<evidence>/<name>-window.json.log \
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command>
```

实际 `<command>` 如下；Vitest 均显式 `--maxWorkers=1`：

```sh
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/registered-combat-armor.test.ts --maxWorkers=1
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/equipment-pointer-behavior.test.ts packages/stdlib/tests/server/prepared-entity-equipment-revision.test.ts packages/stdlib/tests/server/equipment-spine-contract.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-combat.test.ts apps/web/tests/integration/runtime/server/prepared-combat-damage.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/prepared-combat-frontier.test.ts apps/web/tests/integration/runtime/server/prepared-combat-request.test.ts apps/web/tests/integration/runtime/server/prepared-combat-effects.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-armor.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/equipment-spine-red.test.ts -t 'settles equipped armor through the existing combat death producer' --maxWorkers=1
pnpm --filter @seedlands/stdlib typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm typecheck:classic
pnpm exec eslint packages/stdlib/src/server/gameplay/modules/registered-combat-runtime.ts packages/stdlib/src/server/gameplay/prepared-combat-damage.ts packages/stdlib/tests/server/registered-combat-armor.test.ts
pnpm exec prettier --check packages/stdlib/src/server/gameplay/modules/registered-combat-runtime.ts packages/stdlib/src/server/gameplay/prepared-combat-damage.ts packages/stdlib/tests/server/registered-combat-armor.test.ts changes/2026-09-23-classic-functional-completion/spec.md changes/2026-09-23-classic-functional-completion/equipment-combat-contract.md changes/2026-09-23-classic-functional-completion/equipment-combat-evidence.md
```

`red-01`、`red-02`、`green-01`、`green-02`、`green-final`、`green-final2`、
`green-frozen` 与 `green-frozen2` 使用第一条命令，分别对应 fixture 修正、正式 RED、观测边界修正和最终
8-case 冻结过程。`fixture-diagnostic-01` 仅定向首个 case，确认最初失败原因为 `invalid-target`；其 stdout
由执行通道读回但当时未 tee，receipt 已按原字节归档，不把它计作正式证据。每份 receipt 自带实际 UTC、
window ID、exit code 与机器采样；`MANIFEST.sha256` 固定全部原始文件和 source manifest。

## 原子失败边界

- resolve rule reject 会由既有 drain/cancel 路径产出 `cancelled/damage=0`，ECS health、armor 与 revision 不变。
- prepare 后另一个合法 prepared mutation 改变 armor/revision 时，本次 resolve 在 apply 前因完整 actor snapshot
  stale 被拒绝；同期写保持，拟提交的 health/armor/combat result 不出现。
- prepare 后 world restore 会先使 combat observation/lifetime stale；直接 prepared damage participant 另证明旧
  epoch candidate validate 失败且当前世界零写。只 validate 不 apply 的候选也保持原状态。

## 未覆盖与交付边界

- shared `equipment-spine-red.test.ts` 的 death 项仍按预期 RED；本片不实现 bag/cursor/crafting/armor 的死亡
  drop/retain policy，也不把 durability reduction 冒充 death settlement。
- 未运行 build、Browser、Cua、devserver、CI、完整 Classic headless 或全仓测试，不宣称 UI、存档、整体 V2
  或产品 GREEN。root 在隔离树执行的 V4/Web 回归不属于本片证据。
- 长期 docs baseline 未更新：本片只安装当前 change 已冻结的 registered combat armor transaction，没有新增
  公共接口或改变 Kernel/stdlib/Playbook/Web 责任边界。
- 实际活跃墙钟约 0.4 小时，低于 AI 2-4 小时正常预算及 6 小时硬上限；credits、API 等价费用、费率、
  当前额度分母与占比均 unknown。

## GIT-23 隔离交付复验

从 HEAD `5a835ab88454e8506db986c73187c695df1263ea` 建立
`/private/tmp/seedlands-git23-combat`，只应用冻结白名单。内部 `@seedlands/*` 均解析到临时树自身，第三方
`.pnpm` store只读复用，task-state为临时树真实目录。隔离 staged patch SHA-256为
`2489605d9b012d5f35885c12193de0deb21f13eed4f22f9124157cb2cafe2ae4`。

本次实跑结果与子片 checkpoint一致：registered armor `8/8`、registered combat + prepared damage `22/22`、
prepared request/frontier/effects `14/14`、Classic armor `6/6`、equipment pointer/revision/spine `43/43`均
PASS；stdlib、root test、Classic test types、staged TS ESLint、可编辑format与scoped diff均PASS。shared death
只运行第三项并得到预期 `1 failed / 2 skipped`、exit 1，失败仍是死亡后helmet/chestplate保留。

代码、测试、spec与合同已由自然hooks提交为 `067c87607de7d85dace165f81947f84290ed0231`，commit tree
`73348a00123f0c65fcd4031bed701739654b1411`；提交恰含五个冻结路径。52-entry历史 evidence manifest保持原字节，
本次组合另建 GIT-23 manifest。
