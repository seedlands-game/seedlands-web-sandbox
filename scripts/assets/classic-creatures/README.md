# Classic 生物原始配方

`generate.py` 是 12 种生物的原创几何、UV 像素和动作源，不依赖第三方素材或 Python 包。需要已安装 Blender（本轮 5.2.1 LTS）；先运行 `blender --version`，不可用时按 Blender 官网对应平台安装后再执行。项目 Node/pnpm 依赖按根 README 安装。

```sh
node scripts/benchmark-window.mjs -- blender --background --factory-startup \
  --python scripts/assets/classic-creatures/generate.py -- \
  --output-dir apps/web/public/models/classic
node scripts/assets/classic-creatures/sync-metadata.mjs
pnpm exec prettier --write apps/web/src/client/presentation/classic-creature-definitions.ts
```

`blender` 是系统可执行文件占位，可替换为本机 Blender 可执行路径。所有输出路径显式指定；脚本仅覆盖本配方的 12 对 GLB/PNG 与 manifest，不清理其他文件。`--only pig` 用于代表切片，不能据此同步完整元数据；`--render-dir <目录>` 可生成逐物种透明背景静态预览，不把该预览当游戏验收。生成中断后重跑同一完整批次，再同步元数据、运行定向校验；勿提交半批次 manifest。

像素atlas为64×64，每个材质图块16×16，最近邻采样。几何只用cuboid；方盒有独立显式pivot，蜘蛛折腿、鱿鱼触手、鸡翼、四足、双足、头、尾及史莱姆内外体分别建模。Blender导出网格、UV、内嵌PNG及材质后，同一Python配方在GLB追加四个命名transform片段：idle、move、attack、hurt。动画无root motion、无玩法写入；攻击由游戏现有权威阶段定位。

manifest包含工具版本、配方hash、逐物种GLB/PNG SHA-256、米制高度、构件与pivot、四片段、节点与三角形数。运行时复用GLB严格校验、每Application资源生命周期和动画控制器；12种默认CPU Blob有界共享，GPU lease独立释放。默认模型保留作者尺度，外部用户模型仍沿用已有feet归一化。

授权来源：本仓库原创，Apache-2.0。经典方盒风格作为视觉方向，不分发任何第三方模型或像素素材。

骷髅弓的正侧视与抬弓证据可从实际导出GLB复现（读取导出关键帧，不使用源场景姿态）：

```sh
node scripts/benchmark-window.mjs -- blender --background --factory-startup \
  --python scripts/assets/classic-creatures/render-skeleton-bow.py -- \
  --model apps/web/public/models/classic/skeleton.glb \
  --output-dir reports/2026-09-22-visual-audit/classic-v3/creatures/skeleton-bow-fix
```
