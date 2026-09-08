# Blender 静态资产生产配方

仓库中的 `scripts/assets/generate-brass-trail-lantern.py` 是黄铜轨迹提灯示例的可复现编辑源。它使用 Blender Python API 从 1/16 米制方盒生成体素风格模型，作者坐标为 Z-up，导出时使用 glTF 的 Y-up 约定。脚本只写入 `--output-dir` 下由本配方声明的文件，不会清理或覆盖该目录中的其他文件；仓库不提交 `.blend`。

## 生成

需要本机已安装 Blender，脚本不依赖 MCP、Node 包或 Python 第三方包。下例的 `blender` 应替换为本机可执行文件路径；macOS 可使用 Blender.app/Contents/MacOS/Blender，Windows 使用安装目录中的 blender.exe。先查看参数：

```sh
blender --background --factory-startup \
  --python scripts/assets/generate-brass-trail-lantern.py -- --help
```

生成到临时目录，再将需要交付的 GLB 复制到资源目录：

```sh
out_dir="$(mktemp -d /tmp/seedlands-lantern.XXXXXX)"
blender --background --factory-startup \
  --python scripts/assets/generate-brass-trail-lantern.py -- \
  --output-dir "$out_dir"
```

输出包括 `brass-trail-lantern.glb`、`lantern.recipe.json`、两张 36×36 的 16px 图集源和 `generation-report.json`。GLB 为静态单场景，含一个网格、168 个三角形、内嵌 PNG 材质纹理（底色和发光），没有外链 URI、相机或灯光。示例交付文件位于 `apps/web/public/assets/samples/brass-trail-lantern.glb`。

## 导入与重导入

打开 `asset-workbench.html`，在资产库选择“导入静态 GLB”。工坊会先校验 glTF 2.0 容器，再保存到独立的 `seedlands-glb-assets` IndexedDB，并用同一 PlayCanvas 预览资源加载。当前限制为：单文件最大 16 MiB；最多 16 个模型；模型库总计 64 MiB；最多 256 个节点和 100,000 个场景三角形；纹理最长边 4,096 像素、总像素最多 16 MiB。只接受内嵌 PNG/JPEG，拒绝外链、骨骼、动画、形变和压缩几何/纹理。

同一模型的重导入保留所选资源的逻辑 ID，并递增 revision、替换 Blob；普通重导入不应随机新增一个看似相同的模型。若需要并存副本，应使用显式复制语义。导入后的模型只加入本地资源库，不自动注册物品、不替换方块、不创建碰撞，也不改变世界存档。

## 预览与项目备份

工坊和游戏共用现有 GLB 校验、PlayCanvas 容器加载和外层居中归一化逻辑。GLB 的根节点变换与原始字节保持不变；预览只在外层调整位置和比例。材质纹理保持在 GLB 内，由 glTF 材质消费；本配方不把任意 GLB UV 转换成 Seedlands 像素材质，也不新增引擎适配。

完整项目包导出当前编辑项目及可见 GLB 原始字节、稳定 ID 和 revision，包含 schemaVersion=1。恢复时先整体校验，再原子写入项目库；导入为草稿，不自动改变已应用快照。图集的 compiler/content 版本属于独立派生产物，见[资产工坊](asset-workbench.md)。浏览器站点数据清理会移除本地库，项目包是可搬迁备份，不是发布包。

## 来源与许可

该示例及配方是 Seedlands 仓库的一方生产资产，几何、纹理和脚本均由本仓库生成；仓库整体许可见根目录 `LICENSE`（Apache-2.0）。示例没有引入第三方模型、贴图、字体或在线服务。提交前应保留 Blender 版本、输出目录中的 `generation-report.json`、GLB SHA-256 和项目静态校验结果，以便复现来源。

本配方只覆盖静态外观资产生产：无骨骼、无动画、无任意世界注册、无玩法绑定、无运行时材质热替换。后续扩展这些能力必须另立变更合同。
