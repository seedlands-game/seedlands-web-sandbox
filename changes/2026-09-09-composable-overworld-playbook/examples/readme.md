# 独立 Playbook 示例

两个例子只通过 `@seedlands/game-core/mod-api` 使用玩法 API，不导入默认主世界内容。

- `click-conversion`：选中一格原木后，背包里的“合成 石块”把该格一个原木转成两个石块。相同原木在未选中的槽位不满足匹配。使用自己的 `sample:clicked-slot-matcher`，不加载默认无序合成 provider、工位、Combat、Needs 或初始生态。
- `builder`：只有原木/石块、采集/放置、库存和模式合同。没有配方、Combat、Needs 或初始生态；在背包切换创造模式后通过目录建造。

从仓库根目录执行（依赖按仓库 `.npmrc` 使用 npmjs）：

```sh
pnpm build:packs --playbook click-conversion --out dist/click-conversion
pnpm server:headless --playbook click-conversion --seed sample-click --json
SEEDLANDS_PLAYBOOK=click-conversion pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

`builder` 替换上述示例名即可。默认 `pnpm build` 仍构建 Overworld。构建后的 JS、manifest 和锁文件是本地 ESM 产物；不会发布到 npm。摘要在两个宿主导入前验证；更换 Playbook 或代码摘要后，原组合检查点不会被静默迁入新组合。使用不同 seed，或先导出需要保留的旧世界。

宿主接受三个明确的本地 Playbook ID，并对各自权限独立准入。`assembleProductPacks` 不将 Pack 的权限请求自动变成批准。扩展新产品 Pack 需要相应宿主政策；这里没有任意 URL 或市场安装入口。

API 候选：`defineCraftingProviderModule({ moduleId, provider: { version: 1, match } })` 声明匹配 capability；`defineContentModule({ craftingProvider: true, ... })` 显式依赖它。`match` 获得冻结的配方、槽位和选中索引，返回 `{ slot, count }[]` 或 `null`。共享事务严格验证实例和总消耗，并在完整产出有容量时统一提交。匹配器不得依赖时间、随机数、外部可变状态或副作用；Host 在同一观察上重新验证候选，变化的候选会被拒绝。

状态：两个样例已通过真实 Headless 与生产 Browser 验收，点击转换已通过 Headless→Browser→Headless 往返。整体独立审阅与 PR/CI 状态见 [S6 验收](../s6-acceptance.md)。
