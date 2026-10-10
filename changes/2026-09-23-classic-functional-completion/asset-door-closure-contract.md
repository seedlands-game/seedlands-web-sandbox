# 木门物品表现闭包合同

状态：`V1-ASSET-DOOR-CLOSE-01` 实施合同。只修复 Browser 内置资产目录对 Structure 木门物品的静态表现，不改变门玩法、Structure 定义、voxel、Pack 或 stdlib。

## 行为

1. `wooden-door` 保持 `itemType=block` 且没有 `placesVoxel`；物品表现不得恢复 legacy voxel 52 或把 Structure 门降级成普通方块放置。
2. 木门复用已有 `utilitySprite('wooden-door')`，通过正式 `pixelItemAssets` 生成 `builtin:texture:wooden-door:detail` 与 `builtin:model:wooden-door`。
3. 完整 `asset-catalog` 加载时，木门命中显式 native model，不进入 `placesVoxel`/material 推导分支；binding 的 icon 与 model 共享同一可解析 pixel texture。
4. 正式物品 presentation 消费者可把该 model 解析为非空 `ToolModel`，并生成非空 positions/normals/colors/indices；不得用空白图标、未知 fallback 或错误 cube 冒充修复。
5. 无 `placesVoxel` 的未知 block 仍不允许使用像素挤出模型；其他缺少显式 native model 和材质映射的内置物品仍由 catalog 严格报错。

## RED / GREEN

- RED：导入完整 catalog 必须稳定复现 `Missing builtin item material mapping: wooden-door`。
- GREEN：catalog 可加载；木门 binding/model/texture 引用闭合；图标为正式 pixel SVG；CPU 端正式像素网格生成非空；未知 Structure block 仍拒绝。

## 非目标

- 不修改 `placesVoxel`、Structure registry/handler、Classic gameplay、stdlib、门世界 geometry 或 terrain material。
- 不增加未知物品通用 fallback，不启动浏览器，不执行完整 build 或 CI。
