# V2 Canonical Browser 25

唯一 canonical 命令在 BUILD16 冻结 production artifact 上 PASS：Playwright `2 passed / 1 skipped`，canonical main
和 Classic visual 通过，默认 non-Classic smoke 跳过。terminal receipt 是唯一 retry 0 main attempt，selection 为唯一
`CANONICAL_MAIN`，runner/assertion 均 PASS，无 failure attachment、page error 或 failed response。

本目录保留 runner/window、terminal receipt、Playwright HTML report、完整内嵌 report ZIP、31 个 report 文件附件、24 个
inline JSON 附件及其映射。报告 ZIP 的一次 `unzip -t` PASS；它不是 trace。成功运行按 `retain-on-failure` 没有生成
trace，状态为 `NOT_RETAINED_BY_CONFIG`。

V2 receipt 有 19 个 checkpoint，覆盖 wood/cobblestone/iron 独立入包、工具/五件铁甲制作、四槽 pointer
wrong-slot/swap/detach/store/quick-move/close、workbench 回收与保存恢复。唯一 artifact postcheck PASS，产物身份未漂移。
报告派生脚本前两次因分别传错附件数据根和 report summary 根而在生成完整摘要前退出；错误只发生于 Browser 结束后的
task-owned 解析过程，未影响或重跑 canonical/POST artifact 命令。最终解析以原 report JSON 与附件逐字节校验通过为准。

本轮未断言 new object reference、death/drop/respawn、完整 16 armor/194 item matrix 或 V3/V4；Cua、人类听觉和性能
测量未运行。Browser25 PASS 不代表完整产品交付。
