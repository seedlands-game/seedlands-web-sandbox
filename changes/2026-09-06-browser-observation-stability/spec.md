# 浏览器基线观测一致性

## 背景与目标

PR #8 的静态与构建检查已通过，但远端 Chromium 两次在跳台旅程失败，期间也出现下落状态和地图超时波动。当前 main 的 CI 同样有相关重试记录。此变更仅修正测试观测的一致性和有限场地造成的时序干扰，使原有真实输入与几何验收能稳定判断。

证据：PR workflow `34040603117` 的 attempt 1/2；main workflow `34030816405`。失败快照中玩家已跑到 z=16–43，离开上层仅 z=0–2 的场地；帧耗时为数百毫秒。日志说明存在慢帧与观测风险，不能据此宣称产品在所有慢机器上都没有问题。

## 范围与非目标

仅修改 `tests/e2e/support/harness.ts` 的等待返回值、`tests/e2e/regression/world-play.spec.ts` 的测试观测与测试内着陆区域构造，新增本 change 的等待 helper 反例。维持 15 秒等待、真实 Pointer Lock/键盘输入、一格高度、原位移和高度容差、无碰撞与真实支撑规则。

不修改生产源码、物理、预测、渲染质量、CI runner 或重试次数；不跳过用例。地图用例保持原样。新增反例留在 change，不提炼进长期基线。

## 决策

- 当前等待 helper 在浏览器匹配后再发一次读取请求，返回的状态可能已经变化。返回匹配时的那份快照并释放 JSHandle，保留错误诊断。
- 跳回旅程通过现有 `fillHarnessWorld` / 生产编辑路径延长同高着陆区，保持台沿位置与一格高度；先观察跨过台沿，再释放按键，最后验证已落地、原高度、原位移和无碰撞。避免把窄平台上的瞬时高度巧合当作唯一成功窗口。
- 下落旅程若需调整 Pointer Lock 时机，只在移除支撑前取得锁，仍需验证失去支撑后下落、空中 Space 不产生虚假落地、无碰撞。
- 这是既有测试语义的可靠性修正，按用户已授权的 PR 跟进范围实施；基线实际 diff 必须经非实施者 Sol/xhigh 审核，不以远端重试成功代替审核。

## 行为

- Given 第一次满足条件的快照之后世界立即前进，When 等待 helper 返回，Then 返回被条件匹配的快照，不能返回后续相反状态。
- Given 一格台阶，When 玩家不跳仅向台阶移动，Then 在台沿受阻；When 使用真实 Space 跳回，Then 跨过原台沿并在原高度真实落地，身体不与固体重叠。
- Given 玩家失去全部真实支撑，When 下落中按 Space，Then 仍继续下落且不产生虚假落地或碰撞。

## 验证设计

- `changes/2026-09-06-browser-observation-stability/e2e/snapshot-observation.spec.ts`：为两个等待 helper 构造“匹配后立即变化”的快照，旧实现应 RED，新实现应返回首次匹配态 GREEN。
- 现有 world-play 与完整长期 E2E：不降低断言，验证真实输入和生产编辑路径；新旧准出差异由 Sol/xhigh 独立审核。
- 格式、TypeScript 与构建按受影响范围运行；GitHub 最新 HEAD 必要 CI 全通过且无冲突才可交棒。

## 准出条件与证据

| 条件                                        | 证据                | 状态                              |
| ------------------------------------------- | ------------------- | --------------------------------- |
| 两个 helper 返回匹配态，资源被释放          | Playwright-change   | 反例 RED 2/2 → GREEN 2/2          |
| 真实输入、支撑与一格跳回语义保留            | Playwright-baseline | 定向 7/7、完整 9/9 通过           |
| 精确 spec 与最终 diff 获独立 Sol/xhigh 审核 | Manual supplement   | Sol/xhigh APPROVE，见 review.md   |
| 格式、类型与构建通过                        | Static、Build       | verify:static、build 通过         |
| 最新 PR 必要 CI 通过、无冲突                | GitHub CI           | 发布后以 PR #8 最新 HEAD 检查为准 |

Vitest、Midscene：N/A，仅测试观测修正，无生产算法或视觉变更；helper 反例在真实浏览器执行。

## 任务与当前状态

- [x] 定位匹配/返回竞态与有限着陆场地。
- [x] change-local 反例 RED → GREEN，实施并获 Sol/xhigh 最终 APPROVE。
- [x] 完成本地静态、构建和完整基线验证。
- [ ] 父级提交、推送并跟进远端 CI 与冲突。

## 交付快照

变更：等待 helper 返回页面内首次匹配的克隆快照；跳回测试使用生产编辑路径延长台沿正侧的同高落地面，保持 15 秒等待、真实 Pointer Lock、原位移/高度/无碰撞语义。

RED：`pnpm exec playwright test changes/2026-09-06-browser-observation-stability/e2e/snapshot-observation.spec.ts` 在旧 helper 下 2/2 失败，均返回第二次相反快照。GREEN：同命令 2/2 通过；`pnpm exec playwright test tests/e2e/regression/world-play.spec.ts` 7/7 通过；`pnpm verify:static` 通过（151 文件，760 通过、4 跳过，world 行覆盖率 96.37%）；`pnpm build` 通过；`pnpm test:e2e` 9/9 通过。构建仅报告既有大 chunk 提示。Midscene：N/A，无视觉行为变更。

独立审核：初审与最终 APPROVE 见 `review.md`。远端 CI 与冲突的最终准出记录见 [PR #8](https://github.com/seedlands-game/seedlands-web-sandbox/pull/8) 的最新 HEAD 检查及交接摘要；本地通过不代表远端已通过。docs baseline 未更新：本次为局部测试实现纠错，尚无可沉淀的跨 change 私域规则。
