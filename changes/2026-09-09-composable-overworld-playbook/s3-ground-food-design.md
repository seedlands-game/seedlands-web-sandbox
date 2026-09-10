# S3 地面食物注册消费

状态：Implementing，承接已批准消费者闭环，未准出 S3。

当前 grazer 的地面食物消费直接启动/完成 Eat Action、扣除 world-item 并清空 hunger；绕过注册规则及 prepared 多 owner 提交。目标是一次注册 consume-world-item 操作统一预备实体 needs、原地 world-item 数量/删除、Eat Action 及自治行为/感知效果。缺 provider 或权限、after 拒绝、结果 clone 失败、Action/实体容量失败或陈旧观察不得部分提交。

机制使用只读 Feeding actor/item 派生投影，实际状态仍由 ECS EntityStore、ActionRuntime 和自治状态 owner 持有。普通原始输入仅含可选 existingActionId；命名默认 Rules 负责 grazer/存活活跃/饥饿阈值与食物资格，生成明确恢复量。默认 Pack 明确传入 grazer、deficit 阈值 50、恢复全部饥饿，保持原有行为；通用机制按 needs meaning 进行有界加减，不内建 grazer/full 默认。空间范围 1.1 与可见性在准备和最终校验时检查。

单次扣一单位，剩余 stack 保留相同 entity id/lifetime/顺序和位置；最后一单位才删除。禁止用 despawn+respawn 模拟减少，也不以 pickup 再 consume 两次操作冒充原子提交。新 Eat Action 允许预备即完成并进入历史；已有 pending/running Eat Action 只完成一次。任何可能失败的 clone、计数、绑定、分配和感知候选在 apply 前完成。

自动 Logic 使用明确自治 actor authority，自定义脚本保持真实 binding；地面消费即时完成，不新增延迟来源 schema。start-action/eat 等其他真实入口同时检查，避免先创建无来源待执行 Action 再由自动 Logic 借用权限。独立 Builder 组合不安装 Feeding/Needs 时不产生隐式饥饿或进食。

测试先取得纯候选和实际宿主 RED，再验证 missing provider/grants、before/after 拒绝、clone/allocator 错误无变化、partial stack 同 identity、last item 删除、existing Eat 单次完成、当前 actor/target/LOS 变化，以及 Headless/Browser 装配。最终完整树 static → build → Browser；不声称性能提升。

恢复补充：组合世界的 Feeding 即时完成，不产生可持久等待的 Eat。旧存档中 pending/running Eat 无可重绑授权来源，在隔离验证世界内显式中断为 restore-cancelled，保持食物和 needs 不变，再安装归一化快照；已完成 Eat 历史保留。普通自治可在后续新观察后发起新的合法消费。standalone 旧合同维持原有恢复行为。

独立复核修复：Feeding 主操作使用 item execute，同时改变 actor needs/Action，因此宿主现在还独立校验实际 principal 和 operation module 的 actor execute；准备前与最终 validate 均检查。仅有 actor read 不足以进食。两条真实宿主 RED（principal 显式 deny / module 缺 execute）已转 GREEN，14 项宿主用例通过。
