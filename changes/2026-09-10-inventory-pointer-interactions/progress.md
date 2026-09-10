# 本地实施与验收记录

## 授权与当前状态

2026-09-10 用户批准 `3862602180748324e55b82c561a3515760ea62fa3e097eef988a3244f792eda9`，原始字节保存在 `evidence/spec-approved.txt`，交付前重新核对 SHA-256 一致。随后限定“实现+本地验证后先让我验收，先不处理 ci 问题”。本轮不 push、更新 PR 或处理远端 CI；旧续跑保持暂停。

实现与本地静态、构建、浏览器验证完成，最终独立审阅完成，无现存可报告 P0/P1/P2。用户手感验收仍待完成，不将本地 GREEN 称为人工认可、远端 CI 通过或可合并。

## 实现与 source 绑定

- 基线：`14aa2e0c23bd42c8f844adc80f5f8b9b0d898f4b`；功能分支 `codex/composable-overworld-playbook`。实施前工作区仅有本 change 的方案文件。
- 最终代码验证快照：`21210f3a32b0b021dc8c8f75944d2bfb25c9a1ec`，通过临时 Git commit-tree 冻结，未移动功能分支。最终本地提交在此后仅补状态与证据记录；生产代码、测试与此快照一致。
- Root 负责 `apps/web`、`tests/client`、本 change 的 Browser 用例与记录；`inventory_core` 负责 `packages/game-core` 和相关服务端测试，写路径互斥。
- Core 唯一拥有可保存游标、稳定库存 revision 和原子候选；Browser 串行发送正式请求，只派生持物/分配预览。关闭、掉落、死亡、模式切换和旧存档迁移均进入原有权威路径。
- 背包、快捷栏、工作台、箱子、炉体共享槽位组件；支持左右键、直接拖放、均分/逐个铺料、Shift、双击、数字交换、结果槽与关闭结算。保留原容量、配方、食用入口及素材。

## RED 与修复过程

实际行为 RED：旧页面对 9 件木板右键后仍为 9，预期源格 4、游标 5。使用真实 Playwright 右键输入；不是“缺接口导致编译失败”。日志为本机临时证据 `/tmp/seedlands-inventory-red.log`。

首次 UI 独立审阅发现并修复 3 个 P1：关闭遗漏原工位上下文、满背包错误禁用可进入游标的合成结果、模式响应前过早解除输入锁。分别补原工位关闭、满袋制作、150ms 传输延迟下连续点击的 Browser 用例；[首次报告](evidence/review-ui-559a651.md) 保留当时结论，不静默覆盖。

最终 Core 审阅又复现空槽正常失败无法生成公开回执的问题。已统一有限公开失败原因与内部消息映射，真实失败事务可投影/copy，伪造未知 reason 继续严格拒绝。新用例先 RED 后 GREEN。

## 最终本地验证

下列命令均在最终代码快照 `21210f3` 上运行并 exit 0；日志与截图为本机临时证据，不是 CI 产物。

| 层级         | 命令与结果                                                                                                                                                                                                                                      | 证据边界                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 静态与确定性 | `pnpm verify:static`：334 个测试文件通过、2 个既有文件跳过；1792 项通过、4 项既有跳过；SSG、格式、ESLint、路径、配置的覆盖率门禁和全部类型检查通过                                                                                              | 日志 `/tmp/seedlands-inventory-static-receipt.log`；覆盖率仅对应配置范围，不称全仓覆盖率                       |
| 构建         | `pnpm build`：Pack、Rust 工件校验、Web 类型与 Vite 构建通过                                                                                                                                                                                     | 日志 `/tmp/seedlands-inventory-build-receipt.log`；保留既有大 chunk 提示，未改门槛                             |
| Browser 产品 | `SEEDLANDS_E2E_PORT=4174 SEEDLANDS_E2E_SWIFTSHADER=1 pnpm exec playwright test changes/2026-09-10-inventory-pointer-interactions/e2e/inventory-pointer.spec.ts --output /tmp/seedlands-inventory-receipt-browser-artifacts`：10/10，约 1.2 分钟 | 日志 `/tmp/seedlands-inventory-browser-receipt.log`；实际生产构建 preview、系统 Chrome/SwiftShader，非性能测量 |
| 布局观察     | 已阅读背包、工作台、箱子、熔炉与持物/拖拽截图；箱子调整为 8×3 后补验通过                                                                                                                                                                        | 桌面 1280×720；槽位、数量、快捷栏、提示可读，不能替代使用者手感认可                                            |

Browser 10 条旅程覆盖：拆半/单放/关闭归还、左右拖拽分配与 Shift/数字、直接拖放/双击、工作台铺料/结果/保存、箱子与炉体、持物检查点恢复/失焦、内外点击/关闭/模式切换、Shift 批量与个人配方/食用、延迟模式切换期间连续输入、满袋普通合成与 Shift 拒绝。夹具仅用正式 Harness 命令及真实玩家放置准备材料与工位；被测库存操作使用真实鼠标/键盘。

Core 与 adapter 的定向测试另覆盖耐久身份、容量截断、版本/权限拒绝、失败无部分扣料、请求重放、满袋正式掉落、死亡恰好一次、V1–V4 默认迁移、已知旧 Pack 身份迁移与坏摘要拒绝。无需外部模型的确定输入采用 Playwright；Midscene 未运行，人工试玩待完成。

## 独立审阅与预算实际

请求 `inventory_core` 为 Sol/high，独立 reviewer 为 Sol/xhigh；实际运行时 token、credits、API 等价费用未回显，均为 unknown，不用工时反推费用，也不把共享账户变化归因本 change。原建议窗口为 12 小时，范围未扩大；缺少可靠的活跃工时与连续墙钟归因记录，实际工时记 unknown，不能宣称预算已精确达成。未兑换额度、购买 credits 或创建 Goal。

最终独立审阅覆盖完整 Core、UI 修复 delta、受影响测试和 docs；审阅者没有运行测试，其静态结论与 Root 的上述运行证据分开记录。见 [最终独立审阅](evidence/review-final.md)，无现存可报告 P0/P1/P2。

## Delivery Snapshot 与待用户验收

- 当前 change 保持 Active，需求 E2E 保留在 change 目录，未提升为长期基线。
- 长期 docs baseline 已更新：可组合玩法架构补权威游标/原子交互/保存生命周期边界，代码地图补真实 owner 和入口；中英文 README 同步操作。原因是这些责任跨 change 有复用价值，未把全部局部实现复制进 docs。
- 保留原试玩地址 `http://127.0.0.1:4173/`，刷新后可以使用同一 origin 的现有存档。独立生产验收 preview 4174 已停止并确认端口释放；4173 交接前读回 HTTP 200。
- 人工试玩与手感确认未完成；PR、CI 和远端状态按用户指令暂缓，不作通过声明。
