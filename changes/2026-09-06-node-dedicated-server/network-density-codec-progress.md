# 密度语料编解码结果

32/128 个 registered actor 的两档真实语料，均通过当前 C0/C1/C2 的 Node 22 严格深相等，以及真实 Chrome 152 双向 parse → schema → own → hash → consumer 校验。每档每候选每方向三条记录；显式源码路径集合和当前文件 SHA、manifest、逐条内容与数量先于编码核验。

## 包体字节数

| registered actors | 记录                          |    C0 |    C1 |    C2 |
| ----------------- | ----------------------------- | ----: | ----: | ----: |
| 32                | correction                    |   551 |   198 |   145 |
| 32                | pose（34 实体）               |  5159 |  2396 |  1743 |
| 32                | Gameplay v2（33 非玩家实体）  |  5906 |  2755 |  3135 |
| 128               | correction                    |   523 |   181 |   137 |
| 128               | pose（130 实体）              | 19094 |  9075 |  6695 |
| 128               | Gameplay v2（129 非玩家实体） | 21431 | 10544 | 12270 |

这里包括当前参考 metadata，不能换算成最终产品带宽；两档的 seed、epoch 和世界状态各自独立，也不能把 correction 的差异解释为 actor 密度成本。没有改变参考预算或裁剪数据。以前长 identifier 的 C0 metadata 表示限制仍存在，本次短 identifier 语料通过不能消除该限制。

## 证据与限制

[结构化证据](network-density-codec-evidence.json) 保存 UTC、Node/Chrome 版本、两档 corpus/manifest、逐候选字节数、浏览器 fixture/bundle 和原型源码 SHA。浏览器运行于 2026-09-07 04:49:27–28 UTC，Node 22.23.2、Chrome 152.0.7977.76；本次 bundle SHA 与旧九条 corpus 的历史运行不同，各自按实际产物独立绑定，没有把旧 bundle 的结果移植到本次。

原型位于 `/tmp/seedlands-network-probe-codec-consumer-v2`，没有进入生产代码、测试导入或构建入口。浏览器通过 loopback HTTP 取得校验 fixture，证明两端编解码互通；实际游戏 transport、client adapter、GUI、重连、WAN 仍未在本切片验证。没有采集任何性能计时，不据此冻结 codec 或宣称 Node 迁移收益。
