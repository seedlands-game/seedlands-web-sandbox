# 物品缩略图生成记录

生成日期：2026-09-05。

`public/assets/items/` 的九张 PNG 均由本 change 的生产 `GameplayModelAssets.addItem()` 在本地临时 Vite 预览中渲染得到；未使用外部或 Minecraft 资源。渲染使用主体约占 75–85% 画布的 256×256 正交相机、45 度近似观察、双方向光与透明清屏，随后由 Chromium Playwright 以 `omitBackground` 输出 PNG alpha。

覆盖 `item-registry.ts` 内的全部物品：dirt-block、stone-block、wood-block、sand-block、berry、plank、wood-axe、stone-pickaxe、lantern。方块按共享物品模型显示，原木含独立端面；工具分别为木质斧和石质镐。

最终同步：在生产 `GameplayModelAssets.addItem()` 修复灯笼两侧提把连接杆及其缩放后，仅重新渲染 `lantern.png`；同时修复 `dirt-block` 顶面误用草叶材质后，仅重新渲染 `dirt-block.png`。`item-voxel-icons-montage.png` 已由同一次隔离 headless PlayCanvas/Chromium renderer 重建并人工查看；其余物品 PNG 未重新生成。
