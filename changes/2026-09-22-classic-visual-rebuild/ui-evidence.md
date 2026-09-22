# Classic v3 UI 像素视觉证据

状态：UI源码与静态资产闭环完成；Browser 真实画面由主线程在 S3 统一验收，本文不把 CSS 或像素尺寸视为浏览器验收。

## 变更范围

- 新增 `scripts/assets/classic-ui/generate.mjs`，仅使用 Node 标准库确定性生成 6 个原创 RGBA PNG：32×32 灰色面板、24×24 快捷栏格、16×14 心形、16×16 胸甲、16×16 气泡与 86×16 标题标记。没有使用概念图裁切、AI 高分辨率伪像素或第三方素材。
- HUD 的生命、护甲与氧气分别引用心形、胸甲与气泡；空值仍由原有 dim/filter 表达，数值、可见性、ARIA meter 与受击反馈逻辑未改。
- 首屏、暂停/设置覆层、目标卡、库存和快捷栏改用灰色像素面板；当前选择格是白色像素外框，保留热键、物品数、响应式尺寸和 focus-visible 路径。
- 首屏的派生 HTML 已通过 `pnpm ssg:update` 刷新，读回确认其标题标记是 `classic-crest.png`。视觉目录的 UI image rows 已同步至新路径。

## 自动证据

- `node scripts/assets/classic-ui/generate.mjs` 成功；`sips` 读回的输出尺寸分别为 16×16、16×16、86×16、16×14、24×24、32×32，均为 RGBA PNG。
- `node scripts/benchmark-window.mjs -- pnpm ssg:update` 成功。
- `node scripts/benchmark-window.mjs -- pnpm --filter @seedlands/web test apps/web/tests/unit/client/visual-asset-catalog.test.ts --run` 通过，2 tests。
- 定向 ESLint 对 TypeScript/Svelte/脚本无 error；CSS 文件未匹配当前 ESLint 配置而被忽略，已通过 Prettier 与 `git diff --check`。
- Web typecheck 已实际运行但未通过，阻断来自并行光照工作包：`game-harness.ts` 的 `VisualEffectsSnapshot` 缺少 3 个 block-light 字段，以及 `game.ts` 未同步 `sampleBlockLight` 接口和 position 类型；上述文件不属于本 UI 工作包。

## 未验证

未启动开发服务器或 Browser。尚未记录首屏、暂停、库存、目标卡、满/半生命、护甲和水下氧气的真实截图；应由主线程与场景、角色、光照合并后做产品验收。
