# Git 历史瘦身交付读回

## 实际执行

- 用户明确授权不保留备份；已执行单个 Beta 远端分支带 lease 重写与十个本地引用 CAS 迁移。
- main 保持 `9539dea443d1d4778daead91fd021bfdc7ff76a7`；tags 和非目标 refs 保持；15 个 worktree 的 HEAD、index 与未提交状态保持。
- 五份受影响 reflog 仅按验证过的 commit-map 替换旧 OID，253 个记录映射；其他 reflog 字节保持。
- 161 个旧 trace blob 在所有 refs/reflog 中不可达，GC 后全部 cat-file missing；Git full/strict fsck exit 0。
- 保留 292 个不依赖 trace 的孤立根；另有 105 个未引用的旧 trace 历史根随目标历史回收。无 trace 的孤立对象放在 374,254 bytes 的 kept pack 中，避免删除无关内容。

## 数据量

| 指标                |        Before |       After |
| ------------------- | ------------: | ----------: |
| 共享 pack bytes     | 8,706,722,829 | 338,422,923 |
| 共享 Git 分配 bytes | 8,740,749,312 | 345,923,584 |

pack 约 8.10 GiB → 322.7 MiB，减少约 96.1%。这是实际源库读回，不是隔离候选数据，也不代表 GitHub 服务端计量或 clone 时长。

## 精确引用迁移

远端只更新 `refs/heads/feat/classic-beta173-playable`：`cae8dc84e7eebef6c0c207fd4c0c66fb6523b4d5` → `7ea613bf1de3dcce376f9b8ba19cb6ca5731afa1`，发布后 ls-remote 精确读回。

| 本地引用                                                                        | Before                                     | After                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `refs/codex/snapshots/3ab592a1025f7d7a6e038bf32ef7a2a6a74699df`                 | `e3da4e67d61ff0191e37c18170975c663804200f` | `eb8064f8af014fd086a3e7641a32a6379e563f2f` |
| `refs/heads/assess-agent-arena-integration`                                     | `1cc56039fa1357f8df1bd154f2c2d768938099b8` | `b23ea3c6f4d1df6aaff6a697ae39f6463fe72a4d` |
| `refs/heads/feat/classic-beta173-playable`                                      | `2d144c366dbae8323516a5de9f73bb64029b12fa` | `6ffcb118e334f72693f746d0c8373c45e6bb704e` |
| `refs/heads/progress/review-remaining-todos`                                    | `c45fa6479d5490bef4359e4fe4e4c3811405695a` | `dd5b62b0b38e5cc97ab9edb9d389724ed5ea6186` |
| `refs/heads/report-progress/organize-remaining-todos`                           | `c45fa6479d5490bef4359e4fe4e4c3811405695a` | `dd5b62b0b38e5cc97ab9edb9d389724ed5ea6186` |
| `refs/identity-backup/20261012-190410/assess-agent-arena-integration`           | `cae8dc84e7eebef6c0c207fd4c0c66fb6523b4d5` | `7ea613bf1de3dcce376f9b8ba19cb6ca5731afa1` |
| `refs/identity-backup/20261012-190410/progress/review-remaining-todos`          | `2d144c366dbae8323516a5de9f73bb64029b12fa` | `6ffcb118e334f72693f746d0c8373c45e6bb704e` |
| `refs/identity-backup/20261012-190410/report-progress/organize-remaining-todos` | `2d144c366dbae8323516a5de9f73bb64029b12fa` | `6ffcb118e334f72693f746d0c8373c45e6bb704e` |
| `refs/remotes/origin/feat/classic-beta173-playable`                             | `cae8dc84e7eebef6c0c207fd4c0c66fb6523b4d5` | `7ea613bf1de3dcce376f9b8ba19cb6ca5731afa1` |
| `refs/task-backups/git32-evidence-a402b016`                                     | `a402b01623354a5c78e41260354a0fdd7c35394c` | `f03adbd2bc934ab7d87800fd48bee3035d0afa7a` |

## 清理与未验证边界

- 按授权删除本任务临时 backup.git、trace-blobs、candidate.git 与恢复样例；不保留旧 trace 备份，也不提供本机恢复能力。
- 临时备份/导出/候选删除期间磁盘空闲增加 18,303,430,656 bytes（约 17.0 GiB）；对象库回收约 7.8 GiB，两项合计约 24.9 GiB。空闲变化受其他进程影响，分配数据与实际空闲分别读回。
- 从 GitHub 执行正常完整新克隆（15 个远端分支及 tags，无 shallow/单分支/本地借用），pack 337,801,734 bytes（322.2 MiB）；161 个目标 trace blob 可达数为 0，main/Beta SHA 正确，full/strict fsck exit 0。验证副本验收后删除。
- 本任务临时 run 目录、验证克隆与测试日志均删除；仅保留本 change 的人工整理 spec/报告，不保留原始过程产物。
- 不删除用户 worktree；不修改 CI fetch-depth；不合并 PR；不运行浏览器、Classic 或性能验收。
- 新门禁及静态结果、独立评审、PR SHA/gate 在 spec 的 Delivery Snapshot 回填。
