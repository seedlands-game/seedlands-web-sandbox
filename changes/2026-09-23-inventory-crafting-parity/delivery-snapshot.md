# 交付快照

日期：2026-09-23。状态：Delivered。

## 已交付

- Actor inventory cursor 持有可保存的 4 格随身合成区；旧 snapshot 缺失字段时迁移为空 2×2。
- 随身 2×2 与工作台 3×3 使用同一 Classic `StationRecipe` 目录和同一 Authority matcher/commit 路径。
- shaped 配方可在合法位置平移但拒绝额外材料；shapeless 配方按实际占用格精确匹配。
- 关闭背包、死亡和模式切换会将 cursor 与 2×2 材料归还背包，溢出生成正式掉落。
- 生存背包显示真实 2×2 网格、结果槽和按需渲染的共享配方手册；旧一键快捷合成 UI 已移除。
- 背包、快捷栏和工位复用槽位组件的图标被限制在内容盒内并使用 `object-fit: contain`。

## 验证

- stdlib 定向：2 files / 15 tests PASS；完整 stdlib：98 files / 610 tests PASS。
- Web 定向：5 files / 19 tests PASS。
- `@seedlands/stdlib` typecheck、`@seedlands/web` typecheck、Classic tests typecheck、受影响文件 ESLint/Prettier PASS。
- Production build PASS：279 files，dirty-worktree source digest `4327b8cb3157ba1de2d9430dbc8726ce857eb6d71bf9933512b1fb1e2b37fce8`，artifact digest `56260824289f5b9b1e4557fbcedd0b73fa0ae9b5aa705566388cb79bb1ef867b`。
- 唯一 `classic-runtime.spec.ts`：主 C0-C5 与视觉回归 PASS；modular Pack smoke 依现有环境条件 SKIPPED。run id `245353f3-e00f-4a48-a494-6d9fc45c4558`。

## 文档与边界

`docs/code-map.md` 已更新，因为 `personal-recipes.svelte` 被新的 2×2 owner `personal-crafting.svelte` 替代。长期可组合玩法架构未变化。通用旧 recipe action 仍作为 stdlib/其他 Playbook 兼容能力存在，但 Classic Web 不再暴露该入口。

## 估算回填

传统工程量估算保持 5–8 PD。Agent 实际活跃墙钟约 3 h，低于原 12–21 h 预估；未记录可核验的模型 credits、token 或 API 费用，继续标记 unknown。
