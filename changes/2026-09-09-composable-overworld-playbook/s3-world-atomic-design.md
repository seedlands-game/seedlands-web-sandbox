# S3 方块提交参与者

第一批跨 owner 操作准入一个方块编辑加有界 ECS 修改，覆盖放置、挖掘与工位方块内容结算。开发者 fill / 批量体素命令继续走现有 WorldEditBatch，不在此步承诺任意 I/O 或任意批量事务。

提取现有 single edit 的纯结果构造，复用原结构事件、collision delta、重网格范围与 metrics 口径；普通单编辑保持既有提交路径。新增 host-only prepared 单方块参与者只读取已加载 chunk，prepare 校验输入/版本容量并构建全部结果。validate 复核 world revision、chunk 对象/版本、原体素；apply 只同步更新已校验字段，禁止异步、事件监听与外部 I/O。计划本身不暴露可修改的 canonical buffer。

实际 GameServer fluid sidecar 已纳入参与者，GameplayRuntime 的放置、挖掘、掉落和拾取已使用 ECS 候选。无性能优化主张，不改变渲染、生成或普通批量编辑算法。

RED：准备后 live voxel/revision 不变；后一个参与者拒绝时不 apply；过期 world/chunk/体素、版本耗尽、未知 chunk、输入异常均在编辑前拒绝；一次成功 apply 的事件与原单编辑路径一致，不能复用计划。

扩展接线设计：真实 GameServer 的准备参与者同时预构建体素与 fluid byte 的结果；队列仍使用原有 bounded frontier + rescan 恢复机制。只调用已知同步 owner 方法，不把任意外部回调纳入承诺。根任务开始把真实 drop/pickup 切到 ECS prepared batch；整个库存加掉落生命周期仅提交一次 gameplay revision。最终实体 ID 分配失败必须发生在库存、动作与版本修改之前，先加实际 GameplayRuntime RED。

实际放置与挖掘先准备单方块参与者，再准备 actor 全组件和有界掉落候选，全部 validate 后在同一同步调用内 apply。两个参与者只调用已知 owner，不包含用户回调。挖掘完成之前不先清空动作或写入完成进度；掉落实体序号耗尽时方块、库存和动作原样保留。单次失败保证限于操作本身，不宣称整个时间推进回滚。GameplayCallbacks 要求 prepareVoxelEdit，所有产品宿主必须提供完整参与者，不设置旧 editVoxel 降级路径。
