# Harness依赖编译映射补齐

## 背景与目标

最终关联`pnpm harness`的234项单测、生产构建、9项浏览器基线均通过，但Node汇总阶段报`ERR_INVALID_URL`，未解析相对导入`./player-occupancy`。该纯函数在组合重构中从gameplay-runtime抽出，Vite正式构建与Headless模块加载能解析，Harness手工data URL映射遗漏。

## 范围与明确不做

只补 `scripts/harness-gameplay-modules.mjs` 的player-occupancy编译与依赖替换，不改占位几何、玩法、采样规模、基线阈值或旧结果。不用遗留浏览器JSON冒充同次关联证据。

## 决策

沿用当前Harness编译协议，先编译无依赖纯函数，再映射gameplay-runtime的相对导入；不为两行映射引入新runner或生产架构重构。

## 行为

Given 当前生产模块图，When 执行pnpm harness，Then 所有data URL导入可解析，Node汇总与当前同run id/source的浏览器结果关联；10/100/500 actor与1000上限采样保留原规模。

## 测试设计

预期RED已由完整命令实际得到：浏览器9项通过后汇总在player-occupancy导入失败。修复后重跑同一完整命令至GREEN，检查关联run id/source与浏览器PASS，不新增镜像映射字符串的无价值单测。

## 验收与证据

- [x] Static：脚本Prettier、ESLint、路径检查通过。
- [x] Vitest / Build / Playwright-baseline：完整pnpm harness前置门禁通过。
- [x] Harness：同run id关联Node与浏览器结果，无相对导入错误，actor预算样本可读。
- N/A：无产品视觉/声音修改，不新增Midscene或主观试听。

## 任务与当前状态

Delivered：依赖映射补齐，最终关联Harness已通过。

## 交付快照

2026-09-05 最终执行 `SEEDLANDS_E2E_PORT=4250 pnpm harness` 成功，源码 `7a368506eccf9879e1c7a6681862bdb4b7acaba9`，关联run `8a254d1f-01bc-4757-a130-7539f4ae8e63`：234项Vitest通过、4项明确跳过、Build通过、9项浏览器基线21.3秒通过；Node worldMutation、浏览器回归与性能采样均PASS，比较无REGRESSION。父合同 `harness-final.json` 保存同次报告；脚本ESLint/Prettier/路径门禁通过。该证据不替代音频主观试听。
