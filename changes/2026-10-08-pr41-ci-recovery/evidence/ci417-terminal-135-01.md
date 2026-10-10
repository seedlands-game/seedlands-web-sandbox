# CI417 原始终态

2026-10-10 17:24 UTC readonly 观察 run38069100063 精确 `356ec528a19d574867631a5e5851284e2a206be1`：Architecture、Production build、Deterministic、Classic headless、Static verification 五项 SUCCESS；Chromium FAIL，原 PR preview SKIP。PR仍Draft/mergeable=true，不代表可合入。

Chromium 原 32.0m：主旅程首轮15.2m在V2 resource/armor route 的 waitForSnapshot 触及整场900000ms；诊断重试14.2m在原45sec路线到 `[78.5,-0.5]` 超时。两次均触达C0/C1/C2/C3/Creative/V1，V1分别2.0m/1.8m，V2分别9.3m/8.3m失败。C4/C5未运行。原visual 1.6m PASS、普通矿车32.5sec PASS、原Modular SKIP；合计1FAIL/1SKIP/2PASS。没有把step返回时长当通过或性能因果。

原132条 V2 operation diagnostic 为131 returned/1 threw；39条 route pulse diagnostic 为37 returned/2 threw，共236 pulses。两个 route failure 是首轮 `[82.5,2.5]` 2528ms（全球900sec截断，不是45sec先到），重试 `[78.5,-0.5]` 45203ms/18pulses（明确原45sec到期）。重试末pulse开始 player约 `[79.0401,32.6,-0.5028]`，离目标仍约0.54，18号pulse未发键。已观测的首pulse真实KeyS release为本epoch neutral/sequence6562、ACK6563且实际authority移动；不能把该失败描述为全程没有原生release或没有移动，也不能凭此判定生产热点。原时限、断言、路线与输入未修改，失败原因仍待正式证据。

完整 decoded raw `/workspace/pr41-recovery-20261008-root-01/ci417-chromium-raw-135-01.log`：723656 bytes，SHA256 `ef37536dfba7a594aeec44d84def1573f3cc1a53a503b57e807b93867d46086d`。从连接器原日志保存时工具加的末尾空行已校正，LF1079/字符718676与原解码字符串一致。派生 `/workspace/pr41-recovery-20261008-root-01/ci417-route-operations-135-01.json` 保留完整JSON对象。计时仅diagnosticOnly/eligible=false，不作可加和性能样本，不作GPU/Worker因果结论，没有下载新外部artifact或扩网络。

133本地带sampler诊断仍是 C0后的Authority request165原30000ms早期失败、metadata NOT_STARTED，未采到V2，不能拿它解释本CI417。135新的当前native通过另有独立source/run身份，不覆盖此终态。预算最新真实UI仍16:55周74%共享账户、约60停止线。
