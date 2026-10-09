# Transport death settlement checkpoint 50

前驱源码：`7ff66457d5a6f6d5916197d2134d9f7c392ac241`。本片仅处理正式死亡结算的运输乘员关系，未修改 Classic pack identity、旧存档迁移、运输控制/UI、浏览器断言或期限、性能门槛。

## 修复与风险检查

真实 Authority fixture 显式注册 transport deploy/relation 和 death inventory policy，正常部署并 use 骑乘成功后，调用既有 direct Vitals 致死入口。RED 精确发生在 `validateTransportRelations -> prepareEntityMutationSeries -> prepareDeathInventorySettlementSeriesV1 -> ActorVitalsRuntime.commit`：`Transport rider must reference a live actor lifetime.` 初次 fixture 缺 relation module 的 setup failure 保留但不算此 RED。

共同 death series 在所有候选新鲜度验证后，从当前 EntityStore transport component 查询精确 actor ID/lifetime，生成 rider=null、component revision+1 的 replacement。Actor 死亡/退役、容器掉落、存活者与运输 replacement 通过一个 prepared series 预检和发布，不先解除关系，不在底层 entity owner 自动修补一般死亡或 despawn。运输 transform、velocity、fuel、cargo 和 lifetime 由原 owner 保持。原有 actor/despawn/spawn 分段顺序保留；运输 replacement 也计入每段128、最多192段的原总容量。

有界风险检查另取得真实 RED：手造 retained death candidate 的 replacement 仍为 positive health/alive，旧入口未拒绝。现在 retained death replacement 必须 health=0、lifecycle=dead；拒绝前不写 owner。

## 实际验证

- 新 Authority death：1文件3例 PASS。正常 deploy/use mount 后 direct Vitals 致死，掉落仅一次；无 death policy 致死保持 snapshot/view；死亡 portable checkpoint 恢复及正常 respawn 不重连 rider、不重复 drops。
- 新 stdlib death：1文件5例 PASS。混合 mounted/unmounted death 四容器 drops 与存活 rider；运输非零 velocity、完整 survivor component、fuel/cargo/pose/reference 保持；准备后 component 变化、重放、超原总容量、伪造 alive replacement 拒绝；真实 registered Combat caller 致死解除 rider。Combat fixture 是正式 GameplayRuntime 注册入口，未当作真实浏览器/Authority 输入验收。
- 原死亡系列、mixed、direct Vitals、registered Combat、registered Needs 与 policy：6文件63例 PASS，包含新增 guard 后的最终复验。
- ECS transport owner 与 prepared transport mutation：2文件14例 PASS。
- Classic armor death matrix、difficulty/respawn、special damage：3文件25例 PASS。
- 生产与两份新增测试 scoped ESLint PASS；最终生产 stdlib types、root test types、Classic types 均 PASS。格式检查和 diff whitespace 检查 PASS。

私有 raw 输出保留在 `/workspace/pr41-recovery-20261008-fixtures-01/`：`task105-mounted-death-red-01.log`、`task105-series-red-01.log`、`task105-forged-candidate-red-01.log`、`task105-authority-final-raw-03.log`、`task105-stdlib-final-raw-03.log`。最后两份含格式化后的真实 Vitest 输出和 `EXIT_CODE=0`；类型输出为 `task105-classic-types-01.log`、`task105-stdlib-types-01.log`。早期手写 GREEN 摘要不替代 raw 输出。

根输出保留在 `/workspace/pr41-recovery-20261008-root-01/`：`transport-death-final-regression-50-01.log`（实际6文件63例；命令额外两个不存在路径未选中，不能计为8文件）、`transport-death-owner-regression-50-01.log`（随后按实际路径验证2文件14例）、`transport-death-classic-regression-50-01.log`、`transport-death-final-production-lint-50-01.log`，以及本片类型输出。此前失败与不完整尝试保留。

## 合入边界

本片未运行生产构建、浏览器旅程或整帧性能验收。前驱7ff66457的远端 CI 已有 headless、deterministic、architecture、build、static 五项通过，Chromium在记录时仍运行；上一版07ed9416主旅程V2实际用尽原900秒，重试在25分钟CI作业上限被取消，不能视为当前可玩。失败附件通过 connector 取到，但环境下载403，独立网络授权仍待确认。

运输运动、燃料/货箱消费与 UI、Classic/Modular 正常玩家产品链、旧非空载具迁移、完整194与C5保存恢复、组合整帧性能、最终精确SHA的所有必需CI仍需完成。PR保持未合并，不能凭本片测试宣布可合入。
