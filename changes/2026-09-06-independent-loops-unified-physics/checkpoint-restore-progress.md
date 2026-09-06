# 持久检查点恢复修复

本项属于已批准合同 A8 的保存、恢复和一致性验收，不扩大范围。

## 已复现 RED

- `c1b1827` 不可变生产包、当前 Mac 前台 Chrome：真实运行到 600 个物理 tick，保存成功，刷新重入后立即保存返回失败。当前 Authority 从零开始，而 IndexedDB 保留较大的旧 `commitSequence` 并正确拒绝旧检查点写入。
- `tests/server/authority-checkpoint-restore.test.ts`：重载提交序号、未加载 Chunk 时世界修订号恢复、非法检查点拒绝三项 RED。
- 浏览器用例：当前 change 的 `e2e/authority-save-restart.spec.ts`。不修改用户正在玩的存档，使用隔离 Browser Context 与专用 seed。

## 修复约束

持久端返回同次原子保存的提交序号与世界修订号；恢复前验证非负安全整数；GameServer 在恢复 gameplay 前验证检查点，在初始化 AuthoritySession 时沿用已持久的提交序号。保留拒绝旧检查点覆盖的保护。旧档没有此元数据时沿用明确的零初值，不伪造历史序号；新保存同时写入两者。

现有本次新增单元夹具曾允许新会话 `save(0)`，与实际 IndexedDB 的拒绝旧检查点规则冲突。此夹具现改为明确拒绝零序号覆盖，再用恢复序号的后继保存成功；这是修复两种持久端语义不一致，不删除浏览器的保护规则。输入/命令的每会话 sequence 仍随 epoch 重置，持久提交序号是另一字段。

## 当前状态

持久端、GameServer 恢复已实现；Session/Runtime 初值由协作者随 `0186b05` 和 `1745cfd` 接入。检查点恢复、冻结保存、Headless 三文件 19 项 GREEN，另保存/玩法/模拟持久化三文件 19 项 GREEN；受影响 ESLint 通过。为遵守 GameServer 500 行上限，将已有单格编辑指标常量原样移到 `world-edit-metrics.ts`，不改变其计算。`009c0ee` 不可变生产包的真实 IndexedDB 前台 Chrome 重载复验已通过：`1 passed (13.33s)`，刷新前提交序号 821，刷新后立即保存序号 825，两次均由持久事务确认成功。原始回执保存在 `evidence/checkpoint-restart-009c0ee.json`。完整最终生产构建仍待集成准出。
