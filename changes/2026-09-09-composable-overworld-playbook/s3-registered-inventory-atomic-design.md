# S3 注册库存提交补强

实际 registered inventory state port 仍用多个 `inventory.replace` 再调用 `changed`。真实 RED 表明 Gameplay revision 耗尽时仍报告成功并替换两个库存，dirty 回调把 revision 推过安全整数上限。修复沿用已准出的 ECS prepared mutation series：全部 observation/candidate 校验后先预检 gameplay revision，将候选 slots 合并至各 actor 的完整组件，一次 validate/apply，再递增 revision。原有资源权限、Ruleset 拒绝、同 revision 恢复的新鲜度拒绝与一次 fact 保留。

RED：真实 registered transfer 在 gameplay revision 为 MAX_SAFE_INTEGER 时失败，player/NPC 库存、完整 snapshot 和 fact 数量均保持不变；不能用捕获最后一个异常掩盖已发生的库存写入。
