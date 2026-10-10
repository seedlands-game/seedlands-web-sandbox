# 天空来源合同 checkpoint89

冻结生产源码 `c889f40554e592e30c4035143756b6adfd5c741f`；只读调查，未运行测试、构建或浏览器。Root复核唯一既有Luna的来源报告；请求Luna/medium，实际服务型号未核实。

当前 `apps/web/src/app/scene/sky-visibility-volume.ts` 需要调用方提供 `worldTopY`，生产没有接线。`packages/kernel/src/spatial/provider.ts` 只提供generate/sampleVoxel，没有“其上恒为空”的证明；`packages/stdlib/src/server/persistence/chunk-persistence.ts` 没有完整存档key/列目录。一个未加载的合法高层存档可遮挡天空，已加载两层不能排除它。`browser-world-limits.ts` 明确只限制MVP呈现，不限制世界或存档坐标。cache的512样本、64依赖是资源预算，不能冒充世界上限。

后续实现的最小合同方向：

1. 生成器所有者在Pack/stdlib层提供绑定provider identity、seed与generatorVersion的可验证天空边界证明，未知provider保持unknown；不向Kernel添加lighting领域字段。证明只约束未编辑的生成结果，不能限制合法编辑坐标。
2. 现有持久化owner提供当前世界的完整列chunk key目录，包含未加载的存档；它是既有canonical数据的派生索引，不保存第二套可写体素truth。读/写/restore的目录版本与世界epoch一并绑定。
3. Authority合并当前驻留canonical edits与持久化目录，取得覆盖上方所有遮挡的来源和Chunk revisions；不能用采样若干高度或便携存档的当前驻留集合证明完整性。
4. Web仍由同一个per-chunk owner持有派生R8缓存。来源缺失、目录未完成、依赖过期或超过原有资源预算时unknown/fail-dark；不得截断后发布ready。卸载/restore释放旧owner与epoch，随后重建。

最低验收包括：合法高层未加载遮挡不得漏光；完整且无遮挡的列可就绪；canonical edit、目录更新与restore使旧构建失效；来源失败/预算超限不发布光。这些尚未实施或通过。本报告不把架构方向当产品验收，不变更历史sealed evidence，也不新增世界高度限制。
