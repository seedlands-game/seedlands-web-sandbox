# 流体子系统设计与交付记录

## 背景与目标

当前水只由基础生成器写成静态满方块。挖开岸壁后不会流动，透明水侧面又与同一水平面的平面反射叠加，形成悬空水墙和侧面重影。本子任务增加服务端权威、确定性且有界的体素水模拟，并让网格明确区分水面与水侧面。

## 范围与明确不做

- 实现源水、向下落水、受阻后的四向扩散、障碍改道、源移除回退和跨 Chunk 传播。
- 每个流体步只消费固定上限的活动队列，不扫描整个世界；全部水体写入都经 `GameServer.edit()`。
- 保留 `GENERATOR_VERSION = 2` 和 `Voxel.Water = 8`。动态状态使用独立水位 sidecar，不重解释现有体素数值。
- Chunk 快照可选携带 `fluidVersion: 1` 与紧凑 `Uint8Array` sidecar；旧快照没有 sidecar 时，现有水按满级静态源恢复。
- 不实现压力、无限水、黏度、海浪或联机同步。

## 关键决策

- 水位为 `1..8`；8 是源水/满水，横向每格衰减 1，落水保持供给水位。sidecar 低四位保存水位，最高位保存源标记。
- 队列使用坐标去重的 FIFO。固定步长 `0.1s`，每步最多处理 128 个位置，单次调用最多补算 8 步，避免长帧产生无界工作。
- 外部编辑写入水时登记为源；模拟内部写入先登记 sidecar，再调用权威 `edit()`。任何编辑激活自身和六邻域。
- 非源水每步根据上方供给或同层四邻域最高水位重算；无供给则降低/消失。下方空气优先接收落水，存在下落出口时不横向铺开。
- 暴露水网格顶面降低到方块高度的 `7/8`；上方仍有水时下层单元填满到 `1`，避免瀑布逐层出现空气缝。相邻不同水位只生成从低水面到高水面的差值侧面。仅顶面使用反射强度，侧面反射为零并保持透明深度排序，避免垂直镜像墙。

## 行为

- Given 空中源水，When 推进流体，Then 水先逐格向下落，落到固体后才横向扩散。
- Given 水池壁有缺口，When 激活缺口邻域，Then 水穿过缺口并在较低处扩散；新障碍不会被水覆盖。
- Given 孤立流水失去源，When 继续推进，Then 水位逐步回退并最终变为空气。
- Given 水跨越 `x=31/32`，When 推进和保存重载，Then 两侧状态、水位和源标记一致恢复。
- Given 旧 Chunk 快照没有流体字段，When 加载，Then 水保持为满级兼容源且基础世界版本不变。

## 测试设计

- `tests/server/voxel-fluid-runtime.test.ts`：下落优先、横向衰减、障碍、源移除回退、确定性、单步预算、跨 Chunk、快照与旧档兼容。生产实现前预期因模块/API 缺失而 RED。
- `tests/world/water-mesh.test.ts`：水顶面高度低于整方块、相邻水面不生成内部面、边界 halo 正确。生产实现前预期顶面仍为 `1` 而 RED。
- `changes/2026-09-05-mvp-experience-repair/e2e/fluid-world.spec.ts`：由主接线完成后验证真实生产 update、缺口与可观察网格；不并行运行性能浏览器任务。

## 准出与证据

| 准出条件                           | 证据                        | 结果                                                                              |
| ---------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| 下落、扩散、阻挡、回退确定且有界   | Vitest                      | focused Vitest 通过                                                               |
| 跨 Chunk 与新旧快照恢复            | Vitest、Playwright-change   | focused Vitest 与真实浏览器重载 E2E 通过                                          |
| 水顶面与侧面几何不再是完整水立方体 | Vitest、Playwright-change   | 水位 sidecar 已贯通两条 worker mesh 路径，网格与浏览器 E2E 通过                   |
| 仅合适的水上表面混合平面反射       | Playwright-change、Midscene | shader 按上向法线与 Fresnel 混合；截图可见透明水侧面无镜面重影，Midscene 待主任务 |
| 生产构建                           | Build                       | 由主任务统一执行                                                                  |

## 任务与当前状态

- [x] 定义数据编码、队列预算和接线接口。
- [x] 建立 RED 测试。
- [x] 实现 runtime、GameServer sidecar/快照和完整 worker 水位网格链路。
- [x] focused GREEN 与需求 E2E。

## 交付快照

新增 `src/server/fluid/voxel-fluid-runtime.ts`，并在 `GameServer`、Chunk 快照、浏览器 persistence worker、main-snapshot/worker-first 网格链路与水反射 shader 中接入。活动与清理队列各限制 8192 个坐标，只接受浏览器可加载的 `y=0..63`，每步最多处理 128 个位置。后续工程审阅补上水位元数据 commit、恢复队列、连续水柱、不同水位差值侧面与活动窗口约束：流体读取使用不创建 Chunk 的 peek；`World.updateStreaming()` 明确下发活动 Chunk 集；未加载边界暂停；main-snapshot、持久化恢复与 worker-first canonical 到达时均重新激活新 Chunk 水体及边界外已有水。相关 4 文件 29 项 focused 测试通过（含四格水柱 greedy 侧面范围与 worker-first 边界续流），流体与太阳两条 Playwright-change 独立通过。流体 E2E 验证封闭池壁阻挡、打开跨 Chunk 缺口、level 6 流水、IndexedDB 真重载恢复、源移除回退及反射激活；截图门槛要求超过 4 个 Chunk、至少 50 个三角形，且生成、网格、延迟重网格与 GPU 上传队列全部清空。最新证据图可见石质池壁、池内水面和缺口外连续阶梯水流；水列没有逐层空气缝，高低水位之间由透明差值侧面封合，没有平面反射重影。太阳 E2E 验证固定时间方向不随视角变化、屏幕投影移动、背向不可见。截图已保存到 `evidence/fluid-level-and-reflection.png`、`evidence/world-sun-forward.png` 与 `evidence/world-sun-away.png`。此前完整 `pnpm test:coverage` 通过：58 个文件中 56 通过、2 跳过，260 项中 256 通过、4 跳过，world 行覆盖率 95.61%，日志为 `/tmp/seedlands-fluid-coverage.log`；最终整合 coverage 由主任务重跑。完整 `pnpm lint`、`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。

## 世界空间太阳补充合同

### 背景与目标

旧实现只写入 `--sun-x/--sun-y` 屏幕 CSS 变量，太阳没有世界空间实体，固定时间转动视角时会像屏幕贴纸。改为由共享世界时间计算唯一的世界方向，并用与方向光同一时间状态的天空实体呈现。

### 行为与测试设计

- Given 固定世界时间，When 玩家转头或俯仰，Then 太阳相对世界方位不变，在屏幕上随相机投影移动，背向时离开视锥，不再固定于屏幕坐标。
- Given 时间推进，When 太阳方向变化，Then 天空太阳、方向光颜色/强度与阴影方向使用同一世界时间。
- 太阳是有深度的世界天空几何，可被近景遮挡；不得用提高全屏天空亮度冒充。
- `changes/2026-09-05-mvp-experience-repair/e2e/world-sun.spec.ts` 在主 Harness 暴露可观察投影后验证固定时间的正向、侧向和背向视角。
- UI CSS 中若存在 `--sun-x/--sun-y` 或伪元素太阳，应由主任务删除；本子任务停止写这两个变量。
