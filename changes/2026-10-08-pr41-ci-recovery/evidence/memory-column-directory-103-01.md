# Memory 与可切换持久化列目录

基于 a00eb730 的原 Memory snapshot Map，唯一 commitSnapshots 入口维护 canonical key 的列索引及安全单调目录版本；原克隆先全部成功，非空普通与冻结保存推进，空写和克隆失败不推进。查询只读当前列最多128个 key，覆盖任意合法 signed cy，不读取或复制 voxel、不消费 loadSnapshot，不扫描全部 Map。返回 detached 元数据；损坏 primary key/当前列记录、超预算均 unknown，查询期间写入 superseded。索引不是第二世界 truth，不声明速度收益。

Switchable 转发当前 delegate 可选查询，无端口 source-unavailable，replace 包括同对象及转发 chunk/frozen save 均换 fence，迟到结果 superseded。原写/异常行为保留；失败写也保守失效。MemoryGamePersistence 冻结保存继承原提交入口，真实 GameServer freeze 验证版本、空写与失败保存。

Memory缺方法 RED9FAIL，加入安全计数上限反例后最终10PASS；Switchable首次夹具路径错误不算真实RED，修正路径并移除查询方法后实际RED6FAIL，恢复实现后6PASS。所有日志保留。最终 stdlib169files1235PASS；Web当前目录/version/Browser parser/restore/冻结6files61PASS；范围ESLint、实际Classic类型、根stdlib测试类型、stdlib生产类型及CI选择17PASS。新Web单元加入既有headless和类型收集，旧选择不删除。

私有原始日志统一在 /workspace/pr41-recovery-20261008-root-01/：memory-column-red-103-01.log、memory-column-green-103-02.log、switchable-column-red-103-01.log（路径错误）、switchable-column-red-103-02.log（真实RED）、switchable-column-green-103-02.log、memory-column-full-stdlib-103-01.log、memory-column-web-regression-103-01.log、memory-column-final-lint-103-01.log、memory-column-final-classic-types-103-01.log、memory-column-final-stdlib-test-types-103-01.log、memory-column-production-types-103-01.log、memory-column-ci-selection-103-01.log。全量stdlib1235已包含本组10例，Web61已包含本组6例，不重复相加。

源码与本证据同提交；当前远端仍dde3c593，未把旧CI或native98作为本组真实Browser证明。本组未运行新识别构建/完整Browser/headless全量。Sky消费者、world epoch/dirty/resident组合及完整玩法仍待完成；point-in-time目录不保证后续写入或跨tab观察永久有效，整PR不具备可合入证据。08:26实际UI周剩78%，60停止线不变。
