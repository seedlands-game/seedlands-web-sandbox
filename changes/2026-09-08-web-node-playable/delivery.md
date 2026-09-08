# Web↔Node 本机单人闭环交付快照

## 完成状态

状态：Active，尚未 Delivered；PR #17 保持 Draft，base 为 main。本机完整闭环已经通过，Linux 完整旅程仍需准出。

干净 `aeaa9ce` 在本机原生 GPU / Medium 完成认证连接、脚下3×3首屏、真实移动/转向/跳跃、挖块/拾取/放块、durable保存、关闭页面后Node继续、手动重连及Node重启恢复。44项sourceInputs由root逐项核对源码与实际Node产物，原始连续帧已审看；证据保存为 `b3f3256`。11文件37项Vitest及2项Chromium通过，durable stop与重启读取均为797。

最新诊断冻结 `26850f6` 的软件配置原旅程2项也通过，41项源码与实际Node产物hash一致，采集时工作树干净。放置目标的57条关联trace包含prepare/worker/commit/visible-postrender；该读取不改变世界、输入、调度或绘制，只沿用已有telemetry快照的gauge刷新。受限输出丢弃任意errorMessage与其它attributes，定向RED/GREEN和7项测试通过。

Linux CI34235218286绑定aeaa9ce，Static verification与Production build通过，Chromium regression失败。默认headless shell仍首屏超时；完整Chromium/SwiftShader/Low对照通过首屏、移动、转向与跳跃，失败于挖掘前精确站位准备。固定35ms按键、70ms等待未确认浏览器采样或neutral应用，正在修复测试驱动的确定时序缺口；未到meshTarget，没有新的挖放网格停点证据。固定AAABBA绘制实验已按预注册停止线结束，不采用autoRender候选，不作性能收益声明。

## 提交和推送

功能分支 `origin/codex/web-node-playable` 已推送至 `aeaa9ce`；后续原生Medium证据与测试驱动合同已本地commit，待驱动验证后一起push。完整早期接线和修复记录见execution.md及Git历史；最近稳定产品检查点包括 `d7f86ec` 输入target单调保护、`4e63fb7` 交互网格公平调度、`ce146cc` 目标chunk诊断与 `26850f6` 诊断字段白名单。main已合入的底座、CI及审阅规则已同步到本分支；本任务不修改PR #15。

## 变更

- Node CLI 增加显式 loopback/Origin/口令网络入口；单玩家连接通过受限二进制实验协议消费同一 Authority。
- Web 启动页支持本地/Node 双模式；远端只保留输入、预测、派生镜像、Worker mesh 与渲染，不持有 canonical writer 或浏览器存档写者。
- baseline/commit/action/input/checkpoint 均绑定 epoch、sequence/revision 和有界资源；断线取消、迟到结果、重同步、反压与失败连接不会终止世界。
- 正常输入采样至多一条网络/Authority 输入在途，并只保留最新状态；首屏 9 个必需网格原位提升优先级，合法空网格、高度边界和后续全半径流送保持有效。
- 菜单显示只读 Node 地址和 seed，明确网页关闭后世界继续、存档位于 Node；离开等待 durable 保存，断线可回主菜单手动重连。
- README 中英文、代码地图、当前 spec 和 CI Chromium job 已更新；长期 baseline 更新是因为双模式产品入口和 Node 本机运行命令已成为实际接线。正式公网网络与性能路线没有晋升。

## 验证结果

aeaa9ce原生Medium旅程、本机26850软件Medium旅程、真实WS负向、分页交错、迟到结果、capture关闭与单Authority离线运行均有明确证据。最新已完成CI34235218286的静态与构建成功，但浏览器失败，不能据本机通过宣告Linux准出。原始日志、source/hash绑定、帧清单和未闭合的观察见execution.md、diagnosis.md及evidence/。

## 限制

只支持 loopback、单世界、单玩家与手动重连；没有 TLS/WSS、公网/局域网部署、账户、多玩家、自动恢复或浏览器存档导入。实验 C0/WebSocket 接口不代表正式协议采用或性能结论。只有收到 checkpoint receipt 的状态具备 durable 承诺。

## 剩余工作

完成真实键盘驱动的发送与应用屏障并复验Linux原始完整旅程；若再到挖放显示失败，使用已有目标区块trace定位。随后更新独立报告、最新CI终态及交付快照。确认#17无冲突且必要CI全部通过后，转为ready-for-review交人类审核；不自动合并。PR #15由用户在另一台设备处理。
