# Browser23 Hook JSON 包装前件

本目录冻结四份 Browser23 机械 JSON raw 改为 `.json.log` 前的 26 个文件。四份 raw 的归档副本自身也使用 `.log`
后缀，避免再次进入自然 Prettier hook；`raw-path-mapping.json` 保留原路径，`PRIOR-MANIFEST.sha256` 对副本逐项校验。

归档还包含包装前的 Browser23/MAP/GIT39 identity、累计报告、tasks/execution-state 及两份将调整的校验器。创建副本时
逐项 `cmp` 通过。首次重算 prior manifest 时误用 zsh 保留变量 `path`，导致 `shasum` 不可见；失败说明保留，重试使用
`filepath` 并对当时 24 项通过；覆盖 canonical selfcheck 前又补入其上一轮 PASS stdout/window，最终 26 项全部通过。

本恢复只改变四个归档路径和必要 identity/说明，不改 raw 字节、acceptance、运行结果或诊断结论。Browser23 仍为
正式 FAIL，trace 仍为 INCOMPLETE。
