# 连续跨区块缺块与回拉修复

## 已定位的问题

1. **跨边界回拉**：权威位置校正只列出当下物理查询涉及的区块；预测提前进入相邻、客户端已加载的区块时，旧代码误判碰撞版本缺失。现在仅对权威明确声明的版本查冲突，同时检查所有未确认预测帧所需的本地版本。实际缺块或版本改变仍重置。
2. **探索后拒绝新区块**：canonical 接管存档准备结果后，proxy 仍保留快照/missing 元数据；准备缓存默认 256 条，先于 canonical 淘汰饱和。实际线程浏览器日志抓到 `Persistence lane prepare 元数据达到条目上限。`，随后的 baseline 为 `not-available`。现在成功安装 canonical 时释放可重读缓存，保留持久文件和未接纳准备结果；没有提高额度。
3. **取消后迟到页关闭连接**：取消已有 descriptor 的 baseline 仅删除重组状态，迟到页触发 `Baseline page has no active descriptor.`。现在把该 bundle 放入既有 128 条有界忽略集合。正常未知/损坏分页仍报错。

## 证据和边界

- 预测 RED/GREEN：26 项相关测试通过；跨两个区块而权威只报告旧区块的 case 在旧实现失败。
- 缓存 RED：容量 2、连续探索 8 个区块，旧代码稳定报 prepare 元数据上限；覆盖存档恢复、异步生成、同步生成。GREEN 还验证错误 revision 的候选不会释放未消费的准备缓存。
- 取消 RED：旧镜像取消请求后接受迟到页稳定抛出无 descriptor 错误。GREEN 覆盖首个 digest 进行中取消、后续完整重试以及真正未知 bundle 仍拒绝。
- 真实浏览器往返：Low / balanced、Node worker-thread、5120×2718 输出，先挖块，再正向 60 秒、转身返回 60 秒，最后停下 10 秒。正向位移约 270 米，`baseline-unavailable=0`，最终近场 9/9 完整；移动开始后的 `collision-history-missing` 无新增。早期、中途、转头原始帧已检查。
- 真实 Node 延迟分页：用 Playwright WebSocket 转发保留真实 Authority/输入/心跳，只暂存一个 bundle 的分页，直到浏览器正常 15 秒超时发出取消后交付迟到页。测试证明该区块重新渲染、Authority tick 继续前进、无连接关闭和 pageerror；26.3 秒通过。用例已加入现有 Web/Node playable 命令和 CI 的执行范围。
- 不宣称完全消除所有位置校正：往返样本仍有 2 次 `large-error`，本次已证实并消除的是“已加载相邻区块误判缺失”的连续重置。没有性能窗口 A/B，不据此宣称帧率或延迟收益。
- 用户原会话的准确 close code/原因没有保存，不能把其每一次断联都归于取消竞态；这里证明的是实际缺块原因与一个独立可复现的致命取消分支。

原始日志和截图位于 `/tmp/seedlands-remote-traversal`，关键摘要及 SHA-256 存于 [traversal-evidence.json](traversal-evidence.json)。生产修复 commit 为 `c2f23b3` 和 `926c97d`；新增证据 API 仅在已有 harness 中只读暴露预测诊断。临时 Node 调试输出已删除。

## 验收入口

- `pnpm test:remote-traversal`：构建 Node 并运行完整往返和迟到分页两项 change 测试。
- `pnpm test:web-node-playable`：原有协议/适配、挖放/重连、本地隔离及迟到分页回归。
- 全量 static、独立 Web/Node build 和最终 PR CI 的结果在准出后回填。

长期 docs baseline 不更新：没有改变架构、持久格式、协议、资源预算或所有权规则；只是让当前实现符合既有生命周期合同。`ChunkPersistence.evictSnapshot` 源码注释明确只释放读取缓存。PR17 交给人类审核，不自动合并。用户原试玩 Node 进程需要重启才能加载新构建。
