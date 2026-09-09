# CI melee 失败分诊

## 范围

- 冻结提交：`fe5e0f11a92f9706bd1a5ef0f32a27cb36c09e9e`
- CI：GitHub run `34357206570`，工件 `melee-34357206570-1` 已只下载到 `/tmp/seedlands-living-npc/melee-34357206570-1`。
- 合同 SHA-256：已核对为 `f617d8db03090a22b26b4e5bdb13367219d842d4808d51f2cf715485104c06a2`。
- 未运行浏览器、测试、provider 或重试，未写入仓库。

## 变更

本轮没有源码变更。最小修复范围应限于历史 melee Playwright 用例
`changes/2026-09-08-melee-action-showcase/e2e/melee-action-showcase.spec.ts:26-29`：

1. 点击体验场后等待“性能提示的仍然进入”或 `#melee-showcase-guide` 二者之一可见，使用 15 秒上限；
2. 若前者出现则点击它；
3. 再以 15 秒等待 `#melee-showcase-guide`。

这比单纯加长 line 29 的 timeout 更完整：现有 `if (await warning.isVisible())` 是一次瞬时探测，Svelte 的 warning 发布若尚未提交 DOM 即可能跳过确认分支。建议使用 Playwright 的 `warning.or(guide)` 等待其中之一，而不改产品启动、世界生成或 `BrowserGameplay.prepareMeleeShowcase()`。

## 验证

已证实的失败只有 line 29 的 5 秒 `toBeVisible()`：首轮找不到 `#melee-showcase-guide`；retry 通过，但 `failOnFlakyTests` 使门禁失败。

下载的工件只保留 retry #1 trace，未保留首轮失败 trace，因此不能把首轮慢归因到某个具体 Worker、资源或命令。retry trace 仍给出直接的预算证据：

- 低核心性能提示已出现并被点击；点击完成于 trace `17844.7ms`。
- guide 的断言开始于 `17857.0ms`；其 locator 在 `23568.2ms` 才解析到完整 guide。
- Playwright 开始记录 locator 等待后约 `4974ms` 才解析，几乎耗尽该断言默认 `5000ms`；页面同时记录 frame p95 `2239.2ms`、generation queue `13`。
- error context 和 retry trace 均显示随后完整进入：guide、木剑、四个体验场实体和“体验场已布置”反馈存在。

因此“就绪等待没有余量”是可证实原因；“首轮是 warning 分支瞬时探测漏过”是代码上真实可达的竞态，但该首轮工件缺失，不能把它说成已证实的本次唯一原因。

`#melee-showcase-guide` 仍是正确的最终 consumer-ready 信号：`ApplicationShell` 仅在 `game.start()` 后调用 `prepareMeleeShowcase()`，后者在命令、木剑装备和视角更新完成后才 `publishShell({ experience: 'melee-showcase' })`；`AppRoot` 据此渲染 guide。建议修复后保留后续木剑、debug Seed 和实体断言，避免把纯 loading 或 start-card 隐藏误作体验场就绪。

## 风险

### [P1] 体验场端到端的有效就绪路径只给 5 秒且 warning 分支不等待

- 位置：`melee-action-showcase.spec.ts:27-29`。
- 触发：SwiftShader/低质量 CI 的合法世界生成与体验场布置略慢于 5 秒，或 warning DOM 在单次 `isVisible()` 后才提交。
- 可观察影响：产品最终完整就绪仍被初次用例判失败；retry 成功后仍被 `failOnFlakyTests` 拒绝，阻塞无关提交的 CI。
- 证据：该 run 的首轮 line 29 超时；同一 run retry 在约 4.974 秒 locator 等待后才得到 guide，且有高帧 p95/未完成 generation queue。warning 的即时探测可见于冻结用例；其时序风险由 Svelte publish 后异步 DOM 提交决定。
- 最小修复：采用上节二阶段、15 秒的 `warning.or(guide)` / guide 等待；不重试整项测试，不放宽产品运行时，也不把 start-card hidden 当 ready。
- 置信度：高（CI 门禁风险和最小测试修复）；中（首轮究竟是零余量还是 warning 探测漏过，因首轮 trace 未归档）。

## 实际成本

约 0.19 小时；下载并只读分析了 CI 工件，无模型调用、无外部写入。
