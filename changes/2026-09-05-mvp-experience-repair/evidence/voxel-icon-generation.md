# 方块缩略图生成记录

生成日期：2026-09-05。

`public/assets/voxels/grass.png`、`leaves.png` 与 `snow.png` 均由正式 `public/assets/voxel-atlas.webp` 的对应 tile 在本地临时 PlayCanvas 正交相机中渲染，无外部资产。

- Grass：GrassTop 顶面、GrassSide 侧面、Dirt 底面。
- Leaves：Leaves tile，并复用生产 `leafOpacity` 的周期孔洞算法写入 alpha。
- Snow：Snow tile。

三张均为主体约占 75–85% 画布的 256×256 透明 PNG、统一斜上方三面视角与打光。Wood、Dirt、Stone、Sand 与 Lantern 继续复用同套物品 PNG。
