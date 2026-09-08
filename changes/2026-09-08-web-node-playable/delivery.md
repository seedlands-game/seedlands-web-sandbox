# Web↔Node 本机单人闭环交付快照

## 完成状态

状态：Active，尚未 Delivered；PR #17 保持 Draft，base 为 main。本机与Linux完整闭环已经通过，等待正式CI环境采用后的必要门禁全绿。

干净 `77caf7a` 在本机原生 GPU / Medium 和managed完整Chromium/SwiftShader/Low完成认证连接、脚下3×3首屏、真实移动/转向/跳跃、挖块/拾取/放块、durable保存、关闭页面后Node继续、手动重连及Node重启恢复。两份48项sourceInputs由root与独立验收核对，原始连续帧已审看；证据保存为 `fd0c283`。原生11文件37项Vitest及2项Chromium通过，软件Low两项Chromium通过，durable stop与重启读取分别为732和1261。

Linux CI34240608181在merge `4148bf9`（main840f4fb+fd0c283）完成相同Low完整旅程及错误认证用例。48项来源绑定一致、工作树干净，durable3687，重连tick2392→3013，重启新epoch且恢复修改。root与独立验收审看全部5张原图，保存于evidence/linux-low；这是软件环境功能兼容证据，不是Medium或性能结论。

CI342406的旧默认headless shell步骤仍首屏失败，故整项Chromium job未绿。按预先定义的准出条件，已将验证通过的fullChromium/SwiftShader/Low用于正式Active步骤，原脚本、完整断言和其它回归保留，移除重复临时对照。等待该配置的新HEAD CI；不以旧失败环境标记成功。固定AAABBA绘制实验已按停止线结束，没有采用autoRender候选。

## 提交和推送

功能分支 `origin/codex/web-node-playable` 已推送至 `fd0c283`；CI环境采用与Linux证据将作为下一独立检查点保存。关键检查点包括 `d7f86ec` 输入target单调保护、`4e63fb7` 交互网格公平调度、`26850f6` 诊断字段白名单和 `2dabe70` 真实键盘测试结算屏障。main已合入的底座、CI及审阅规则已同步到本分支；本任务不修改PR #15。

## 变更

- Node CLI 增加显式 loopback/Origin/口令网络入口；单玩家连接通过受限二进制实验协议消费同一 Authority。
- Web 启动页支持本地/Node 双模式；远端只保留输入、预测、派生镜像、Worker mesh 与渲染，不持有 canonical writer 或浏览器存档写者。
- baseline/commit/action/input/checkpoint 均绑定 epoch、sequence/revision 和有界资源；断线取消、迟到结果、重同步、反压与失败连接不会终止世界。
- 正常输入采样至多一条网络/Authority 输入在途，并只保留最新状态；首屏 9 个必需网格原位提升优先级，合法空网格、高度边界和后续全半径流送保持有效。
- 菜单显示只读 Node 地址和 seed，明确网页关闭后世界继续、存档位于 Node；离开等待 durable 保存，断线可回主菜单手动重连。
- README 中英文、代码地图、当前 spec 和 CI Chromium job 已更新；长期 baseline 更新是因为双模式产品入口和 Node 本机运行命令已成为实际接线。正式公网网络与性能路线没有晋升。

## 验证结果

本机77caf7a双配置及Linux4148bf9的原完整旅程已独立复核；真实WS负向、分页交错、迟到结果、capture关闭与单Authority离线运行均有明确证据。2dabe70的5项驱动测试与完整typecheck通过，LinuxCI的Production build成功；最新完整静态与必要门禁以正式环境采用后的CI终态为准。原始日志、source/hash绑定与帧清单见execution.md、independent-validation.md及evidence/。

## 限制

只支持 loopback、单世界、单玩家与手动重连；没有 TLS/WSS、公网/局域网部署、账户、多玩家、自动恢复或浏览器存档导入。实验 C0/WebSocket 接口不代表正式协议采用或性能结论。只有收到 checkpoint receipt 的状态具备 durable 承诺。

## 剩余工作

取得正式CI环境采用后的必要门禁全绿，更新交付快照，确认#17无冲突后转为ready-for-review交人类审核；不自动合并。PR #15由用户在另一台设备处理。
