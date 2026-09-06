# 修复归档与目录边界遗漏

## 背景与目标

PR #8 的有效 review 指出两处边界遗漏：归档工具在解压前未拒绝 ZIP 中的符号链接或非常规条目，且 app 顶层归属规则只匹配 `.ts`，允许顶层 `.svelte` 绕过。修复这两处验证边界，保持业务行为不变。

## 范围与非目标

修改 `scripts/change-archive.mjs` 的 ZIP 条目验证及恢复后校验，补充归档工具的符号链接与重复 manifest 反例；将 app 顶层归属规则覆盖 `.ts` 与 `.svelte`，补充真实 ESLint 配置反例。同步准确的目录规则说明。

不修改归档格式、历史 ZIP 内容、业务源码、物理、渲染、CI 或长期浏览器基线。不会引入依赖或构建通用 ZIP 框架。

## 决策

直接使用既有 Info-ZIP 工具：在读取 manifest、验证内容或解压前列出全部条目，要求数量对应且全部为常规文件；同时拒绝重复、越界或未列入 manifest 的路径。恢复后以 `lstat` 确认常规文件，并以真实路径确认其仍在目标目录。ESLint 继续使用现有 owner allowlist，只扩展顶层匹配的源码扩展名。

## 行为

- Given ZIP 含符号链接、目录或其他非常规条目，When 执行 verify 或 extract，Then 在读取内容或解压前拒绝，且不创建恢复目录。
- Given manifest、ZIP 条目或恢复文件的路径不安全、重复或越出目标目录，When 验证或恢复，Then 拒绝归档。
- Given `src/app/foo.svelte` 位于顶层且未在 allowlist，When ESLint 使用真实配置检查，Then 报 app 顶层归属规则；`src/app/ui/` 的既有组件仍不报该规则。

## 验证设计

先新增两项确定性 RED：由 `zip -y` 写入符号链接条目的 ZIP 必须被当前 verify/extract 漏过；顶层 `.svelte` probe 当前不报 owner 规则。实现后反例 GREEN，并运行归档/治理受影响测试、静态检查和构建。

## 准出条件与证据

| 条件                                              | 证据          | 状态                                                                                              |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| ZIP 非常规条目在解压前被拒绝                      | Vitest        | 通过：真实 `zip -y -D` 符号链接 ZIP 的 verify/extract 均在解压前拒绝                              |
| 恢复文件保持常规文件与目标路径边界                | Vitest        | 通过：正常 roundtrip 保持路径与 hash；恢复后实现以 `lstat` 和 `realpath` 复核                     |
| 顶层 `.svelte` 不能绕过 owner 规则，UI 子目录允许 | Vitest        | 通过：真实 ESLint 配置反例覆盖 `src/app/foo.svelte` 与 `src/app/ui/primitives/game-button.svelte` |
| 静态检查与构建通过                                | Static、Build | 通过：`pnpm verify:static`、`pnpm build`                                                          |

Playwright、Midscene：N/A；本次没有浏览器产品或视觉行为变更。

## 任务与当前状态

1. [x] 写入短 spec 和 RED 设计。
2. [x] 添加 RED 反例：符号链接 ZIP、重复 manifest 路径和顶层 `.svelte`。
3. [x] 实现最小边界修复并运行 GREEN、静态和构建。
4. [x] 父级以非实施者身份完成最终 diff 复审。
5. [ ] 父级提交、推送并跟进 CI。

## 交付快照

RED：受影响 Vitest 在旧实现下 2 项失败：`zip -y -D` 的符号链接 ZIP 被 verify 接受，顶层 `src/app/foo.svelte` 未触发 owner rule；补充重复 manifest 后，修正前该反例也失败。GREEN：`pnpm vitest run tests/scripts/change-archive.test.ts tests/governance/client-app-boundary-eslint.test.ts` 9/9 通过。

完整本地证据：`pnpm verify:static` 通过（151 文件，762 通过、4 跳过，world 行覆盖率 96.37%）；`pnpm build` 通过。构建仅报告既有大 bundle 提示。Playwright、Midscene：N/A，未运行浏览器。

非实施者复审：父级已复审 tracked 五文件 diff，SHA-256 为 `6c8b0814729368c259d0e7061611101a6ab3800efbeb8b19d5be4f56bec49795`，结论通过；Sol 额外审查调用被平台中止，未作为批准证据。本地验收时远端 PR #8 的 HEAD 为 `21bf05d5df6249b19dd4194daea15ed28de6b99f`；该提交尚未包含本 change。发布后的最终 CI 与冲突结果以 [PR #8](https://github.com/seedlands-game/seedlands-web-sandbox/pull/8) 最新 HEAD 检查及交接摘要为准。

docs baseline：已更新目录规则说明，原因是可执行 app 顶层 owner 边界扩展到 `.svelte`；归档工具细节保留在既有归档文档，不重复写入长期治理。
