# S3 世界 Ruleset owner

依据 D5/D6 与机制闭环设计。WorldRuleset 与 actor mode 采用独立 owner：世界记录定义 ID、版本与 revision，角色保持各自模式 revision。当前版本 Ruleset 为不可变世界状态，切换角色模式不递增其 revision。

新增两个 RED：实际 Overworld 没有 Ruleset 注册/快照，坏 Ruleset 也未在恢复前拒绝。实现显式第一方 Ruleset module、公开 factory、世界只读 state port，模式操作在同一提交中观察 Ruleset revision。宿主为普通玩家显式授予 Ruleset 的世界读取权限，模式写入仍限 self；不依赖管理员入口。

当前协调器仅增加不可变 Ruleset 观察与既有单 mutable owner 的联合版本检查。对 Ruleset 的写入直接拒绝；不能据此宣称 ECS/体素/Combat 多 owner 原子协调已完成。Ruleset 对 needs/damage/place 的规则贡献仍待后续注册机制集成。

V4 在提供 Ruleset capability 的世界保存必需 Ruleset identity；恢复前校验完整身份与 revision。缺少 provider 的世界不能接收带 Ruleset 的快照，V1–V3 的已批准默认迁移沿 composition guard 处理，不发明新的兼容回退。

验证：首次 GREEN 尝试被并行的 module-lifecycle 临时缺失阻断，没有把无测试运行计为通过。文件恢复后，world-ruleset、rule-stages、gameplay-registered-mode、mode-command-host、gameplay-composition-checkpoint 共 5 files / 16 tests 通过；涉及源文件的 ESLint 通过。
