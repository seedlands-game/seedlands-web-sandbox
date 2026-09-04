# Chunk 持久化架构复核

## 结论

有条件通过。IndexedDB 以 `worldId + Chunk key` 保存独立二进制 record、dirty-only 增量写和异步驻留/淘汰可以消除当前全量 JSON 写放大；前提是异步 I/O 不进入 Change 5 的 plan / apply 原子区间，并补齐 revision ACK 与淘汰状态机。

## 必须纳入的约束

- load 区分 `found`、`missing`、`error`；读取或解码错误不能等同 missing 后生成 procedural Chunk。
- 保存 `revision=R` 期间发生 R+1 修改时，R 的 ACK 不得清除 dirty；旧保存不得覆盖新 record。
- unload 的异步等待结束后重新检查 revision、lease 与 epoch，避免等待期间的新 edit 被删除。
- codec、voxel schema 与 generator 使用独立版本；自适应编码保留 `raw-u16` 有界回退。
- materialized Chunk 的历史不能因 generator 更新静默重建；依赖 procedural base 的编码必须验证 base signature，并为未来 generator migration 保留转换入口。
- 高负载不仅测总 bytes，还要证明启动和 active Chunk 解码不扫描或解码全部 record。

## 与 Change 5 的边界

- Change 5 负责同步 validation / resolve / plan / apply / publish、revision 与 dirty。
- Change 6 在 commit 前异步 ensure resident，在 publish 后调度 snapshot 保存。
- 原子 apply 区间不得 `await`；并行实现可暂时分叉，最终集成按该时序解决接口冲突。

## 证据边界

复核只读取了 Change 6 输入、当前源码和 Change 5 实时 spec；未实施、未运行容量/性能基准，也未验证 IndexedDB quota、worker clone 成本或旧存档迁移。运行时未暴露 effective model / effort telemetry。
