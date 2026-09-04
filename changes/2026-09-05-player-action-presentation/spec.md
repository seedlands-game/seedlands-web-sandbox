# 第一人称动作与受击表现

**状态：Delivered；沿用父 Goal 自主本地 SDD 授权。**

## 背景与目标

生存规则与声音已经可用，但镜头中还看不到手持物，挥击与使用缺少动作反馈。补上玩家能直接读懂的轻量第一人称表现，属于父合同既定动作范围。

## 范围与明确不做

手持物图示与皮革袖口/手套；采集循环、成功攻击/放置/食用短动作；受伤时克制的屏幕边缘反馈。使用原创 SVG/CSS 与现有物品图示，不添加骨骼系统、武器耐久、额外物品或新的游戏状态。

## 关键决策

动作只消费 UiBridge 展示快照，不能反向改变游戏或直接依赖 server。成功动作与声音共同消费 BrowserGameplay 的 typed presentation event；连续采集由权威 breakAction 的投影触发。动画最长 420ms，生命周期清理定时器；减少动态设置保留物品、进度与生命值信息。

## 行为

- Given 当前快捷栏有木斧，When 关闭背包，Then 右下方显示同一把木斧与袖口，主准星和快捷栏不被遮住。
- Given 对石头按住采集，When breakAction 有效，Then 手持物作重复轻挥且原有采集进度可读；松开后停止。
- Given 服务端拒绝操作，When 显示反馈，Then 不播放成功挥击/食用动画。
- Given 生命下降，When 收到 damage 事件，Then 边缘闪烁一次且及时消退，不遮住核心视野。
- Given prefers-reduced-motion，When 操作，Then 保留物品与语义信息，取消摆动。

## 测试设计

- `e2e/player-action.spec.ts` 在实现前 RED：手持木斧图示不存在；实现后通过真实键鼠进入采集并验证动画状态、取消采集及减少动态。
- `midscene/player-action.yaml`：手持图示、皮革/黄铜语言与世界画面一致，准星/快捷栏无遮挡。
- 对 CSS 动画本身不写镜像单测；事件映射已有 Audio 专项 Vitest。本次继续运行静态/构建及涉及的浏览器整合。

## 验收与证据

- [x] Playwright-change：真实选择/采集/取消/减少动态。
- [x] Midscene：图示和手部清楚，布局与美术统一。
- [x] Static / Build：依赖边界、格式、类型与构建通过。

## 任务与当前状态

1. 先定义合同和 RED。
2. 实现纯展示契约与组件。
3. 分层验证并本地提交。

## 交付快照

尚未交付。

### 实际证据与交付

05:46 专项 Playwright RED：`手持 木斧` 不存在。实现后该真实输入用例通过（3.6 秒），并在 05:49 的 14 项整合回归内再次通过。Midscene 完整旅程通过（26.26 秒），run `player-action-2026-09-05_05-47-44-cc847642`。

`pnpm verify:static` 195 passed / 4 skipped，world 行覆盖 94.86%，Svelte 0/0；`pnpm build` 通过。状态 **Delivered**；仍随父 change 接受 Change9 最终集成复验。动作是轻量 SVG/CSS 表现，不声称骨骼或真实三维手部模型。
