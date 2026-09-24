# Legacy Gameplay 玩家布局窄合同

## 适用范围

本合同只约束 `validateGameplaySnapshot` 将 V1-V3 gameplay snapshot 转换为 V4 candidate 时的 player inventory layout。它不改变新世界布局、V4 schema、最终 restore owner 或 Classic content。

## 合同行为

- V1-V3 player snapshot 固定按既有 legacy 24 格 inventory、8 格 hotbar 合同验证和转换。
- 转换输出的 V4 `entityStore` 保留原始 inventory 长度、hotbar 大小、selected slot、物品 identity/count/instance 和槽位，不 padding、不截断、不重新布局。
- 该 V4 candidate 可以通过既有 `restoreComponentSnapshot` 安装到当前 36/9 composition；安装后 legacy player 仍保持 24/8。
- V4 输入始终使用当前 composition 的 `playerLayout` validation owner；合法 36/9 不能被降级为 24/8。
- legacy 24/8 兼容只接受现有合法形状。错误 inventory 长度、hotbar 大小或 selected slot 必须 fail closed，不能由默认值修复。
- snapshot validation 不得修改调用方输入。

## 非目标

- 不修改 `EntityStore` 或 `PlayerState` 的新 player 默认布局。
- 不增加 Classic 专用 padding 或迁移规则。
- 不重构通用 snapshot/checkpoint owner、lineage guard 或 player component schema。
