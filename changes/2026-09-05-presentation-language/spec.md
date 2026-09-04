# 统一表现语言与界面美术

**状态：Active；父 goal 已授权自主 SDD。**

## 背景与目标

Retained UI 已建立单 Svelte root 与分片 UiBridge，但原样式仍为绿色圆角玻璃卡片。将已选概念图中的黑曜石、黄铜、青紫奥术与克制的反馈语言转成实际可复用资产、语义 token、UI primitives 与游戏内反馈，使主菜单、HUD、背包、合成和后续设置属于同一世界。

参考：`/Users/chlorinec/Downloads/_sorted/images/Living World UI Concept.png`，以及父合同 `changes/2026-09-05-playable-world-mvp/spec.md`。概念图的场景密度和未实现装备不属于逐像素合同。

## 范围与明确不做

- 新增原创黑曜石/黄铜 9-slice 面板资产，统一 SVG 图标/符文、物品图示和 primitive 状态语言。
- 语义 token 覆盖 surface、content、border、confirm、arcane、danger、focus、motion、spacing 与可读字体。
- 现有首屏、玩家 HUD、Inventory/Crafting、Debug、地图与反馈逐步使用统一材质，Game Shell 新页面消费同一 primitives。
- 减少大面积 backdrop blur 与持续动画；支持键盘 focus、disabled/pressed/selected 与 reduced-motion。
- 不改生存规则、存档、世界生成、UI runtime；不新增 GPU UI、Tailwind 或通用主题框架。

## 关键决策

- 复杂纹理与框体来自原创资产，CSS 负责布局和状态；SVG 图标使用同一几何词汇。
- 深色石面保持低频、低对比纹理；黄铜集中于边框和选中结构；青紫只用于发现/奥术；危险为红橙，正文暖白。
- 主界面正文使用系统 CJK 可读字体，标题可使用系统 serif 与字距；不依赖网络字体才能进入游戏。
- 每个有物品模型的槽位显示可辨识图示、数量与键位，名称通过目标提示/tooltip 表达；不把原始物品 id 当主文案。
- UI 音频语义交由后续 Audio change 接入同一操作边界，本期不伪装声音已完成。
- 素材生成使用内置 Image Generation。原提示词、产物位置、实际截图验收写入交付记录。

## 行为

- Given 任意已实现面板，When 显示，Then 使用统一深石面/暖金属结构，正文区域清晰安静，控件可辨认且不遮挡必要内容。
- Given 按钮和槽位，When hover/focus/pressed/selected/disabled，Then 通过边框、明度或短动态形成可辨状态，禁用不误导为可点击。
- Given 700px 窄窗口或 reduced-motion，When 打开面板并操作，Then 内容不横向溢出，反馈信息仍存在，持续装饰动作关闭。
- Given 正常游玩，When 无新事件，Then HUD 保持稳定；收到确认、失败、受击时只显示短时清晰反馈。

## 测试设计

- 这是表现语义变更，颜色/“属于同一世界”无法用单测证明，不添加镜像 CSS 的测试。预期 RED 为当前画面是绿色圆角玻璃风格，不满足上述石面/黄铜/奥术视觉预期。
- 在实现前定义 `midscene/presentation-language.yaml` 的主菜单、游戏 HUD、地图/命令面板视觉旅程；Inventory/Crafting 在上游完成集成后补入相应场景。
- 用当前长期 Playwright 基线与 Retained UI 已有交互预期验证行为保持；新增 Game Shell/整体 E2E 后由其验证本期组件在真实场景的集成。
- 记录 desktop 与 700px/reduced-motion 截图，分别检查材质、层级、文字、控件边界和动效。素材自身图片不替代 UI 截图。

## 验收与证据

- [ ] **Midscene / Manual supplement：** 面板、框体、槽位和图标统一，主菜单、HUD、地图与命令面板可读；生存背包/合成集成后同样验证。
- [ ] **Playwright-baseline：** 现有输入、Hotbar、地图、命令、持久化等行为无回归。
- [ ] **Playwright-change / Midscene：** 窄屏与 reduced-motion 的布局/信息保持，由当前 change 显式场景验证。
- [ ] **Static：** 格式、lint、路径、Svelte/TypeScript 与 world coverage 不退化。
- [ ] **Build：** 生产构建成功，原创资产打包可用，记录资产体积。

## 任务与当前状态

1. [已完成] 读取原始概念图、已批准路线、Retained UI 源码与父合同。
2. [已完成] 实现前建立本合同与可观察的视觉 RED。
3. [已完成] 原创框体与 SVG 标志、语义 tokens、九宫格框体/槽位与状态样式已接入。
4. [进行中] 主菜单/HUD/地图/命令两条 Midscene 通过；700px 减少动态与 shell Playwright 已通过，等待生存背包/合成合入。

## 交付快照

尚未交付。原创 PNG 2,119,538 字节；来源及完整提示词见 asset-record.md。首次 Midscene 发现选中槽边框过白，增强黄铜九宫格选中框后第二次两条旅程全部通过（34 秒，2026-09-05 04:37，报告 presentation-language-2026-09-05_04-37-08-1f69788b.html）。05:00 当前树 Static 与 Build 通过。生存背包/合成和最终整合旅程仍待验收。

### 林地透明轮廓修订合同

2026-09-05 06:44 实际林地镜头中，16像素单元的固定随机孔洞呈现明显棋盘格，与轻手绘材质语言不一致。只替换叶片 alpha 的程序轮廓为平滑周期形状，保留原彩色 atlas、cutout 管线、世界数据和阴影采样路径。`tests/client/leaf-opacity.test.ts` 先 RED：周期边界一致、实际空洞/实体比例有界，像素0–255；随后真实林地与高级阴影专项、Midscene复验。不得把叶子改成不透明实体以隐藏问题。

叶片轮廓单测1项通过；06:49完整Static/Build通过；06:49高级光影3项与标签1项浏览器通过23.9秒；06:50 Midscene明确验证连续镂空及保留天空空隙，通过23.52秒。
