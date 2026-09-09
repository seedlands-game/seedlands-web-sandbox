# Change 归档索引

已交付且不被当前运行入口或活跃测试直接依赖的 change 可以压缩为 `archives/changes/*.zip`。这只是本地可恢复整理，不删除 Git 历史，不自动按日期猜测状态，也不配置定时任务。

归档前工具要求 `spec.md` 明示 Delivered、change 路径在 `changes/` 内、目标 ZIP 不存在，并扫描 `package.json`、运行脚本、长期测试和配置入口的直接引用。操作前仍要人工确认没有当前/Active change 依赖；该扫描不证明所有依赖均不存在。ZIP 内 `manifest.json` 保存每个原路径与 SHA-256；逐项验证成功才移走工作树原件。若验证成功后的源目录移除异常，ZIP 保留作为恢复副本。

```sh
node scripts/change-archive.mjs archive archives/changes/<batch>.zip changes/<delivered-change> [...]
node scripts/change-archive.mjs verify archives/changes/<batch>.zip
node scripts/change-archive.mjs extract archives/changes/<batch>.zip restored/<batch>
```

恢复目录必须不存在；工具拒绝覆盖、路径越界和符号链接路径。解压后的内容保持原 `changes/...` 相对路径，读取后可移回 `changes/` 进行追溯。

## 当前归档

| ZIP                                                    | SHA-256                                                            | 原 change 路径                                                                                                                                                                                                       | 验证与恢复                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `archives/changes/2026-09-03-foundation-delivered.zip` | `0cc93587de3d894152986d046ceeb28e4124a3c06510d808d6f7f47056cdb461` | `2026-09-03-{auto-commit-push,establish-lightweight-sdd,local-commit-only,pnpm-corepack-worktree-setup,record-first-lightweight-sdd,scope-midscene-yaml-to-changes,static-quality-baseline,vitest-test-environment}` | 已逐文件 manifest 验证；用 `extract` 命令恢复到不存在的目录 |

仍被 `midscene:smoke`、Harness、治理测试或 active change 直接引用的历史目录保留在 `changes/`。

## Node Dedicated Server 研究归档

归档 tag：`archive/node-dedicated-mvp-2026-09-09`，指向已合并的 `ec77fdd667458ec93ea426dbf81a142ac6028f91`（PR #17）。该 Git tree 保存当时完整 Node/Web/core、锁文件、专项测试、E2E、历史 change 和证据。它是研究快照，不是继续更新的兼容分支。

恢复时从 tag 建立独立 worktree，在该历史目录按其 README 安装和运行；不要把旧目录复制回当前 workspace 或将恢复作为主线必需门禁。例如：

```sh
git fetch origin tag archive/node-dedicated-mvp-2026-09-09
git worktree add --detach ../seedlands-node-research archive/node-dedicated-mvp-2026-09-09
```

主线保留历史文字合同与交付证据；Node 专项源码、测试、Web↔Node E2E 和构建/CI 入口从活跃树移除。撤销退役需新的需求与基于当时主线的独立合同，不保证该快照随平台或依赖变化持续编译运行。详见[退役记录](../changes/2026-09-09-browser-living-world-baseline/spec.md)。
