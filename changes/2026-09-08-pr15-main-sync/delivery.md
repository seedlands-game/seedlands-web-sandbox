# PR #15 集成交付

## 结果与范围

在已发布的 Node 三包基础 `3c727f7` 上普通合并主干 `9c04598`，保留资产工坊及治理文档更新，不重写发布历史。本次变更只交付 PR #15；远端可玩路线 PR #17 不在此变更中。

- 工坊 HTML、Web 源码、公开资产归入 apps/web；产品跨包引用通过 game-core exports，根整合测试沿用既有源码定位方式。
- 主干 30 个公开资产迁移后的 Git blob hash 全部一致。更新资产脚本、许可路径和代码导航。
- 修复 Node 旧检查点文件无界积累及启动逐个读 Chunk 的评审问题。保留 CURRENT/PREVIOUS、durable 顺序和磁盘格式；按需内容校验、回收可达集、目录类型检查与关闭/读取生命周期由定向测试保护。

## 验证记录

运行时源码冻结于 bb22da4。本地记录来自该提交对应的集成源码；Node 构建输出中的 Git SHA 在提交前仍是父提交，不作为新提交的远端准出证明。最终提交对应的 CI 与 mergeability 由 PR 描述绑定读回。

- Web 普通构建与 `/seedlands-web-sandbox/` 前缀生产构建通过，Svelte/TypeScript 无错误。
- 原有 Chromium regression 15/15，包括 Wasm 默认、显式 TS fallback、启动/加载、真实输入、挖放与存档。
- 新增资产集成 2/2 在开发服务器通过，在带部署前缀的生产 preview 再次 2/2 通过：草稿/应用/刷新、游戏启动/高清图标、公开 GLB、导入后刷新。生产预览进程已清理。
- Active Node portable 检查 4 文件 35/35 通过；Node 五入口构建通过。
- 最终 `pnpm verify:static` 通过：249 个测试文件通过、2 个既有跳过；1266 项测试通过、4 项既有跳过，世界行覆盖率 96.89%。包含格式、ESLint、命名、覆盖率及 core/Web/Node/test 类型检查。存储相关 6 文件 44/44 通过。
- 存储 RED/GREEN 与故障窗口见 [存储记录](storage-notes.md)；独立 Sol/xhigh 复核通过，见 [复核记录](review.md)。

Node 包的独立安装/构建验收使用 PR CI 的隔离 runner；本地没有运行会覆盖共享 `/tmp/seedlands-monorepo` 目录的隔离脚本。必要 CI 包含 Static verification、Production build（含三包构建和 Node 独立安装）和 Chromium regression（含新增资产旅程）。PR 不自动合并。

首次远端集成提交 21d6e37 的三项 CI 全通过，但最终读回发现 main ruleset 要求的检查名为 `Production build`，原三包迁移将 job 改名为 `Package builds`，导致必需检查缺失而 BLOCKED。本次仅恢复原必需 context 名称，全部构建/隔离步骤保持不变；不修改 ruleset 或降低门禁。名称修复后的提交必须重新通过必要 CI，并确认 GitHub 为 CLEAN 后才交棒。

## 长期文档与证据边界

长期 docs baseline 已更新：代码地图加入迁移后的资产入口和 Node 持久化生命周期；资产工坊、Blender 文档与 ASSETS 路径对齐三包。历史 change 的证据与源码绑定保持不变。本次没有性能采样，不把减少文件读取次数或功能测试耗时表述为端到端性能收益。
