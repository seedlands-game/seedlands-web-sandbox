# 当前轨道配置的原生普通矿车验收 135-02

精确生产源 `b705f3706a8c43d947d9909b05854aca321cf9dc` 的 identified build PASS；sourceDigest `cb7cc554575562fbacf350211af26e2207fa5a19373b648ed647eac9390ed6b1`、artifactDigest `fe182af48fecd80ee0fa9878e0406ffa2efa948de2c6e3f8275e6d197e358972`、lockDigest `882341009384ae16f18f58723d04656da8564759dc8386d871268c5b5521aa71`，289 文件，builtAt 17:24:48.677Z。旧 356ec528 dist 保留在独立私有目录；浏览器读取的 artifact identity 与回执一致。

仅运行原唯一 Classic spec 中既有普通矿车用例，原 120000ms 及全部断言保持。真实右键部署与上车、键盘移动至原轨道末端、真实 Shift 右键下车、原保存/重载/epoch/lifetime/状态与实际模型恢复通过：1 PASS，原用例 48.0 秒，runner 51.5 秒，runId `pr41-route-shapes-native-135-02`。benchmark、所有 sampler、low-core fault injection 均未启用；SwiftShader WebGL2 是既有 Cloud 浏览器环境，非实体 GPU 性能证据。

native JSON 中 deployed/mounted 从 `[2.5,31,0.5]` 到 moved/dismounted `[9,31,0.5]`；restore 保持 cell `[8,31,0]` 与 progress 1、carrier `transport-2` lifetime 2，epoch 1→2，rider 已下车，速度零。Root 查看原 deployed/restored 两张 PNG，模型呈现在轨道上；没有将两图宣称为新曲线/坡道外观或连续帧性能证据。

135-01 的初次 grep 使用起始锚点，匹配不到 Playwright 完整标题，0 tests FAIL。该原日志保留；collection-only 明确选择一个原用例后以新 135-02 run 执行，没有改源码、输入、超时或断言。中途解析 HTML 时先错误匹配 favicon base64、随后只得到 report JSON；最终从原 report 的 inline JSON attachment body 提取 native 数据，正确派生文件 `route-shapes-native-browser-attachments-135-04.json`，保留早期派生文件，不将其冒充 native attachment。

现有 Luna 仅一轮有界独立审阅 Root 共享 resolver/identity/current V4 predecessor，冻结 base356ec528/headb705f370，未发现范围内可证实 P0/P1/P2。Luna 自己写的 Classic 配置不算其独立覆盖；报告未执行验证且不作合并批准。Root核对精确 identity constant 与实际 fixture composition 深相等。审阅原文保留在私有路径，checksum 见 validation。

此结果是 NON_MAIN，不能代替当前完整主旅程、corner/slope 原生驾驶、neighbor-aware mesh、其余运输矩阵或性能 A/A/A/B。CI417 旧356ec528已终态主旅程失败，C4/C5未运行；135需推送后的精确最终 CI。PR仍Draft/不可合入，无merge、automerge、main push或生产发布。
