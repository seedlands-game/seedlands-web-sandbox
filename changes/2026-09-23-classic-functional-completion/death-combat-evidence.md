# V2 Registered Combat Death 证据

阶段：`V2-DEATH-COMBAT-INTEGRATION-01`
基线：`9f5a6ff49cccb1e5ecb9fae9ae0ab9277f42769e`
状态：registered combat producer 的 fixture、确定性行为与静态验证完成；未暂存、未提交、未推送。

## 实施结果

- `RegisteredCombatRuntime` 在构造时从本 world composition 解析一次只读 death inventory policy capability。
  非致命 hit 不要求该 capability；致命 composed resolve 缺 capability 时返回
  `DEATH_INVENTORY_POLICY_UNAVAILABLE / death-inventory-policy-unavailable`，且 pending combat、ECS、drop 和
  gameplay revision 均不提交。
- `prepareCombatDamage` 使用私有 `legacy | composed` discriminant。registered host 只传 composed；旧未组合直接
  调用必须显式传 legacy，避免把 capability 缺失误当成兼容授权。
- 致命 composed hit 以原始 actor reference、health 和完整 components 为 source，以命中后 armor 和清空的 player
  `breakAction` 为 settlement components，只构造一个公共 death candidate 与一个 settlement series entity
  participant。combat、entity、Action/perception effects 仍先全部 validate，再按既有顺序 apply。
- player、NPC 的 drop/retain 与 retain/despawn 来自非 Classic sample policy。durability=1 的 helmet 在本次减伤后
  破损且不掉落；chestplate 以命中后 durability 掉落或保留。NPC intrinsic trophy 与 inventory policy 独立，
  在同一 series 末尾恰好一次。
- 既有 composed registered combat fixture 显式安装非 Classic drop policy，继续验证 lifecycle、restore、allocator
  和 Action settlement；未向 Classic pack 安装生产策略。

## RED、GREEN 与回归

| 门禁                               | window                                   | 结果                                        | 证明边界                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式 registered lethal RED         | `v2-death-combat-red-01`                 | FAIL，4 failed / 5 passed                   | player armor 未 drop、NPC armor 未 drop、retain 未生效、缺 capability 未拒绝；正常收集并已到达 registered lethal resolve                                                                |
| 最终 death producer 矩阵           | `v2-death-combat-final-behavior-06`      | PASS，1 file / 11 tests                     | request→resolve receipt、committed fact、combat lastResult 与 health delta 一致；player/NPC drop/retain、post-hit armor、intrinsic、missing policy、非致命、拒绝/stale/capacity/abandon |
| stdlib policy/series/armor 回归    | `v2-death-combat-regression-stdlib-01`   | PASS，4 files / 33 tests                    | 公共 capability/series、registered armor 与初版 death suite；production 字节之后未变，新增用例由最终矩阵覆盖                                                                            |
| 既有 registered combat 回归        | `v2-death-combat-registered-existing-01` | PASS，1 file / 19 tests                     | 显式 sample policy 下 lifecycle、restore、allocator exhaustion 与 Action settlement 保持                                                                                                |
| Web prepared/frontier + shared RED | `v2-death-combat-regression-web-01`      | 3 files PASS，15 tests；shared death 1 FAIL | prepared damage/effects/frontier 通过；`equipment-spine-red` 第三项继续证明 legacy pure model 不清 armor，按冻结要求保留                                                                |
| stdlib production types            | `v2-death-combat-type-stdlib-final`      | PASS                                        | 最终 production 类型                                                                                                                                                                    |
| root test types                    | `v2-death-combat-root-types-delivery`    | PASS                                        | 最终新增与适配测试类型                                                                                                                                                                  |
| Classic test types                 | `v2-death-combat-classic-types-delivery` | PASS                                        | 私有 discriminant 对 Classic test 闭包兼容                                                                                                                                              |
| 定向 ESLint                        | `v2-death-combat-eslint-delivery`        | PASS                                        | 最终本片 production 与受影响测试                                                                                                                                                        |
| 最终 format/diff                   | `v2-death-combat-diff-delivery-frozen`   | PASS                                        | 最终 TS/MD/JSON Prettier 与 tracked/untracked whitespace                                                                                                                                |

所有命令都从仓库根目录经默认机器级锁运行：

```sh
SEEDLANDS_RESERVATION_RUN=<window> \
SEEDLANDS_RESERVATION_EVIDENCE=<evidence>/<name>-window.json.log \
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command>
```

关键 `<command>` 如下；Vitest 均显式 `--maxWorkers=1`：

```sh
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/registered-combat-death.test.ts --maxWorkers=1
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/registered-combat-death.test.ts packages/stdlib/tests/server/registered-combat-armor.test.ts packages/stdlib/tests/server/death-inventory-policy-module.test.ts packages/stdlib/tests/server/death-inventory-settlement-series.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-combat.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/prepared-combat-damage.test.ts apps/web/tests/integration/runtime/server/prepared-combat-effects.test.ts apps/web/tests/integration/runtime/server/prepared-combat-frontier.test.ts apps/web/tests/integration/runtime/server/composition/equipment-spine-red.test.ts --maxWorkers=1
pnpm --filter @seedlands/stdlib typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
pnpm exec eslint <本片 production 与测试路径>
pnpm exec prettier --check <本片 TS/MD 路径>
```

## 保留失败与证据解释

- `regression-root-01` 使用根 Vitest config 指向 Web tests，得到 `No test files found`；随后改用
  `apps/web/vitest.config.ts`。这是 runner 选择错误，不计行为失败，原始回执保留。
- `final-behavior-02` 尝试从另一个短生命周期 registered runtime 订阅 resolve fact，listener 不跨
  `GameplayModuleRuntime.bind()` 实例；最终 fixture 给同一 combat module 增加合法 ruleset read permission，并从同一
  execution 订阅事实，未修改生产权限。
- `final-behavior-04` 的 NPC retain 初始测试误期望零 drop；合同规定 intrinsic drop 独立于 inventory policy，修正为
  仅有一枚 trophy 后通过。`final-behavior-05` 和 `06` 分别证明修正期望与同一 execution fact 闭环。
- `regression-web-01` 的唯一失败是明确保留的 shared legacy death RED，不是 registered producer 回归；其余 3 个
  prepared damage/frontier/effects 文件全部通过。所有失败 stdout 与 window receipt 均保留原字节。

## 原子性与边界

- missing policy、invalid target、authority 缺失、after-rule reject、prepare 后 actor component/lifetime/effects stale、
  allocator exhaustion 均验证无拟提交的 health、armor、drop、combat result 或 revision 部分写。只 validate 不 apply
  的 composed lethal candidate 同样保持完整状态。
- `PreparedEntityMutation` 继续统一推进一次 inventory revision；caller 未追加 revision。公共 settlement suite 已覆盖
  source health/components/reference、owner epoch/sequence、allocator/capacity 与大 series 边界。
- 未修改 public protocol/projection/mod-api/exports、death policy/settlement owner、Classic pack、Needs/Vitals/Autonomy、
  UI 或 runtime adapter。长期 docs baseline 未更新，因为本片只完成当前 change 内既有公共 capability 的 private
  registered combat consumer，没有改变跨层 owner 或公共接口。
- 未运行 build、Browser、Cua、devserver、CI、完整 Classic headless 或全仓 suite。Classic policy 安装、其他 death
  producer、保存恢复组合、完整 V2 与产品验收仍未完成。本片仅可标记 registered combat producer slice GREEN。
- 实际活跃墙钟约 0.4 小时，低于 AI 3-5 小时预算和 6 小时硬上限；credits、API 等价费用、费率、额度分母及占比
  均 unknown。
