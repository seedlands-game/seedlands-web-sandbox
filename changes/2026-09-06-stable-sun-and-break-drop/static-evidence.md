# 最终静态与构建证据

## 验证对象

- 执行日期：2026-09-06
- 工作树基准 HEAD：`f84ccd7084d71a48f66ed4e23686fa7884ede5c2`
- 验证对象：该 HEAD 加当前 `stable-sun-and-break-drop` change 尚未提交的冻结生产与测试文件。
- 构建产物通过 28 文件 SHA-256 清单与已完成浏览器验收的产物逐项绑定，避免只用未包含工作树改动的 HEAD 代表本轮源码。
- 验证期间未读取 `.env` 或密钥，未启动浏览器，也未修改生产代码或冻结 spec。

## 完整静态检查

执行 `pnpm verify:static`，使用 `pipefail` 与 `tee` 保留原始标准输出，真实退出码为 0。

- Prettier：通过。
- ESLint：通过。
- ls-lint：通过。
- Vitest V8 coverage：149 个测试文件中 147 个通过、2 个跳过；748 项测试中 744 项通过、4 项跳过；用时 28.33 秒。
- `src/world/**` 覆盖率：语句 94.65%、分支 87.25%、函数 96.80%、行 96.37%，满足行覆盖率不低于 80% 的门禁。
- Svelte：0 error、0 warning。
- source 与 test TypeScript：通过。

原始日志：

- 路径：`/tmp/seedlands-stable-sun-drop-verify-static.log`
- SHA-256：`b01ece7f3b24d484a825e602e533811703e0312c2dba9a8d408740d1f6114c60`
- 日志末尾记录：`__EXIT_CODE__=0`

## 生产构建

在静态检查结束后串行执行 `pnpm build`，使用 `pipefail` 与 `tee` 保留原始标准输出，真实退出码为 0。

- Svelte：0 error、0 warning。
- Vite：转换 2440 个模块，构建用时 2.81 秒。
- Worker 产物包含 Authority、Persistence、World、Fluid Compute 与 Game Logic 五类 Worker。
- 构建仅出现既有的大 Chunk 提示，没有构建错误。

原始日志：

- 路径：`/tmp/seedlands-stable-sun-drop-build.log`
- SHA-256：`8cbe17466c7047b33158ae6ffc6df0498b2bc43cc6d06d5c57d845a4d45fad52`
- 日志末尾记录：`__EXIT_CODE__=0`

## 产物一致性

构建后递归计算 `dist/` 所有文件 SHA-256，并与 `/tmp/seedlands-stable-sun-drop-validated-dist-manifest.json` 比较：

- 预期文件：28。
- 实际文件：28。
- 缺失：0。
- 多余：0。
- 哈希不一致：0。
- 比较退出码：0。

清单与比较证据：

- 已验证清单 SHA-256：`c25b5904a42db14eec9cf4d459cfd2b5859d267057689ecd0e8e4f7f72deb41f`
- 本轮实际清单：`/tmp/seedlands-stable-sun-drop-actual-dist-manifest.json`
- 本轮实际清单 SHA-256：`2f153abff44f71a78803be47929ba7e32343164758ff766efd4203258e731ded`
- 比较日志：`/tmp/seedlands-stable-sun-drop-dist-manifest-check.log`
- 比较日志 SHA-256：`1f7936bc27ddbbb5d7a1827e42087d1f48f894aedcb0ccb17ab383dbad9e3fa4`

本轮只证明静态质量、类型、确定性单元测试和生产构建一致性；浏览器、视觉与性能证据由本 change 的独立验收记录承担。

## 最终采样数学补充后的静态复跑

新增 4 项持久化太阳采样数学测试后，2026-09-06 再次执行完整 `pnpm verify:static`。本节保留两轮真实结果，不覆盖上文已完成的静态与构建证据。

首轮在测试前被当前 change 的 4 份 evidence JSON 格式门禁拦截，退出码为 1。只对以下文件执行 Prettier，没有修改生产代码、其他 change 或冻结 spec：

- `evidence/drop-midscene-summary.json`
- `evidence/sun-midscene-summary.json`
- `evidence/sun-validation-summary.json`
- `evidence/validated-dist-manifest.json`

首轮原始日志：

- 路径：`/tmp/seedlands-stable-sun-drop-final-static-format-red.log`
- SHA-256：`2d3e63e43656133468be3fd10ae73523d73dd2f357ad42fa82700edf7dcb3bc1`
- 退出码：1。

格式修复后的第二轮执行到 TypeScript，结果如下：

- Prettier、ESLint、ls-lint：通过。
- Vitest V8 coverage：149 个测试文件中 147 个通过、2 个跳过；752 项测试中 748 项通过、4 项跳过；用时 28.13 秒。
- `src/world/**` 覆盖率：语句 94.65%、分支 87.25%、函数 96.80%、行 96.37%。
- Svelte：0 error、0 warning。
- source TypeScript：通过。
- test TypeScript：失败；`e2e/sun-shadow-stability.spec.ts:98:73` 将 `number | null` 的 `pairNormalizedDifferenceMax` 传给只接受 `number` 的 `toBeCloseTo`。
- 完整命令退出码：2。

第二轮原始日志：

- 路径：`/tmp/seedlands-stable-sun-drop-final-static.log`
- SHA-256：`876cc352e44b2c388ecc422d481752ea8cdde85c1eb958600b7d837aa8cffd61`
- 日志末尾记录：`__EXIT_CODE__=2`

负责人随后先断言 `pairNormalizedDifferenceMax` 非空，再将已收窄的数值传给 `toBeCloseTo`；空样本仍明确失败，没有改变生产代码、采样算法或门槛。按验收安排不重复已经完成的全量 coverage，补跑以下确定性检查：

- `pnpm typecheck`：退出码 0；Svelte 0 error、0 warning，source 与 test TypeScript 全部通过。
- 受影响的太阳 E2E、静态证据和 4 份 evidence JSON 执行 Prettier check：退出码 0。
- `e2e/sun-shadow-stability.spec.ts` 执行 ESLint：退出码 0。
- 上述受影响文件执行 `git diff --check`：退出码 0。

修复后类型日志：

- 路径：`/tmp/seedlands-stable-sun-drop-final-typecheck.log`
- SHA-256：`db42339f05dcc2c182241ee16e50a7c78c5cefff33794d435d398ab4a3db0bb5`
- 日志末尾记录：`__EXIT_CODE__=0`

因此最终静态证据由第二轮完整格式、lint、路径规则及 748/4 coverage GREEN，加修复后完整类型检查 GREEN 组成；先前 EXIT2 原始日志继续保留。本轮按要求没有重复生产构建；上文 28 文件产物哈希一致性仍保留为构建证据。
