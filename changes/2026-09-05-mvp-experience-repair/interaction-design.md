# 连续采集与方块目标设计

## 规则与来源

当前PlayerController只在mousedown调用一次interact，mouseup取消；服务端breakAction本身可延续，但完成后无下一次发起，所以用户报告无法连续挖掘可由真实两块fixture复现。当前raymarch最远7米，与服务端体素中心5米规则不一致，并且没有实际三维目标轮廓。

引入纯client体素射线函数，采用精确网格DDA穿越，返回首个solid目标及邻接放置位置；inRange按服务端同一体素中心5米距离计算。渲染轮廓、顶部信息、采集与放置使用同一结果，不能各自raycast。穿水仍可命中背后的solid，不能穿solid遮挡。

按住左键保留明确输入状态，目标变化时取消旧采集并发起新目标；目标不变不重复提交。破坏后下一帧射线命中后续块继续，无需松开。实体攻击优先且按有界间隔重复；松开/失锁/UI/暂停/死亡释放输入。正在采集时转向空处也立即取消旧目标。服务端硬度与物品原子性保持。

三维轮廓采用轻量线/边网格，略向外偏移避免z fighting，深度测试使墙后轮廓不透视。顶部卡片包含目标物品缩略图、中文名、采集进度，DOM更新只随目标/进度变化。

## 测试

`tests/client/voxel-target.test.ts`先RED，覆盖首障碍/负坐标/相邻放置/5米中心边界/无遮挡空处。需求`e2e/continuous-mining.spec.ts`使用生产World.edit fixture和真实一次左键按下，以World.getVoxel观察连续两块破坏，第三块在松开后保持；旧代码应只破坏一块RED。`e2e/interaction-target.spec.ts`以真实视角和可观察目标节点/截图检查近远及暂停隐藏。

## 当前状态

- `src/client/voxel-target.ts` 已由预置单测证明首障碍、负坐标、水穿透、放置邻格及 5m 中心边界。
- `PlayerController` 已改为按住左键的目标驱动状态机：目标变更先取消旧 action 再开始新 action，方块破坏后下一帧继续；松开、失焦、Pointer Lock 失去、暂停或 UI 阻断均取消。`aimTarget` 与 `interactionBlocked` 公开给上层，`onAimTarget` 只在目标实际变化时回调。
- Playwright-change：`SEEDLANDS_E2E_PORT=4261 CI=true corepack pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/continuous-mining.spec.ts --retries=0` 通过 `1/1`：一次按住破坏两块；松开后仍推进服务端 1 秒，第三块保留。
- 攻击探测采用同一完整体素射线的首个命中距离限制实体 hit-test。一次攻击结果维持到下一次 `0.2` 秒探测，避免在实体攻击冷却间隔内转而采集背后方块。`interaction-target.spec.ts` 已以真实输入验证墙后 creature 保持满血、移除墙后受到一次伤害。
- 服务端 `attackEntity` 独立执行权威遮挡校验，不能信任浏览器提交的目标。射线从玩家实体的眼位出发，终点取目标碰撞体内部的中心采样点，避免射向脚底时被正常站立地面误挡；两点之间任一非空气体素均返回 `blocked`，不造成伤害且不启动攻击冷却。拆除墙体后，同距离攻击立即恢复成功；成功后的 `0.5` 秒冷却与原有 3 米距离限制保持不变。
- 服务端预置用例位于 `tests/server/survival-gameplay.test.ts`：先放置覆盖射线路径的两格石墙，断言攻击被拒绝且生命不变；随后经 `World.edit()` 移除墙体，断言攻击成功、立即重试仍受冷却限制，并在冷却结束后验证远距离仍被拒绝。该用例先在缺少权威遮挡的实现上取得 RED，再修改生产代码。

## 主线联合验收回归

联合运行发现墙移除后的新点击仍被客户端上一次无实体命中的节流挡住，health保持12而非8（RED）。新一次mousedown重新探测实体，真实攻击间隔仍由服务端cooldown验证；持续按住则沿用客户端0.2秒探测预算。需求E2E去掉固定250ms等待，使用有实际地面的实体fixture，避免把实体下落误当攻击失败。

### 交互门禁复核补充

画面采样稳定复现：冻结世界时钟后 F3 无响应。原因是输入门禁错误地将昼夜时钟暂停当作游戏暂停；同一早返回还阻止 E 再次关闭背包。新增 `e2e/input-gates.spec.ts`，先验证冻结时钟仍可切换调试、背包可用 E 开关，再修正门禁；真实暂停、死亡与 UI 打开时仍禁止采集和移动输入。

门禁复验：`tests/app/player-input-gates.test.ts` 两项均先在正式控制器失败（冻结时钟错误返回 blocked、背包 E 回调未触发），移除时钟门禁并将界面切换键放到世界输入门禁之前后 GREEN。真实浏览器 `input-gates.spec.ts`、`interaction-target.spec.ts`、`visual-capture.spec.ts` 合计4项通过（2026-09-05 14:10前后）。原 F3 截图用例失败已定位为生产输入缺陷，并非通过强制隐藏调试 DOM 规避。

最终准出补充回归覆盖：连续采集中打开背包、真实 Escape 暂停、退出 Pointer Lock、服务端死亡四条中断路径。每项先观察真实输入产生采集进度，再触发中断，推进正式玩法模拟5秒后资源仍在。属于既有 R2 中断合同的补足，不声称事后新增用例曾取得实现前 RED；原始连续采集 RED 仍为两块连续破坏用例。
