# V2 Classic Death Policy 安装合同

阶段：`V2-CLASSIC-DEATH-POLICY-INSTALL-01`
状态：合同冻结；Classic policy、精确 V4 predecessor 与迁移尚待 RED/GREEN。

## Owner 与最小接口

- Classic Playbook 唯一声明模块 `seedlands:overworld-death-inventory-policy`，通过公共
  `defineDeathInventoryPolicyModuleV1` 提供 `seedlands:death-inventory-policy`。Kernel、stdlib producer 和 Web 不包含
  Classic 物品 ID 或 actor ID 分支。
- policy 固定为：player 的 inventory/cursor/crafting/armor 全部 `drop` 且 actor `retain`；creature/npc 的四容器全部
  `drop` 且 actor `despawn`。定义是 Pack 组合身份的一部分，不使用宿主 callback、可变全局配置或新 snapshot child。
- `pack.ts` 只安装该模块。已提交的 registered Combat 与 direct Vitals producer 从 composition 解析 capability；本阶段
  不改 producer、Needs、runtime adapter、公开 settlement 或协议。非 Classic Pack 可不安装 capability，或安装不同的
  player retain-inventory 策略，证明机制不依赖 Classic 内容。

## 精确 V4 前身与迁移

- BUILD02 产物捕获的完整 `CompositionCheckpointIdentity` 作为独立 literal 保存，并仅以
  `gameplayVersions: [4]` 加入 predecessor。来源固定为 source
  `1bbe3a60d55ffa5d05e405377624fbbd942e6327`、pack lock
  `fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332`、artifact receipt
  `aa4f6d8056335413523964fd1d2d4630c5261fb7ee4477c879a54ad0c145281a`；捕获 raw SHA-256 为
  `ebad22c315758e0b9e305aaff6ba7c0c4adc7026ac506fb6dfe4b82abd1db405`，canonical identity SHA-256 为
  `e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a`。不得从当前 target 动态删除 death 定义来伪造该前身。
- 既有四条 exact predecessor 继续受理。pre-Media 特例仍只接受其固定 pack digest 和目标定义的精确投影；安装 death
  后，该投影同时删除 Media 的 module/capability/resource/codec/operations 与 death policy 的 module/capability。不得按
  digest 单独放行，不得忽略未知 module、capability、operation、resource、codec 或 definition identity 差异。
- 合法 V4 代表 snapshot 在 exact source identity 下先由既有 migration 重投影到当前 target，再由 checkpoint guard 完整
  校验。迁移不跳过 composition 验证；任一 identity 字段篡改必须 fail closed，且 active owner 零写。该夹具只证明
  deterministic snapshot 兼容，不冒充真实 Browser 保存。

## 死亡事务与可观察结果

- direct Vitals 致死 player：同一 prepared death transaction 将命中后仍存在的 inventory、cursor、crafting 与 armor 各
  掉落一次，清空四容器，player 保留为 dead；共享 inventory revision 只前进一次。重复伤害不新增掉落或磨损。
- registered Combat 致死 creature/npc：固有 death drop 与四容器/装备在同一提交中生成，actor 从 ECS 与 simulation
  清除；player 目标则保留 dead。实例耐久必须保持，不能重复或重造。
- allocation/source/frontier/policy 失败继续由已提交 producer fail closed。本阶段不宣称 registered Needs、Browser、Cua、
  artifact 或完整 Classic 死亡链路已验收。BUILD02 明确不含本阶段接线。

## RED、GREEN 与验收

- RED 必须可执行地证明：当前 Classic composition 缺 death capability；正式 Classic direct Vitals 致死未按四容器策略
  结算；BUILD02 捕获的 exact V4 identity 未被 predecessor 接纳。失败不得是缺少 import 或测试收集。
- GREEN 至少覆盖：模块 identity/冻结定义；player 四容器 drop+retain+一次 revision+重复致死无重复；正式 registered
  Combat 的 creature/npc 四容器、固有掉落与 despawn；完整 pre-death identity restore；pre-pointer、pre-Media、
  retired-graph 既有恢复；module/capability/definition/digest/resource near-miss 全拒绝。
- 定向测试、相关 stdlib/root/Classic test types、精确 ESLint、可编辑文件 Prettier 与 scoped diff 均须通过性能窗口。原始
  stdout/receipt、SOURCE/MANIFEST/delivery 逐项保留；本阶段不运行 build、Browser、Cua 或 CI。

## 阶段 Done When 与预算

- `done_when`：Classic policy 已安装；公开 composition 出现唯一 death capability；BUILD02 exact predecessor 和全部既有
  支持集合可恢复；near-miss fail closed；正式 direct/registered death 定向 GREEN；证据身份可独立复核。
- 传统工程量：1.5–2.5 PD。AI 连续墙钟：4–6 小时；阶段硬上限 6 小时。120% 保守建议：1.8–3 PD、4.8–7.2 小时，
  超出本阶段则 checkpoint 后退出。
- credits、API 等价费用、费率、当前额度分母及占比均为 `unknown`，不伪造换算。长期 architecture/docs owner 未变化，
  本阶段仅更新当前 change 合同与状态。
