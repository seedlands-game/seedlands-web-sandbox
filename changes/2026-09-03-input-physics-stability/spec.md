# Input and Physics Stability

**Status:** Delivered locally

## Context & Goal

快速连续编辑会为同一 Chunk 反复排队 Worker remesh 和同步 `localStorage` 写入，造成卡顿并让玩家误以为点击丢失。竖直移动复用全身 AABB 碰撞，下降时会把身体侧面贴住的方块误判为脚底支撑，导致跳跃/搭方块时悬空卡住。上一轮将下降检测缩至脚底四角后，边缘残留方块仍可作为单角支撑，快速破坏脚下方块或跳搭时仍会出现悬空。

完成态：每个有效编辑立即进入 mutation state，但同一短时间批次只 remesh 一次；跳跃只在脚底接触方块时落地，不会被侧面方块卡在空中。

## Scope & Non-goals

- In scope: 编辑 remesh/save 合并、过期 mesh 结果失效、竖直碰撞分离、地图采样帧预算与浏览器回归覆盖。
- Non-goals: 改变体素碰撞尺寸、增加网络输入、重写 Worker/mesh 协议或变更持久化格式。

## Decisions

**Direct implementation:** 编辑先同步更新 `World.changes`，再以 48ms 窗口合并每个已加载 Chunk 的 remesh；存档使用相同窗口并在 pagehide/换世界时 flush。下降只认可脚底中心格的 solid 支撑，上升检查头顶四角，水平移动继续使用完整身体 AABB。这样侧方或单角残留方块不能把玩家重新吸附到地面。Macro map 每帧采样预算从 8ms 降为 4ms。

## Behaviour

- Given 一批快速点击命中同一或相邻 Chunk, When `World.edit()` 连续调用, Then 每个 mutation 立即可查询，旧 Worker result 不会覆盖新状态，且每个 dirty Chunk 在窗口后只发起一次 replacement mesh。
- Given 玩家快速破坏脚下连续方块或在单角边缘跳搭, When 向下移动, Then 只有脚底中心格的 solid voxel 才设为 onGround；单角或侧方接触不会让玩家悬空吸附；向上仍在头顶命中时停止。
- Given 页面离开或开始新世界, When 有待写入存档, Then 在销毁旧 world 前 flush。

## Acceptance & Evidence

- [x] `CI=true corepack pnpm test` 和 `CI=true corepack pnpm build` 通过。
- [x] Chromium 回归覆盖跳起后重新落地、真实编辑/存档、同 Chunk 编辑突发、streaming、地图和刷新恢复；完整 Harness 再次通过。
- [x] `CI=true corepack pnpm harness` 通过；`git diff --check` 通过。

## Tasks & Current State

1. [done] 定位 remesh/save burst 与竖直 AABB 误判路径。
2. [done] 实现编辑/存档合并与平面竖直碰撞。
3. [done] 收紧下降支撑并执行浏览器与完整 Harness 回归。

## Delivery Snapshot

Changed paths: `src/main.ts`, `scripts/browser-harness.mjs` and this change record. Follow-up delivery: `src/main.ts` now uses center-cell ground support, so a remaining side or corner block cannot produce a false landing while the center below the player is air.

Validation: `CI=true corepack pnpm test` passed; `CI=true corepack pnpm build` passed; `CI=true corepack pnpm harness:e2e` passed; `CI=true corepack pnpm harness` passed; `git diff --check` passed. Chromium stages Load, Input, Player, Interaction, Streaming, MacroMap and Persistence all passed. The interaction stage performs a real pointer-lock left/right edit, then a six-edit same-Chunk burst through the Harness-only `World.edit()` entry and observes immediate mutation growth plus deferred remesh queue drain. The input stage holds Space across frames, verifies upward movement, then observes `onGround` again. The current regression uses the same controller after the center-support change; its existing input and interaction assertions remain green.

Known limitation: this confirms the previous physics false-ground path and edit/remesh/save scheduling behavior in Chromium; it does not introduce networked input or a full swept-capsule controller.

Git: local commit on `codex/macro-worldgen`; default delivery rule does not push.
