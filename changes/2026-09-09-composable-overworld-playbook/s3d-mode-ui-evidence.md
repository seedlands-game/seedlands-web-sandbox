# S3d 生存/创造 Browser UI 证据

## 实现范围

- 新世界入口新增 `#actor-mode`，默认 `survival`。选择值经 `UiActionPort → ApplicationShell → Game` 传递；`Game` 只在 `AuthorityReady.isNew` 为真时执行初始模式命令，因此继续已有存档不会覆盖权威模式。
- 模式命令使用 `sourceType: browser-player`、绑定当前 `entityId` 且仅声明 `mutation` capability。`set-mode`、`set-flight`、`set-creative-slot` 均通过实际 Authority 命令入口；失败消息进入既有 `#interaction-feedback`。无安全落脚点错误显示“无法切回生存：当前位置没有安全落脚点。”，不先改变 UI 本地模式。
- UI 投影优先消费 `AuthorityGameplayView.items/recipes` 的每世界实际定义。仅旧隔离 fixture 未提供定义时保留默认 registry fallback；显式世界定义不补入默认物品或配方。
- 创造模式用 `creativeCatalog.hotbar/selectedSlot` 投影快捷栏与手持物，选择目录物品只执行 `set-creative-slot`；生存 `inventory/selectedSlot` 保持独立。切回生存后 HUD 重新投影原生存快捷栏。
- 创造目录、模式切换、飞行状态与提示接入现有背包层；创造状态明确标注生命和饥饿不消耗，并显示 `Space` 上升、`Shift` 下降。

## RED / GREEN

RED：

```text
corepack pnpm exec vitest run tests/client/creative-mode-ui.test.ts
FAIL Cannot find module '../../apps/web/src/app/gameplay/browser-gameplay-actions'
Test Files 1 failed (1)
```

GREEN：

```text
corepack pnpm exec vitest run tests/client/creative-mode-ui.test.ts tests/app/gameplay-ui-projection.test.ts tests/app/application-shell.test.ts tests/app/ui-bridge.test.ts
Test Files 4 passed (4)
Tests 16 passed (16)
```

专项覆盖：每世界自定义物品/配方名称、创造快捷引用与生存库存隔离、普通 browser-player source、Authority 拒绝消息透传、低核心确认路径保留新世界创造模式选择。

## 静态检查

```text
corepack pnpm exec eslint <本 capsule 所有 TS/Svelte/测试路径>
PASS

corepack pnpm --filter @seedlands/web typecheck
svelte-check found 0 errors and 0 warnings
tsc apps/web + tools PASS
```

未运行 full static、build、Playwright、浏览器服务、安装或 commit，符合 capsule 边界。

## Browser 验收定位

- 新世界模式：`#actor-mode`，值 `survival | creative`。
- 当前模式：`#actor-mode-status`，文本“生存模式”或“创造模式”。
- 模式切换：按钮 accessible name “切换创造模式” / “切换生存模式”。
- 创造目录：`#creative-catalog[aria-label="创造内容目录"]`。
- 目录选物：`#creative-catalog button[data-item="<item-id>"]`；accessible name 为“将<物品名>放入创造快捷栏 N”。
- 创造快捷栏：`#hotbar[aria-label="创造快捷栏"]`，槽位仍有 `data-item` 和 `aria-pressed`。
- 飞行开关：`#flight-toggle`，accessible name “开启飞行”或“关闭飞行”；背包内另有相同 accessible name 的开关。
- 创造规则提示：`#creative-vitals-inactive`；飞行帮助文本包含 `Space 上升 · Shift 下降`。
- 命令反馈：`#interaction-feedback[data-tone="error"]` / `[data-tone="success"]`。

最终 Browser 验收仍由 root 在源码冻结后执行：新建创造世界、从实际目录选块、数字键选择创造快捷栏、真实 `Space/Shift` 位移、关闭/开启飞行、安全切回生存并核对库存、checkpoint 重启后核对模式与两套快捷栏。本文不把单测或静态检查冒充 Browser 产品验收。
