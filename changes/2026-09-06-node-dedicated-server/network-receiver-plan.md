# 参考消息的客户端应用验证

本项落实已批准 N0/N2 的接收端应用要求，仍是 change 内的功能验证，不采用 wire、传输或 GUI。生产改动仅把 `LocalPlayerPrediction` 和 `AuthoritySnapshotGate` 的参数类型收窄为实际消费的字段；完整 Worker snapshot 继续结构兼容，预测和排序算法保持原行为。

## 预置行为与用例

- Given 只包含公开 correction 必需字段的状态，When 调用预测与快照门禁，Then 类型检查通过且不需要伪造 diagnostics、entities 或内部时钟。先在 `tests/client/local-player-prediction.test.ts` 与门禁测试取得缺少最小类型的 TypeScript RED，再修改类型。
- Given 真实生成 Chunk 经公开 reference 投影，When 校验完整 canonical/fluid 的长度与 SHA-256 后安装，Then 使用现有 collision mirror 和 `VoxelCollisionWorld` 供统一预测物理读取；修改输入 buffer 不能改写已安装副本。
- Given `World.edit()` 的真实 delta，When 连续应用，Then canonical/fluid 与 revision 一起更新；缺失 predecessor 时请求 baseline，不能在旧碰撞版本上重放未确认输入。
- Given 旧 epoch、重复或倒退 correction，When 接收，Then 现有快照门禁拒绝且预测状态不变；损坏或长度错误 baseline 不能部分安装。
- Given 提交消息丢失但 correction 声明更高碰撞 revision，When 应用 correction，Then 旧缓存失效并请求基线，后续预测只能查询未知空间阻挡或有效新版数据。并发 baseline 较新版本先完成后，迟到旧结果不得覆盖新缓存。

后三项位于 `e2e/network-reference-receiver.test.ts` 与 `e2e/support/network-reference-receiver.ts`，由本 change 专属 Vitest 配置显式运行；初始预期 RED 为缺失 receiver。这是 **Vitest** 功能证据，目录名不使它成为 Playwright/E2E 浏览器证据。后续各 codec 解码结果还须复用该应用路径，不以 DTO deep equality 代替。HUD/可见 GUI、真实网络乱序/断连、新会话握手及性能仍未验证。

## 准出与当前状态

类型契约已取得缺少最小类型的 TypeScript RED，随后补齐；现有预测/门禁/镜像 3 文件 19 项回归通过（Vitest）。真实 reference 接收最初因缺少 helper RED，前三项通过后独立复审通过；补充丢失提交的场景取得旧缓存仍存在的 RED，随后将 correction 的最低版本要求纳入 guard 并取得 GREEN。没有新增长期浏览器基线，不触发基线提炼。

统一收口：Node 22.23.2 的 reference receiver **5/5**、C0/C1/C2 各九条解码应用对照 **1/1** 通过；浏览器生产构建和 Node 五入口构建通过。最新 `verify:static` 为 **175 文件通过、2 跳过；916 项通过、4 跳过**，world 行覆盖 96.37%。本批无浏览器运行时算法变化，不复用这些 Vitest 数字证明 GUI 或网络行为。

独立复审：Sol/high 检查异步 hash 前副本、每 key lease/最低 revision、两块原子安装、delta predecessor 与预测使用当前可读版本，未发现当时三项范围的阻断问题。它不是 public parser：key/值域/重复 cell/连接聚合预算、驻留容量、hash 并发限制和失败重试属于后续 session adapter；这里的 `Map/Set` 只受固定 fixture 控制。不得将 oracle 的成功等同公开网络资源门通过。
