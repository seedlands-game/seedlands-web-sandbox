# 前置基线集成

2026-09-09，PR #24 已 squash 合并为 `4416a3fdf52e809abb62661fb88174af9670604f`。PR #25 的原始退役父提交 `3c93101` 与该主线提交具有完全相同的 tree：`4478390823aa9e36156b0d63249f399dc7fcf313`；没有遗漏主线源码变更。

Git 因 squash 的重复历史对 #25 报告冲突。在独立 `/tmp/seedlands-harness-main-sync` worktree 中，以保留现有树的祖先对齐合并将 origin/main 纳入 #25：`b7d7169d3afc5da5a4e56e134c31424ec5aada5d`。合并前后的 tree 均为 `8781e8219aa6d31ab18c254f52aa57f8867114e0`，`git diff --exit-code HEAD^1 HEAD` 成功；未通过任意选择一边来丢弃不同源码。

NPC 分支随后 fast-forward 到此新基点；当前未提交实现保持原样。此操作仅修复 PR 的 Git 祖先关系，不自动合并任何 PR。H1/H2 原静态/运行证据对应同一个源码树；新的 CI 仍须以新 SHA 单独记录。

#25 后续 CI 在相同代码树重跑时暴露重集成 parity 夹具总时限问题。Low 质量本地1/1通过但CI仍失败；进一步trace证实Browser parity已成功，Headless往返与断言使30秒总预算耗尽。前置提交 `54debdc` 给该case90秒总预算，并独立限制clock与点击5秒，保留真实移动15秒界限；本地无重试1/1通过。以正常merge纳入NPC分支，保留前置分支祖先关系和原有WIP；未改生产clock。最新CI绑定该前置SHA单独跟进。
