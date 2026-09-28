# GIT36 冻结证据格式事实附录

本附录只补充 GIT36 evidence commit 的 hook 事实，不修改 GIT36、MAP01、Close11 或 Browser20 的既有
SOURCE/MANIFEST/delivery。

第一次自然 `git commit` hook 失败。原始输出位于本任务统一执行 session `31060`，首段 chunk `b2d501`，最终失败段
chunk `63327a`。`lint-staged` 的 `prettier --check` 精确报告以下三份已批准 immutable MAP01 文件不符合当前格式：

- `changes/2026-09-23-classic-functional-completion/evidence/v1-browser20-route-aim-contract-map-01/README.md`
- `changes/2026-09-23-classic-functional-completion/evidence/v1-browser20-route-aim-contract-map-01/delivery-validation.json`
- `changes/2026-09-23-classic-functional-completion/evidence/v1-browser20-route-aim-contract-map-01/diagnosis.json`

原 hook 没有单独写仓库 raw 文件；上述 session/chunk 是原始工具输出所在句柄，本附录是事实转录，不冒充 raw。三文件
当时及提交后 SHA-256 分别保持
`1b591fa9f2541a7e2927652b7179249017cd6e581fd3d30f52c8961e97a90c20`、
`852f5fac254fd209235eec0813613d241ba1226b45da560aed72cd13be9a2d45`、
`8800d6fdcba5a07f2b36137bdf714721e782e4dee4a95d3dd94f51288dd8841b`。

为保留这些冻结字节，提交者曾在工作树 `.prettierignore` 临时加入且未 stage 以上三个精确路径，再次执行自然 hook后
提交成功，随后立即删除临时条目；`.prettierignore` 最终相对 HEAD 无 diff。该事实意味着：

- GIT36 四路径源码隔离 Prettier 门禁确实 PASS。
- GIT36 可编辑 evidence/state 的显式 Prettier 检查确实 PASS。
- 上述三份 MAP01 冻结文件**没有通过**该次 Prettier 检查，不能归入“全部 evidence 自然 format PASS”。
- 后续不得再次临时修改 ignore 绕过冻结文件格式失败；需要提交同类文件时，必须先由 root 冻结明确的包装、重命名或
  持久豁免合同。
