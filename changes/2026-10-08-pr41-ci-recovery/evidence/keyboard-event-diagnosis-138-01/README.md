# 原生键盘事件诊断138

一次原完整主旅程在 identified source `53d29c1f`（生产源码 `b47a6c22`）上运行，C0–C3 与 Creative 通过，V1 首水区 approach `[66,2.5]` 越过固定支撑面跌落失败；V2/C4/C5 未到达。所有原输入、超时、predicate、断言、低质量与 SwiftShader 保持，只开启既有被动 keyboard timing，其他 sampler/benchmark 关闭。build 与产物完整身份验证通过；这不是性能验收。

最后两次 KeyS 请求 300ms/200.97ms；真实事件 timeStamp 间隔 340ms/458.6ms，handler observation 间隔 517.7ms/675.3ms，末次 keyup handling 延迟 240ms。事件可信、Pointer Lock/visible 保持；松键最终已获 Authority 确认。trace 快照确认末次由 `[66.4353,32.6000,1.7073]` 越界到 `[64.8859,19.6000,4.6351]`，不扩大 fixture、不删跌落断言、不盲重跑。

事件时间、handler 时间与 Playwright call wall time分别记录，不能替代实际 command target tick 或 Authority 消费时刻。该失败阶段与 CI418 V2 不同；主线程 CPU、native/GPU 因果仍未知。有界只读输入 Owner 审计未证实调度缺陷，不能据猜测写 hotfix。最终 trace screencast PNG/JPEG 已实际查看，仅显示夜间工作台场景，不作为完整玩法通过证据。

完整原始结果、220事件/110 pair、trace 与路线快照保留在独立私有路径，精确字节摘要见 validation.json。136 四个 supported slope 反例仍开放，CI419 自然运行。PR 仍不可合入。长期 docs baseline 未变；实际 UI17:54 周剩余74%，约60%停止线，云端不能直接读取 UI。
