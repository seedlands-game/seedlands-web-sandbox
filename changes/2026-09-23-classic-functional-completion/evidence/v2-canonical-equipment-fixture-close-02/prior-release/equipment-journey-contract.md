# V2 Canonical Equipment Journey 合同

阶段：`V2-CANONICAL-EQUIPMENT-FIXTURE-01`
状态：fixture 实施中；确定性与静态验证不替代新 artifact 上的唯一 Browser 验收。

## 行为边界

- 唯一 canonical Playwright 旅程继续使用 `classic-runtime.spec.ts` 和 `canonical-runtime-v11.json`，不增加
  第二条 browser 路线、retry、随机 fallback 或 timeout。V2 装备步骤插在完整 V1 水桶、门、唱片机完成后和 C4
  streaming 前；原 C0-C5、V1 media/door 与 save-return-continue 断言不得删除、放宽或重排。
- 创造目录只选择 creative hotbar，不写 survival inventory。固定资源带由真实 UI 在创造模式放置 3 个原木、3 个
  石块和 4 个铁块；切回生存后，只通过真实 Pointer Lock、鼠标采集、键盘移动拾取和正式背包/工作台 UI
  获得材料与装备。禁止 Harness 世界写口、生产 action 函数、命令壳、teleport 或 setView。
- 固定资源闭包为：3 原木产生 12 木板并提供木镐所需木板/木棍；3 石块产生 3 圆石并提供石镐；4 铁块
  经真实配方拆分为 36 铁锭。四件铁甲与额外铁头盔共需 29 铁锭。资源位置必须位于既有平坦 corridor，
  support/target/approach 全部显式声明且不与 C0-C5、门、唱片机或工作台坐标冲突。坐标可达性只由后续
  Browser 证明。
- 工作台使用 C3 已真实取得并回收的同一物品；V2 合成结束后再次真实拆除和拾回，使 C5 继续要求
  `stationTarget` 为空且背包内有工作台。

## 装备矩阵

1. 普通 click 将铁头盔从 bag 经 cursor 穿入 helmet；Shift-click 将胸甲、护腿、靴子 quick-move 到对应空槽。
2. 额外铁头盔进入 cursor 后点击已占 chestplate，必须显示既有失败反馈；同一次 committed oracle 的 slots、
   cursor、armor 与 inventoryRevision 必须完全不变。
3. 同一 cursor 点击已占 helmet 完成原子交换；因两件头盔同 ID/同耐久，不声称存在 item instance ID，只以
   cursor origin、revision 与 bag/cursor/armor 总数守恒证明交换。
4. 至少一次 equipment -> bag 脱下和 bag -> equipment Shift quick-move 穿回；最后拿起一件 equipment 后通过
   真实“关闭背包”结算，cursor 必须为空且物品回到合法原槽。
5. 每个动作完成都等待新的只读 Authority equipment snapshot，并核对应 DOM；不得以 ghost preview、旧对象、
   固定 sleep、input ack 或计数增长冒充提交。

## 只读观察与恢复

- fixture 只消费 `HarnessApi.equipmentSnapshot(): HarnessEquipmentSnapshot | null`。该接口由独立 owner 提供，字段
  固定为 runtimeEpoch、gameplayRevision、actor、inventoryRevision、slots、armor、cursor、player health/lifecycle 与
  armorPoints。fixture 不复制 DTO，也不增加写口。
- oracle 必须来自同一个当前 `BrowserAuthorityClient.gameplay` 对象，深复制并冻结所有引用、slot、instance、armor、
  cursor origin/crafting grid；client、runtimeEpoch 或 gameplay identity 在复制期间变化时返回 null。
- C5 pre-save 在原有 world/inventory baseline 旁记录完整 equipment baseline。恢复后先保留原 V1 media/door
  校验，再要求 runtimeEpoch 和 actor epoch 换代、actor entityId 不变，且 inventoryRevision、slots、armor、cursor
  与 durability 精确恢复；随后用新 actor projection 完成一次真实脱/穿并观察 revision 前进。旧 actor ref 只用于
  不等比较，不发送伪造 stale action。

## 明确未覆盖

- 本旅程仅抽样铁甲四槽和同种头盔交换，不代表 16 件 armor 变体或 194 项完整矩阵。
- 当前 canonical 没有无需 Harness/admin 写状态即可确定触发致死的真实键鼠路线。实战 durability 损耗、死亡
  掉落、death overlay 与 respawn 在本阶段及后续 equipment Browser 中均记为 `NOT OBSERVED`；确定性 server
  测试不能冒充 Browser 证据。
- 木剑体验场会内部执行 fill/teleport/heal/spawn/apply-damage，不得用作本旅程死亡入口。

## RED、准出与预算

- 确定性 RED 只覆盖 scenario 尚无 `v2Equipment`、10 个资源 target 的唯一性/不冲突，以及基于真实 Classic
  item/block/recipe 定义的资源闭包。post-baseline source policy 同时扫描 equipment helper，拒绝 Harness 写口和
  admin command。不得复制现有 pointer 33 项行为矩阵。
- fixture 完成线：上述测试、Classic/root test types、定向 lint/format/diff 通过；原 V1/C0-C5 断言与 evidence
  schema 保持。真实 GREEN 仅能来自 954 提交、重建新身份 artifact 后由 root 授予的唯一 canonical Browser。
- 预算：AI 活跃 4-5 小时，保守 120% 上限 6 小时；传统 1-1.5 PD。credits、API 等价费用、费率、当前额度
  分母与占比均 unknown。
