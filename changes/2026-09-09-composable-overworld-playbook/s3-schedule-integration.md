# S3 玩法时钟与存档接线

范围：将已验证 ModuleLifecycle 接入真实 GameplayRuntime，组合世界的 gameplayTime 直接读取该时钟；未组合的历史测试宿主保留既有时钟路径。注册系统使用宿主明确传入的服务主体授权，不从 Pack 请求自动复制授权。此步不表示默认 needs/combat 已迁移为注册操作。

新世界在首次推进或保存前激活一次；构造后直接恢复不会先执行 start。恢复前验证 schedule 的完整 ID/order、精度、范围及与 gameplayTime 相同的 frontier，验证失败不得替换 ECS、时钟或绑定。V4 组合存档必须包含 schedule；获准的 V1–V3 迁移按历史 gameplayTime 建立确定性相位，跳过历史启动和 tick 副作用。恢复到已激活宿主也不得重复 start。

保存前最多排空 64 个派生操作；仍有队列则明确拒绝保存，不能输出缺少待执行工作又声称完整的快照。恢复成功后使旧 actor/system 绑定失效；dispose 顺序为 lifecycle stop 后释放绑定。

RED：真实 GameplayRuntime 中 0.4 秒保存后恢复并推进 0.6 秒，interval 正好触发一次且无重复 start；缺失/异时 schedule 在原状态安装前被拒绝；注册系统没有服务授权不得借用玩家权限；循环派生队列阻止保存。

验证：真实接线前 4 项 RED 位于本地 `/tmp/seedlands-s3-gameplay-schedule-red.log`；接线后 composition 合计 14 文件 / 78 项 GREEN。循环队列检查使用真实 Mode/ECS binding 的订阅回路，拒绝输出未排空快照；取消订阅后有界清理可保存并恢复。独立 full static/build 与 Browser 尚待此切片冻结后运行。
