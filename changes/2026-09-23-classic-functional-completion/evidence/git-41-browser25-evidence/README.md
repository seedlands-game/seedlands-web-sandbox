# GIT-41 Browser25 Evidence

阶段：`GIT-41-BROWSER25-EVIDENCE`。baseline 为
`783e106fb5fcba4869bcc8d0aab68ada1df827a7`。本阶段只封存 root 已独立验收的 Browser25 evidence、累计 Browser 报告和
当前状态，不修改生产、配置、测试、runner、合同或长期文档，也不重跑 Browser、build、artifact 或行为门禁。

Browser25 的冻结 source 为 `fdb53c07c0da14c7f523473e4f33060a385f23ff`，SOURCE6、MANIFEST84 与最终 delivery
分别为 `c0d37c2742c8a9627c4839d0cde0c1d5eb7dd17cdfff4c39bd13c7064d8c49eb`、
`78b45e794bb2688cb75acf4756df80fc6691b456e7881eff14f210c713722a2c` 和
`f227181902cecbe52d7b45e666c8ac9c4a0cc8e227b38df56f84988ac2942838`。旧 delivery
`3d790c9de1cdd459f74532f20ec8f625c859dd17451bd7bdb40f600c035dcf2c` 仅是实际完整命令写回前的 superseded
值，不是本阶段交付身份。

Browser25 证明其唯一 canonical attempt 的 C0-C5、完整 V1、V2 19 checkpoint、保存恢复与 Classic visual PASS，
默认 non-Classic smoke SKIPPED。成功运行依 `retain-on-failure` 未保留 trace，状态是
`NOT_RETAINED_BY_CONFIG`。new object reference、death/drop/respawn、完整 16 armor/194 item matrix、V3/V4、Cua/
人类听觉和性能仍未验收；Browser24 保持 discovery 前 FAIL/Chromium 0，Browser23 保持 FAIL/TRACE_INCOMPLETE。

`evidence.paths` 是本提交精确 allowlist。`SOURCE-MANIFEST.sha256` 绑定 Browser25 三元组与本次三份状态/累计文档；
`MANIFEST.sha256` 只覆盖本目录中不形成自引用的元数据和格式窗口。根 manifest、delivery 以及 final selfcheck 的
stdout/window 明确排除，最终提交仍由自然 hooks 和远端读回完成。

首次 final selfcheck 在全部严格 hash、tail、scope 与 blob 检查通过后，因 sparse tree 未检出 workspace package manifests，
`pnpm exec prettier` 在实际启动 Prettier 前失败。两份 `final-selfcheck-workspace-sparse-failure.*.log` 保留原始失败；closure
改为直接调用已安装的 Prettier binary，并为自然 hooks 补齐仓库 workspace manifests，不改变格式规则或跳过 hook。
