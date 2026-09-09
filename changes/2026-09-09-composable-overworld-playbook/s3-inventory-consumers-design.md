# S3 库存实际消费者接线

状态：Implementing；细化已批准 S3/T05/T06/T07/T12，不扩大本期范围。

普通玩家输入、普通 NPC 和脚本命令的选择、移动、食用、合成、丢弃、拾取统一调用已注册 operation。纯模块读取受授权的 actor/item 投影，形成离线候选；宿主核对实际 operation、原始 actor、身份、观察版本、有效输入和候选后，预备 ECS 与 Combat/Action 取消。所有校验、分配、结果构造先完成，再同步提交并产生事实。

- 已有 `seedlands:inventory` 列表投影与跨角色 transfer 保持合同；transfer 也使用 prepared participant，并在所选装备变化时同时取消其 Combat。
- 新 actor 投影包含库存、装备槽、生命周期与需求。物品投影只包含 world-item 身份、位置与 stack，不暴露其他角色库存。
- 普通玩家 `seedlands.inventory` 为 self；`seedlands.inventory-item` 允许读取和拾取地面物品。拾取同时读取自己的 actor 投影和目标 item 投影，由同一个 owner 原子提交；两个角色争抢时只有先提交者成功。
- 命令入口使用调用者当前的 module binding。普通产品输入使用宿主显式提供的 actor policy；缺少绑定或 operation 时拒绝，不回退到旧消费者。开发者 give/remove 仍在后续原子化接线队列，不授予普通玩家生成物品权限。
- 物品实例身份保持一致。丢弃先预检实体分配容量；拾取先验证真实距离与视线、actor/item lifetime。库存、装备、需求与物品实体变更都属于 ECS 候选；改变当前装备时，同一个预备 Combat frontier 结清 Action。
- 不加载默认合成消费者时，组合根可选择实现相同操作合同的其他 provider；不隐式加载默认配方或恢复旧分支。

决定性验证：规则拒绝真实选择/拾取无状态变化；self 无法读别人的库存；两个角色拾取同一实例只成功一次；掉落分配失败不扣库存；当前武器 transfer/drop/move 后对应 Combat/Action 同时结清；脚本无权限时不借普通产品身份；真实 Headless/Browser 仍可采集合成、拾取和保存恢复。

Inventory 候选 child 合同 SHA-256：`86fde386188b54ac0f497bef63eef265108583f1163db09b7e03dc88bc2622ca`；只拥有纯模块/模型/自身测试。宿主与产品接线由 root 完成，所有写入停止后再串行执行 full static、build 和浏览器验收。
