# 修复版验证记录

## 证据口径

本轮测试在 `codex/playable-world-mvp` 未提交修复工作区执行。原 HEAD 为 `f67cea6`，不把该 HEAD 单独标为本轮实现身份；最终性能记录含生产输入 SHA-256，与交付提交关联。旧父合同的 60 分钟长测保持原源码归属，本轮没有冒称重跑该长测。

## 已执行

- 实现期单元/算法 RED → GREEN 的具体原因见 `interaction-design.md`、`fluid-design.md`、`reflection-design.md`、`model-design.md` 及本目录专项复核。
- 全量静态检查：273 项单元通过、4 项既有环境条件跳过；world 行覆盖率 95.69%；Svelte 零错误/警告。最终提交前再次执行 `CI=true corepack pnpm verify:static`，退出0，58个测试文件通过、2个既有条件跳过，273项通过、4项跳过，格式/ESLint/路径/覆盖率/类型全部通过。
- 生产构建通过，保留既有主 bundle 大于 500 kB 的体积提示，无构建错误。
- 功能 Playwright-change：首次全套 17 通过、1 失败、1 性能待独占跳过。失败是坐标 `59.599998474121094` 与 `59.6` 严格相等断言，不是未到达站立点；改为 0.0001 米容差后真实落地/移除支撑/吸附专项 1/1 通过。其余通过项包括连续采集的四种中断、输入、目标/遮挡、流体与水位存档、三类模型、四种尺寸、暂停和世界方向太阳。
- 长期基线 `env -u CI SEEDLANDS_E2E_PORT=4260 pnpm harness:e2e`：9/9 通过，20.3 秒；包含基线浏览器性能采样与真实 Pointer Lock、移动/跳跃、平地、中心挖空、下台阶、持久化及跨 Chunk streaming。
- 原型同页对照和模型正/侧/背图的 Midscene 均 1/1 通过；实时视觉的失败与修订逐轮保留在 `semantic-visual-qa.md`，最终结论未被早期通过替代。

## 最终功能与视觉收口

完整自然旅程命令：`SEEDLANDS_E2E_PORT=4277 CI=true corepack pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/natural-journey.spec.ts --grep "修复版自然资源" --retries=0`，1/1通过、2.2分钟、进程退出0。自然采集、GUI合成/进食、精确体素建造、动态敌人真实受伤和死亡、存退后建筑/灯光/敌人/饥饿/库存一致均逐项断言；F3与Harness仅只读观察，不生成资源或移动玩家。末帧 `natural-save-continue.png` 为诊断记录，非独立美观验收。

最后 live Midscene `experience-repair.yaml`：1/1通过、44.283秒；对应 `midscene-live-final-summary.json`。原型同页配对、模型正侧背对照亦各1/1通过，失败历史与修复均保留，三个报告不互相替代。

需求用例全部保留在本 change，没有扩大长期基线，也不主张历史 change 用例永久可执行。

## 首次原生性能运行的环境 RED

`/tmp/repair-native-performance.log` 在两次 Medium、一次 Low 后，于 High 的 `unfocusedFrames === 0` 断言失败，实际167帧失焦；该轮不能用作最终性能通过。测试原来在所有档位完成后才写 JSON，失败会丢失已完成样本，因此增加每档断言前的原始 checkpoint，并在首次失焦时记录前台应用与页面状态，便于定位真实焦点来源。此改动只增加失败取证，不改变零隐藏/零失焦或任何帧时间阈值；新增观测仅在失焦已使样本无效时读取系统状态，避免给有效采样引入定时进程负载。

## 最终独占性能通过（15:45）

命令：`env -u CI SEEDLANDS_E2E_PORT=4260 SEEDLANDS_PERFORMANCE_ACCEPTANCE=1 pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/performance-profile.spec.ts --output=/tmp/repair-native-performance-final`，1/1通过，3.1分钟。Chrome 152.0.7977.76，独立临时原生 profile、真实前台、未启用焦点仿真；窗口1920×1080、DPR1，按既有画质预设使用不同内部渲染分辨率。此处不把Medium的内部1689×950称作原生1080p渲染。

| 样本         | 实际 Canvas | 帧 p95 / p99（ms） | 隐藏/失焦帧 |
| ------------ | ----------- | ------------------ | ----------- |
| Medium 第1次 | 1689×950    | 9.1 / 9.3          | 0 / 0       |
| Medium 第2次 | 1689×950    | 9.3 / 9.4          | 0 / 0       |
| Low          | 1382×777    | 9.1 / 9.3          | 0 / 0       |
| High         | 1920×1080   | 9.0 / 9.3          | 0 / 0       |
| Medium 跨区  | 1689×950    | 9.2 / 9.4          | 0 / 0       |

20次背包输入反馈 p95 为9.1ms，未处理页面错误为0。所有预置门槛保持不变：Medium p95≤22ms/p99≤50ms，跨区p95≤33.3ms，输入p95≤100ms。GPU duration未采集，不能从rAF帧时间推算GPU专用耗时。第一轮167帧失焦仍是被排除的环境失败，不隐藏或合并到通过样本。

原始结果：`performance-profile.json`；生产输入SHA-256：`0008bf68283c749bccaca2674459d110fda5f7bae46a9bea9d5ecb5f78ac1496`。性能完成后再次读取工作区摘要一致。最终7项目标/布局用例在目标卡片修订后14.1秒通过；最后完整静态273项/4跳过、world95.69%和独立Build均通过。
