# GIT-21 Equipment Core 组合验证计划

## 交付身份

- 基线、upstream 与 `origin/feat/classic-beta173-playable` 均为
  `7030adac5ea234319bfe032185828287ee07b85d`；开始验证时 index 为空。
- 公共 spine 以 `../v2-equipment-spine-01/SOURCE-MANIFEST.sha256` 的 28 条路径为基础。
- 重叠路径按 pointer、revision、station host 的最终 delivery/SOURCE 身份覆盖。pointer contract 的唯一有效
  SHA-256 为 `d113f62669d9fcc310ce4a7187ad7d944b104085f0ca0f10c62616e01bfb99d1`；旧冻结身份不参与本次组合。
- `mod-api.ts` 只纳入 equipment 的 10 行 export hunk；相邻 route/transport hunk不进入补丁、验证或提交。
- 四个既有 evidence 目录按原字节提交；历史 manifest 仍表示各自当时快照，不为组合源码覆盖关系改写。

## 隔离与门禁

- 从基线建立 detached `/private/tmp/seedlands-git21-equipment`，只复制白名单文件和四个完整 evidence 目录。
- 根与 package 级 `@seedlands/*` 依赖必须解析到该临时树；只允许复用第三方依赖。
- 在默认 `benchmark-window` 下串行运行公共 spine 合同、pointer 4 files / 35 tests、station host 11 tests、
  revision 12 tests、registered station 与 prepared mutation 回归。Vitest 固定 `--maxWorkers=1`。
- `equipment-spine-red.test.ts` 必须执行为 `2 passed / 1 failed`，唯一失败为尚未接入三条 death producer 的
  settlement。该 exit 1 是冻结的下一阶段 RED，不改写、跳过或冒充全部 GREEN。
- 运行 stdlib、root test、Classic test types，全部 staged TypeScript ESLint，可编辑 TypeScript/Markdown format
  check 和 staged scoped diff；Browser、Cua、CI、deploy、merge 均不运行。

## 提交与构建

- 第一笔语义提交只含生产代码、测试与合同；第二笔含四片历史 evidence、本批组合 evidence 与
  `spec.md`、`tasks.md`、`execution-state.md` 的窄状态增量。自然 hooks 必须通过。
- 推送并读回 local/upstream/`ls-remote`、ahead/behind 与 PR #41 Draft/Open/base main 后，才从已推送源码 SHA
  创建 `/private/tmp/seedlands-v2-acceptance-<sha8>`。
- acceptance tree 中只运行一次 `pnpm build` 和一次 `pnpm harness:artifact`，分别取得机器锁；记录源码、lock、
  artifact、MP3、`packs.lock`、文件数、命令、UTC、stdout 和 receipt 身份。失败只诊断，不启动 Browser。

## 范围与预算

本批只组合已准出实现，不接 death producer、combat armor、UI、V4 restore、Lighting 或 transport。传统工程量
正常 0.5–1 PD；AI 活跃正常 4–6h、保守 8h。模型固定 TraeX `gpt-5.6-sol/max/xhigh`、thinking `xhigh`。
tokens、credits、API 等价费用、费率、额度分母及占比均 unknown，不做虚构换算。

## 组合结果

- 代码、测试与合同提交：`fe2fcc9f174848ef9d7419cb5df96209a2d25796`；提交树
  `65fe988f8c6089502dad6dfd0ec8754f44072119`，32 个路径。隔离与主树 staged binary patch SHA-256 均为
  `409271b89f90db79f25495d726aba27e025f104095b593d7e9856f440556fbe2`。
- GREEN：spine `9/9`、pointer `35/35`、revision `12/12`、station host `11/11`，以及 registered station +
  prepared mutation/series `18/18`。stdlib、root test、Classic test types、staged ESLint、editable format 与
  TypeScript scoped diff 均 PASS。
- 预期 RED：共享行为文件实际 `2 passed / 1 failed`、exit 1；唯一失败为 combat death 后 helmet/chestplate
  未清空。原始 stdout 与 FAIL receipt 保留。
- 首次 `pnpm exec` 在隔离树执行 lockfile/prepare；运行后 package/lockfile 无 tracked diff，内部 package
  symlink 仍全部解析到 detached tree。后续命令直接调用临时树本地工具入口。
- 本结果只准出 V2 equipment core 的 pointer/revision/station host 组合。V2 BUILD01、death producer、UI、
  combat armor、V4 restore、Browser/Cua/CI 均待后续状态。
