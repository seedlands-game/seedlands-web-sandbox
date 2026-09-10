# S3 单一逻辑时钟设计

## 目标与边界

`ModuleLifecycle` 是模块系统的唯一逻辑时间 owner。宿主只能显式调用 `advance(seconds)`；本实现不读取墙钟、不创建 timer，也不接入 `GameplayRuntime` 或 `AutonomyRuntime`。root 后续把唯一 `GameplayRuntime` 推进入口接到该 lifecycle，并把 cadence 写入 composition identity。

## 系统 cadence

`registerSystem` 支持两种互斥定义：

- interval：`{ cadence?: 'interval', intervalSeconds }`。省略 cadence 保持现有调用兼容。每到固定边界调用一次，operation 收到规范化的 interval 秒数。
- every-advance：`{ cadence: 'every-advance' }`。每次正数 `advance` 调用一次，operation 收到本次权威时钟实际推进的规范 seconds；`advance(0)` 不调用任何系统。

两类事件使用同一个已经拓扑排序的 systems 顺序。interval 事件按本次 advance 内的到期时间排序；every-advance 位于本次 advance 的末端。同一时点再按 systems 顺序排序。因此拆分推进会改变 every-advance 的调用次数，这是 cadence 的定义；interval 的边界、余数和同一时点顺序保持确定。

每次 advance 最多执行 256 个系统 operation，包含 every-advance。预算、输入数值和全部候选余数在调用 operation 前验证；拒绝时不改变 time 或 schedule。

## 数值合同

schedule 内部只保存整数纳秒，比例为 `1e9`。time、interval、remainder 和 advance 先转为安全整数；最大逻辑时间为 `Number.MAX_SAFE_INTEGER / 1e9` 秒，不能表达为至少 1 纳秒的正推进、非有限值、负数、加法溢出或不安全余数运算均拒绝。

every-advance operation 的 `seconds` 使用本次输入取整为整数纳秒后再转换的规范值，必须与权威 clock delta 相等，不能把精度更高的原始浮点数当成第二个时间来源。interval operation 使用注册时规范化后的秒数。snapshot 输出由整数纳秒转换的规范数值；every-advance 的 remainder 永远为 `0`。

## 激活、恢复与停止

- `activateFresh()` 仅允许 `created → running`，按 module order 执行 start operation。成功激活的 lifecycle 在 dispose 时按逆序执行 stop 一次。部分启动失败时只清理此前已成功激活的 lifecycle，状态进入 failed。
- `resume(snapshot)` 仅允许 `created → running`。它先完整验证 snapshot，再一次性安装 time/remainders，并把当前 composition 的 lifecycle 视为已恢复激活；整个过程不调用 start 或其他 module operation。无效 snapshot 保持 created 且无副作用。
- `validate(snapshot)` 在任意非重入状态复用同一完整验证器并返回 `void`，不安装 schedule、不切换 lifecycle 状态，也不调用任何 operation，供 root 在提交 gameplay restore 前预检。
- `start()` 保留为 `activateFresh()` 的兼容入口；运行中 `restore(snapshot)` 保留给现有调用者，但同样先完整验证再替换 schedule。root 的真实恢复必须使用 `resume(snapshot)`。
- created 状态直接 dispose 不调用 stop；fresh 激活、resume 激活或运行中失败后的 dispose 只对其已激活 lifecycle 逆序 stop 一次。重复 dispose 是空操作。
- operation 调用期间，activate/advance/snapshot/restore/resume/dispose/time 读取的同步重入均拒绝。

## Snapshot 严格性

沿用 `ModuleScheduleSnapshot.version = 1`：`{ version, time, systems: [{ id, remainder }] }`。恢复前验证：

- 顶层和 entry 只能包含合同字段，必须为普通非数组对象，且所有合同字段必须是 data property；accessor 会在 getter 执行前被拒绝；
- systems 必须是稠密数组，长度与当前 composition 一致，每个索引必须是 data property；accessor 索引会在 getter 执行前被拒绝；
- id 必须按当前确定性 systems 顺序完整匹配，不允许重复、未知、缺失或调换；
- time/remainder 必须有限、非负、在安全整数纳秒范围且为规范输出；
- interval remainder 必须小于 interval；every-advance remainder 必须严格为零。

验证函数只构造候选整数 schedule，不修改当前状态。全部条目通过后才安装。

## Root 集成接口

root 应只创建一个 lifecycle：

1. 新世界调用 `activateFresh()`；恢复世界调用 `resume(saved.moduleSchedule)`，不得先 activate/start 再 restore。
2. 权威玩法每次唯一逻辑推进调用 `lifecycle.advance(actualPositiveSeconds)`；不要同时保留 needs/combat 的隐式推进。
3. 保存同 frontier 时读取 `lifecycle.time` 与 `lifecycle.snapshot()`；要求该 time 与 gameplayTime 相等后再提交 checkpoint。
4. composition identity 对每个 system 保存规范 cadence；interval 同时保存规范 intervalSeconds，every-advance 不保存伪 interval。
5. 世界退出或失败清理调用 `dispose()` 一次；lifecycle 自身保证 stop 至多一次。
6. `invoke` 的第三参数是执行上下文 ID：system tick 传 `definition.id`，start/stop 传 `${moduleId}/lifecycle`；调用者仍可提供忽略第三参数的两参数 callback。当前 lifecycle 内没有可冒充的 actor 来源。
7. root 在修改 gameplay 状态前先调用 `validate(saved.moduleSchedule)`；全部 gameplay 恢复步骤成功后再调用 `resume` 安装同一快照。
