# 最终静态检查与构建证据

## 固定源码与父链

本轮在 detached 临时工作树 `/tmp/seedlands-final-static-74a8ed2` 中固定并核对源码：

```text
74a8ed288b3f92d10dae961ef45288c9bcfdbfcc
└─ b0c0d89e2d79bc8d42f7d8caa2aecd423da0c213
   └─ a5157ca77a3a0dda47f493dc8c65d47c3dff06dc
      └─ 88d0d741d256dff36e10a4f09990f69d48a83119
```

因此 `74a8ed2` 已包含 `a5157ca` 的受控负载目标隔离，以及 `b0c0d89` 的受控负载角色稳定修订；二者不是本轮静态检查之后才出现的提交。后续 `1c30d2b`、`c139cb5` 仅为证据文档，不属于本次固定源码。

## 完整静态检查

执行 `pnpm verify:static`，退出码为 0：

- Prettier、ESLint 与路径命名检查全部通过。
- Vitest 共发现 137 个文件，其中 135 个通过、2 个跳过；共 692 项，其中 688 项通过、4 项跳过。
- `src/world/**` 行覆盖率为 96.37%（718/745），statement 为 94.65%（832/879），branch 为 87.25%（438/502），function 为 96.8%（91/94）。
- Svelte 检查为 0 error、0 warning；源码与测试 TypeScript 检查全部通过。

实际覆盖率产物：

- `/tmp/seedlands-final-static-74a8ed2/coverage/coverage-summary.json`
- `/tmp/seedlands-final-static-74a8ed2/coverage/lcov.info`

## 生产构建

执行 `pnpm build`，退出码为 0。类型检查再次通过，Vite 完成 2432 个模块转换并产出 Authority、Logic、Persistence、Fluid 与 General Worker bundle。构建仅报告既有的单个主 bundle 超过 500 kB 警告，没有构建错误。

实际构建产物入口：`/tmp/seedlands-final-static-74a8ed2/dist/index.html`。

## 日志边界

本轮命令通过 Codex 工具直接捕获标准输出，运行时没有使用 `tee`，因此不存在可声称为逐行原始 stdout 的文件。根据已捕获输出整理的本地摘要位于 `/tmp/seedlands-final-static-74a8ed2/final-static-captured-output.txt`；覆盖率 JSON、LCOV 和生产 `dist` 是命令直接生成的实际产物。本文件保留可提交的完整结果与精确源码身份，不把整理摘要描述成原始日志。
