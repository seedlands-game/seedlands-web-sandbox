# 远端连续跨区块游玩恢复

状态：Delivered（本地验收完成，PR17 必要 CI 与人类审核状态见当前 PR）。类型：Agile，同 PR17 已授权闭环的缺陷修复。

## 问题和验收

用户在 seed `node-playable-trial`、Low / balanced 下连续步行，经过几个区块后地形出现空洞，等待仍不恢复；同时发生行走回退。之前出生点附近的挖放旅程不能覆盖此问题。

- 先使用独立 Node 数据目录和合成凭据，以真实浏览器键鼠持续移动，记录早期、中途、转向和停下后的原始帧。
- 对齐玩家权威/呈现位置、输入决策、区块请求/准备/Worker/显示停点。没有相关证据前，不把问题归因于浏览器积压或网络丢包。
- RED：在原实现复现跨区块缺失或持续回退；找到原因后增加确定性回归测试，证明修复前失败。
- GREEN：同 seed / 画质 / profile 的连续跨区块旅程能取得新区块，停下后近场地形完整；位置校正不存在由本缺陷触发的持续跳变。保留本地模式和原远端挖放/重连验收。
- 保留 Node 唯一 Authority、完整 baseline 和资源预算，不通过客户端生成兜底、调低画质、扩大超时或公开写 RPC 绕过失败。

## 实施与交付

- [x] 复现并登记根因与失败证据。
- [x] 确定性 RED/GREEN 与实现修复。
- [x] 实际浏览器连续移动和受影响门禁、独立的 static / build 证据。
- [x] 语义 commit、push、更新 PR17 交由用户审核，不自动合并。

现有 playable fixture 可增加默认保持不变的 seed 参数，以复用进程与合成凭据生命周期。诊断产物存于 `/tmp/seedlands-remote-traversal`；可读结论纳入本 change。长期 docs baseline 是否需要更新，在定位后按实际边界决定。

## 跨边界预测的碰撞版本覆盖

真实线程模式、5120×2718 输出、先挖一个方块后连续跨区块的旅程中，出现 15 次 `collision-history-missing`，直线移动却未发生后续地形修改。权威校正只携带服务端当前物理查询涉及的 chunk；客户端预测提前进入相邻 chunk 时，不能把“校正未列出这个 chunk”当成“客户端没有这个 chunk 的版本”。

可执行 RED：预测历史涉及相邻两个 chunk，校正只列出尚未跨过的旧 chunk，而客户端两个版本都仍可读；应回放未确认输入，不清空历史回拉。GREEN 必须同时拒绝实际缺失、过期或与权威已声明版本不符的历史，不扩大平滑误差阈值；本地与远端共用预测需一并回归。真实旅程对比跨区块期间的该重置计数。这项修复不单独代表永久缺块已解决。

## 已采用 canonical 的存档准备缓存释放

线程模式已记录 `Persistence lane prepare 元数据达到条目上限。`，随后 baseline 返回 `not-available`。存档准备结果在 canonical 接管后仍保留，256 条准备缓存先于 canonical 淘汰发生饱和。修复合同：只在 canonical 成功安装后释放对应的可重读存档准备副本或 missing 标记；不清理尚未消费的准备结果、不改缓存预算、不删除持久文件。保存 ACK 仍只更新相同 generation 的缓存。

RED/GREEN：小容量 proxy 连续恢复和生成超过容量的 canonical，保持旧 canonical 及保存 revision；拒绝安装时保留准备结果；在途请求上限和迟到 ACK/token 测试保持有效。

## 取消后的迟到 baseline 分页

超时或卸载取消已经接收 descriptor 的请求后，迟到分页必须按已取消 bundle 忽略，不能作为“无 descriptor”协议错误关闭整个连接。未取消的未知 bundle、损坏分页仍拒绝；忽略集合保持现有有界预算。RED/GREEN 覆盖取消后迟到页、校验在途取消和随后重新加载。

准出记录见 [delivery.md](delivery.md)，摘要见 [traversal-evidence.json](traversal-evidence.json)。新增迟到分页用例由现有 playable CI 执行，完整往返仍是本 change 的显式验收。
