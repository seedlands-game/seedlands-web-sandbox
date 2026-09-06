# MVP体验修复视觉语义验收记录

## 准备状态

- Midscene 合同：`changes/2026-09-05-mvp-experience-repair/midscene/experience-repair.yaml`。
- 目标地址固定为主 agent 指定的 `http://127.0.0.1:4260/?harness=1`；最终命令将以 `--dotenv-override --summary /tmp/seedlands-experience-repair-midscene.json` 运行。
- 已有可追溯游戏帧：`evidence/presentation-1280x720.png`、`presentation-1920x1080.png`、`presentation-700x720.png`、`world-1920.png`、`pause-1920.png`、`settings-1920.png` 和模型近景帧。
- 用户原型 image3 已从 `/var/folders/bt/s2j98jm12_d5yylsv3vx8znh0000gn/T/codex-clipboard-d85f84fb-4c2c-4364-b2c5-1d519c463003.png` 复制到 `/tmp/seedlands-experience-repair-gallery/prototype-image3.png`；并排页为 `/tmp/seedlands-experience-repair-gallery/index.html`，不属于生产资源或交付证据。

## 当前最终矩阵

| 范围       | 最终证据                                                   | 当前状态                          |
| ---------- | ---------------------------------------------------------- | --------------------------------- |
| HUD        | 原型同页 Midscene `1/1`、最终 live Midscene                | 通过                              |
| 持握和实体 | `model-visual.spec.ts`、生产正侧背同页 Midscene、最终 live | 通过                              |
| 目标       | 最终 live：卡片、进度与 `z=-3` 单方块轮廓                  | 通过                              |
| 暂停       | 最终 live Midscene；菜单/设置另有原始帧人工补充            | 通过（暂停）；菜单/设置为人工补充 |
| 水与太阳   | 最终 live：无侧面镜像墙；太阳正对可见、转 180° 消失        | 通过                              |

## 冻结前对照观察

- 原型的核心语言是黑曜石纹理面、细黄铜边、居中的青宝石纹章与青色主要操作；当前 `pause-1920.png` 已有相同的框架、纹章和按钮层次，最终仍需以冻结后的实时帧确认。
- `world-1920.png` 是刻意打开 F3 的调试取证帧，右侧实体标签和左侧调试面板不能作为正常 HUD 的缺陷结论；正常模式须由最终 Midscene 单独观察。
- `presentation-1920x1080.png` 的生物近景在空背景中取证，不能证明林地落地或完整世界构图。它不作为 R3/R4 的最终通过证据。
- 尚未取得冻结后的顶部目标卡片、采集进度、太阳转头前后和水侧面原始帧，因而这些项目当前均为待验收，不标记通过。
- 模型持握帧在主 agent 视觉冻结前可能被重写；本地对照页以符号链接实时引用 `evidence/world-wood-axe-1920.png` 与 `evidence/world-stone-pickaxe-1920.png`。旧的无手帧不得用于 PASS；最终必须直接观察手掌包住工具柄。
- 新 `world-1920.png` 预审：右下手掌与青色袖口可见，手掌覆盖木斧柄下部，持握不再是“有工具无手”；HUD 是八格紧凑栏，心/肉图标位于其上方，未见常规 F3 标签。该帧尚未覆盖三类实体和掉落物，不能替代模型场景取证。
- 新 `pause-1920.png` 与 `settings-1920.png` 预审：中央黑曜石纹理面板、细黄铜边、青宝石纹章、青色主按钮和暗色次按钮均可见；面板贴合内容，背景仍可辨。未发现可独立复现的 P1/P2；最终 Midscene 仍会重新判断。
- `e2e/model-visual.spec.ts` 已预置：通过正式 `spawn-actor` 生成林鹿、夜行兽、营地居民，正式 `spawn-world-item` 生成灯笼掉落物，并轮询服务端实体原型/类别和掉落位置后保存同场生产截图。它不以 preview 模型替代生产 Presenter。

## 缺陷分级

- P1：视觉合同核心项缺失、被遮挡、与原型材料语言明显冲突或误导游戏状态。
- P2：比例、间距、材质层次或轮廓可辨性不足，但核心操作和状态仍正确。
- 最终仅在实际 Midscene 输出、原始截图和原型并排复核后填写具体编号；此准备记录不宣称任何 PASS。

## 冻结轮次实际结果（等待水体修复后的最终复验）

- Playwright-change：`env -u CI SEEDLANDS_E2E_PORT=4260 corepack pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/model-visual.spec.ts --retries=0` 通过 `1/1`。正式 Harness 在网格与渲染队列稳定后生成林鹿、夜行兽、营地居民与灯笼掉落物，轮询服务端 archetype/type/stack 和掉落位置后保存 `evidence/models-production-1920.png`。真实 `Digit1` / `Digit2` 选择分别刷新 `world-wood-axe-1920.png` 与 `world-stone-pickaxe-1920.png`，两帧都有手掌、袖口和握住柄的工具。
- Midscene：首次因 YAML JavaScript 顶层 `await` 不被 runner 支持而 RED；移除后第二次在 HUD 材料断言 RED，任务于第一项中止，报告为 `midscene_run/report/experience-repair-2026-09-05_14-28-26-6e245d76.html`，摘要为 `/tmp/seedlands-experience-repair-midscene.json`。未执行目标、水面、太阳或暂停的 Midscene 断言，不能以该运行覆盖它们。
- **P1-视觉-01：** Midscene 实际判断 HUD 为深色半透明方块、白色边线和数字，未能识别原型要求的黑曜石纹理、细黄铜边和青宝石强调。该结果与 R4 的材料与层级合同冲突；在主 agent 允许视觉修正并重新冻结前保持未通过。
- 模型图目的仅证明真实生产 Presenter 的实体、掉落物和手持连接；其受控平地/天空构图不替代林地世界整体美术判断。

## 14:48 最终冻结轮次（当前真实结果）

- 执行时间：2026-09-05 14:48（本机时区）。命令：`env -u CI 'VOXEL_SANDBOX_URL=http://127.0.0.1:4260/?harness=1' corepack pnpm exec midscene changes/2026-09-05-mvp-experience-repair/midscene/experience-repair.yaml --dotenv-override --summary /tmp/repair-semantic-final.json`。
- 本次可审计输出：`/tmp/repair-semantic-final.json`、`midscene_run/output/experience-repair-1788590913358.json`、`midscene_run/report/experience-repair-2026-09-05_14-48-33-4560a411.html`。它不是 14:28 的旧运行。
- 结果：首个 HUD 材料断言仍 RED，后续目标、水面、太阳、暂停任务因 bail limit 未执行。模型的原文判断为槽位深色半透明矩形、浅色边框、未观察到明显细黄铜边或青宝石强调；因此本次 Midscene 不能宣称 R4 或整份视觉合同 GREEN。
- 同一冻结后的 `evidence/world-wood-axe-1920.png`（14:44:53）目视对照显示八个槽位确有黑曜石底、黄铜角饰和选中槽的青色高光；木斧的手掌/袖口连接与灯笼上沿提把也可见。该手工观察不能覆盖 Midscene RED，只说明视觉模型对小尺寸装饰的判断与原始帧的人工复核存在分歧。
- 与用户原型 image3 的逐项对照：紧凑八槽、心/肉上置、黑暗底色、黄铜框架和青色选中语义均有对应；原型的更强层次、宝石纹章细节、世界构图与高密度材质仍未由这轮 Midscene 证明。保持 P1-视觉-01 未关闭。

## 原型与当前同页对照（14:58）

- 输入页：`/tmp/seedlands-experience-repair-gallery/index.html`，左列为用户原型 image3，右列为冻结后 `evidence/world-1920.png`，下列为从该实际帧裁出的 HUD/持握放大图；没有混入预览模型或旧 HUD。
- Midscene：`env -u CI corepack pnpm exec midscene /tmp/seedlands-experience-repair-gallery/compare.yaml --dotenv-override --summary /tmp/repair-prototype-compare.json`，通过 `1/1`。报告：`midscene_run/report/compare-2026-09-05_14-58-39-986e1426.html`；输出：`midscene_run/output/compare-1788591519069.json`。
- 实际结论：当前画面与原型共享八个正方快捷槽、上置心/肉、深色底、黄铜角饰和青色选中语义；放大图确认八格数字键清楚，右侧手与工具未压住栏位。原型特有的高密度背景插画、完整纹章和更强的装饰层次仍是参考，不被记作当前已实现内容。目标、水、太阳和菜单没有出现在此同页比较中，仍需独立 live Midscene。

## 15:04 生产模型同页与最终 live 轮次

- `midscene/model-production-compare.yaml` 在正式 Harness 的三张正侧背生产帧上通过 `1/1`；报告为 `midscene_run/report/model-production-compare-2026-09-05_15-04-12-880e1949.html`。它确认林鹿、夜行兽、营地居民和落地灯笼的正侧背形体可辨；受控平台不作为完整世界美术通过证据。
- 最终 live 命令：`env -u CI 'VOXEL_SANDBOX_URL=http://127.0.0.1:4260/?harness=1' corepack pnpm exec midscene changes/2026-09-05-mvp-experience-repair/midscene/experience-repair.yaml --dotenv-override --summary /tmp/repair-live-final.json`。本轮摘要生成时间为 15:04:49，报告为 `midscene_run/report/experience-repair-2026-09-05_15-04-19-2b9cf316.html`。
- live 结果：HUD、持握与正常无 F3 标签的首任务通过；目标卡片显示方块图、名称且与时钟/准星分离的客观部分通过，但视觉模型未识别明显黑曜石/黄铜/青宝石材料，目标卡片材料断言 RED 并使后续水、太阳、暂停任务未执行。该项保持未通过，不能用同页 HUD 或模型对照替代。

## 15:08 目标卡片修正后 live 轮次

| 项目                 | 实际结论                                                         | 状态               |
| -------------------- | ---------------------------------------------------------------- | ------------------ |
| HUD、持握、正常无 F3 | 通过首任务；八槽、状态图标、木斧握持和无实体调试标签均被本轮观察 | 已解决             |
| 目标卡片材料         | 本轮已越过此前材料断言；卡片显示方块图、名称且与时钟/准星分离    | 已解决             |
| 目标三维轮廓         | Midscene 实际帧未观察到包围命中泥土的三维轮廓线                  | 未解决：P1-视觉-02 |
| 水、太阳、暂停       | 因轮廓断言触发 bail 未执行                                       | 待独立复验         |

- 本轮命令：`env -u CI 'VOXEL_SANDBOX_URL=http://127.0.0.1:4260/?harness=1' corepack pnpm exec midscene changes/2026-09-05-mvp-experience-repair/midscene/experience-repair.yaml --dotenv-override --summary /tmp/repair-live-after-target.json`。
- 可追溯 summary 副本：`evidence/midscene-live-after-target-summary.json`；报告：`midscene_run/report/experience-repair-2026-09-05_15-08-43-85ab2e24.html`；输出：`midscene_run/output/experience-repair-1788592123559.json`。
- 轮廓 RED 的完整可见判定：画面有“泥土”目标信息和采集进度，但未显示单方块三维轮廓线；因此没有把 target card 的材料修正错误地扩展为 R6 全部通过。

## 最终 live 验收（15:16）

| 项目                | 实际结果                                                                                                 | 状态   |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| HUD、持握、正常 HUD | 八槽、状态图标、黑曜石/黄铜语言、手持不遮挡、无 F3 标签均通过                                            | 已解决 |
| 顶部目标卡片        | 方块图、名称、进度、材料语言与时钟/准星分离通过                                                          | 已解决 |
| 目标三维轮廓        | 将 fixture 从近距 `z=-1` 调至网格完成的 `z=-3` 后，黑色轮廓紧贴单方块并通过                              | 已解决 |
| 水侧面              | 蓝绿色半透明水面、岸边正向材质、无镜像墙/黑矩形通过                                                      | 已解决 |
| 太阳                | 时间 09:00 后按权威 `sunSnapshot.direction` 算得 `yaw≈-80`、`pitch≈45`；正对画面可见太阳，转 180° 后消失 | 已解决 |
| 暂停菜单            | 紧凑面板、金属边、宝石纹章、青色主按钮、隐藏手持 HUD 通过                                                | 已解决 |

- 最终命令：`env -u CI 'VOXEL_SANDBOX_URL=http://127.0.0.1:4260/?harness=1' corepack pnpm exec midscene changes/2026-09-05-mvp-experience-repair/midscene/experience-repair.yaml --dotenv-override --summary /tmp/repair-live-sun-direction-final.json`。
- 结果：通过 `1/1`，生成时间 2026-09-05 15:16:45。可追溯 summary 副本为 `evidence/midscene-live-final-summary.json`；报告为 `midscene_run/report/experience-repair-2026-09-05_15-16-01-cdebe0d3.html`；输出为 `midscene_run/output/experience-repair-1788592561075.json`。
- 早期 P1-视觉-01（HUD 材料）与 P1-视觉-02（轮廓）均已由后续真实 live 帧解决；旧失败保留为定位历史，不作为最终状态。
