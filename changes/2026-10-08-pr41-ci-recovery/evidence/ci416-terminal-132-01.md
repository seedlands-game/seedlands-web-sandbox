# CI416 终态与下一诊断边界

2026-10-10 16:45UTC，精确远端 `dcb39a9e742bb859b691f7dfd38c89a3f5407e97` 的 [CI416](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/38065570619) 已自然结束，没有取消或重跑。Architecture、Production build、Deterministic module tests、Static verification SUCCESS；Classic headless FAILURE；Chromium FAILURE；Deploy Cloudflare Pages SKIPPED。

Headless 为 150 文件、1030 例，4 FAIL / 1026 PASS。失败是两处间接 walkTo 夹具遗漏新释放观察，129 在原两文件取得 RED 4 FAIL / 14 PASS 后补显式合成协议字段；7 文件 82 PASS、Classic types、范围 lint 和正常提交 hooks PASS。本地 `183f339d5a0df029f64494a8a167451fe70f3f28` 尚未在远端验收，不改写 CI416 的失败。

Chromium 为 1 FAIL / 1 SKIP / 2 PASS，32.4 分钟。两轮主旅程都完成 V1，V2 分别约 11.3 / 11.9 分钟后触及原 900000ms 整场上限。第一次中断于 placeOneEach 的 committedPointer 等待，重试中断于铁头盔结果按钮的 Shift-click；两者都不能单凭中断位置认定为合成生产缺陷。C4/C5 均未运行。原 visual（包括冷来源阶段）1.0 分钟 PASS；普通 native 矿车 23.3 秒 PASS；Modular 条件 SKIP。完整玩法和最终 SHA 验收仍未闭合。

原 Node 日志中两轮各 57 条 V2 路线，全部 status returned。第一轮 450 个脉冲、路线累计 472663ms，第二轮 416 个脉冲、437029ms；合计原键盘 API 墙钟 154702ms、脉冲开始至输入前的校正观察 319882ms、输入结束至首次匹配停稳观察 364823ms。它们是已有诊断记录的分段和，不是精确服务器 ACK 时间、GPU 成本、性能样本或瓶颈因果，不能作为优化准入。260 条资源操作诊断全部 returned；操作计时与路线计时有包含关系，不得相加。输入拒绝计数属于整个 client lifetime，不能归属于 V2 某条命令。

完整 Chromium 原日志在私有环境 `ci416-chromium-raw-132-01.log`，1595197 bytes，SHA256 `20273a92d62a6f2306f7411d05f1033807491c8de621069682b5f6ac25839af6`；解析保存于独立 `ci416-parsed-132-01.json` 和 `ci416-operations-132-01.json`。正确资源诊断 marker 是 `Classic V2 resource operation diagnostic:`，旧解析器寻找 `Classic V2 operation diagnostic:` 的 0 条不能解释为没有操作记录。远端 ZIP 未传入环境，未声称看过 CI416 UI 附件。

130 只将已有 snapshot 的释放 epoch/sequence/neutral 复制到原 Node route 诊断，RED 1 FAIL / 5 PASS 后相关 5 文件 50 PASS、Classic types/lint/hooks PASS；本地 `50e8faf1289048c2c6b302d6e367b9118fdf1678` 尚未远端验收。没有增加浏览器 query、输入、等待或改变时限/容差/判定。

PR 保持 Draft / 不可合入。下一正常 feature push 交付 129/130 与本诊断，生产 push 仅 main、既有 PR preview 边界不变；不 merge、automerge 或生产部署。随后用既有唯一主旅程的精确 Authority Worker CPU 诊断补当前生产来源的工作分布，不能以同源重复盼绿替代原因证据。最新主对话产品 UI 为 16:03UTC 周剩 74%、4d11h 重置，约 60% 停止线保持；不由时间或 token/credits 推算额度。
