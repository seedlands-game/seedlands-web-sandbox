# 实验性性能设置设计 QA

## 对照来源

- 问题截图：`changes/2026-09-07-experimental-client-options/evidence/experimental-settings-before.png`
- 该截图是待修复的失败状态，不是需要逐像素复刻的设计目标；目标是消除异常放大的 checkbox，同时保持项目现有暗色石纹、黄铜边框与排版体系。

## 实现截图

- 桌面：`changes/2026-09-07-experimental-client-options/evidence/experimental-settings-1280.png`
- 窄屏：`changes/2026-09-07-experimental-client-options/evidence/experimental-settings-390.png`
- 联合对照：`changes/2026-09-07-experimental-client-options/evidence/experimental-settings-comparison.png`

## 视口与状态

- 问题截图：1376 × 838，系统显示密度未知；比较时按 900 px 高度等比归一化。
- 桌面实现：1280 × 900，浏览器 CSS 像素截图，设置面板展开，WebGL2 / Wasm / SIMD 为默认状态。
- 窄屏实现：390 × 844，浏览器 CSS 像素截图，同一设置状态。
- 重点区域：实验性性能分组中的渲染后端、Rust WebAssembly 与 SIMD 两行。

## 全视图与重点对照

- 全视图：桌面实现保持设置面板原有标题、音量、质量、本地参考曲和面板边框层级，没有新增横向溢出或裁切。
- 重点对照：联合对照图左侧可见旧版 checkbox 被通用 input 样式拉成巨大蓝色方块并与文案脱行；右侧实现为 18 × 18 原生 checkbox，靠右且与两行文案垂直居中。
- 窄屏：两个设置行仍为左文案、右 checkbox；Playwright 实测分组 `scrollWidth === clientWidth`，没有横向溢出。

## 发现与处置

- P1：`.reference-music input` 的 `width: 100%` 与全局输入最小高度误伤 checkbox，造成截图中的巨大居中控件。已用限定选择器恢复 18 × 18 原生尺寸，并改为整行可点击的 flex 布局。
- P2：原始单行文案无法清楚区分 Wasm 覆盖范围与 SIMD 实际范围。已拆成标题和说明，明确 Rust 为 `w02–w06`、只有 `w06` 使用标准 SIMD128，其余 Rust 内核保持标量。
- P2：Wasm 关闭后只靠灰度表达 SIMD 不可用不够清晰。已增加“需要先启用 Rust WebAssembly”依赖提示，并保留原 SIMD 偏好。
- 字体、颜色、黄铜强调色、石纹背景、现有 crest 与按钮组件均复用项目设计系统；未新增替代图标、伪造 SVG 或低清素材。

## 比较历史

1. 初始对照：发现 P1 巨型 checkbox、P2 文案与控件脱行。
2. 第一轮实现：桌面和 390 px 窄屏恢复紧凑同行布局；Playwright 尺寸断言发现窄屏行高 72.1875 px，收紧垂直 padding 后为合同范围内。
3. 第二轮实现：补充 SIMD 依赖提示；联合截图复核未发现新的 P0、P1 或 P2 视觉问题。
4. 语义视觉旅程：Midscene 1/1 通过，覆盖设置入口、默认组合、下拉选项、紧凑开关、变更提示和返回主菜单。

## 最终结果

passed
