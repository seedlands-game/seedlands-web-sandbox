# 创造模式破坏输入节奏

状态：Active / Agile。基线 `9115766075b8ae348397a38205fe74e24342da74`。

## 目标与范围

修复创造模式按住左键时，因每帧重新瞄准并提交 `begin-break` 而沿视线连续破坏多个方块的问题。仅调整浏览器玩家输入到既有 Authority `begin-break` 的调用节奏；Authority 的创造即时破坏规则和生存硬度采集规则不变。

非目标：宣称与任何外部游戏精确等价；调整方块硬度、攻击伤害、世界/存档协议、资源、美术、CI 选择或浏览器验收口径。

## 行为合同

- Given 创造模式左键按下且没有命中可攻击实体，When 首帧处理输入，Then 只提交一次破坏。
- Given 左键持续按住，When 已经过 250ms，Then 后续每 200ms 至多提交一次；低帧率或在途请求不会补发积压请求。
- Given 松开后再次按下，Then 新按下可立即提交一次。
- Given `mouseup`、失焦、Pointer Lock 丢失、页面隐藏、UI 阻挡或权威模式切换，When 输入状态被清除，Then 已排期和在途回调均不能恢复本次按住的破坏。
- Given 左键命中生物，When 同一次短按处理，Then 不向其背后的体素提交破坏。
- Given 生存模式，When 持续采集或瞄准目标改变，Then 仍走既有硬度采集/取消路径，不套用创造模式节奏。

## 实施前测试设计与 RED

- 纯节奏状态测试固定 elapsed time，覆盖 250ms 起点、200ms 间隔、低帧率至多一次、重置和无积压。
- 玩家控制器测试覆盖创造首次立即请求、在途请求、释放后的迟到完成、攻击阻挡、UI/模式重置，以及生存模式不受创造节奏延迟。
- RED：新增节奏 helper 的定向 Vitest 在 helper 尚未实现时失败。

## 任务状态

- [x] 冻结基线、读取输入/玩法/Authority 责任边界。
- [x] 写入 RED 测试：缺少 helper 时定向 Vitest 因模块不存在失败。
- [x] 实现节奏、模式和在途隔离。
- [x] GREEN 与定向静态检查。
- [x] Delivery Snapshot 与语义本地 commit。

## Delivery Snapshot

本 change 以 `PlayerMiningState` 保存创造按住时长、活动目标和请求 generation：按下立即提交；250ms 后开始每 200ms 最多一次；低帧或未完成请求只消耗当次节拍，不能追补。`stop()` 递增 generation，因此释放、失焦、Pointer Lock 丢失、页面隐藏、UI 阻挡和模式改变后的迟到 Promise 不能重开旧按住。生存模式沿用开始/取消和目标变化时立即重定向的既有路径。

验证：RED 为 `pnpm --filter @seedlands/web test apps/web/tests/unit/app/creative-break-cadence.test.ts --maxWorkers=1`，缺少模块而失败；GREEN 为同一节奏测试、`player-creative-break-input`、既有 `player-input-gates` 共 16/16 PASS。针对改动文件的 Prettier、ESLint 和 `pnpm --filter @seedlands/web typecheck` 均 PASS，`git diff --check` PASS。未运行浏览器、开发服务器、真实 Pointer Lock 或 Authority Worker，故这些运行时证据为 NOT_RUN；没有修改长期 docs baseline、CI 或测试选择。
