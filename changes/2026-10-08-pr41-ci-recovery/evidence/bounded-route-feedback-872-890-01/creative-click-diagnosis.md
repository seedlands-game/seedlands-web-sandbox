# 899 creative click：只读诊断

**观察到：** `test.trace` 的 `pw:api@1796` 是 `crop-journey.ts:31` 木锄 role/name Locator.click，494576.592开始、507422.044超时；`0-trace.trace` 中该调用495134.750进入等待，497995.213已解析到唯一 `<button data-item="wood-hoe" aria-label="将木锄放入创造快捷栏 1">`，之后到超时没有 `attempting click action`、pointer/actionability或点击完成记录。此前 filter fill 494563.823完成。调用前snapshot为495133.678，采集约2.7ms（任务提供数据）。

**证据边界：** 这排除了“未找到按钮”和该次点击已进入常规actionability/pointer步骤；不证明点击目标在全程静止/可点击，也不直接证明渲染线程卡死。trace窗口没有可归因于此按钮的console/error事件。已检查 `creative-catalog.svelte:9-11,26-42`：filter按名称派生可见项、列表以稳定 `item.itemId` keyed，按钮有对应aria-label/data-item及点击回调；未见与已解析目标明显冲突的源码缺陷。`crop-journey.ts:24-34`仍在点后验证hotbar真实item。

Playwright 1.62.1的本次已知路径在 locator resolved 后还会 `result.evaluateHandle(r => r.element)` 才调用 action；本次无 `attempting click action` 与此一致。因此最窄推断是解析后等待 renderer 回应/element handle 的窗口耗尽，但缺少协议事件/主线程trace，无法确证具体阻塞者或修复点。fill耗时及前序旅程耗时不能单独证明 renderer 卡顿。

最小下一证据：仅对该点击在既有trace保留目标 locator 的 resolved 后记录 CDP `Runtime.evaluate`/响应时间、目标连接与可见性简要标量，以及浏览器主线程long-task区间；如有响应再记录 Playwright actionability起点。保持10s timeout、role/name、真实pointer及hotbar断言。未建议 `force`、`noWaitAfter` 或放宽时限；未跑测试/浏览器，未改仓库文件。
