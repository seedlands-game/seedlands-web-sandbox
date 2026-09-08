# PR17 main 同步交付快照

状态：实现及本地验收完成，提交 PR17 交人类审核；最终 HEAD CI 由 PR 门禁校验。范围仅为冻结后的 main 合并与集成修复，不开展后续优化。

## 来源与回退

- 用户复测通过的冻结点：`2214a49c29e2fdfd7c9c2fdd006b858a6ba2dcfd`；远端回退分支 `codex/pr17-frozen-20260909`。
- 合入 main：`a3509ef2ccd2e07027242998caa6dd5621e6a151`（#21 木剑近战、骨骼动画/模型工坊及本地动作体验场）。
- 合并提交：`05a7b60a350026710ae76165991b02b093339714`，两个父提交明确保留 PR17 与 main 历史；追加本地体验场状态隔离修复 `0fba411`。
- 分支仍是 `codex/web-node-playable`，推送至既有 origin，交付到 [PR17](https://github.com/seedlands-game/seedlands-web-sandbox/pull/17)。未处理 PR15，未自动合并。

## 集成结果

1. 逐处解决 6 项文本冲突：Shell、Game、生成的开始页、两端各自提取的保存队列、脚本和 Shell 测试。HTML 从合并后的 Svelte 重新生成；保存队列保留动态 Authority/telemetry 生命周期。
2. 木剑前摇回执原先要求同步 damage，连击拒绝原因不在 PR17 白名单内。新增动作 ID、缓冲状态及两个合法拒绝原因；保留旧同步伤害回执，拒绝坏字段，不伪造伤害。
3. Web 复制并保留权威 combat 字段，首击、连击及阶段抵达 HUD 和表现层，仍不由动画事件决定伤害。
4. 本地体验场入口在远端模式隐藏；取消后迟到的本地启动不得造景；进入 Node 清除旧体验场面板。公开协议仍不提供传送、造景等管理 RPC。
5. 两分支组合令 Game 超过 500 有效行，地图控制委托给既有 game-runtime-controls，状态仍由 UiBridge 拥有。

长期 docs baseline 已更新 `docs/code-map.md` 的地图控制归属，并保留 main 的资产工坊文档；目录规则、世界权威、存档格式和性能预算未改变。历史 Delivered change 结论不重写。

## 验证与限度

- 接缝 RED：最初 4 项回执/投影测试全失败；另补本地体验场状态残留 RED。修复后网络接缝和 Shell 合计 14 项通过，包括坏动作字段与迟到启动隔离。
- 完整覆盖率：273 文件通过、2 文件原有 skip；1,374 测试通过、4 测试原有 skip，world 行覆盖率 96.89%。SSG、format、ESLint 和路径检查均通过。
- 首次 `verify:static:ci` 在最后 typecheck 发现新增异步测试桩返回类型错误；修正后完整 `pnpm typecheck` 及 Shell 7 项重跑通过。没有把首次组合命令记为成功；当前 HEAD CI 再执行完整组合门禁。
- Web 与 Node 构建分别通过；Svelte 检查 0 error / 0 warning。生产构建保留既有大 chunk 提示，本轮不做拆包优化。
- 原生浏览器本地木剑体验场通过；真实 Node worker-thread + Low 木剑场景通过：前摇、5 点首击、7 点连击、保持连接，保存退出后文件恢复保留木剑及目标受损。
- 完整 Chromium / SwiftShader 两项通过（20.7 秒）：本地体验场，以及本地体验场返回后连接 Node、确认造景面板消失、继续真实木剑输入与 durable 恢复。只用离线合成测试存档，不开放管理 RPC。
- 初版合成测试使用了错误的 edit 字段名，随后把平台放在 y=80，超出既有 Web scheduler 的 cy=0..1 范围；修正为 main 体验场同高度 y=57 后通过。未延长生产超时或扩大世界高度。
- 既有浏览器回归及 main 新玩法/动画模型/工坊：20 项通过（37.8 秒），包括地图图层与输入碰撞基线。
- 原 PR17 浏览器闭环：3 项通过（45 秒），覆盖真实移动/挖放、durable 保存、关页重连、Node 重启、认证失败资源清理及取消 baseline 的迟到分页恢复。
- 旧试玩存档副本：通过真实 UI 复活后，worker-thread / Low / balanced / 5K 图像连续外出 60 秒再返回 60 秒，通过（2.4 分钟）；终点近场 9/9、baseline-unavailable 0，移动窗口碰撞历史重置无新增。复活/输入门控产生的历史计数保留，不宣称全部校正为零。
- 首次旧存档旅程停在死亡界面、等待 Pointer Lock 而总用例超时；补可选真实“复活”前置后通过，原试玩存档不改变。
- Portable Active Node：4 文件、35 项通过。

本轮不声称新的性能收益；原始帧中显示的帧率与统计不是受控 A/B。所有浏览器旅程与覆盖率串行运行，避免机器争用混入输入结论。

## 复跑与证据

`pnpm test:pr17:integration` 已进入 Chromium CI，覆盖本地体验场及 Node 木剑闭环；本机默认 Chrome，CI 使用完整 Chromium/SwiftShader。

其它入口：`pnpm verify:static:ci`、`pnpm build`、`pnpm build:server`、`pnpm test:e2e:regression`、`pnpm test:web-node-playable:browser`、`pnpm test:remote-traversal`、`pnpm test:active-node:critical`。连续探索使用旧试玩检查点的隔离复制，原试玩存档不因测试改变。

原始本机日志与截图：`/tmp/seedlands-remote-traversal/main-sync-*`。包括 combat RED/GREEN、两次测试场景修正、状态隔离 RED/GREEN、static/type/build、原生与完整 Chromium 截图，以及后续浏览器旅程。运行产物不提交；CI 结果绑定 PR 的最终 HEAD，不能沿用冻结点的历史绿灯。

CI 首轮保留记录：`34260122925` 的 Production build 成功；浏览器 job 因 Linux 4 核性能提示未被点击而失败。已对两个体验场用例补真实“仍然进入”前置。取消分页用例曾以 descriptor→cancel 误判 13,255ms；现按生产计时起点记录同 requestId 的 request→cancel，另存 descriptor 后实际扣留时长，仍要求大于 14 秒。main 已有连击用例一轮未观察到 7 点伤害、自动重试通过，这不是本轮新的性能或产品正确性结论。

上述 CI 准备修正后的本机完整 Chromium / SwiftShader：3 项一次通过（44.8 秒），包括本地体验场、本地切远端木剑持久化及迟到分页恢复；最新完整类型检查通过。最终提交包含交付记录与测试准备修正，不再修改生产实现。
