# Git 运行产物与文件预算门禁

## 状态与范围

- 类型：Agile；状态：Delivered（本地合同验收完成；不代表 hosted CI 或人类合并审核通过）。
- 用户目标：解释并治理仓库体积增长；本轮先防复发，不宣称已回收旧历史空间。
- 基线：`9539dea443d1d4778daead91fd021bfdc7ff76a7`；功能分支：`analyze-repo-size-optimize`。
- 已核实：共享 pack 约 8.10 GiB，约 7.79 GiB 来自 Classic evidence 的 trace ZIP 分片；main 历史对象约 178 MiB。对象库及引用曾被其他操作更新，数字为诊断快照，不是性能 A/B。
- Scope：Git index / CI 提交范围的元数据门禁、精确 ignore、证据存储规范、工程合同测试。
- Non-goals：删除文件或 worktree、过期 reflog、GC、移除备份、历史重写、force push、上传旧证据、修改 CI fetch 深度、修改 Kernel/stdlib 测试选择或恢复产品验证。

## 决策

复用 Git 元数据、Node 内置模块、现有 Husky 与架构 CI，不新增服务或依赖。仅接入 LFS 不会迁移历史，且临时 trace 不适合默认长期版本化；对象存储/CI artifact 的实际选择与上传留待另行授权。

- 新增或修改的 blob 超过 10 MiB 时警告，超过 50 MiB 时拒绝；单位为 1024² 字节，不按压缩后大小判定。
- trace ZIP 及 `.zip.part-*` / 数字后缀分片拒绝进入 Git；evidence、reports 和已忽略运行目录下的 ZIP/录像亦拒绝。普通小型 JSON、Markdown、截图和游戏资源不被全目录忽略。
- pre-commit 读取已暂存 Git 对象，不读取工作区文件内容；`git add -f` 不绕过门禁。
- CI 扫描 base..head 每次提交引入/修改的文件，而非仅最终 tree diff；中间提交后删除仍拒绝。
- base 中相同路径、相同 blob 的既有文件不追溯拒绝；改动或重命名的大文件重新检查。已存在的约 88 MiB 归档不被本 change 改写或删除。
- 未解析的对象、冲突 index、无效参数或 base/head、Git 命令失败均 fail closed。文件名按 NUL 分隔解析，元数据严格 UTF-8 解码，非法字节拒绝而非有损替换；日志转义控制字符；仅读取对象类型、大小及路径，不读取 `.env`、密钥或 blob 正文。
- 本地 hook 是提前反馈，CI 是已纳入 `Static verification` 的强制后备。缺失/全零 CI base 不静默降级为空检查。

## Given / When / Then

1. Given 小型报告和图片，When 暂存或进入 CI 范围，Then 门禁通过。
2. Given 10/50 MiB 边界与相邻字节，When 判定，Then <=10 无告警、>10 且 <=50 警告、>50 拒绝。
3. Given 很小的 trace ZIP/分片或 evidence 录像，When 强制暂存，Then 仍拒绝。
4. Given 已暂存 trace 后工作区被改名/删除，When 检查 index，Then 仍拒绝；反过来未暂存内容不影响结果。
5. Given 范围内新增违规文件再删除，When 检查 base..head，Then 仍拒绝；删除 base 中的违规文件允许。
6. Given base 中既有大归档且后续只改文档，When CI 检查，Then 通过；重命名或修改大归档拒绝。
7. Given 文件名含中文、空格、Tab、换行，When Git 输出与日志解析，Then 路径边界与拒绝规则不变。
8. Given merge 或无共同祖先但可解析的 base/head，When 检查，Then 不遗漏新增提交；无效 base/head 拒绝。

## 实施前测试设计

在 `scripts/git-artifact-budget.test.mjs` 维护最低充分工程合同：纯分类阈值、真实临时 Git 仓库 index/range、add-delete、grandfather/rename、merge、Git 错误、特殊文件名和 hook/CI/package 接线。夹具只在临时目录生成，Git 与 CLI 子进程清除继承的全部 `GIT_*` 控制变量，并以两个临时仓库验证 index/refs 隔离；不触碰用户仓库/备份；不执行产品、浏览器或性能采样。先用未实施的允许全部版本取得可执行行为 RED，再实现并 GREEN。

长期工程断言准入要求独立 Sol/xhigh 只读评审，关注重复、维护成本、误拦截和绕过路径；未完成前不声称 Delivered。

## 验收与任务

- [x] 可执行 RED 与行为 GREEN：允许全部的 RED scaffold 为 2 pass / 10 fail；首次实现为 12/12 GREEN。补充真实大小及 hook 检查后得到 16 pass / 1 fail（直接 shell hook 吞掉前序失败）；加入 `set -e` 后 17/17 GREEN。
- [x] metadata-only staged/range 门禁、ignore、hook 和 architecture CI 接线。
- [x] 最终版本 `pnpm verify:static:ci && pnpm test:deterministic` exit 0：格式、路径、Lint、类型通过；ESLint 规则 66、CI selection 8、artifact 合同 24、Kernel 28、stdlib 530 全通过。
- [x] 独立 Sol/xhigh 基线评审并处理阻塞项；最终 24/24 独立 PASS，长期价值/重复度/确定性/成本/维护负担均准入，无遗留 P0/P1。
- [x] docs 基线更新，交付文件范围冻结为本 change 的 9 个文件。语义提交、PR URL、远端 SHA 与当前 gate 由 owning Paseo session 读回记录，避免本文件自引用其交付 commit。

## Delivery Snapshot

- 已实现：index 与整段提交历史的元数据门禁、ignore、hook 首步失败传播、architecture CI 后备及运行证据存储规范；既有约 88 MiB 基线归档未修改。
- 独立评审：Paseo agent `9c9420da-93d8-49c6-81c6-aa7274d68ed7`，Codex `gpt-6.1-sol/xhigh`。首轮因 UTF-8 有损碰撞与夹具 Git 环境变量污染两项 P1 BLOCKED；补反例得到 21 pass / 2 fail，严格解码与环境隔离后 GREEN。复验 23/23 准入，最后真实缺失 blob 增量再独立审核并 24/24 准入。
- 冻结脚本 SHA-256：`070c49fcf253c4c83198e46ae7c01449de0cf3eec9e309edcb3fd865765d6bde`；最终测试 SHA-256：`0f3fad136b0cc35751f3f6bce26983c9cc039638943085afeeab664ffa953fa2`。
- docs baseline 已更新：新增 `docs/git-artifact-budget.md` 并在 `docs/ci-testing.md` 链接，沉淀跨 change 的字节预算、产物存储、失败边界与历史清理安全规则；不更新产品/架构路线，因为本轮只改变工程准入。
- 发布交接采用功能分支 → `main` PR，禁止自动合并或 force push。预存的未跟踪 `paseo.json` 不进入提交。CI fetch 深度、Kernel/stdlib 选择器和线上保护规则未改。
- hosted CI 结果在 PR gate 动态字段读回，不能用本地 GREEN 代替；人类审核仍待完成。
- 旧 pack 体积回收、云存储迁移、浏览器/Classic/性能证据均 NOT_RUN；不得以防复发门禁通过冒充仓库已瘦身。
