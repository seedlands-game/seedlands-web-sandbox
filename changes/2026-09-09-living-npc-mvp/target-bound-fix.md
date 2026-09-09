# A1 target reference 有界修复

合同 SHA-256：`402383f6e4f278f2db86c4a85929da843b1b1ff0e4599f6fb7944dbf542172c2`

## 变更

- `CharacterRecord.targets` 上限固定为 128。新增引用达到上限时淘汰最旧的非保护 binding；一次 observation 中当前实际投影的 entity/POI refs 与角色正在执行的 entity target 均受保护，因此返回给调用方的本轮局部引用不会在同轮失效。
- 历史事件不随 binding 淘汰而删除；被淘汰的 ref 后续作为 goal target 时走既有 `CHARACTER_TARGET_UNAVAILABLE`，即使相同底层 entity id 再次出现在视野内也不会复活旧 ref。
- forage pickup 在 world item 仍存在时先取得事件 ref，然后才消费实体；不再对已经 despawn 的物品新建引用。
- snapshot restore 拒绝超过 128 个 targets；每个 ref 必须为正整数 `target-N`，且最大 N 必须与 `targetSequence` 精确一致。验证仍发生在候选 runtime，失败不改变现有角色状态。
- 新增测试覆盖 116 个轮换可见 NPC 与 20 个真实拾取/食用物品，共生成 137 个不同资源引用；断言冻结 map 恰为 128、最旧 ref 淘汰、20 条 pickup 事件 ref 仍对应 binding、已淘汰 ref 在同 id 重新可见时仍拒绝。原子恢复测试另覆盖 129 bindings 与伪造 sequence。

## 验证

- RED：新有界测试失败，实际 snapshot targets 为 137，预期 128。
- GREEN：`./node_modules/.bin/vitest run tests/server/character-control-runtime.test.ts`，10/10 通过，7.57s。
- 最终加强“同 id 再可见仍拒绝”后单测：1/1 通过，0.80s。
- `./node_modules/.bin/tsc -p packages/game-core/tsconfig.json --noEmit`：通过。
- `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit`：通过。
- `git diff --check`：通过。
- 未运行 pnpm、安装、Browser、全局门禁或 Git 写入。

## 风险

- 淘汰策略有界且确定，但旧事件中的 ref 只作为历史标识；一旦其 binding 被淘汰，不能再次用于控制。当前 observation 与正在执行的 target 保持可用。
- Browser、前置回归和最终 V01-V10 汇总由 Root 执行；本修复只证明角色 core target 生命周期边界。
- Root 已声明接管 `applyIntent` speech 前置校验；本修复未触碰该区域。

## 实际成本

- 单次实现尝试完成；测试类型声明经历两次只读类型窄化修正，未改变生产设计。
- 墙钟约 12 分钟，低于合同 0.5 agent-hour；外部 API 调用费用为 0。
