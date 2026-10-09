# checkpoint45：完整 observation 组件 A/A 否决，候选已撤回

实验前的估时、单轴、固定输入、warmup/sample、阈值、停止条件在本组 spec 预注册。源码基于 `5d91421ecbd6a57ecc255f476cb41bb6614c236f`，候选 worktree digest `8688065bfdbc7efdc18c44e17e668d0f68aab550e5f42b7fcda84eaf2cd2db02`、lock `44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`、bundle `ded1ff0a2e89cfb4faf5c8d390f265f2d40455e9215534f789aab87f72adba4b`、corpus `8e2d3d272b88dfa1084ce2112e0d602fdec45e33b8f0863f31b80d4fca83af32`。

实际 Node22.23.3/linux/x64、machine reservation 独占，未并行测试或构建。50 synthetic pose 在同一个真实 GameServer canonical Chunk 上，全部 output 两轮深比较相同；每 sample 先 warmup200 次再计时200次完整 buildLogicObservation，包含 actor/entity/POI clone、bounds 与 occupancy 构造。未包含 Worker transfer、GPU 或浏览器原始完整负载。cache峰值2023/32768 cells。

UTC10:05:37.758–10:05:38.427，四对 A/A 交错的原始墙钟毫秒为：

| pair | order | A1 ms              | A2 ms              | abs/min noise %    |
| ---- | ----- | ------------------ | ------------------ | ------------------ |
| 0    | A1/A2 | 42.06638299999997  | 39.599519999999984 | 6.229527529626598  |
| 1    | A2/A1 | 38.03388300000006  | 43.80528299999992  | 15.174364395031265 |
| 2    | A1/A2 | 49.281146000000035 | 37.269209000000046 | 32.23019034291813  |
| 3    | A2/A1 | 38.66385300000002  | 37.930356000000074 | 1.933799408579085  |

最大32.23019034291813%超过预注册15%，status `A_A_NOISE_FAIL`、A/B `NOT_RUN`、eligible=false。进程及reservation均exit1、无signal。没有重试、增样本、四舍五入越过门槛或改变输入/renderer/线程/trace/期限/断言；立即恢复生产 A，候选不采用、不作性能或FPS收益声明。

根私有证据目录 `/workspace/pr41-recovery-20261008-root-01` 保留 `logic-terrain-component-45-01.json`、同名log/reservation（measurement SHA256 `863f9a4bc4f1a703dd7fe4b69ec5748993b5ee9eda4bf35914a94c509da65089`）、benchmark TS/MJS v1/v2与 `logic-terrain-withdrawn-candidate-45-01` 中9个精确候选文件、patch及SHA256 manifest。v1仅准备未采样；v2在首个样本前更正奇数pair标签映射，未改变计时阈值。旧sealed evidence不改。

可执行实际RED为6/6缺cache导出失败；最终cache fixture6/6 PASS，真实GameServer consumer两例加原default builder两例4/4 PASS。早期错误profile、Chunk Y、边长16假设与readonly resolver赋值失败原日志保留；真实Chunk边长32，未改生产常量/使用类型绕过。最终agent证据在 `/workspace/pr41-recovery-20261008-fixtures-01/logic-terrain-cache-92-green-01.log` 与准确correction报告。

`logic-terrain-static-45-01.log` 的完整verify:static:ci退出2：sealed5/5、format/paths/lint、生产types和Svelte0/0已PASS，root types因夹具readonly resolver赋值失败。修复仅该夹具与文档后 `logic-terrain-static-remainder-45-01.log` 实际exit0，root/Classic types、ESLint规则与CI选择全部PASS。这是复用有效阶段并补齐余项，不伪称原完整命令exit0。撤回后无候选生产变更，未构建或再跑浏览器。

Browser34 的精确Authority Worker采样实际COMPLETE：1701 samples、Node capture20.042772417秒、V8 deltas20.27291秒。函数合并createTerrainWindow self1.922548秒、buildLogicObservation inclusive2.660231秒只是候选线索，嵌套指标不可相加，不能推翻此次否决。

远端精确5d91421 CI run37910217197：五项SUCCESS，Chromium FAIL、Cloudflare SKIP；首次铁资源路线超时，retry1 V1门交互期望[2,2]实得[2,0]。本地Browser34 main FAIL、visual PASS、Modular SKIP；C5、全194、真实Modular及组合整帧 A/A/A/B仍未完成，PR不可合入。最新真实周额度09:40 UTC剩87%，约60%停止线不变。此组有界风险核对不等于整PR正式review。
