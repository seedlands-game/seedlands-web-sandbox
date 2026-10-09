# 路线只读快照候选 checkpoint28

本地开发父提交为 `cd5ff7caadfb335bef54764d7140b09dac3d1132`。2026-10-09 00:57 UTC 远端核验仍是此提交，main 为 `fba4486e433c145db658f6b1598b70c47f759c8a`。本记录仅冻结待测候选，不宣布性能采用、真实玩法完成或可合入；候选暂不推送。

## 行为与边界

新增只读 `routeSnapshot()`，从现有 Controller 与已接受 Authority 复制三轴位置/速度、视角、ground/collision、physics tick/input ack。缺少、未就绪或非法 owner 数据返回 null；完整诊断 snapshot 保留。设备路线改读精简投影，真实键鼠、脉冲、双端到达、settle 和所有原期限不变。`route-walk.ts` 承接原真实移动循环，完整与精简观测共享同一逻辑，未新增动作或状态 owner。

测量只在既有完整 canonical benchmark 中开启，逐样本同任务核对两个 owner 投影精确等价；4 次 warmup、8 对 A/A、8 对平衡 ABBA/BAAB，使用当前 spec 的 15% 噪声否决和 20% 改善门槛。失败 attachment 保存原始样本、顺序、artifact/profile 身份和逻辑 UTF-8 JSON 字节数。无效计时、owner 改变或整段旅程失败均不能通过资格；原始 CDP 编码与实际网络 bytes 不混称。

## 验证与失败保留

独立原始输出位于 `/workspace/pr41-recovery-20261008-root-01/` 和 `/workspace/pr41-recovery-20261008-fixtures-01/`；不是 sealed 历史证据的复制或覆盖。

- 有效旧完整投影 RED：`route-snapshot-red-47-04.log` 为 10 FAIL / 1 PASS；夹具校准失败另存，不能冒充行为 RED。
- 投影和导航定向 GREEN：23/23。测量合同最初 7/7，通过确定性假时钟；根增加无效计时反例后为 8 个合同用例，不作为真实性能证据。
- 首次完整 headless：`route-snapshot-headless-28-01.log` 为 511 PASS / 1 FAIL。旧 handoff 夹具只识别 `snapshot()`，在新只读 API 的首次观测处拒绝；补充同 owner 的精简投影，原 overshoot/反向键/最终到达断言保留。
- 修正夹具及无效计时反例后的定向检查：`route-snapshot-fixture-green-28-01.log` 为 21/21 PASS。
- 最终本轮正式 `pnpm test:classic:headless`：`route-snapshot-headless-28-02.log`，72 files / 513 tests PASS，exit 0。
- 初次静态检查分别暴露文件行数和夹具 unused-var；移动原循环、明确 fixture override 后，`route-snapshot-static-28-02.log` exit 0。冻结证据 5/5 原字节、Prettier、目录、lint、全部类型、Svelte 0 errors/0 warnings、ESLint 插件 66 tests 和 CI selection 14 tests 均 PASS。
- Task49 首次 tsc 未覆盖新增 unit，补入正式 tsconfig 后重新检查并修正明确 fixture 类型；最终静态检查覆盖该 unit。初始错误与报告修订保留，不把此前不完整覆盖当作完整通过。
- stdlib 本轮未重复运行：本组生产修改仅在 Web Harness；前一组的 152 files / 1102 tests PASS 与远端确定性 CI 不代替本组产品验收。

## 待验与权限

新精确 SHA 构建、完整真实浏览器、当前 A/A+A/B 及既有 frame 改动的组合端到端 A/B 未运行。远端 `cd5ff7c` 的构建、静态、确定性与 Classic headless 已 PASS，Chromium 在本记录时仍运行；旧 c3 run 的 Chromium CANCELLED 保留为未通过。

长期代码地图已更新，因为原真实移动循环新增明确承接文件；其余 owner/玩法长期架构没有变化，不重复写教程。周额度最新真实读数由主对话在 00:40 UTC 提供：剩余 91%，约 60% 停止线保持；本环境无法直接读取产品 UI，未使用 token/credits/API 估算替代。未合并、未启用自动合并、未推 main、未做生产部署或扩张权限。
