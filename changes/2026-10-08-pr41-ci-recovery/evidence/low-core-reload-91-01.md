# 矿车重载性能提示 RED/GREEN

本片证明唯一 Classic 原生矿车线路在重载后能通过实际性能提示继续；不是完整主旅程、运输矩阵或性能验收。默认正式 CI 不设置故障标志。

| 项目          | RED                                                                | GREEN                                                              |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| source SHA    | `589ed99cfcac9e23ec7c3d0083ba7b35e07e946d`                         | `eda37826c14c637c20b4b8dab202f3ecc5ff7177`                         |
| source digest | `4e6bd22366477f31f310e4ad98725b7942d02de0e269f28f01e0a14894ee973b` | `8f947a7b8534d33f151ca7a3f6667f565cf3264692d01dcc200de8ccf0623083` |
| run ID        | `pr41-low-core-reload-red-browser91-01`                            | `pr41-low-core-reload-green-browser91-01`                          |
| 终态          | FAIL：原 reload start-card 10000ms                                 | PASS：原 native 用例约1.4分钟                                      |
| receipt       | NON_MAIN / attempts空                                              | NON_MAIN / attempts空                                              |

两次 artifact digest 均为 `399aea0a6e0bc1bb6a1874973cbf62f8e4b794e3d91ad3eada95643e02fda956`；生产字节未改。lock digest 为 `44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`。

显式故障标志 `SEEDLANDS_CLASSIC_NATIVE_LOW_CORE_DIAGNOSTIC=1` 保留真实 advertised 核心数5，并仅在测试中覆盖为4。RED 的实际页面文本包含“性能提示”“当前浏览器估算可用 4 个核心”“仍然进入”，start-card仍可见、游戏 Harness 尚未创建。它不是实际4核心硬件或性能样本，`diagnosticOnly=true / eligible=false`；benchmark 与此标志并用会拒绝。

修复从初次启动提取已有确认步骤，reload 后点击真实“仍然进入”，保留原120000/10000ms、右键上车、W行驶、Shift右键下车、保存重开、位置/rider/引用新鲜度与模型断言。GREEN 原始附件 `classic-minecart-native-input.json` 为85731字节，SHA-256 `011e9a38a53de7e4e7bcd4bb37f95d7245c49187201951870d4002304af82d8b`；恢复pose为`[9,31,0.5]`、epoch2、rider=null，旧epoch1 stale、新epoch2 current。

Classic类型、范围lint/格式、路径、冻结5/5、commit hook、identified build通过。首次pre-RED类型检查因nullable诊断失败，修正后通过；首次GREEN HTML提取遇header-only引用失败，空目录与原脚本保留，第二次验证唯一实际raw payload成功。原RED日志、HTML、error-context和trace保留在独立私有run路径，不改sealed evidence。

Root范围审查确认只复用实际启动确认步骤，不增加导航、不降断言或延长预算。实际CI407 ZIP尚未物化，本地故障不能冒充远端native根因；CI407 Chromium FAIL/C4未闭合、完整lighting/运输/194矩阵缺口继续保留。长期docs未更新，因为无production owner、协议或存档语义变化。最新产品UI由主对话于06:10UTC实测剩80%、4天20小时重置，约60%停止线保持。
