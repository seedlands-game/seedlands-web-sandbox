# 密度语料编解码验证计划

## 范围与预期

读取已冻结的 32/128 个 registered actor 真实语料，每档 correction、pose、Gameplay v2 共三条记录。保持现有 C0/C1/C2 和 64 KiB metadata、4 MiB frame 参考预算不变，先验证 manifest、逐条内容、当前显式源码 SHA 与实际数量，再通过 parse → schema → own → hash → consumer 验证严格深相等。

仅在 `/tmp/seedlands-network-probe-codec-consumer-v2` 新增独立 runner 与结果，不导入生产模块、不覆盖旧语料或旧 runner。每条报告编码字节数和拒绝原因；合法共同 schema 若超出某候选表示预算，应记录该候选的表示限制，不能裁剪数据或提高上限后宣称等价通过。

若三候选全部成功，生成独立浏览器 fixture，用现有真实 Chrome runner 验证 Node → Chrome 与 Chrome → Node 两向完整流水线。若出现表示限制，只对可表示的明确子集进行浏览器验证，并保留完整拒绝记录。

## 准出与边界

- 三条记录与 manifest、当前显式 source path/hash、actorTarget/实际 actor 数一致；缺项、陈旧源码或内容破坏先于编解码拒绝。
- 每个候选每条记录报告强等价或明确失败；不得跳过失败后汇总全通过。
- Node 与真实 Chrome 互通结果分开记录，不代表客户端适配、网络传输、GUI 或首次连接行为。
- 本切片不采计时，不形成编码性能、游戏 tick、CPU、内存或 WAN 结论；字节数只表示当前候选与该语料的编码结果。

本切片沿用冻结实验中的隔离原型流程；没有新增生产代码或正式网络协议。实际结果回填独立进度记录。
