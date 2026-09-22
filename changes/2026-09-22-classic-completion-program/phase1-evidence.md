# 阶段 1 证据

状态：COMPLETE。实现、生产构建与主要实机矩阵完成；首轮独立复核的 2 个 P1 / 1 个 P2 已修复，关闭性复核确认 0 个残留 P0/P1/P2。输入提交 `27249bd80e4388e2a36f61e84424b793b0f9c80a`；实现提交 `bcc30c3db2f9665c0be44e0a5ffc14bbd2436343`，审阅修复提交 `8004ff7df97a4cf4bf6406397c123c692098e831`，目标读回兼容提交 `4d9da2ca27458e070d1be3db2efe03f93009ba8f`，exact-head 矩阵证据提交 `8868ea0620c1abc3a3645e587f774eb6831fa115`。

## 缩略图与结构模型

- 使用 `node scripts/benchmark-window.mjs -- node scripts/assets/render-item-thumbnails.mjs --url=http://localhost:5173/` 从当前源码派生 194 张 512×512 PNG。
- 只有 `wooden-door.png`、`ladder.png`、`torch.png`、`fence.png` 与上次提交不同，符合本轮只修改四类结构材质/模型的范围。
- 目视 RED：第一次派生的火炬木柄整体呈橙色，栅栏仅有立柱。修复后火炬分为棕色木柄和独立发光火头；栅栏含双层横档。栅栏碰撞仍固定为修改前中心柱盒，不用视觉横档扩大阻挡。
- Web 定向 6 文件 34 项通过；stdlib 结构 2 项通过；全仓 `pnpm typecheck` 通过，Svelte 0 errors / 0 warnings。

## 生产构建

首次 dirty-worktree 构建用于实现期检查；审阅后在 exact code head `8004ff7df97a4cf4bf6406397c123c692098e831` 重新执行 `node scripts/benchmark-window.mjs -- pnpm build`，PASS：

- sourceSha：`8004ff7df97a4cf4bf6406397c123c692098e831`
- sourceDigest：`d55e1a571510e174cb24cd3a9e9cd08338998402f3d78bd1fc2b5b1fd7730cd7`
- artifactDigest：`3ed693609186c69ce56760252ce5964b1c3dd45f46d7beb8175f549607cc01d7`
- files：274
- builtAt：`2026-09-22T15:03:15.823Z`

从 `apps/web/dist` 以 Vite preview 启动 `127.0.0.1:4274/?harness=1`；隔离 agent-browser 直接读取 `/harness-artifact.json`，四项 identity 与上面完全一致，`errors --json` 为空，console 仅 Tone.js 正常日志。

## agent-browser 实机证据

工具：`agent-browser 0.33.2`，隔离 session；目标 `http://localhost:5173`，1280×720。没有读取或修改用户浏览器、凭据或既有存档。材料位于 `reports/2026-09-22-classic-completion/phase1-browser/`。

- 菜单→推荐森林→背包→创造目录的录像 `menu-to-world.webm`：VP8 1280×720，108.6 秒，可解码。
- 森林画面 `after-load-timeout.png`：最终植物调色与九格 HUD 已生效；页面错误为空。该帧仍显示 v10 树冠压顶、植被密度高，已归入阶段 2。
- 生存背包 `survival-inventory.png`：快捷合成从木板、木棍、基础工具开始，旧铁块/铁锭优先问题消失。
- 创造目录 `creative-catalog-all.png`、`creative-catalog-torch.png`、`creative-catalog-empty.png`：全量、单结果和空结果外框/搜索/关闭位置稳定；普通项目不常显内部 ID。十六色羊毛名称仍为英文，归入阶段 3。
- 木剑体验场 `melee-showcase.png`、`melee-showcase.webm`：正常进入，明确显示僵尸，不再请求 `night-stalker`；页面错误为空。
- 最终创造世界 `final-creative-world.png`：待机目标卡已隐藏，HUD 和手持保持可见。
- Pointer Lock：页面读回 `document.pointerLockElement === true`；W 键持续输入前后画面有位置变化。
- 真实放置/破坏：选择砖块后瞄准沙砾，右键后 HUD 目标变为“砖块”且反馈“放置 · 方块”；单击左键后目标恢复“沙砾”。录像 `final-place-break.webm` 为 VP8 1280×720、15 秒，可解码；对应截图 `final-place-aim.png`、`final-placed.png`、`final-broken.png`。
- 最终 agent-browser `errors --json` 为空；console 只有 Vite 连接、Tone.js 与 PlayCanvas 正常日志。
- 结构世界近景 `final-structure-gallery-clean.png`：正式 `?harness=1` 接口只负责构造确定场景，真实 WebGL 渲染显示双层栅栏横档、棕柄/亮火头火炬、木门与梯子；页面错误为空。真实右键栅栏放置两次因目标仍与玩家占用相交而返回 `player-collision`，没有把拒绝冒充成功；真实放置能力由砖块路径单独证明。
- `final-creative-input.webm`、`final-place-break.webm`、`melee-showcase.webm` 均可解码；其中 `melee-input.webm` 记录一次画布输入后回主菜单的失败尝试，只作执行器诊断，不算产品通过。

## 尚待阶段 1 复核

- 首轮 Sol/xhigh 审阅冻结 `27249bd...bcc30c3`：0 P0、2 P1、1 P2。已为旧 terrain pack 与 AppearanceProject 增加火炬→火头兼容继承；TargetCard 改为一次方块名 + “采集中”并补 SSR 测试；exact-head 生产 identity 与浏览器读回已补齐。对应定向测试 13/13 通过。
- 关闭性复核绑定 `8004ff7`、`4d9da2c`、`8868ea0`，三项均 CLOSED；最终 0 个残留 P0/P1/P2。

## 审阅修复后的 exact-head 复验

- 代码提交 `8004ff7df97a4cf4bf6406397c123c692098e831`：旧 terrain pack 与 AppearanceProject 火炬覆盖兼容继承；显式火头覆盖优先；TargetCard 使用动作语义。定向测试 13/13、全仓 typecheck、lint 与确定性 Kernel 28 / stdlib 590 通过。
- `8004ff7` 生产构建 identity 如上；同一 dist 的 `exact-head-matrix.webm`（VP8 1280×720，244.6 秒）和 `exact-head-*` 截图重新覆盖森林、背包、目录三态与结构 gallery。
- 最后兼容提交 `4d9da2ca27458e070d1be3db2efe03f93009ba8f` 保留隐藏 `#target-card[data-target]`，避免正式瞄准辅助回归。exact-head 构建：sourceDigest `9c2904b141e35c0f70efe552da040215ed5aa3137365f31378d5d4a0e7d51264`、artifactDigest `3ca34e8440da570aee38d55a2a2d7c9005ae08dd0d012acc9176a8a7e040e2d2`、274 files。生产页读回 `class=sr-only`、`data-target=-4,10,-7`、`data-voxel=32`，截图为 `exact-final-hidden-target.png`，页面 errors 为空。
- 原始结构化摘要见 `reports/2026-09-22-classic-completion/phase1-browser/exact-head-readback.json`。失败输入材料保留并明确不计通过。
- 完成后更新 `progress.md`、提交、push，并读回远端 SHA/PR。

## 后续阶段边界

- v10 的树冠、植被密度、出生通路只记录为阶段 2 RED；阶段 1 不改变世界生成。
- 十六色羊毛英文名称与不可放置状态进入阶段 3；不在阶段 1 增加 voxel ID。
