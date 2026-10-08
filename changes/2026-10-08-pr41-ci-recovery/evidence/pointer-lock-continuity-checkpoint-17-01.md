# Browser16 终态与真实 Pointer Lock 连续性候选

冻结 SHA `956bc6a6ec280b65974b0145481222e63a1da10c`，runId `pr41-cloud-browser-16-01`。build15 sourceDigest `57aab70116dbff46ad69481da849f5c3799c6674ff4d3651c93aa35dd807508f`，artifactDigest `ce977f12f66a54025eeebec83ffc21dbe38d324ba9fdc3f20bd8d5120dc0d28e`。本次完整主旅程仍 FAIL：1 FAIL / 1 visual PASS / 1 modular SKIP，18.1m，CLI exit1、CANONICAL_MAIN receipt FAIL。失败附件明确 C0/C1/C2/C3 PASS；其他阶段的耗时记录不充当 PASS。

V2 在最后一段资源带的 Survival 切换中触及原900秒主旅程期限。堆栈为 `placeResourceStrip → switchToSurvival → closeInventory → lockPointer → locator.click(#game)`，末态 player `[98.5249481,32.6,-0.50021094]`。本次没有 resources-placed 完成回执，没有采集/铁甲完成证据。不能因为到达资源带末端或 visual PASS 宣称完整可玩。956 远端 CI run37833265260 已终态：build、headless、architecture、deterministic、static PASS；Chromium FAIL；preview SKIP。CI 首次在原10秒启动卡门禁失败，重试在 V1 door retreat predicate 原20秒门禁失败；并非同一个本地 V2 超时。

## 实际控制原因和有界修复

闭合 Browser16 trace 中有34次1500ms cooldown和2次100ms等待，实际 waitForTimeout 总51.434秒。旧 mouse helper 在 Playwright 虚拟指针越过 canvas 边界时主动退出 Pointer Lock，再冷却、恢复菜单并重锁；它破坏真实输入的连续锁定并引入世界暂停。各 API 时间有重叠，不相加推断总瓶颈；没有声称此项是所有900秒问题的唯一原因，也没有性能收益测量。

在匹配 Chromium151 的隔离真实 canvas 中，直接调用实际 mouse helper：有效 RED `pointer-lock-helper-red-17-02.log/json` 记录5个真实+80px相对事件，随后实际 lock lifetime 为 `['game', null]`，连续性断言失败。早先 red17-01 是简单探针重锁超时，保留为校准失败，不作为有效 RED。

候选只删除 moveMouseBy 的虚拟坐标边界重锁机制，继续调用真实 page.mouse.move，并在每次移动前严格检查实际 `document.pointerLockElement.id === game`。GREEN `pointer-lock-helper-green-17-01.log/json` 记录26个精确相对移动和唯一 `['game']` 锁定生命周期；超出 viewport 的真实右键 mousedown/up 仍以 game 为目标、button2、isTrusted=true。没有注入模拟事件、设置相机或吞掉锁定丢失。原 lockPointer 的实际 canvas click、可见/稳定门禁仍保留，目标/邻格断言、80px步长及浏览器期限均未放宽。

这些是输入机械性验收，不是当前生产世界玩法、WebGL或性能验收。完整 Browser17 尚未运行。crop producer、V3/V4、modular和194项验收仍未闭合。实际产品周额度20:01UTC剩余92%，约60%为停止线；没有用token估算，也未收到停止要求。

静态最终 verify:static:ci PASS；完整 headless 原固定选择器262/262 PASS。首次因原 fake page 不维护锁定状态产生5个失败，随后两份替身按其 click 更新锁定、使 cursor baseline 与实际声明的 canvas中心一致，原到达/freshness/反向输入/双RAF断言均保留；相关6/6 PASS。实际机械性 probe 的 RED/GREEN仍是上文真实 Chromium证据，fake通过不替代真实输入验收。
