# GIT-39 Canonical Budget Terminal

阶段：`GIT-39-CANONICAL-BUDGET-TERMINAL`。baseline 为
`2db4c5fd8cf81294d164b128d667f73fa7e5f01f`，第一笔代码/tests/spec/contracts/code-map
提交为 `fca25ef1`；最终完整提交 SHA 与远端读回在 push 后写入 PR，不反向改写本目录。

第一笔精确 13 路径在 detached tree
`/private/tmp/seedlands-git39-canonical-budget-terminal` 组合。离线依赖安装使用
`pnpm install --offline --frozen-lockfile --ignore-scripts`。同一个默认 benchmark window
内串行通过 pure receipt `8/8`、Reporter `5/5`、既有 performance-window consumer `3/3`、
Classic/root test types、变更路径 ESLint、13 路径标准 Prettier 和 staged diff。窗口只证明串行
执行，`measurement=NOT_RECORDED`，不是性能测量。

第一次 staged gate 在 pure `8/8`、Reporter `5/5` 后失败：外层绝对
`SEEDLANDS_RESERVATION_EVIDENCE` 被既有 performance-window consumer 的嵌套临时仓库继承，
导致错误拼接为临时目录内的绝对路径并报 `ENOENT`。原 stdout/window 完整保留；未改实现或测试。
最终 gate 只对该 consumer 子进程清除六个 reservation/window 环境变量，仍由同一外层默认机器锁
串行执行，其余命令保持继承窗口。

第二笔仅冻结 Browser23、预算 MAP、Close15、Close16、null closure、两份 evidence 汇总、
tasks/execution-state 窄更新和本目录。Browser23 整体仍是 FAIL；C0-C5 与 V2 19 checkpoint 已到达，
但 720 秒主测试超时且原 trace 缺 EOCD/中央目录。25 个 trace 分片和 3 个 recovery gzip 分片
均不超过 50 MiB；重组 SHA 相等只证明封存字节一致，不证明 ZIP 完整。

Close15 只登记下一次 canonical main 为 900 秒，Chromium project 60 秒分别约束 Playwright
teardown/trace 等 slot，不是总收尾承诺。Close16/null closure 的 deterministic/static gate 已通过，
但没有运行 Browser24；terminal receipt 也不自动校验 ZIP CRC/EOCD。new object reference、
death/drop/respawn、16 armor/194 matrix、V3/V4 与完整 canonical GREEN 仍未完成。

`SOURCE-MANIFEST.sha256` 只覆盖第一笔 13 路径在 `fca25ef1` 中的交付字节。
第一次 evidence selfcheck 逐项通过 source 与历史 manifests、确认最大 staged blob 为 50 MiB，随后因机械
Browser23 `error-context` 使用 `.md` 归档后缀而被真实 Prettier 门禁拒绝。失败 stdout/window 原件保留并由当前
manifest 覆盖。root 准出的最窄包装恢复只将这一份 2800-byte raw 更名为 `.md.log`；字节 SHA
`499ae94ac08d04e70cc7e1775ca03a453b7c1daae16fd5f3b26209652c31a573` 不变，acceptance raw/report/trace 不动。
`prior-packaging/` 保存全部 21 个将变 metadata/raw 的旧字节、旧新路径映射与旧新身份映射。
首次 recovery selfcheck 已逐项输出旧 Browser23/MAP/GIT39 mapping PASS，但在当前 identity 尚未完成最终级联时
以 exit 1 停止；其 stdout/window 已改名为 `recovery-selfcheck-identity-superseded-failure.*` 原样保留。后续窄诊断
确认 acceptance、当前五个 delivery、Browser23/MAP source/manifest、GIT39 mapping 与最大 50 MiB blob 均通过；
第二次 recovery selfcheck 因校验器漏定义 acceptance tree 变量，把 detached staged tree 误作 clean acceptance 并退出；
此前输出已证明 exact scope、当前 manifests/raw 与旧映射通过，失败 stdout/window 原样保存在
`recovery-selfcheck-acceptance-variable-failure.*`。canonical recovery selfcheck 补入固定 BUILD14 acceptance 路径后使用
最终身份重跑，不覆盖两个中间失败。

`MANIFEST.sha256` 覆盖本目录除自身、`delivery-validation.json`、
`prior-packaging/metadata-identity-mapping.json` 和 canonical recovery selfcheck stdout/window 外的文件；这些排除避免自引用。
首次失败的 `final-selfcheck.stdout.log`/window 明确纳入当前 manifest。`evidence-staged.paths` 是第二笔提交的 exact allowlist，
`evidence-staged.actual.paths` 是 staging 后的独立读回，两者都纳入 manifest。历史 Browser23、MAP、
Close15、Close16 和 null closure 的旧 manifest/delivery 按原字节提交；Browser23/MAP 的旧身份由 prior mapping 验证，
当前身份只 supersede 包装层。
