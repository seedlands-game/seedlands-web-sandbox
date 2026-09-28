# GIT-37 Arrival During Aim

## 身份与范围

- baseline：`24dc3a1daca6e629ca273ea07aeae50eb4be868a`。
- 代码提交：`99b895067324ae930fd5dbd6bb227c578c499c8d`；tree
  `fd5cd21572509cf7b57536947bf3d88d23c7ad5a`。
- 精确九路径 staged binary patch SHA-256：
  `8d55c757e842d65ce710f3e4af83f5e404516bcc9388fa578b63017a1116f4b5`。
- 验证树：`/private/tmp/seedlands-git37-arrival-during-aim`，detached HEAD 为 baseline。根
  `node_modules/@seedlands/*` workspace links 指向该树内 `packages/` 与 `playbooks/`。

## 验证

离线 `pnpm install --offline --frozen-lockfile --ignore-scripts` 在独立默认 benchmark-window 内 exit 0；安装 stdout
仅在命令执行回执中可见，未单独重定向到稳定文件，因此标 `NOT_RECORDED_AS_FILE`，不重跑补造。随后在另一独立
默认 benchmark-window 内串行运行：

- 13 个受影响测试文件，`138/138 PASS`，Vitest `maxWorkers=1`。
- Classic test types 与 root test types PASS。
- 6 个 TS 文件 ESLint PASS。
- 精确 9 路径常规 Prettier PASS；没有临时或持久 ignore，也没有本片新增 inline suppression。
- 精确 staged scope 与 `git diff --cached --check` PASS。

代码提交自然 hooks 的 6 TS Prettier/ESLint、3 Markdown Prettier 和 `ls-lint` 均 PASS。第一次尝试合并创建 detached
tree 与应用 patch 时，命令因指定的 cwd 尚不存在而在进程创建前失败；没有创建 tree、没有应用 patch，也没有测试
attempt，标 `NOT_STARTED/NOT_RECORDED_AS_FILE`。后续按创建 tree、应用 patch、离线安装、门禁的独立步骤成功完成。

## 边界

Browser-21 保持 FAIL：本轮真实到达 C0-C3、完整 V1、资源放置和首格 wood 独立入包，后续 V2/pointer/C4/C5/save
均 `NOT_REACHED`。Browser-19 首 iron inventory pickup 仍 `NOT_PROVEN`。本阶段未运行 build、Browser22、Cua、
devserver、CI watch、deploy 或 merge；fixture/static GREEN 不等于产品 GREEN。长期 docs 只因 type-only
`harness-snapshot.ts` owner 新增 `docs/code-map.md` 映射，不表示生产架构或公共协议变化。
