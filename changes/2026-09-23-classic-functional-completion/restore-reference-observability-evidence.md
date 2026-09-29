# V2 Restore Reference Observability 证据

阶段：`V2-RESTORE-REFERENCE-OBSERVABILITY-01`
基线：`01c650793c79ac34e6184da48b5a4c94a5f161c2` / tree
`e20a8b1d85520c960096b5c898c3ffdd7e241b2a`
状态：focused deterministic/static GREEN；真实 Browser、build、artifact 与 Git 均未运行。

## 已完成能力

- `WorldHarnessPort.inspect` 新增通用只读 `entity-reference` variant；请求携带完整
  `EntityLifetimeReference`，结果返回 detached reference 与 `current | stale`，协议版本保持 `1`。
- 请求在入队时按 exact keys、plain data property、trimmed non-empty id（最长 256）及正安全整数
  epoch/lifetime 做 detached capture。授权仍为 `world.entity/read`，target 为 `reference.entityId`，并在调用当前
  Authority server 的 `resolveEntityReference` 前完成。
- 合法旧 epoch、错误 lifetime 或不存在实体返回成功的 `stale`；malformed 请求返回结构化 validation failure，
  未授权 foreign/unknown reference 返回结构化 permission failure，且都不调用 resolver、不改变 world、gameplay、
  actor、inventory 或 entity state。
- 既有 equipment restore journey 保存 restore 前 actor reference，恢复后经同一个
  `window.__seedlandsHarness.world.inspect` 证明 old=`stale`、new=`current`；只有二者都通过后才继续原正式 UI
  helmet detach/reequip。canonical receipt 新增
  `restoreEvidence.after.referenceStatus = { old, current }`，原 `v2Equipment` 结构继续保留。

这只证明 Authority lifetime reference 的可观察性。它不把 epoch 增长当作 reference 结论，也不宣称 Browser 中的
JS object identity 或 retained access 异常；后两项仍由既有 Headless restore suite 负责。

## RED 与 GREEN

可信 RED 为 `evidence/v2-restore-reference-observability-01/red-02.stdout.log`，窗口
`v2-restore-reference-observability-red-02`：`10 failed / 1 passed / 17 skipped`。三个真实 non-Classic Headless
用例因旧实现没有 `entity-reference` variant 失败；七个 consumer 用例因未调用 inspect 或未 fail closed 失败；现有
Browser Worker generic transport 正例已通过。该 RED 不是 import、collection 或配置错误。

最终 focused GREEN 为 `focused-green-final-05`：`1 file / 11 tests PASS`。它覆盖：

- non-Classic 真实 `HeadlessSession` 的 current、成功 restore 后 old stale/new current、失败 restore 后 current；
- malformed、missing/extra keys、非法 id/epoch/lifetime、self/foreign/unknown 权限正反例；
- 授权前不 resolve、排队请求 detached capture、响应副本隔离、状态不变；
- 真实 `BrowserAuthorityClient` Worker RPC 的 request identity、protocol version 1、current/stale 与结构化 failure；
- consumer 对 old-current、new-stale、reference mismatch、permission、validation、transport failure 全部在 UI
  continuation 前 fail closed，成功路径保持 `inspect-old -> inspect-current -> UI` 顺序。

受影响旧路径窗口 `affected-tests-sealed` 为 `2 files / 16 passed / 1 skipped`，覆盖 HEAD 原有
World Harness session 与 Browser Authority adapter，未修改这两个旧测试文件。首次合并运行 `green-01` 的新增目标已
GREEN，但同文件既有 `authorizes action ids against their actual actor owner` 因
`getActorAction('foreign') === null` 失败；独立窗口 `existing-action-owner-diag-01` 稳定复现。该测试和行为不在本片
diff，故没有通过扩大范围修复或隐去失败。

首轮 `red.stdout.log` 同时遇到错误 safe-spawn seed，不能作为 Headless RED；其 consumer RED 仍保留。初次静态 scope
还因检查脚本 allowlist 错误把八个本片 tracked 路径报为 unexpected，原始 `static-scope-final` 保留，不作为源码失败。
初次 ESLint 的三个 `max-lines` 通过抽取 focused test 和把 inspect 分派移入已有 operations owner 修复，没有增加
suppression/ignore。迭代中的测试 helper 类型错误和误删 import 也均保留原始回执，最终门禁覆盖最终字节。

## 最终静态门禁

- `focused-green-final-05`：`11/11 PASS`。
- `affected-tests-sealed`：`16 passed / 1 skipped`。
- `stdlib-types-green-03`：stdlib production TypeScript PASS。
- `web-types-final-03`：Svelte `0 errors / 0 warnings`，Web production TypeScript PASS。
- `root-test-types-final-03`：root test types PASS。
- `classic-types-final-05`：Classic test types PASS。
- `eslint-final-03`：本片目标源码、测试和文档 ESLint PASS。
- `format-final-04` 及后续 metadata format：正常 Prettier PASS；未增加 ignore 或 suppression。

验证在从基线 commit 提取并仅覆盖本片 allowlist 字节的
`/private/tmp/seedlands-v2-restore-reference-01` 中串行执行，避免消费主工作区既有 lighting、transport、climb 与
`mod-api.ts` dirty。依赖只链接既有安装，没有下载或修改 lockfile。最终 SOURCE/MANIFEST 与 delivery readback 见本片
evidence 目录。

## 未验证与下一前置

本片没有运行 Browser26、`--list`、build、artifact、Cua、dev server、CI，也没有写 Git index、commit、push 或 PR。
因此不宣称真实 Browser 或产品 GREEN；Browser25 仍只代表既有 `2 passed / 1 skipped` 范围。下一步必须先由 root
审阅 diff，形成只含授权范围的新 commit 和 production artifact，再取得唯一 Browser 租约，沿项目唯一 canonical 线路
验证 receipt 中可独立读回 old stale/new current 以及后续正式 UI continuation。

death/worldItems、16 armor 全矩阵、194 catalog family closure、V3/V4 均未实施。长期 docs 仅在
`docs/harness-contracts.md` 登记这个新增通用 inspect variant 的 owner 与只读授权边界；未改其他架构路线。传统工程量
预算 `0.25-0.5 PD`、120% 建议 `0.6 PD`；AI 基准 `2h`、120% 建议 `2.4h`、硬上限 `3h`。credits、费率、
API 等价费用、当前额度和预测占比均为 `unknown`。
