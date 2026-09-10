# S3 方块实际消费者迁移

状态：Implementing；细化已批准 D4/T06/T07/T11/T12，实际注册入口正在集成，尚未准出。

## 要获得的行为

实际放置、开始/取消挖掘和持续挖掘完成经过显式注册操作。标准机制产生候选，默认 Playbook 提供可命名替换的方块规则。当前地形、角色身份/位置/模式、库存和工具必须在最终提交前重新校验；方块、消耗、掉落和挖掘状态一起预检并一致提交。普通输入保留其宿主绑定，脚本不得借开发管理员或自动行为身份。

持续挖掘接受时只保存稳定来源；每次产生最终破坏效果前按当前宿主策略重绑定。系统时钟只推进待完成候选，不能充当玩家身份完成方块编辑。撤销权限、角色 lifetime 不一致、目标变化或离开范围应明确取消；分配/协议等异常保留可诊断状态，不静默吞掉。恢复沿用已支持的旧快照迁移；旧快照无稳定来源的在途挖掘安全取消，地形和库存不变，新快照保存来源并重授权。

## 实施边界

- 保留现有世界单编辑和流体 sidecar 的 owner，注册宿主只组合其 prepared participant。需要把已构造的编辑回执作为写前只读结果供最终 clone 使用，不能在 apply 后才构造返回结果。
- 玩家仍使用同一 ECS breakAction owner；不新建平行库存、地形或挖掘状态。其他 actor 的采集能力不在此切片额外扩张；本期 T05 的玩家/NPC 共享拾取由已接通的 Inventory 负责。
- 普通 actor 状态与 voxel 目标分资源授权；系统推进仅获独立 clock 资源。before/after 规则不能越过宿主身份和当前世界校验。
- 无所需 provider 的组合世界拒绝对应操作；未组合测试宿主保留既有显式行为对照。本切片不承担炉体/箱子及耐久，S4 在这些真实方块入口上继续组合。

## 验证设计

先获得实际入口的 RED：after 规则拒绝放置/挖掘后地形、库存、掉落、动作和 revision 不变；脚本无资源权限时不能借权；缺 provider 时无隐式路径；接受后撤销来源不产生未来掉落；保存恢复中途挖掘只完成一次。原子负例覆盖实体/世界 revision 耗尽、结果 clone 失败、最终目标/范围变化。绿色后统一运行 full static、build 和原有 Browser 木剑/创造回归。

此文档是实现准备，不是任何一项已完成或已验证的证据。

并行收敛既有开发者 give/remove：保留已有 `world.command` 开发权限入口，不将其加入普通 Inventory 模块；采用 detached Inventory + prepared ECS 和当前装备对应的 Combat 取消。RED 覆盖 gameplay revision 耗尽不增减库存、移除当前武器同时取消攻击。

## 集成发现与处置（尚未准出）

- 实际缺 provider、单次结算、来源撤销、after 拒绝、最终结果 clone 失败与最终几何变化的定向检查通过。公开 JSON 只传递 worldRevision 回执引用；宿主从其只读回执队列取得实际 WorldCommitResult，不接受脚本伪造的世界结果。
- 调度隔离测试原本明确去掉 Needs/Combat；新增 Block 同样从该夹具去除，保留自定义 schedule 专属权限和启动/恢复断言。
- 旧距离错误反馈被纯规则读空体素遮蔽；Actor 投影增加当前位置，默认规则在读取体素前检查距离，宿主仍在最终提交前复核。
- allocator 耗尽 RED 曾暴露 finish 异常污染调度生命周期、快照不可读；现已移到 lifecycle 返回后结算。失败 finish 的 world/inventory/drop/action-clear effects 不变；clock elapsed/revision 是此前已提交的独立事实，不承诺整个多 system advance 回滚。

以上仅为局部静态/功能证据，未运行本切片完整 static/build/Browser，也不代表 S3 或 S6 完成。

### 注册时钟和完成操作的失败边界

沿已准出的 Combat 合同，原子边界是单个注册 operation，整个多 system advance 不承诺回滚。Block clock 的 before/after 与实际 system 授权必须先执行；成功提交的 elapsed 与 schedule 是独立事实。之后宿主在 lifecycle 调用栈外，用持久来源发起 finish。finish 失败时世界、库存、掉落、未清空的 breakAction 保持该已提交 clock 的状态，不能使已完成的调度变成 failed；快照保存 ready action 与相同调度 frontier，后续显式 advance 可重试。

此前旧方块测试将 clock 与 finish 视作一次门面原子操作；迁入独立注册操作后，测试改为与相同时钟已提交、目标临时不可读的控制世界比较整个 EntityStore 和 moduleSchedule，并保留不改方块、不创建掉落、不清动作断言。这不是多操作回滚承诺。另加暂停时钟规则负例及 transient finish failure 后保存/恢复只结算一次。提前预演未来 elapsed 的候选已因绕过 clock before/after 被 RED 否决，生产实现已移除。
