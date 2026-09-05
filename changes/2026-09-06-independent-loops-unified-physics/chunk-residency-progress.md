# Canonical Chunk 驻留边界进度

## 冻结内部合同

`GameServer` 是 canonical Chunk 的唯一所有者。正常驻留目标为 256，每次 Authority 维护最多回收 32 个；2048 只作为持久化故障时的新增 admission 背压门，不删除 dirty 或 pin 数据，也不得让 Authority Worker fatal。健康持久化路径的实际驻留量应收敛到 `max(256, pinnedCount)`。

pin 来源限定为当前 streaming/fluid active 集合、当前物理步真实碰撞查询窗口、流体在途 lease 的 snapshot/readSet、mesh prepare 引用计数和 dirty Chunk。可见 mesh 在 prepare 结束后的驻留由现有 streaming active 集合覆盖。`release-mesh` 只释放 exact center 的引用并保留持久化临时快照释放语义，不把 3×3 邻域当 canonical 驱逐请求。

驱逐只选择 `dirty=false && persistedRevision===revision` 的未 pin LRU。候选记录对象、`accessEpoch` 与 `revision`，删除前再次核对；任何访问、修改、重新 pin 或对象替换都使候选失效。压力下只允许一个异步 `freezeSaveSnapshot` → `saveFrozen`，成功 ACK 后再回收；失败保留 dirty 和会话，以活跃时间按 1/2/4…30 秒退避。

## RED 与状态

- [x] 已定义 clean LRU、三类集合 pin、mesh exact/refcount、二次校验、hard admission、原子保存失败/退避/重试以及默认 256 长探索收敛用例。
- [x] `pnpm exec vitest run tests/server/chunk-residency.test.ts` 按预期 RED：`src/server/chunk-residency` 尚不存在，测试套件在导入边界失败且未执行用例。
- [x] 已实现内部驻留管理、Authority pin 接线与非阻塞压力保存；物理 pin 每步只来自实际碰撞查询，流体 lease、streaming 与 mesh prepare 分别独立持有。
- [x] 定向 `Vitest`：7 文件 57 项通过；源码 TypeScript、Svelte 检查与所改文件 ESLint 通过。
- [x] 生产 `vite build` 通过；完整测试 TypeScript 与封装式 `pnpm build` 暂被同 change 正在 RED 的 `tests/server/fluid-interactive-priority.test.ts` 四处新 API 调用阻挡。驻留实现自身无类型诊断，待交互流体实现转绿后复跑封装入口。
- [ ] 真实浏览器长距离探索由主任务在稳定不可变产物上另行安排，不以 Node 用例代替。

极端 pin/dirty 集合允许超过正常目标，以数据安全优先。现有 `EntityStore` 对 world-item 数量没有独立玩法上限，因此本 change 不宣称恶意无限生成下的数学绝对内存上界；本次保证健康自然探索收敛，并在持久化持续失败且达到 2048 时停止接纳新的 streaming canonical、保留现有世界并等待可恢复重试。
