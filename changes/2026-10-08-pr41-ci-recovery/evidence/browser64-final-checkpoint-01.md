# Browser64 真实终态

- runId：`pr41-classic-browser64-01`；source SHA：`e71dbe2800f1edb9b58e6db37cb029f111a6251a`。
- identified build 实际 EXIT0，builtAt `2026-10-09T20:41:34.547Z`，284 files。sourceDigest `5efe4d5057d6a8e64eae784675dce950afcce509d62a5d9859840165d3c77c6d`，artifactDigest `41d4f632d6033029c4a72d3cf461127eebe35b11a920418180f5a147c72b07c1`，lockDigest `44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`。
- 原唯一完整 `pnpm harness:classic` PTY43357于20:49:14UTC实际 EXIT1；main 5.0min FAIL，visual 1.0min FAIL，Modular SKIP。正式receipt只记录C0/C1 PASS；C2采集 `[38,31,0]` 在既有range guard失败，未到C3、crop、V1/V2、C4/C5、death/save/194。
- 视觉失败发生在原lighting/revision 20秒predicate，尚未到single-click acceptance。不能把前一run的visual PASS当当前PASS，也不能从步骤耗时行推导阶段成功。

## 定向只读诊断

键盘附件COMPLETE，当前document内42个可信edges、21对完整非repeat按键、0 dropped、0 unmatched；PointerLock均为game。最后S100的回调dispatch间隔609.5ms，event.timeStamp间隔123.7ms；两种时钟代表不同边界，不等于Authority消费时长或输入协议根因。附件为diagnosticOnly/eligible=false，不是CPU或whole-frame性能证据。

原0-trace观察显示：目标中心距离需要原 `[2.5,4.5]` band。player从 `[39.10158157348633,33.60000228881836,0.4862043261528015]` 经第一次原S100停在 `[36.24327850341797,32.599998474121094,0.4921601712703705]`，Authority位置对应且已grounded/noncollision/velocity0，距离约2.51。旧固定approach仍发第二S100，停在 `[33.54338073730469,32.599998474121094,0.5105381011962891]`，超过5，原guard如实拒绝。该观察支持mineVoxel消费边界的checkpoint65，不支持改变physics/input lease/late policy。

## 保存与限制

本云实例私有目录 `/workspace/pr41-recovery-20261008-root-01/` 保留 `classic-browser-64-01.log`、`production-build-64-01.log`、`browser64-final-checkpoint-01.md`、`browser64-keyboard-timing-01.json`、`browser64-keyboard-pairs-01.json`、`browser64-route-input-observations-01.json`。canonical receipt在 `harness/results/pr41-classic-browser64-01/classic.json`，两条原trace及error-context随当前test-results保留，后续只移动至独立保留目录。未复制或改写sealed evidence。

21:15UTC远端精确SHA CI run37988586835已自然终态：deterministic/build/headless/architecture/static均SUCCESS，Chromium FAIL，部署SKIP。原job114017053286日志两次主旅程均C4返回walkTo（spec333/harness266/130）耗尽原900秒，V2步骤8.4/8.8min仅耗时记录而非独立PASS证明；Visual1.0min PASS、Modular SKIP。本地C2 FAIL与远端C4 FAIL分别记录，不混为同一故障。私有精确错误摘录ci64-chromium-errors-01.log保留，不取消或重跑原CI。PR仍Draft/open/unmerged；本地FAIL与CI静态绿色均不能宣称可合入。统一lighting、正式transport全链、Modular、非空旧V4迁移、完整194与组合整帧性能仍未准出。

长期docs baseline不更新：本记录只补具体run终态，不改变产品/架构/性能合同或验收门槛。
