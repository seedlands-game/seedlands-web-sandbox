# V2 death policy spine 证据

阶段：`V2-DEATH-POLICY-SPINE-01`
基线：`a39f7ba6d18b602305372093c43757be83a6125e`
状态：公共 capability、source frontier 与纯 series participant 已完成定向验证和 GIT-24 隔离交付；未接
Classic 或 producer。

## 实施结果

- 新增无状态 `seedlands:death-inventory-policy@1.0.0` capability。定义精确包含
  `player | creature | npc`，构造时 exact-key/typed validate、脱离输入、深冻结并进入
  `definitionIdentity`；无 state、resource、operation 或 snapshot child。resolver 在未装配时返回 `null`。
- settlement candidate 现显式分开原始权威 `source`（reference、health、完整 actor components）与
  `settlementComponents`。拟状态可携带 post-hit needs/armor 和清空后的 break action；prepare 只用原始 source
  判断是否 stale。
- 多 candidate 与显式 intrinsic drops 被合入一次 `prepareEntityMutationSeries`；按既有每段 128 entries 分段，
  继续服从既有 192 segments 总预算与同一 allocator/frontier。单 participant 委托该 series，没有较弱旁路。
- drop 顺序为 inventory、cursor、crafting、armor，随后才是 intrinsic drops。测试确认命中后已破碎 armor 不掉、
  剩余 armor 保留命中后 durability；despawn 只接受四容器全部 drop。
- source health、needs、armor、inventory revision、epoch/lifetime 漂移，duplicate actor、replacement/despawn
  冲突、最后 spawn capacity 与总预算失败均在 apply 前拒绝；既有 prepared series 继续验证 prepare 后的
  owner/epoch/sequence/allocator/touched snapshot。

## RED 与中间失败

| 记录                | window                                 | 结果                       | 结论                                                                                                                                       |
| ------------------- | -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `red-health-stale`  | `97686996-bc36-4017-80c9-acad8335c86a` | FAIL，1/1                  | 测试误调用不存在的 `EntityStore.setHealth`，不是行为 RED；原始字节保留。                                                                   |
| `red-health-stale2` | `bd970aa3-470e-41ba-8ae8-bea7a97bb43b` | FAIL，1/1                  | 真实行为 RED：权威 health 从 8 改为 7 后，旧 participant 的 prepare 没有抛错，证明旧实现仅校验 inventory revision。                        |
| `green-01`          | `e7ae05d2-5d05-4ecc-9daf-384ec4b216d9` | FAIL，19 passed / 4 failed | 新 source frontier 已生效；失败分别为共享期望对象被测试修改、默认 inventory 容量未产生 144 drops、旧错误文本、restore 后仍用旧 reference。 |
| `green-02`          | `b9fa535a-ee69-4492-af90-cf7c06cff50f` | PASS，23/23                | 修正测试构造后初版 GREEN。                                                                                                                 |
| `green-final`       | `30b6bea2-d5cc-4cf2-b59f-c5f721fdeb66` | FAIL，24 passed / 1 failed | Despawn 已成功，唯一失败是测试误期望 `get()` 返回 `undefined`，实际缺失合同为 `null`。                                                     |
| `green-final2`      | `abd5d7bb-bdce-4513-b3ff-9b32986047b5` | PASS，25/25                | 修正缺失值断言后的 GREEN。                                                                                                                 |
| `green-frozen`      | `70182ea1-afab-4396-929e-8c9e2b7ce63c` | PASS，25/25                | 增加 source break action 与 proposed 清空后仍通过；后续只增加严格输入负例和公共入口导入。                                                  |
| `tests-final`       | `b72d7b48-f7ea-474b-b30d-1366c231562e` | PASS，3 files / 25 tests   | 最终严格输入、公共导出、source/series 与既有 equipment spine 组合。                                                                        |

所有失败 stdout/receipt 原字节保留，没有删除、改名为 GREEN 或覆盖。

## 最终静态门禁

| 门禁                      | window                                 | 结果 |
| ------------------------- | -------------------------------------- | ---- |
| stdlib types              | `c74ba153-9ad1-4a9e-b352-3ca3260f3cc0` | PASS |
| root test types           | `2646cb99-2c83-40ce-9929-f2f9778a2b76` | PASS |
| 定向 ESLint               | `a37585f4-1212-48a3-8df5-c5b65e059e61` | PASS |
| 可编辑文件 Prettier check | `e58f309a-21a5-4101-858a-fed4f5865051` | PASS |

`root-test-types-01` 曾因新增测试对 readonly 字段直接赋值而 FAIL；改为显式测试用 mutable alias/不可变
snapshot 重建后，`root-test-types-02` 与最终门禁均 PASS。`format-write` 只写本片独占源码/测试/合同，
没有格式化含并发 transport hunk 的 `mod-api.ts`。

## 实际命令

所有命令均由仓库根目录通过默认 `benchmark-window` 执行，Vitest 固定 `--maxWorkers=1`：

```sh
pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/death-inventory-policy-module.test.ts packages/stdlib/tests/server/death-inventory-settlement-series.test.ts packages/stdlib/tests/server/equipment-spine-contract.test.ts --maxWorkers=1
pnpm --filter @seedlands/stdlib typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec eslint packages/stdlib/src/server/gameplay/death-inventory-settlement.ts packages/stdlib/src/server/gameplay/modules/death-inventory-policy-module.ts packages/stdlib/src/server/composition/mod-api.ts packages/stdlib/tests/server/death-inventory-policy-module.test.ts packages/stdlib/tests/server/death-inventory-settlement-series.test.ts packages/stdlib/tests/server/equipment-spine-contract.test.ts
pnpm exec prettier --check packages/stdlib/src/server/gameplay/death-inventory-settlement.ts packages/stdlib/src/server/gameplay/modules/death-inventory-policy-module.ts packages/stdlib/src/server/composition/mod-api.ts packages/stdlib/tests/server/death-inventory-policy-module.test.ts packages/stdlib/tests/server/death-inventory-settlement-series.test.ts packages/stdlib/tests/server/equipment-spine-contract.test.ts changes/2026-09-23-classic-functional-completion/death-policy-contract.md
```

## 边界与风险

- `mod-api.ts` 同时存在其他 owner 的 transport dirty；本片只拥有紧邻 armor exports 的 death capability、
  builder、participant、series 与类型 exports，不拥有、回退或交付 transport hunk。
- 本片没有安装 Classic 定义，没有修改 playbook、WorldRuleset、GameplayCallbacks、Needs/Combat/Vitals/Autonomy
  producer，也没有实现 `death-inventory-policy-unavailable` 产品 receipt。composed 致命路径与 NPC intrinsic drop/despawn
  必须在后续串行 producer/Classic 阶段验证。
- 未运行 Classic test types、build、Browser、Cua、devserver、CI 或全仓测试；本片只证明 stdlib 公共机制与
  non-Classic fixture，不宣称完整 V2 GREEN。
- 长期 docs baseline 不更新：本片实现当前 change 冻结的 stdlib 通用机制，不改变 Kernel/stdlib/Playbook/Web
  责任边界。

## 工时

实际活跃墙钟约 0.4h，低于 AI 3–5h 预计与 6h 保守上限。credits、API 等价费率、当前额度和分母未知，
不换算 token、金额或占比。

## GIT-24 隔离交付复验

从 HEAD `a39f7ba6d18b602305372093c43757be83a6125e` 精确暂存 7 个代码、测试与合同路径；共享
`mod-api.ts` 只暂存冻结的 25 行 death exports，未暂存同文件 46 行 transport dirty。staged patch
SHA-256 为 `1e0c9af735068eb31299ee24e21071092195fc48608f26c04475b479aa781755`，tree 为
`9fa96419a55037af7fc2d9bc7fda025edd9f346c`。临时 commit
`f4bf34026216e774e8ab01db9c46d4f65e3fe178` 只用于 detached 验证，不更新分支。

隔离树 `/private/tmp/seedlands-git24-death` 内部 `@seedlands/*` 根与包级链接均解析到该树自身，第三方
`.pnpm` store 只读复用，task-state 位于该树。实际结果：

| 门禁                                | window                                 | 结果                     |
| ----------------------------------- | -------------------------------------- | ------------------------ |
| death policy/series/equipment spine | `849f8020-afe8-423b-a733-5d76f263edce` | PASS，3 files / 25 tests |
| stdlib types                        | `602e545f-6e3b-4000-8977-cacfebadfd56` | PASS                     |
| root test types                     | `0305c1bf-0820-411c-a50b-44ac14b2a19f` | PASS                     |
| Classic test types                  | `cc3de099-4d10-4a6d-b66d-414dcb93ce38` | PASS                     |
| 精确 staged TS ESLint               | `db88bfa9-a39a-4a54-90ab-bf361c20c52b` | PASS                     |
| 可编辑文件 Prettier check           | `7199d74f-9422-4b75-bca7-2160af255bed` | PASS                     |
| baseline→临时 commit scoped diff    | `5b0fdd69-b0b2-4062-8180-c87f48ea6715` | PASS                     |

公共代码、测试与合同经自然 hooks 提交为 `364c6517848a0c1d03aed28b051a106820264b2f`，commit tree
`9fa96419a55037af7fc2d9bc7fda025edd9f346c`。提交中的 `mod-api.ts` blob SHA-256 为
`530f3fe9a17af8df1be9dbb356e2474e06d43ed3a410c5b594dc2fed1bc0a729`；其中 death export 片段仍与
`mod-api-death-exports.ts.log` 的冻结 SHA
`f56d000a14d09bef28fccc2ae7cdcc2c57b6414ada06c7beb29e08cb9b0f6fcd` 逐字节一致。原 V2
SOURCE/MANIFEST/delivery 保持历史原字节；GIT-24 另建 metadata，不回填旧快照。

后续 producer 风险仍未实现：Needs 同一 schedule 若同时包含存活 needs 更新和死亡 settlement，必须共用一个
`prepareEntityMutationSeries` 与 effects validate-before-write，不能把两个 participant 依次 apply。当前 death-only
series 没有混合 needs update 接缝；该接口须由 root 在 producer 阶段另行冻结，并继续保持非 player health/lifecycle
readonly。
