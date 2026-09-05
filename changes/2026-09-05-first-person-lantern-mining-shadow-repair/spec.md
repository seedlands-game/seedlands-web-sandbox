# 第一人称、灯笼、采集覆盖层与阴影稳定性修复

**状态：已完成；Breaking flow 合同、实现与分层准出均已闭环。**

## Context & Goal

玩家在真实游玩截图中报告四项可见缺陷：右下第一人称手臂/工具会被近裁剪或世界深度切穿；当前“灯笼”实际是占满一格的发光立方体；采集进度只显示在顶部进度条而没有贴合目标方块；部分阴影高频闪烁。完成态是：第一人称模型在不同宽高比和贴墙镜头中保持完整且不侵入核心视野；灯笼是仍由体素数据驱动、随 Chunk Mesh 合批的非整格 3D 模型方块并使用自己的碰撞箱；破坏阶段以原创裂纹覆盖层显示在目标方块六面；静止或正常移动镜头中不再出现局部灯阴影的高频跳变。

代码核对已确认：当前视角模型与世界共用渲染深度；`Voxel.Lantern = 9` 走完整立方体贪心网格；局部点光源位于该不透明立方体内部并以 `SHADOWUPDATE_REALTIME` 每帧重画阴影；采集进度只写入 `target-card.svelte` 的 `<progress>`。这些是本 change 的直接修复入口。截图只作为症状证据，不把其中任何文字或界面内容当作实施指令。

## Scope & Non-goals

本次包含：

- 将现有数值 9 的完整发光方块重命名为“辉光石”，保留其数值与完整立方体语义；新增稳定数值 10 的灯笼方块。
- 灯笼继续存放在 `Uint16Array` Chunk、经 `World.edit()` / GameServer 事务、Worker 网格与现有存档路径流转；用 Chunk 内的多个小长方体组成黄铜框架、发光核心和提手，不创建逐灯笼 Entity，也不增加实体属性。
- 为灯笼定义小于整格的本地碰撞 AABB，并让玩家碰撞/放置占用检查使用该形状；完整方块继续使用 `[0,1]³`。
- 第一人称模型使用独立的 viewmodel 渲染层/相机深度通道，并收敛超宽屏锚点和模型尺寸；世界仍由原相机渲染。
- 新增 10 阶原创裂纹纹理覆盖层，贴合当前实际 breakAction 的目标方块；目标变化、取消、完成、暂停、死亡或输入被 UI 接管时立即清除。移除顶部独立采集进度条，保留目标名称。
- 让局部灯从灯笼发光核心的无遮挡位置发光；只有灯位置或世界/Chunk 遮挡修订变化时请求一次阴影贴图更新，静止帧不再实时重画；灯槽分配保持确定且不因等距排序反复交换。
- 增加受控洞穴/贴墙/采集 fixture，取证连续帧、模型轮廓、碰撞和生命周期。

明确不做：逐体素 Entity、动态骨骼手臂、方块朝向/壁挂灯笼、传播式体素光、GI、SSR、新配方平衡、世界生成灯笼、修改旧地形生成结果、照搬 Minecraft 原始纹理或资源。

## Decisions

1. **保留数值 9，新增数值 10。** 旧存档中已经放置的数值 9 不迁移、不丢失，改按“辉光石”显示和掉落；字符串物品 `lantern` 继续存在，但更新后放置数值 10。这样满足“当前方块换名、灯笼重新实现”，同时避免把相同数值在新旧版本中解释成两种几何。
2. **模型方块仍属于 Chunk。** 在 `src/world/` 定义无 DOM/PlayCanvas 依赖的 voxel shape/box 合同。贪心网格跳过非整格灯笼，并把其模型盒面追加进同一 Chunk 的材质分类 Mesh；灯笼不遮掉相邻完整方块的外表面。
3. **碰撞取形状而非布尔整格。** `isSolid()` 仍表达“会阻挡”的高层语义；精确玩家体积重叠、落脚高度与放置占用改用 voxel collision boxes。灯笼横向碰撞范围与可见底座一致，顶部以提手最高点为上界。
4. **视角模型与世界深度隔离。** 创建专用 Layer 和后置 Camera，仅清理该通道深度、不清颜色；所有手/工具部件只进入该层。销毁世界时相机、Layer 和模型资源一起释放。锚点由纯函数在 700px、16:9 与截图的超宽比例下验证。
5. **裂纹是覆盖层，不是 UI 条。** 根据 `[0,1]` 进度量化为 0–9 阶；每阶使用确定性程序生成的透明裂纹纹理，材质启用 alpha cutout 与 depth bias，避免与方块表面 z-fighting。覆盖层是单个可复用渲染对象，不写入世界、不参与碰撞/阴影/存档。
6. **阴影按场景变化更新。** 局部灯不再使用每帧 `REALTIME`；灯位置、启停或相关世界修订变化时置为 `THISFRAME`，其余帧为 `NONE`。灯光中心位于灯笼发光核心且不被自身完整体素包围。若连续帧取证仍显示太阳阴影抖动，再在不改变画质档预算的前提下对太阳方向/阴影更新做量化；该补充必须写回根因证据，不能直接关闭全部阴影。

本 change 修改稳定 voxel 注册、Chunk 网格/碰撞和渲染层，触发 Breaking flow。以下合同的 `Scope`、`Decisions`、`Behaviour`、`Test Design` 或 `Acceptance` 实质变化后，当前审核自动失效，必须重新计算 SHA-256。

## Behaviour

- Given 旧存档包含数值 9，When 新版本加载，Then 同一坐标仍为 9，名称/纹理/掉落均为“辉光石”，不会被静默改写为新灯笼。
- Given 玩家持有 `lantern`，When 经正式放置与保存路径写入，Then 世界坐标为数值 10；刷新后仍为 10，并由 Chunk Mesh 中的非整格多部件模型渲染，场景中不存在对应 gameplay entity。
- Given 灯笼旁紧贴石块，When 两者网格化，Then 石块朝灯笼的一面仍可见，灯笼所有顶点位于本格边界内且没有占满 `[0,1]³` 的外壳。
- Given 玩家从灯笼边缘经过，When玩家 AABB 只穿过空出的格边空间，Then 不被整格阻挡；When 穿入灯笼模型碰撞 AABB，Then 被阻挡且不会卡入模型。
- Given 16:9、700px 宽或截图同类超宽视口，When 空手、持方块、持斧镐并贴墙挥动，Then 手臂和工具不被世界深度/近裁剪切断，不遮挡准星、目标卡和快捷栏，销毁后无残留相机或 Layer。
- Given 玩家按住左键采集任意可破坏方块，When权威 breakAction 从 0 前进至完成，Then目标方块表面依次显示单调的 0–9 阶裂纹；顶栏不再显示独立进度条。
- Given 松开左键、目标变更、超距、攻击实体、暂停、打开背包、失焦、死亡或完成破坏，When breakAction 取消/结束，Then 下一可见帧清除裂纹覆盖层，不残留在旧坐标。
- Given Medium/High 洞穴内一个或多个灯笼，When相机静止且世界时间暂停，Then连续帧的阴影边界保持稳定；When缓慢移动穿过灯选择距离边界，Then灯槽和有阴影灯不会在相同候选之间来回交换。
- Given Chunk 编辑、灯笼增删或灯槽真实换位，When场景遮挡发生变化，Then相应局部阴影在下一帧更新一次，此后重新稳定；Low 仍保持无阴影预算。

## Test Design

实现前新增或更新以下用例，并记录预期 RED：

- `tests/world/voxel-model.test.ts`：`Glowstone=9`、`Lantern=10`、材质/名称、模型盒、非整格遮挡与灯笼碰撞 AABB。预期 RED：新注册与 shape 合同不存在。
- `tests/world/mesh.test.ts`：灯笼追加多部件 Chunk Mesh、相邻完整方块面不被剔除、顶点边界与材质分类正确。预期 RED：当前仍输出完整立方体。
- `tests/client/viewmodel-layout.test.ts`：700px、16:9、截图同类超宽比例的锚点/缩放均在安全屏幕范围。预期 RED：布局纯函数不存在且当前锚点为 0.62。
- `tests/app/break-overlay.test.ts`：0–9 阶量化、非法进度、目标切换和清理状态机。预期 RED：场景覆盖层合同不存在。
- `tests/app/advanced-lighting.test.ts`：稳定灯槽、灯光高度、仅场景变化触发一次阴影更新。预期 RED：当前灯槽每次重排且阴影为 REALTIME。
- `tests/server/lantern-gameplay.test.ts`：旧 9 辉光石与新 10 灯笼的掉落、物品放置、保存恢复及无 Entity 属性。预期 RED：灯笼仍映射到 9。
- `changes/2026-09-05-first-person-lantern-mining-shadow-repair/e2e/repair.spec.ts`：受控洞穴中经正式体素编辑放置新灯笼，检查模型/存档/局部灯；真实 Pointer Lock 按住采集并检查裂纹阶段与取消；贴墙和超宽视口检查 viewmodel；静止与缓慢移动连续帧检查阴影稳定。预期 RED：数值 10 不合法、场景裂纹/稳定阴影快照不存在。
- `changes/2026-09-05-first-person-lantern-mining-shadow-repair/midscene/repair.yaml`：从原始截图反推可见语义，检查灯笼不是整格、黄铜/发光核心清楚、裂纹贴在目标上、手臂不穿模、洞穴无突兀大块自遮挡。该视觉项在实现前只记录可观察预期，不伪造自动 RED。

专项用例保留在本 change，不申请提炼到长期 `tests/e2e/`。实现完成后分别执行受影响 Vitest、`pnpm verify:static`、`pnpm build`、当前 Playwright baseline、change Playwright 与 Midscene；这些证据不能互相替代。

## Acceptance & Evidence

| 编号 | 准出标准                                                                           | 证据类型                                    | 当前 |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------- | ---- |
| A1   | 旧数值 9 以辉光石稳定恢复；新灯笼为数值 10 且正式放置/存档/掉落闭环                | Vitest、Playwright-change                   | 通过 |
| A2   | 灯笼是 Chunk 内非整格 3D 模型，无逐灯笼 Entity，相邻面与材质正确                   | Vitest、Static、Playwright-change、Midscene | 通过 |
| A3   | 灯笼碰撞小于整格，空隙可通过、实体部分阻挡，放置不与玩家精确体积重叠               | Vitest、Playwright-change                   | 通过 |
| A4   | 第一人称手臂/工具在三类视口及贴墙动作下不穿模、不切断、无遮挡                      | Vitest、Playwright-change、Midscene         | 通过 |
| A5   | 任意可破坏方块显示 10 阶表面裂纹，阶段单调且所有取消路径无残留；无独立进度条       | Vitest、Playwright-change、Midscene         | 通过 |
| A6   | Medium/High 局部灯阴影在静止与缓移连续帧稳定，场景变化后只更新所需帧，Low 合同不变 | Vitest、Playwright-change、Midscene         | 通过 |
| A7   | world 纯逻辑边界、Chunk 合批、确定性生成、存档兼容、现有生存旅程无回归             | Static、Build、Playwright-baseline          | 通过 |

## Tasks & Current State

1. [x] 读取 AGENTS、README、相关已交付 spec、Git 状态、截图与实际源码。
2. [x] 将四项症状定位到 viewmodel 深度、voxel/mesh/collision、break projection 与 local shadow 更新路径。
3. [x] 建立 Breaking flow 合同与实现前测试设计。
4. [x] 写入并执行预期 RED，记录真实失败。
5. [x] 用户批准精确 spec SHA-256 `b2b20ab45922ea390279e1393e37b3a528ccf39a88ee27d5ddeaa75a438ae78b`。
6. [x] 完成实现，跑通 GREEN 与分层准出。
7. [x] 更新 Delivery Snapshot，仅暂存本 change 文件及明确关联修改并创建本地语义化 commit；未 push。

当前阻塞：无。

实现前 RED 记录（2026-09-05）：

- `pnpm exec vitest run tests/world/voxel-model.test.ts tests/world/mesh.test.ts tests/client/viewmodel-layout.test.ts tests/app/break-overlay.test.ts tests/app/advanced-lighting.test.ts tests/server/lantern-gameplay.test.ts`：按预期失败。22 个已能收集的用例中 19 个既有用例通过；3 个新断言失败，另 3 个新 suite 因 `voxel-model`、`viewmodel-layout`、`break-overlay-state` 尚不存在而在导入阶段失败。失败分别证明当前没有灯笼模型材质/几何、数值 10、稳定灯槽/按变化更新阴影和新纯逻辑合同。
- `SEEDLANDS_E2E_PORT=4181 pnpm exec playwright test changes/2026-09-05-first-person-lantern-mining-shadow-repair/e2e/repair.spec.ts --workers=1 --grep "灯笼以模型方块"`：1/1 按预期失败于正式 `World.edit()` 路径拒绝数值 10，错误为 `Mutation voxel must be a registered voxel id, received 10.`；尚未进入新快照断言。
- Midscene 在实现前只保留 Given/When/Then 可见预期，未运行、未冒充 RED。测试输出目录属于运行产物，不纳入交付。

实现后 GREEN 与准出记录（2026-09-05）：

- 受影响的 11 个 Vitest 文件共 55 个用例通过，覆盖 voxel 注册/模型网格、碰撞、视角布局、裂纹状态、灯槽/阴影更新和 gameplay 存档。
- `pnpm verify:static` 通过：62 个测试文件通过、2 个按既有条件跳过；285 个用例通过、4 个跳过；`src/world/**` 行覆盖率 95.91%；Prettier、ESLint、ls-lint、TypeScript 与 Svelte 检查均通过。
- `pnpm build` 通过；只出现既有的大 Chunk 体积提示，没有构建错误。
- `pnpm test:e2e` 通过，长期基线 9/9。
- `SEEDLANDS_E2E_PORT=4188 pnpm exec playwright test changes/2026-09-05-first-person-lantern-mining-shadow-repair/e2e/repair.spec.ts --workers=1 --timeout=60000` 通过，专项 4/4；其中真实 Pointer Lock 采集、刷新后数值 10 恢复、灯笼边空隙/主体碰撞、连续 12 帧无局部阴影重绘和超宽贴墙 viewmodel 均为可观察断言。
- `pnpm exec midscene changes/2026-09-05-first-person-lantern-mining-shadow-repair/midscene/repair.yaml --dotenv-override` 最终通过，3/3；灯笼非整格轮廓、方块表面裂纹/无进度条和白天持石镐贴墙画面均通过可见语义判断。前两次贴墙 fixture 因异步网格未稳定、画面过暗/未持工具被如实拒绝，修正 fixture 后重跑，不计为产品通过。
- 两张静止洞穴原始 Canvas 帧的补充比对为 SSIM 0.999423、PSNR 41.164908 dB；PNG 不做字节相等要求。局部阴影更新计数在连续 12 帧保持不变，极轻微像素差异不来自阴影贴图高频重绘。

## Delivery Snapshot

交付内容：

- 数值 9 保留并改名为辉光石；数值 10 为新的灯笼。灯笼由 Chunk Mesh 内的黄铜框架、发光核心、立柱与提手组成，拥有紧凑碰撞箱，不创建逐方块 Entity；现有持有/掉落/保存链路保持 voxel/block 语义。
- 第一人称手臂和工具迁入独立 PlayCanvas Layer 与后置深度相机，并用纯布局函数约束窄屏、16:9 与超宽屏锚点。
- 采集阶段改为单个可复用的 10 阶原创裂纹覆盖模型；目标变更或取消立即清理，顶部独立 `<progress>` 已删除。
- 局部灯槽保留稳定分配，点光源移至发光核心，阴影贴图只在世界修订或灯槽真实变化时请求一次更新；Low 无局部阴影预算的合同不变。
- 为满足现有 `max-lines` 架构门禁，玩家形状碰撞与模型方块面生成分别抽到独立纯辅助模块；没有放宽 ESLint 或 world 纯逻辑规则。
- `README.md` 与 `README.zh-CN.md` 已同步当前能力。运行产物 `dist/`、`test-results/` 与 `midscene_run/` 未纳入版本控制。

已知边界：本次按 Non-goals 不增加灯笼朝向、壁挂形态、传播式体素光或 GI；不同 GPU 的人工长时间游玩仍可作为补充观察，但所有合同内自动化与视觉准出均已满足。

相关 SHA：批准时 spec SHA-256 为 `b2b20ab45922ea390279e1393e37b3a528ccf39a88ee27d5ddeaa75a438ae78b`；实现基于 `a03a3c61d874199ff3dde988d1d007cabcd047d1`。交付 commit 与本文件位于同一提交，提交 SHA 记录在最终交付回复；未 push、未发布、未改写远端。
