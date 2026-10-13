# Git 历史瘦身与过程产物禁入

## 状态与授权

- 类型：Breaking；状态：Delivered（本地合同验收完成；不代表 hosted CI 或人类合并审核通过）。
- 用户已明确授权直接应用隔离验收通过的候选、重写 Beta 分支、回收旧对象，不保留备份；明确豁免持久备份与 hash 再确认。此前审批计划中相应前置要求由本次用户指令覆盖。
- 基线 main：`9539dea443d1d4778daead91fd021bfdc7ff76a7`；交付分支：`analyze-repo-size-optimize`；防复发前序交付为 PR #51。
- 当前实测：上次已导入候选的私有 refs，但 HTTPS 凭据缺失使 push 失败，正式 refs 与远端尚未迁移。GitHub CLI 登录有效，本次操作临时复用其 credential helper，不改凭据或全局配置。

## 范围与不变量

- 应用既有候选：只从历史移除 `changes/2026-09-23-classic-functional-completion/evidence/*trace*.zip*`。隔离验收已验证 1,637 个提交、非目标文件及提交元数据、拓扑，main 未变。
- 远端仅 `refs/heads/feat/classic-beta173-playable`：旧 `cae8dc84e7eebef6c0c207fd4c0c66fb6523b4d5` → 新 `7ea613bf1de3dcce376f9b8ba19cb6ca5731afa1`，显式 lease 与 refspec；不 mirror、不合并、不改权限或发布设置。
- 本地只迁移验收映射中的十个引用及固定旧图的恢复记录；非目标引用、worktree HEAD/index/未提交状态保留。任何状态漂移停止核查，不覆盖新工作。
- 回收旧 trace 对象并删除本任务临时备份、导出和候选；不删除其他项目产物或用户 worktree。删除后不提供旧 trace 恢复能力。
- 将既有门禁扩展为拒绝运行输出目录内的过程日志、截图和其他产物；保留源码、游戏资源、基线归档、小型人工报告和 manifest。不追溯删除既有非 trace 文件。
- 不调整 CI fetch-depth、测试选择、Kernel/stdlib 行为、产品路线或长期性能基线。

## 行为与实施前验收设计

1. Given 旧图与已验证候选，When 单分支带 lease 发布和十个本地引用 CAS 更新，Then 远端新 SHA、main/其他 refs、全部 worktree 状态读回符合合同。
2. Given 恢复记录仍固定旧图，When 按已验证 commit-map 仅迁移被改写的 OID，Then 非目标记录保持原样，所有有效恢复根可解析且无 trace 可达；不全局过期其他会话 reflog。
3. Given 无其他控制器或 Git writer，When 回收并删除任务临时大产物，Then Git full/strict fsck 通过、161 个旧 trace blob 不再存在、共享对象库及实际磁盘数据量读回。无法保证空闲窗口则暂停 GC，不杀他人进程。
4. Given 新增 evidence/reports/运行目录中的日志、截图、JSONL、原始运行包，When 暂存或进入提交范围，Then 小文件与强制 add 均被拒绝；小型 Markdown 报告与 JSON manifest 可用，普通游戏图片仍通过。先记录可执行 RED，再 GREEN。

## 任务与证据

- [x] 完成本地与远端历史迁移及实际 readback；正式源库与远端 Beta SHA 均匹配候选，main 保持。
- [x] 恢复记录迁移、GC、临时大产物清理与 fsck；161 个旧 trace blob missing，15 个 worktree 状态保持。
- [x] 过程产物禁入 RED/GREEN、ignore/hook/CI 合同验证；26/26 GREEN。
- [x] 静态验证与独立长期断言准入；语义 commit、推送与 PR #51 gate 由 owning session 最终读回，避免 spec 自引用交付 SHA。

## Delivery Snapshot

- 实际对象与引用读回见[交付报告](report.md)。共享 pack 从 8,706,722,829 bytes 降至 338,422,923 bytes（322.7 MiB，约减少 96.1%）。五份受影响 reflog 的 253 个记录仅替换映射 OID，其他 reflog 保持；不依赖 trace 的 292 个孤立根保留。
- 已删除本任务临时备份、161 blob 导出、候选与恢复样例；删除期间空闲从 40,820,101,120 bytes 升至 59,123,531,776 bytes，增加约 17.0 GiB。旧 trace 不再保留本机恢复能力。
- 当前执行 `pnpm verify:static:ci` exit 0：格式、路径、Lint、类型通过；ESLint 合同 66、CI selector 8、Git 产物合同 26 全部通过。`pnpm test:deterministic` exit 0：Kernel 28、stdlib 530 全部通过。
- 已定向 fetch 最新 origin/main；基线 SHA 未变，主干领先 0、当前交付分支领先 1（新增提交前），无需 rebase。远端正常完整新克隆验证 15 个分支与 tags，pack 337,801,734 bytes（322.2 MiB）、trace 可达 0、fsck 通过；验证副本随后删除。最终发布 gate 由 owning session 另行读回。
- 独立准入：原生只读评审 `/root/artifact_gate_review`，请求 Codex `gpt-6.1-sol/xhigh`，六个指定文件的防复发边界逐项审查与 26/26 独立 GREEN；长期价值、重复度、确定性、成本及维护负担均准入，无可证实 P0/P1/P2。迁移/GC/远端状态另由 owning session 实际读回，不用此断言评审冒充迁移独立验收。
- 长期 docs baseline 将更新 Git 产物规范，原因是用户明确改变过程证据的入库边界；产品与架构路线不变。
- 未执行浏览器、Classic、性能或产品验收；Git 数据量测量不等于 clone 时长或 GitHub 服务端存储计量。

## RED 记录

- 在原门禁上新增过程输出分类、强制暂存及中间提交截图、嵌套 ignore 合同，`pnpm test:git-artifacts` exit 1（23 pass / 3 fail）；旧版本仍允许 evidence 截图和原始结果。新规则只放行 evidence/reports 中 `.md`、`manifest.json`、`*-manifest.json`、`*.manifest.json`，既有运行输出目录完全拒绝；原有大小阈值与 grandfather 保持。
