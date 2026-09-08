# 按变更路径收敛 Pull Request CI

**状态：** Agile flow；本地实现与独立评审完成，等待远端 CI

## Context & Goal

当前 `.github/workflows/ci.yml` 对每个 Pull Request 无条件运行完整静态验证、三个产品构建与 Chromium 回归。即使变更只包含 Markdown 文档、change spec 或本地 Skill，仍会安装浏览器并执行与代码行为无关的完整测试。

目标是在不修改 GitHub required check 名称、不降低源码变更门禁、也不改变 `main` 发布链路的前提下，让纯文档 Pull Request 只运行格式与路径命名校验。源码、测试、依赖、配置、工作流、可执行 Skill 文件或任何未知路径仍运行当前完整 CI。

## Scope & Non-goals

### Scope

- 增加无第三方依赖的确定性路径分类器，输入 NUL 分隔的 Git 路径，输出固定的 `run_full` 与 `reason` 标量。
- Pull Request 使用事件中绑定的 base/head SHA 计算变更路径；`main` push 始终选择完整 CI。
- 保留 `Static verification`、`Production build`、`Chromium regression` 三个 required check 的显示名称。
- 纯文档 PR 的 `Static verification` 改跑 `pnpm format:check` 与 `pnpm lint:paths`；构建与 Chromium job 通过 job-level condition 跳过。
- 分类器失败、无路径、输出非法或路径不在明确 allowlist 时 fail closed 到完整 CI，或由必需的静态 job 明确失败。

### Non-goals

- 不按 workspace、包或测试文件进一步拆分源码变更的测试矩阵。
- 不修改测试断言、覆盖率、超时、retry、runner 规格、Actions 权限或分支 ruleset。
- 不在 Pull Request 部署 Pages；不减少 `main` push 的构建、浏览器回归或部署前置门禁。
- 不把预测的 job 数下降表述为尚未远端测得的墙钟或费用节省。

## Decisions

- 不使用 workflow-level `paths` / `paths-ignore`。当前 ruleset 要求三个稳定 status context；整个 workflow 被路径过滤时，required check 可能保持 Pending。
- 使用 job-level `if` 跳过两个重型 job。GitHub 将因 job 条件而跳过的 job 报告为 Success，可保留现有 required context。
- `Static verification` 始终运行：完整范围执行原命令，文档范围执行轻量格式与路径检查；如果 scope job 失败或输出不是严格的 `true` / `false`，该必需 job 失败。
- 文档 allowlist 只接受仓库根目录 Markdown、`LICENSE` / `NOTICE`，以及 `docs/`、`changes/`、`.agents/` 下的 Markdown 和静态图片。现有治理测试直接读取的 `AGENTS.md` 与 `docs/development-governance.md` 明确进入完整 CI；`.github/`、JSON/YAML、脚本、测试、源码、锁文件及未知扩展也全部选择完整 CI。
- 路径通过 `git diff --name-only -z` 传递，避免文件名中的空格或换行改变分类结果；分类器不把文件名写入 `GITHUB_OUTPUT`。
- Git diff 禁用 rename detection，使代码文件移动到文档目录时同时暴露旧代码路径和新文档路径，仍选择完整 CI。
- Pull Request 分类使用 `github.event.pull_request.base.sha` 到 `head.sha` 的变更集合；产品 job 仍检出 GitHub 默认的 PR merge ref，以继续验证与目标分支合并后的代码。
- Pull Request 只执行 `base.sha` 中已受保护的分类器副本，不执行 PR 可修改的脚本；首次引入分类器、base 中尚无脚本时强制完整 CI。
- 仓库内 workflow 仍不能自证自身未被 PR 篡改；彻底消除此信任边界需要仓库或组织 ruleset 中的 required workflow。当前任务不擅自修改外部规则集，`.github/**` 只保证按未被篡改的本 workflow 逻辑选择完整 CI。

## Behaviour

- **Given** PR 只修改 allowlist 内且未被治理测试直接读取的根目录 Markdown、`docs/**/*.md`、`changes/**/*.md` 或 `.agents/**/*.md`，**When** CI 分类路径，**Then** 静态 required check 只运行格式与路径检查，构建和 Chromium required jobs 以 skipped/success 完成。
- **Given** PR 同时包含任一源码、测试、依赖、工作流、配置或未知路径，**When** CI 分类路径，**Then** 三个既有质量 job 全部运行原有完整命令。
- **Given** `main` push，**When** workflow 运行，**Then** 无论路径类型都执行完整静态、构建和 Chromium 门禁，并只在三者成功后部署 Pages。
- **Given** scope job 失败或输出无效，**When** required jobs 求值，**Then** `Static verification` 明确失败，PR 不得因依赖 job 被动跳过而绕过门禁。

## Test Design

### 预注册 A/B

- 假设：纯文档 diff 不需要执行会编译产品或启动 Chromium 的重型 job。
- A：当前 workflow 对纯文档 fixture 固定调度 3 个重型质量 job。
- B：新分类器对同一 fixture 选择文档范围，调度 0 个重型 job，同时保留 1 个轻量 required static job。
- 主指标：同一变更路径集合被调度的重型 job 数，目标从 `3` 降为 `0`。
- 次指标：required context 名称保持不变；源码/工作流/未知路径 fixture 仍为完整范围。
- 否决项：任一非 allowlist 路径被判为文档、`main` push 被降级、scope 失败后 required check 仍成功，或 Pages 部署失去三个完整前置门禁。
- 停止线：若无法在不修改 required contexts 的情况下 fail closed，则保留当前 workflow。

### RED

- 当前 workflow 没有 path scope job，也没有任何 job-level 条件；纯文档 PR 仍无条件执行 `pnpm verify:static:ci`、三个产品构建、Chromium 安装与两组浏览器回归。
- 实施前目标脚本与测试文件不存在，因此文档/混合/未知/NUL 文件名等分类合同不可执行。

### 自动化用例

- 纯根目录 Markdown、`docs/`、`changes/`、`.agents/` Markdown fixture 返回文档范围。
- 静态图片只在上述文档目录内返回文档范围；生产资源图片仍返回完整范围。
- `.github/workflows/**`、源码、测试、package/lock 配置、change 下的 E2E/实验脚本和未知扩展返回完整范围。
- 混合 diff、空输入返回完整范围。
- NUL 分隔输入正确处理含空格和换行的合法 Git 文件名，输出只含固定键值。
- workflow 必须从 base SHA 提取分类器；base 中无分类器时强制完整 CI，不执行 PR 分支中的分类器。
- workflow 人工读回 required job 名称、scope failure guard、`main` 完整路径和 deploy dependencies。

## Acceptance & Evidence

- [x] 定向分类器与 workflow 信任边界 Vitest 9/9 通过，覆盖文档 allowlist、受测试约束的治理文档、混合/未知路径、主干 push、NUL 文件名、畸形输入和 base classifier 调用。
- [x] A/B fixture 证明纯文档重型 job 选择从 3 降为 0，混合与未知路径仍为 3；这是确定性调度证据，不是远端墙钟证据。
- [x] `pnpm format:check`、`pnpm lint:paths`、`git diff --check` 与 `tsc -p tsconfig.test.json --noEmit` 通过。
- [x] 最终 `pnpm verify:static` 通过：250 个测试文件通过、2 个跳过，1275 个用例通过、4 个跳过；coverage statements 95.37%、branches 90.42%、functions 96.93%、lines 96.89%，Svelte 0 error / 0 warning，TypeScript 通过。
- [x] `pnpm build` 通过：Rust artifact 指纹、预渲染入口、Svelte/TypeScript 与 Vite 生产构建均通过；约 1.999 MB 的既有 PlayCanvas vendor chunk warning 不阻塞本变更。
- [x] 真实 A 基线：纯 Skill/Markdown 的 PR #20 在旧 workflow 下仍运行三个重型 job；Static 约 12 分 10 秒、Build 约 1 分 17 秒、Chromium 约 3 分 05 秒，合计约 16 分 32 秒 runner job wall time。B 的远端耗时待本 workflow 进入 base 后验证。
- [x] 独立只读评审的 P0 已关闭：PR 不再执行自身可修改的分类器；复核未发现 P0/P1，随后补齐 bootstrap `run_full=true` 与 `git cat-file` guard 的精确回归断言。
- [ ] GitHub 新 head 上三个 required contexts 均产生终态；本 PR 因包含 workflow/script 应执行完整 CI。
- [ ] 远端确认 ruleset、head SHA、mergeability；文档-only 远端跳过行为需在本变更进入 base 后由后续文档 PR 验证。

## Tasks & Current State

1. [已完成] 读取当前 workflow、项目 CI 历史、package scripts 与 live ruleset，确认三个 required context 必须保留。
2. [已完成] 先建立分类器测试，再实现路径分类与 workflow 条件。
3. [已完成] 运行定向、静态、构建和配置读回验收。
4. [待办] 创建独立提交与 PR，读取新 head 的 GitHub Actions 和 mergeability。

## Delivery Snapshot

本地实现与验收已完成。Pull Request 通过 NUL-safe、禁用 rename detection 的三点 diff 分类路径；只优化显式文档 allowlist，`main` push 始终完整，scope 失败由 `Static verification` fail closed。三个 required context 名称和 Pages 的三项前置依赖未改变。

定向 Vitest 9/9、完整静态 1275 个用例通过、Svelte/TypeScript、格式/路径和生产构建均通过。独立评审发现并推动修复了 PR 可篡改分类器的信任问题：PR scope 改为执行 base SHA 中的分类器，本次 bootstrap 则强制完整 CI；复核未发现 P0/P1，最后一个 P2 已通过精确断言和输出类型补齐。仓库内 workflow 自身仍需外部 required workflow 才能形成不可篡改边界，本任务未修改 ruleset。

旧 workflow 下的纯文档 PR #20 提供 A 基线：三个重型 job 合计约 16 分 32 秒 runner job wall time；本地 B 只证明重型 job 调度数从 3 降为 0，不能替代合入后的远端耗时与 skipped context 读回。本 PR 自身包含 workflow/script，因此按合同必须运行完整 CI。
