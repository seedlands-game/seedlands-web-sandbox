# Rejected Close-13 Snapshot

状态：`UNAPPROVED / REJECTED_REAL_DRIVER_DEADLINE_UNREACHABLE`。

本目录在 Close-14 替换任何字节前保存未准出的 Close-13 现状：

- `files/apps/web/tests/e2e/classic-support/`：当时带 timeout catch 的 controller 与对应测试。
- `files/changes/2026-09-23-classic-functional-completion/spec.md`：当时包含 Close-13 宣称的 spec。
- `files/changes/2026-09-23-classic-functional-completion/route-driver-reject-contract.md`：未批准合同。
- `raw/`：未批准阶段已经产生的 RED/GREEN/affected/types/ESLint/format stdout 与 benchmark window。

`REJECTED-CLOSE13-SNAPSHOT.sha256` 只列上述 20 个归档原件，不包含本 README 或 manifest 自身。归档时四个
source/test/spec/contract 均已通过 `cmp`；`raw/` 与原 Close-13 evidence 目录已通过 `diff -qr`。原 Close-13 evidence
目录继续保留。该快照仅用于追溯，不是已准出实现或可复用 GREEN。
