# V2 Classic Death Policy 安装证据

阶段：`V2-CLASSIC-DEATH-POLICY-INSTALL-01`
基线：`5fcdc1dffe3b4a7fbcf5e43c91ae45189ed10708`
状态：Classic policy、精确 V4 predecessor 与迁移已完成定向验证；待 root 独立准出，未 Git。

## 实现结果

- Classic 新增唯一模块 `seedlands:overworld-death-inventory-policy`，只通过公共
  `defineDeathInventoryPolicyModuleV1` 声明策略。player 四容器全部 drop 且 retain；creature/npc 四容器全部 drop 且
  despawn。没有 Classic ID 分支、宿主 callback、新 schema child 或 stdlib 玩法规则。
- `pack.ts` 只安装该模块。正式 direct Vitals 和 registered Combat 复用 GIT26 producer，从 composition 解析同一只读
  capability；本片未修改公共 runtime、Needs、协议或 Web UI。
- BUILD02 的完整 pre-death V4 identity 以独立固定 JSON literal 保存，作为第五条 `gameplayVersions:[4]` exact
  predecessor。测试对 production literal 与原 raw 做完整值相等，并用项目 canonicalizer 验证 SHA-256
  `e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a`、`39998` bytes、`22` modules、
  `28` capabilities。原 capture 文件 SHA-256 仍为
  `ebad22c315758e0b9e305aaff6ba7c0c4adc7026ac506fb6dfe4b82abd1db405`，未重跑或改写。
- pre-Media 兼容继续使用固定 pack digests；其 exact target 投影现在同时剥离 Media 与新增 death module/capability。
  既有 pre-pointer、pre-Media、retired graph 与 c18a890 identity 支持集合未扩大为通配。

## RED 与诊断

| 记录                      | window                                      | 结果                                 | 结论                                                                                                 |
| ------------------------- | ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `classic-lineage`         | `7226c57e-26c5-44ca-8cec-734ccb70af46`      | EXPECTED FAIL，`2 failed / 2 passed` | Classic capability 为 0，完整 pre-death identity 未登记。                                            |
| `classic-armor-final-red` | `82a822ac-547a-4547-a0f3-18d5a1d9816f`      | EXPECTED FAIL，`1 failed / 5 passed` | 正式 direct Vitals 返回 `death-inventory-policy-unavailable`；不是 import/collection 失败。          |
| 根 Vitest 配置            | `4cea8fb8-9c55-4373-aff1-b9658f0e2f57`      | 诊断 FAIL，无收集                    | 根配置只收 Kernel/stdlib；后续改用 Classic/Web 真实配置，不计行为 RED。                              |
| 两次完整 Pack 构造        | `6bc17b37...`、`d132f621...`                | 诊断 FAIL                            | 测试缺 Media/Structure host 端口；随后先用真实最小闭包固定 RED，再以完整 Pack+显式端口完成最终验证。 |
| literal/line-count        | `29458ec8...`、`1fde7181...`、`442ab703...` | 诊断 FAIL                            | 分别为无效 target helper、shell stderr 污染 JSON 和两个 `max-lines`；原件保留，最终均已修正。        |

## 最终 GREEN

- lineage：window `850d497f-aed2-4a2f-ba8e-083661ba3863`，`1 file / 4 tests PASS`。覆盖唯一 capability、
  fixed raw 全值/canonical SHA、22/28 行数，以及 unknown module/capability/resource、module/capability version、
  definition identity、manifest/entry/resource digest 的 fail-closed 反例。
- 完整 Classic Pack：window `ca1595ff-f488-4e6a-9372-73e21f59119f`，`1 file / 3 tests PASS`。覆盖 exact
  pre-death V4 合法代表 snapshot 恢复、player 致死后再次保存恢复、creature 固有掉落+四容器+despawn、NPC
  四容器+despawn。完整 Pack host 端口如被本测试意外调用会抛错。
- 最终 Web 聚合：window `4a098ce6-9eb1-46e8-b12a-39faff05fd0f`，`3 files / 18 tests PASS`；包括既有
  pre-pointer/pre-Media/retired graph、Classic armor 与本阶段完整 Pack 测试。
- 精确 no-duplication：window `352aba62-5b27-4fb8-9b21-9db57c188d29`，`2 files / 9 tests PASS`。player 与
  NPC 精确 4 个容器掉落，creature 精确 5 个（四容器+固有掉落）；重复攻击不新增掉落。装备掉落保留命中后的
  durability。
- Classic production types：`ee0df525-2bb7-4c27-8b8b-cd537762e599` PASS；stdlib production types：
  `a2b4d532-576e-4395-b9dc-65f5b720afd0` PASS；最终 root/Classic test types：
  `b526ddc0-cf2f-423e-91b5-bf25465e0bb5`、`2645a0fc-3880-45d2-a1b0-001a17be1bf0` PASS。
- 最终精确 ESLint `6b8a5510-1e2b-4ba6-abdb-ad54a415a44a`、Prettier
  `6a3413c5-827c-4d47-97a2-6b6bc508fb1e`、scoped diff
  `e31e2ef6-fa73-4d82-8ce2-033b195cb7c2` 均 PASS。所有 Vitest 固定 `--maxWorkers=1`，所有检查经默认
  benchmark window 串行执行。

## 边界与未验证项

- 本片只证明 Classic policy 安装、GIT26 direct/registered producer 的 Classic 消费、精确迁移和 deterministic
  save/reopen；registered Needs 生产片与显式 Classic fixture closure 已由 root 分别独立准出，当前只待组合 Git，本片
  不认领其 GREEN。
- 未运行 build、artifact、Browser、Cua、CI、deploy；BUILD02 source `1bbe3a60...` 不含 GIT26 或本阶段代码，不能作为
  当前 death artifact。未执行真实 Browser 保存或 UI 死亡旅程。
- 未修改长期架构 docs，因为 Kernel/stdlib/Playbook/Web owner 边界未变化；具体策略和兼容身份留在当前 change。传统
  实际约 `0.7 PD`，AI 活跃墙钟约 `1.5h`；credits、API 等价费用、费率、额度分母与占比为 `unknown`。
