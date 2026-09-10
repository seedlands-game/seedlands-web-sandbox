# S3d 模式宿主与输入接线证据

范围：实际 GameplayRuntime/GameServer 的模式组件 owner、注册模式操作、普通主体授权、物理落点、生命周期失效、命令和移动预测。本记录不是 S3 或 Browser 体验准出。

- 注册操作的集成 RED：`gameplay-registered-mode` 入口缺失；完成后真实 ECS 创造/生存切换、库存不变、需求/伤害免除、无安全落点原子拒绝、权限拒绝、恢复/退役后的旧绑定拒绝通过。fixture 的同 persistent ID 再生原本就禁止，测试已保留该拒绝并另外验证旧绑定不能作用于新实体。
- 命令 RED：`/gamemode`、`/fly`、`/creative-slot` 尚无解析/资源映射，真实 Headless Harness 调用失败。接入后使用仅持有 `seedlands.mode` self read/write/execute 的普通 actor 主体通过；同时断言 Harness envelope 的 `ok` 与内部 CommandResult 的 `success`，不把前者当执行成功。
- 实际产品注册资源来自 GameServer 的 immutable composition.resources。模块不能通过 permission 请求自授宿主权限。Browser 根据模式命令类别固定绑定普通 browser-player；Source 的 actor/label 不是授权依据。Headless 与 Harness 在提交时传宿主真实 authorizer/principal。
- ModeRuntime 在取消在途动作前校验完整候选（包括 revision 耗尽、稀疏快捷引用），无安全落点不取消、不改模式/位置/库存。成功切换才清零速度；选择目录不会重置物理速度。
- GameplayModuleRuntime 对每个绑定保留真实 entity lifetime，提交前复核；成功 restore/dispose 清理订阅/队列。一次性命令执行后释放绑定。库存事务与单角色模式事务由已注册 owner 分别处理，尚不接受跨这两个 owner 的混合提交。
- 移动 RED：创造状态未到达实际 authority physics/客户端预测。接入后 PhysicsSnapshot 派生 movement revision 与 flightSpeed，预测和 replay 使用现有 stepBody 的同一碰撞飞行分支；模式变化清理旧预测、待处理输入，并拒绝旧 revision 的迟到输入。未切换过的旧生存输入保留兼容；经历模式/飞行 revision 变化后必须匹配权威版本。
- 相关定向回归：`pnpm exec vitest run tests/client/local-player-prediction.test.ts tests/client/creative-flight-prediction.test.ts tests/server/creative-authority-physics.test.ts tests/server/composition/mode-command-host.test.ts tests/server/composition/gameplay-registered-mode.test.ts tests/server/actor-mode-runtime.test.ts tests/runtime/session-protocol.test.ts` 得到 7 files / 47 tests GREEN。后续结构提取仍要重跑适当门禁。物理定向结果不表示浏览器飞行观感已验证。
- 每世界物品/配方表已进入 AuthorityGameplayView，UI 子任务使用此投影；创建/目录/模式切换 UI 与即时方块操作由各自证据记录承接。S4 工位/炉体候选已开始，但真实 owner/世界生命周期仍未交付。

无性能收益主张。最终全量 static/build、冻结产物的 Browser 输入与视听、跨宿主恢复、独立审阅和 PR/CI 仍待完成。

- 额外 RED/GREEN：事实监听器通过另一个 binding 同步重入原先可绕过单 binding busy，现统一由每世界提交锁拒绝；排队在下一次显式规则推进执行，跨 binding 总计最多 64 项。负时间推进原先会先消费队列再抛错，现先验证时间；快照严格不变用例通过（注册模式测试 4 项 GREEN）。
