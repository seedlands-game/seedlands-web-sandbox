# Change 归档索引

已交付且不被当前运行入口或活跃测试直接依赖的 change 可以压缩为 `archives/changes/*.zip`。这只是本地可恢复整理，不删除 Git 历史，不自动按日期猜测状态，也不配置定时任务。

当用户明确要求将**整个已提交主线现状**冻结为历史基线时，使用独立的 `freeze` 模式：它收集指定完整 HEAD SHA 中的全部 `changes/` 目录，要求当前源文件列表和字节与该 Git tree 一致，并拒绝受保护运行引用。该模式保存各 change 原有的 Active、Proposed、Delivered 等状态，**不把归档解释成业务交付或产品验收通过**；新建的归档执行记录不在旧 SHA 中，另行按普通 Delivered 门禁归档。长期文档的历史证据链接固定到来源 SHA；后续工作以新的 change 合同继续。

普通 `archive` 模式要求 `spec.md` 明示 Delivered、change 路径在 `changes/` 内、目标 ZIP 不存在，并扫描受保护运行引用。操作前仍要人工确认没有当前/Active change 依赖；该扫描不证明所有依赖均不存在。ZIP 内 `manifest.json` 保存每个原路径与 SHA-256；逐项验证成功才移走工作树原件。若验证成功后的源目录移除异常，ZIP 保留作为恢复副本。

```sh
node scripts/change-archive.mjs archive archives/changes/<batch>.zip changes/<delivered-change> [...]
node scripts/change-archive.mjs freeze <完整基线 SHA> archives/changes/<baseline-batch>.zip
node scripts/change-archive.mjs verify archives/changes/<batch>.zip
node scripts/change-archive.mjs extract archives/changes/<batch>.zip restored/<batch>
```

恢复目录必须不存在；工具拒绝覆盖、路径越界和符号链接路径。解压后的内容保持原 `changes/...` 相对路径，读取后可移回 `changes/` 进行追溯。

## 当前归档

| ZIP                                                          | SHA-256                                                            | 原 change 路径                                                                                                                                                                                                       | 验证与恢复                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `archives/changes/2026-09-03-foundation-delivered.zip`       | `0cc93587de3d894152986d046ceeb28e4124a3c06510d808d6f7f47056cdb461` | `2026-09-03-{auto-commit-push,establish-lightweight-sdd,local-commit-only,pnpm-corepack-worktree-setup,record-first-lightweight-sdd,scope-midscene-yaml-to-changes,static-quality-baseline,vitest-test-environment}` | 已逐文件 manifest 验证；用 `extract` 命令恢复到不存在的目录                     |
| `archives/changes/2026-09-16-main-architecture-baseline.zip` | `d7ec12a5b3f85e984892079a8cbbb99a262ca982823197046151d1dcbff49b8e` | `5a5f0a5ea7e4a8e59597cb9c575b37997f4a933d` 中的全部 104 个 change 目录、1351 个文件                                                                                                                                  | `kind=baseline-freeze`；逐文件 SHA-256 已验证，原状态未改写；恢复到不存在的目录 |
| `archives/changes/2026-09-16-baseline-freeze-record.zip`     | `557d5524f5a14b5d9c5b9dffd57adfa22452576da0e4bb04fbedf6ea585824b5` | `2026-09-16-current-baseline-freeze` 归档执行合同与本地 Delivery Snapshot                                                                                                                                            | 普通 `Delivered` 入口；逐文件 manifest 已验证                                   |

本批完成后 `changes/` 无剩余文件；后续新需求仍按[开发治理](development-governance.md)建立新的 change。未来若有运行入口或活跃测试直接依赖某 change，必须先迁移依赖或保留该目录，不得强行归档。

本批是**现状快照**而非 104 项全部 Delivered 的声明。已知未闭合项包括：#33 只冻结架构，Classic 行为、浏览器和性能仍在 [Draft PR #36](https://github.com/seedlands-game/seedlands-web-sandbox/pull/36)；[NPC 三角色 change](https://github.com/seedlands-game/seedlands-web-sandbox/blob/5a5f0a5ea7e4a8e59597cb9c575b37997f4a933d/changes/2026-09-10-npc-composable-baseline/progress.md)保留原 `Implementing` 与人工/真实模型缺口；[库存指针交互](https://github.com/seedlands-game/seedlands-web-sandbox/blob/5a5f0a5ea7e4a8e59597cb9c575b37997f4a933d/changes/2026-09-10-inventory-pointer-interactions/spec.md)仍待使用者试玩；[浏览器单 NPC MVP 设计](https://github.com/seedlands-game/seedlands-web-sandbox/blob/5a5f0a5ea7e4a8e59597cb9c575b37997f4a933d/changes/2026-09-09-browser-agent-mvp-design/spec.md)不是运行交付。后续实施应新建 change 并重新读取当前源码，不改写 ZIP 中的历史状态。

## Node Dedicated Server 研究归档

归档 tag：`archive/node-dedicated-mvp-2026-09-09`，指向已合并的 `ec77fdd667458ec93ea426dbf81a142ac6028f91`（PR #17）。该 Git tree 保存当时完整 Node/Web/core、锁文件、专项测试、E2E、历史 change 和证据。它是研究快照，不是继续更新的兼容分支。

恢复时从 tag 建立独立 worktree，在该历史目录按其 README 安装和运行；不要把旧目录复制回当前 workspace 或将恢复作为主线必需门禁。例如：

```sh
git fetch origin tag archive/node-dedicated-mvp-2026-09-09
git worktree add --detach ../seedlands-node-research archive/node-dedicated-mvp-2026-09-09
```

主线保留历史文字合同与交付证据；Node 专项源码、测试、Web↔Node E2E 和构建/CI 入口从活跃树移除。撤销退役需新的需求与基于当时主线的独立合同，不保证该快照随平台或依赖变化持续编译运行。详见[退役记录](https://github.com/seedlands-game/seedlands-web-sandbox/blob/5a5f0a5ea7e4a8e59597cb9c575b37997f4a933d/changes/2026-09-09-browser-living-world-baseline/spec.md)。
