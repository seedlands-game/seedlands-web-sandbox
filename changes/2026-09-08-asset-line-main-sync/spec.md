# 资产线同步 main 与 PR #12 准出

状态：Delivered（本地证据完成，远端准出读取PR最新HEAD）；类型：Agile。用户明确要求解决 #12 冲突并推进到可合并状态，不自动合并PR。

## 边界与行为

源分支 `codex/voxel-tool-playable-sample`，起点 `0173566`（已包含 #13、#16、#18），目标 `main` 当前 `5557f34`。main独有2提交，源独有5提交；以merge保留已发布历史。

- 同时保留main的预渲染首屏、CSS先于模块、manifest/vendor分包，以及资产线的游戏/工坊多HTML入口。工坊不注入游戏首屏。
- 修复 #12 未解决评审：最后一个方块/食物消耗导致槽位清空时，一次性place/eat动作继续完成；真正切换采集工具时仍停止采集并平滑收手。
- 不扩展玩法、Node目录迁移、资源格式或GPU后端，不修改其他worktree与用户数据。

## RED / 测试设计

1. merge冲突及Vite配置联合行为为本次RED证据；构建后两个HTML均存在，游戏含预渲染首屏、工坊仅有独立入口，资源路径与分包正确。
2. 新增确定性用例模拟authority更新库存后setHeldItem(null)：place/eat动作中段仍有非静止姿态，结束回位；采集工具切换保持取消语义。先运行失败再修复。
3. `pnpm verify:static`、`pnpm build`、核心Chromium回归与当前资产中心关键旅程验证；临时dev/preview server用完释放。
4. 推送后核对最新SHA、CI、mergeability、评审反馈与PR范围。只有技术门禁通过才报告可交棒，人类审核与合并保留。

## 任务

- [x] 同步main并解决配置冲突
- [x] 评审问题RED/GREEN
- [x] 本地静态、构建与浏览器检查
- [x] PR交接材料准备；远端检查与评审状态以PR最新HEAD读回为准

## Delivery Snapshot

本地准出完成，交接[PR #12](https://github.com/seedlands-game/seedlands-web-sandbox/pull/12)，不自动合并。长期docs baseline不更新：本次保留双方既有合同，局部修复与同步证据在本change记录。主任务沿用Astra/high；冲突和小范围动作修复由主任务串行处理，避免共享文件协调成本。

## 验收与失败归因

- RED：`vite.config.ts`发生内容冲突；新增place/eat最后物品用例原先2项失败（姿态为0）。修复后手持生命周期6项全部通过，采集切换取消保持原语义。
- 合并新增的1行使`game.ts`触发501/500行门禁；改为从已有资源工厂推导返回类型，移除重复类型依赖，未放宽门禁。
- 默认`pnpm verify:static`并行运行出现两项未修改的归档/CLI测试超时；独立单worker复验9/9通过，随后仓库既有`pnpm verify:static:ci`完整通过：197文件通过/2跳过，920测试通过/4跳过，world行覆盖96.89%，Svelte/TypeScript零错误。
- `SEEDLANDS_BASE_PATH=/seedlands-web-sandbox/ pnpm build`通过。产物断言确认游戏SSG、CSS先于模块、两个独立HTML和manifest入口；实际生产预览游戏ready、工坊19对象/10张512px图标，无资源加载错误。
- 联合Playwright共21项通过，覆盖main首屏/加载、核心世界、完整资产中心及真实右键使用最后物品。新用例首次误用spectator移动镜头，因权威玩家仍在原位而被拒绝；改用正式movePlayerTo后通过，未改生产距离规则。
- [早期帧](evidence/last-lantern-early.jpg)、[中间帧](evidence/last-lantern-middle.jpg)、[结束帧](evidence/last-lantern-rest.jpg)为同次真实右键流程的浏览器截图；库存清空后仍有动作，结束回位。进食边界由确定性用例覆盖，不将其声称为真人食用旅程。
- 临时4190 dev与4191 preview已结束并确认端口释放。未启动长期服务。

浏览器复现：`SEEDLANDS_E2E_PORT=4190 pnpm exec playwright test tests/e2e/regression changes/2026-09-07-loading-performance/e2e/loading-performance.spec.ts changes/2026-09-07-prerendered-start-screen/e2e/prerendered-start-screen.spec.ts changes/2026-09-08-asset-appearance-center/e2e changes/2026-09-08-asset-line-main-sync/e2e --workers=1 --output=test-results/pr12-integration`。
