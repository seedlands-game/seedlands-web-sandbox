# 高级光照、水体与画质分级

**状态：Delivered；父合同已授权本地自主交付，无需逐项等待 hash 批准。**

## Context & Goal

在已交付的 WebGL2 分类合批渲染管线上完成一次可实际游玩的视觉功能冒烟：持久化灯笼方块能发光，太阳与有限局部灯产生阴影，树叶的镂空参与阴影，水面显示真实场景的有界平面反射，并按 Low / Medium / High 明确控制 GPU 负载。Medium 以当前 Mac 1920×1080 接近 60 FPS 为集成目标，但本 change 不以单次 headless 帧率代替真机验证。

## Scope & Non-goals

本次包含：

- 新增稳定数值 `Voxel.Lantern = 9`、`FaceMaterial.Lantern = 11`，基础生成器不自然生成灯笼。
- 扩展服务端、浏览器存档与 Worker 校验，使灯笼编辑经现有事务和存档路径持久化。
- 灯笼材质自发光；附近有限数量的点光源随玩家有界扫描，最近的少量灯可投阴影。
- Medium / High 开启实时太阳阴影；Low 明确关闭。
- 树叶纹理具有确定性的透明孔洞，cutout 同时用于主画面与阴影通道。
- High 使用低分辨率、降频更新的镜像相机生成真实场景水面反射；Medium 保留更低成本反射；Low 关闭。
- Medium / High 使用可销毁的轻量调色后处理，Low 关闭；场景 tone mapping 同步分级。
- Harness 暴露实际启用状态、预算与活跃灯数量，供浏览器验收。

本次不包含：生存物品/配方入口、UI/game shell 重构、体素光照传播、GI、SSR、水流物理、WebGPU、音频和发布。水面反射只保证水平水面附近的有限平面反射，不承诺任意高度多水面的精确反射。

## Decisions

1. 保留 WebGL2、分类合批与紧凑顶点布局；新增功能不恢复逐材质 draw call。
2. 局部灯采用玩家附近有界扫描和对象池，而非全世界扫描：Low / Medium / High 最大活跃灯分别为 2 / 4 / 6，投影局部灯分别为 0 / 1 / 2；水平扫描半径分别为 10 / 14 / 18，垂直半径 6 / 8 / 10，每 0.5 秒刷新。
3. 太阳阴影预算：Low 关闭；Medium 512；High 1024。局部阴影贴图分别为 0 / 128 / 256。
4. 反射预算：Low 关闭；Medium 128²、每 8 帧更新；High 256²、每 4 帧更新。反射相机只渲染世界不透明/cutout 层，水层不参与反射，防止递归采样。
5. 后处理：Low 关闭且线性 tone mapping；Medium/High 启用单 pass 风格化调色，分别使用 Neutral / ACES tone mapping。效果必须随 runtime 销毁。
6. 灯笼是实体方块，继承现有碰撞和面剔除规则；基础世界确定性与 generatorVersion 不变。

## Behaviour

- Given 合法编辑写入灯笼，When Chunk 经过服务端提交、存档、刷新与恢复，Then 同一坐标仍为数值 9，并由 opaque 分类和纹理数组第 11 层渲染。
- Given 玩家附近存在多个灯笼，When 灯光系统刷新，Then 只启用预算内最近灯，超出扫描范围或预算的灯不创建 GPU 光源；Medium 最多一个、High 最多两个局部阴影灯。
- Given 日间或夜间场景，When Medium/High 运行，Then 太阳阴影实时启用；树叶透明孔洞不会形成完整实心方块阴影。
- Given High 水边镜头，When反射相机按预算更新，Then 水材质采样由镜像相机真实渲染的场景纹理，且不会递归渲染水层。
- Given Low，When进入同一世界，Then 反射相机和后处理均不创建/启用，太阳与局部阴影关闭，但水、灯笼与危险轮廓仍可辨认。
- Given切换画质后重新进入同一 seed，Then只改变表现预算，不改变 seed、generatorVersion、Chunk 内容或持久化编辑。
- Given runtime 被销毁，Then 点光源、反射 RenderTarget/Texture、后处理与相关相机/层全部释放，不流入下一世界。

## Test Design

实现前新增：

- `tests/world/voxel.test.ts`：灯笼稳定数值、材质映射、实体碰撞及基础世界永不生成灯笼。预期 RED：注册项不存在。
- `tests/app/advanced-lighting.test.ts`：三档预算、最近灯筛选、显式反射/后处理/阴影上限。预期 RED：预算模块不存在。
- `tests/app/voxel-render-pipeline.test.ts`：第 11 层与灯笼 opaque 分类。预期 RED：层数仍为 10。
- `changes/2026-09-05-advanced-lighting-water/e2e/advanced-lighting-water.spec.ts`：真实浏览器放置灯笼、局部灯激活、Low/High 开关、刷新持久化与水面反射状态。预期 RED：Harness 尚无 visualEffects 与放置入口。
- `changes/2026-09-05-advanced-lighting-water/midscene/advanced-lighting-water.yaml`：夜间灯笼、水边反射、树叶镂空与 Low 可读性视觉语义。

## Acceptance & Evidence

| 编号 | 准出标准                                                           | 证据                                 | 当前                                                                           |
| ---- | ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
| A1   | 灯笼数值、材质、事务与刷新持久化成立，且基础生成器不自然生成       | Vitest、Playwright-change            | GREEN：单元与刷新恢复通过                                                      |
| A2   | 三档太阳/局部灯/阴影预算生效，附近材质被人工光源真实照亮           | Vitest、Playwright-change、Midscene  | GREEN：预算、暖光与降级通过                                                    |
| A3   | 树叶具有可见透明孔洞并以同一 alpha cutout 参与阴影                 | Static、Playwright-change、Midscene  | GREEN：跨 mip 孔洞、shadow pass 编译与视觉语义通过                             |
| A4   | Medium/High 水面采样真实镜像相机场景纹理，Low 完全关闭且无递归水层 | Vitest、Playwright-change、Midscene  | GREEN：倒置叶墙反射与材质隔离通过                                              |
| A5   | 后处理与 tone mapping 按档位启停，切档不改变世界数据               | Vitest、Playwright-change            | GREEN：三档状态与同 seed 持久化通过                                            |
| A6   | 既有 WebGL2 分类合批、世界确定性、浏览器核心旅程无回归             | Static、Build、Playwright-baseline   | GREEN：全部门禁与 9 条基线通过                                                 |
| A7   | 当前 Mac 1920×1080 Medium 接近 60 FPS，新增效果成本与环境明确记录  | Playwright-change、Manual supplement | 部分：自动帧可观察到约 60 FPS；1920×1080 headed 真机采样留给父 change 集成验收 |

## Tasks & Current State

1. [x] 对齐父合同、代码边界与 PlayCanvas 能力。
2. [x] 建立 change 合同与 RED 用例定义。
3. [x] 记录 RED，补 voxel/持久化/预算纯逻辑。
4. [x] 实现灯光、阴影、cutout、水反射与后处理。
5. [x] 跑 Vitest、Static、Build、Playwright-change、Midscene 与基线。
6. [x] 更新 Delivery Snapshot 并创建本地提交。

## Delivery Snapshot

基线为 `abdaf5a`。本 change 改动集中在：

- `src/world/voxel.ts` 与四处存档/服务校验：新增稳定数值灯笼并沿现有事务持久化；生成器版本与基础世界不变。
- `src/app/advanced-lighting-budget.ts`、`advanced-visual-effects.ts`：三档太阳阴影、局部灯对象池、附近扫描、镜像相机、RenderTarget 和明确更新预算。
- `src/app/voxel-materials.ts`、`playcanvas-chunk-adapter.ts`：第 11 纹理层、发光灯笼、跨 mip 叶片 cutout、水纹与独立 Water layer；反射相机不渲染 Water layer。
- `src/app/stylized-post-effect.ts`：单 pass 饱和度/对比度/暖高光/暗角调色，Low 不实例化。
- `game.ts` 与 Harness：生命周期接入、状态证据、正式 `World.edit()` fixture 和保存等待。

Shader 变更汇总：

1. 新增 opaque `emissivePS`（GLSL/WGSL），只在纹理数组第 11 层输出灯笼自发光。
2. 重写 `opacityPS`（GLSL/WGSL）的层选择：由 shadow pass 不保证存在的 `vVertexColor` 改为每个分类材质的固定数组层，使叶片太阳/局部阴影 shader 正常编译。
3. 新增 WebGL2 water `emissivePS`，按屏幕投影采样低分辨率镜像相机纹理；WGSL 不在最终后端范围。
4. 新增 WebGL2 fullscreen post-effect fragment shader；此前 change 的 array `diffusePS` 本次未重写。

最终证据：

- `CI=true pnpm verify:static`：23 个 test file 通过、2 个按既有条件跳过；132 个 test 通过、4 个跳过；`src/world/**` 行覆盖率 94.86%。
- `CI=true pnpm build`：通过；仅保留既有 Vite 大 chunk 警告。
- `CI=true pnpm test:e2e`：9/9 通过。
- `CI=true pnpm exec playwright test changes/2026-09-05-advanced-lighting-water/e2e`：3/3 通过，无 shader/page error；覆盖 Medium 灯笼与刷新持久化、High 平面反射、Low 关闭高级效果。
- Midscene `advanced-lighting-water.yaml`：最终 High 与 Low 两项全部通过；中间失败用于修正 mipmap cutout、水镜头、反射权重和灯笼过曝，未伪造为首次通过。
- `git diff --check`：通过。

已知限制：尚未在 1920×1080 headed Chrome 做父 change 的同路线性能采样；平面反射只跟踪玩家附近最近的一层水平水面；水流、SSR/GI 与生存配方入口不在本 change。Midscene、`dist/` 和测试运行产物均不提交。
