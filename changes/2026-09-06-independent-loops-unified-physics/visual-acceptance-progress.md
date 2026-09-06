# 视觉准出记录

本记录补充已批准的冻结合同，不修改其准出标准。精确运动、碰撞和时序由同次 Playwright 轨迹与纯逻辑测试证明；Midscene 检查真实画面中可见的运动过程、介质差异与调试表现，两者不互相替代。

## 自然旅程与碰撞调试

- 生产版本 `7be2f4b` 的真实键鼠自然河岸、低顶、快速下落和灯笼场景通过。自然旅程包含涉水、潜水、Space 越岸、生物及掉落物失去支撑并实际落地。原始运行记录：`/tmp/seedlands-7be2f4b-visual.jsonlog`，解码附件：`/tmp/seedlands-visual-7be/`。
- 碰撞调试渲染原本虽有颜色数据，但 PlayCanvas 在 MeshInstance 创建时缓存的顶点格式不含颜色。`e9c6866` 先建立实际位置与颜色缓冲再创建实例，保持关闭时零额外资源；针对性反例先 RED 后 GREEN。
- `2149788` 的实际浏览器调试旅程通过；测试将掉落物置于既有平台支撑范围内，防止准备期间先掉出视野，并在 GUI 交互后释放表单焦点再验证 F3。生产代码未为此改变。记录：`/tmp/seedlands-2149788-debug-supported.jsonlog`，原始画面：`/tmp/seedlands-debug-supported-214/`。
- 真实调试帧可见权威橙色 AABB、预测青色身体、灯笼窄碰撞形状，以及与身体方框不同的拾取和吸附球形传感器；关闭帧无调试线框。

## Midscene 证据

`physics-visual-acceptance.yaml` 三项任务全部通过，运行耗时 24.09 秒。摘要：`/tmp/seedlands-physics-midscene-summary-3.json`。本地取证页 `/tmp/seedlands-physics-visual-gallery/` 仅排列未经修改的原始截图与原始视频每秒四帧抽帧；其 `manifest.json` 记录来源。河岸使用视频第 55–63 帧，低顶第 12–17 帧，实体下落第 75–83 帧。

首次断言将静态状态对照同时当作连续动态证明，Midscene 拒绝；随后补充同次视频的中间帧序列，将静态介质对照与连续实体下落分别观察。没有把首尾截图当作完整运动轨迹，也没有以画廊取代真实键鼠 Playwright。

`fluid-geometry-transition.yaml` 在完整构建的 `643b01f` 上通过，耗时 20.75 秒，摘要 `/tmp/seedlands-water-midscene-summary-2.json`。浏览器实际执行生产世界编辑，捕获中井单几何水面中间高度并暂停表现插值，观察稳定左井及中间水位；释放后确认左、中井完整水面与空右井，未见双层透明墙或残片。首次俯视平台遮挡井口，无法判定；将仅用于观察的支撑平台收窄为一格后取证，未改水体规则或阈值。预览前逐字节核对 HTTP 首页及资源与该 SHA 的完整构建产物一致。
