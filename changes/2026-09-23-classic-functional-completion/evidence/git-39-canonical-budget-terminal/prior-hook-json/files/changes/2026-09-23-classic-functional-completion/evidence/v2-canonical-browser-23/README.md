# V2 Canonical Browser 23

状态：`FAIL_EVIDENCE_SEALED`。唯一实际 Browser attempt 使用 BUILD14 source
`0eafd4273bc1f5a23e7d147ded37801436074015`，单 worker、单 Chromium、retry 0。Playwright 主测试最终为
`timedOut`，runner exit 1；Classic 视觉测试 PASS，non-Classic smoke SKIPPED。receipt 中同一主 test 有一个 afterEach
FAIL record 和一个稍后写出的 detailed record；二者 `attempt=0`，不是两次 browser attempt。detailed record 的本地
`status=PASS` 只表示它写出时 C0-C5、pageErrors 和 failedResponses 条件满足，不能覆盖 runner 与 aggregate receipt 的 FAIL。

2026-09-29 的 `GIT39-BROWSER23-RAW-PACKAGING-RECOVERY` 只把归档附件
`attachments/test-0-error-context.md` 更名为 `attachments/test-0-error-context.md.log`，以免自然 pre-commit hook
把机械 Playwright raw 当作 Markdown 格式化。原 attachment 名称 `error-context`、`contentType=text/markdown`、report 内
`sourcePath` 和运行原件保持历史事实；新旧归档路径字节均为 2800 bytes、SHA-256
`499ae94ac08d04e70cc7e1775ca03a453b7c1daae16fd5f3b26209652c31a573`。旧 SOURCE22/MANIFEST127/delivery 与
本轮所有将变 metadata 原字节保存在
`../git-39-canonical-budget-terminal/prior-packaging/`，当前 manifest/delivery 只 supersede 包装身份，不改变 Browser23 FAIL、
trace incomplete 或任何阶段结论。

## 实际到达

C0-C3、完整 V1、V2、C4 和 C5 的 Playwright step 都返回。V2 receipt 记录 19 个 checkpoint：资源放置、三格
wood 入包、木镐、三格 stone 入包、石镐、四格 iron block 入包、iron unpack 后五件铁甲、四槽 click/Shift、错槽零
变化、occupied swap、detach/store/quick-move、equipment-origin close 和 workbench 回收入包。资源 helper 在每格采矿后
独立断言 `itemCount` 增长；直接 checkpoint 记录 wood `3`、cobblestone `3`、iron-block `4`，不使用
`worldItems=0` 证明背包。石镐耐久为 `132 -> 128 -> 127`。

C5 完成时记录 pre-save runtime/actor epoch `1/1`，restore 后为 `2/2`、lifetime 仍 `1`；inventory revision `143`
保持，继续装备操作后为 `145`；四槽铁甲、armorPoints `15` 和石镐耐久 `127` 保持。fixture 已执行 V1 media 的
resume/eject/audio idle 断言，但这些值没有并入 `restoreEvidence`，因此只标为 completed call-chain assertion。对象新引用没有
直接断言或序列化，标 `NOT_RECORDED_NOT_ASSERTED`。death、equipment death-drop、respawn 没有运行。

## 正式失败

主 test 从 `2026-09-28T15:45:04.247Z` 开始；C5 在 `+718,819ms` 完成，重开后玻璃步骤在 `+718,822ms`
开始。`+720,000ms` 的整体 test timeout 在该步骤中触发；afterEach 于 `+720,773ms` 附加 failure record。清理中的
在途调用随后仍写出玻璃截图、V5 钻石块截图、删除世界、audio release、detailed evidence 以及最终空错误断言，最后
context teardown 再触发 `30,000ms` timeout。该时序只能证明断言链在 timeout 后的清理阶段继续完成，不能把整体结果提升为
PASS，也不能据此预选修复。

## Trace 边界

原 Playwright trace 在 producer 退出后稳定为 `1,269,815,136` bytes、SHA-256
`fa61f3c1962a0134a85c9cb72eee911f141804f04cc39f764a3d949ca5fbcc48`。原字节无损切成 25 个最大 50 MiB
分片，流式重组 SHA 相同；这只证明封存字节一致。`zipinfo -t` exit 9，明确缺少 EOCD/中央目录，所以原 trace 不是
完整可解析 ZIP。

仅对 task-owned 字节相同副本运行一次 `zip -FF`。工具把文件当作缺失 `raw-copy.z01` 的 split archive，持续等待
交互；有界五分钟后以 exit 130 终止，没有生成 recovered ZIP。失败 stdout 原始长度/SHA 固定后无损 gzip，并再次切为
三个最大 50 MiB 分片。局部只读 header 仅恢复 offset 0 的首个 local header 名称；完整条目和缺失范围均未知。
`trace-recovery-analysis.json` 因此明确标记 `RECOVERED_PARTIAL_METADATA_ONLY`，不替代 raw。

Playwright HTML report 的内嵌 report ZIP 在正确剥离 data URL 前缀后可完整校验，SHA-256
`e810e3ce17de7c1b927016a66a7402964b65ee00093c11f7da7914a52b5a112e`；它用于机械映射 step 和附件，不修复
trace。首次未剥前缀的提取失败也原样保留。

## 后验与边界

唯一 artifact postcheck `v2-canonical-browser-23-artifact-postcheck` PASS，未重跑。source/tree/digest、lock、artifact、
builtAt、276 项 map 和 277-file 磁盘闭包与 BUILD14 一致。验收树 tracked/index clean，4273、owned browser/preview
进程和机器锁均为 0。没有运行 Browser24、Cua、build、CI、Git/index、push、deploy、merge 或实现修复。
