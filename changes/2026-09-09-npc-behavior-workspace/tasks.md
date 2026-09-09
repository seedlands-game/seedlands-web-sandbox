# 任务状态

- [x] 停止旧修复；旧PR #26转draft并停止监控；读取确认方案，独立worktree
- [x] E：Mistreevous 4.3.1公开API准入
- [x] G：固定LiteLLM + 有界ASGI、标准框架/PG准入及正式产物
- [x] A：正式树/技能/唯一owner/恢复/Headless与Browser合同
- [x] A：Headless与Browser三个昼夜、物品争抢、跟随目标失联/重现
- [x] B：标准Agent、持久workspace/journal、双唤醒、Pro事务压缩
- [x] B：真实Flash回应玩家/替换策略/断线继续执行，真实Pro发布新记忆窗口
- [x] C：最终三角色Browser+PG配对恢复复验14.8秒通过，pageerror为空
- [x] Factory：真实Pro出生包+浏览器幂等激活通过（一次Pro生成小满，两次激活同一npc-8）
- [x] 独立审阅问题闭环、最终NPC Browser套件及H1输入恢复回归、可玩环境
- [x] 最终静态285files/1369tests、build、当前Browser/H1及独立复核
- [x] 创建PR #29并跟进首次CI失败，修正loading fixture总预算
- 远端最终门禁与审核状态见[PR #29](https://github.com/seedlands-game/seedlands-web-sandbox/pull/29)，本文件不作为实时CI状态源。

## 当前证据

G：原版LiteLLM和Bifrost未通过完整合同，保留失败证据。正式LiteLLM 1.100.0有界适配通过同套mock：全局实际后端峰值2、等待32、超限拒绝、Retry-After、总截止、取消、别名替换、扩展字段。真实供应商不用于故障注入。

A：冻结9ea0b23修复独立审阅四项P1（健康长路径预算、热更新终态、损坏ledger、复合对话条件）；浏览器暂停推进新增Logic/Physics交错后，三个昼夜功能测试29.8秒PASS：1800模拟秒、18次完整补给、3次夜间休息后恢复巡游、192次巡逻到点。零模型、零旅程补资源、零树修改。不是性能基准或长期泄漏证明。

旧60分钟旅程完成采样但断言失败；旧产物的replan预算问题已复现修复。修复版第二轮在用户调整验收后主动取消。两者保留，不能记为通过，不再要求真实60分钟重跑。

B：实际PG与标准Agent100项检查通过；追加日志上限、冻结窗口、恢复拓扑、不可变receipts及工具目录由独立审阅提出并修正。真实Flash第四次联调已回应玩家并安装跟随树；离开局部感知正确失败、重新出现后同树恢复跟随且断网继续执行。真实Pro两次工具调用完成一次压缩发布。Factory与其拆开验证，不重复已通过Flash/压缩。

C：初轮一个Browser连接承载三NPC、独立PG工作区及配对checkpoint恢复15.4秒通过；最终复验发现旧Authority epoch的dispose Promise拒绝泄漏为pageerror，已补确定性RED/GREEN。独立Host审阅追加重复sessionId生命周期与多workspace导入部分提交P1，分别增加重复连接拒绝及PG整批事务/并发锁，最终集成复验14.8秒通过。

权限：所有新世界行为沿用统一WorldResourceAuthorizer；旧绑定入口在明确deny world.character execute时仍接受intent的RED已修正。Agent仅局部观察与正常规则Action，开发全局Harness不进入模型工具。

长期文档已更新单树持续行为、128K窗口、PG持久化、逻辑flash/pro网关和快进验收边界。最终结果见后续delivery.md，不以旧PR绿色代替本变更。

## CI 后续修正（准出仍待最终 checks）

- [x] 首次冷缓存进入世界触发 Vite 补依赖刷新：受控 A/B 修复并完成21项完整基线。
- [x] 第二轮 CI 的 HMR socket 被误计为 Agent 连接：测试按实际服务 URL 匹配；无头shell组合复验通过。
- [x] 主线程300ms阻塞可复现世界计时/物理正常而 NPC 补给停滞，已保存 RED 权威记录。
- [x] Authority/Logic Worker 直接通信、生命周期及回档验证；保留原200ms新鲜度。
- [x] 相同主线程阻塞下完成补给、无头shell三昼夜及三角色/PG恢复组合验证。
- [ ] 最新SHA静态、构建、远端checks通过，PR转可审核。

Headless三日CI一轮87.319秒通过、一轮120秒被宿主测试期限中止；调整单例有界期限180秒并保留所有模拟步骤和功能断言。此与浏览器运动停滞分别处理，不以超时改动代替产品修复。
