# checkpoint47：运输创建与替换参与原子发布

基于 `5912eab1f477e8dec80786ebde15801e1555add8`。host-only EntityStore participant 新增 `transportSpawns` 与 `transports`；库存消费、运输创建、工位、world item 使用同一 allocator reservation 和最终发布边界。prepare/validate 不改 owner、库存、sequence、issued IDs 或 lifetime；apply 前重检 owner/epoch/allocator、目标实体与 immutable component、完整候选骑乘关系。运输元数据 revision 恰好前进一次，definition 不在同一 lifetime 改换，空间变化写唯一 canonical transform/velocity，候选 cargo/空间字段复制后不受调用方修改影响。

`prepared-spawn-identity.ts` 提取原 world-item/station 的临时 ID 保留逻辑并用于 transport。`prepared-transport-relations.ts` 校验所有未来组件，死亡或移除 rider 必须在同一候选解除关系；合法解除后死亡/移除可一次提交，关系错误零写。原 128 entries / 192 segments、500 有效行规则不变。快照投影和列清理按已有职责提取，未改变原字段、持久身份或空间桶语义。

Task95 实际运行时接线前 RED 为新增 fixture 6/6 FAIL：库存被扣但运输 spawn 被忽略，坏 definition 未拒绝，transport-only replacement/series 不获支持，骑乘者死亡未拒绝。接线后首轮因容量 1 的测试误给 2 槽而失败，按声明容量修正 fixture 后 6/6 GREEN；不放宽断言。最终模块拆分后根回归 stdlib 2 文件 14/14 PASS，Web 实体/工位/prepared/snapshot 4 文件 24/24 PASS。日志为 cloud 私有独立路径 `transport-publication-{stdlib,app}-regression-47-01.log`；局部 lint 实际 exit0。

完整 `pnpm verify:static:ci` 实际 exit0，日志 `transport-publication-static-47-01.log`：sealed 5/5、全库 format/paths/lint、各包生产及 root/tools/Classic 类型、Svelte 0错误0警告、ESLint规则与 CI 选择 14/14 全部通过。最终新增证据/代码地图文字另做格式检查；未追加构建、浏览器或性能运行，静态与上述回归不能替代产品验收。

裸 EntityLifetimeReference 没有 worldId：本组候选绑定实际 owner，恢复换 owner 拒绝旧候选，但不能识别来自另一世界且字段完全相同的裸引用。后续 Authority/Host 必须绑定当前实例。未声称正式 deploy/mount/control/body/container、非空 legacy V4 vehicles 迁移或真实浏览器玩法已通过。远端第46组五个非浏览器 job PASS，Chromium 截至 10:51 仍运行；旧 Browser34/远端44失败未被此组抹除。真实周额度最近读数为 10:10 UTC 剩余86%，10:40请求更新尚未收到，不换算 token/credits。
