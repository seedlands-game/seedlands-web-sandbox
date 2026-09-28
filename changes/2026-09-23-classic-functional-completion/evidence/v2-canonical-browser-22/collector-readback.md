# Browser22 collector readback

首次 raw collector 在复制 canonical receipt、runtime failure、error context、Playwright last-run 与 5 张 drop PNG
后以 exit 1 结束；原因是随后尝试读取一个不存在的 failure-frame 路径。该次命令没有保存独立 stdout，具体错误路径为
`NOT_RECORDED`，不补造。上述已复制文件保持原字节。

`failure-screencast-frame.jpeg` 不是 Playwright 独立 screenshot attachment，而是后续从原 trace 的最后一个失败前
screencast resource `page@da3b269eb0e28e52c39a72efc232e91c-1790600281268.jpeg` 原字节复制；其 SHA-256 为
`d2d22976b7ee1262d0c9798da15d47400b3b311f9d465fe9790dc447a9a6bd6f`。

`workbench-route-summary.json.log` 是既有临时解析器按 `startTime >= 389000` 生成的子窗口，记录 140 个 snapshot；
它不是完整失败 leg。`diagnosis.json` 的 144 snapshot / 111 mouse move / 8 对 KeyS 统计从
`workbench-route-calls.json.log` 的 `@8674`（`388570.806ms`）到 `@9386` 完整区间重新机械计算。

GIT38 提交前的自然 hook 发现四份机械导出使用 `.json` 后缀时会被 Prettier 当作可编辑 JSON；本次仅将其原字节
改名为 `.json.log`。四份内容 SHA-256、Browser22 FAIL、trace、source 和报告叙事均未变化；旧审批 metadata 与路径
映射保存在 `../git-38-post-drift-direction/prior-packaging/`。

首次手工 selfcheck 错误地在 evidence 目录执行 acceptance-relative `SOURCE-MANIFEST.sha256`，因此 15 条均报告
`FAILED open or read` 并以 exit 1 结束；该输出未重定向到文件。正式 selfcheck 必须从 acceptance tree 校验 SOURCE，
再从 evidence 目录校验 MANIFEST。该失误没有改 source、raw、manifest 或 artifact。
