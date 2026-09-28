# Browser23 Raw Packaging Recovery 前件

本目录冻结 `GIT39-BROWSER23-RAW-PACKAGING-RECOVERY` 修改前的 21 个文件。
`files/` 下保持仓库相对路径；唯一会触发 Markdown hook 的 raw 副本增加 `.log` 包装后缀，其原路径由映射单独记录。
`PRIOR-MANIFEST.sha256` 对这些副本逐项校验；归档时每个副本均与原路径 `cmp` 一致。

唯一 raw 变更是归档路径从
`changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-23/attachments/test-0-error-context.md`
改为同目录 `test-0-error-context.md.log`。旧、新与归档副本均为 2800 bytes、SHA-256
`499ae94ac08d04e70cc7e1775ca03a453b7c1daae16fd5f3b26209652c31a573`；内容没有格式化或改写。

`raw-path-mapping.json` 记录旧、新归档路径与 Playwright 原 attachment identity。
`metadata-identity-mapping.json` 记录 Browser23、MAP01 和 GIT39 在包装恢复前后的 manifest/delivery 关系；归档还包含
修改前的 `tasks.md` 与 `execution-state.md`。旧身份是当时的
冻结事实，不以当前路径重算；当前身份只 supersede 包装层，不改变 Browser23 正式 FAIL、trace incomplete、预算诊断、
Close15/Close16/null closure 或第一笔代码提交。
