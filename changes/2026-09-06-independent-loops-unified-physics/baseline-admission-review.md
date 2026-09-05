# 长期浏览器基线独立准入评审

## 评审绑定

- 评审配置：请求使用与草案实现者独立的 `gpt-5.6-sol`、`xhigh`，只读评审。
- 批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，复算 SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 精确草案：`/tmp/seedlands-baseline-proposal/baseline.patch`，最终复算 SHA-256 为 `313505dc2af8c6a5f5b10eb3b7a2467c63d1b73ec09552aae7361d4a9b28aa13`。
- 草案路径：`tests/e2e/support/harness.ts` 与 `tests/e2e/regression/world-play.spec.ts`；初审仓库 HEAD 为 `1478910`，最终隔离复验以生产提交 `009c0ee` 为基线。
- 限制：草案只应用到 `/tmp/seedlands-baseline-review-3135` 与 `/tmp/seedlands-preview-cachefix-2`，未在主工作树修改既有长期测试。初审未启动浏览器；最终复验在取得浏览器独占后以单 worker 独立执行。

## 结论

批准 SHA-256 为 `313505dc2af8c6a5f5b10eb3b7a2467c63d1b73ec09552aae7361d4a9b28aa13` 的精确 patch 进入长期基线。它替换两条过期几何语义，核心价值、重复度、确定性和维护成本均达到准入要求，没有删除或削弱碰撞断言。独立隔离构建通过；在生产编辑成功回执同步客户端碰撞副本的窄修复下，两条修改用例与完整 `world-play.spec.ts` 均已 GREEN。

## 长期核心价值与语义

草案保持 `world-play.spec.ts` 原有 7 项用例总数，只替换两项已经被批准合同明确废止的行为：

1. “中心体素挖空即下落”改为“真实邻块支撑仍站立，挖除完整身体底面覆盖的全部支撑才下落”。夹具先保留中心空洞并跨至少 16 个权威物理 tick 验证持续支撑，再经生产 Harness 填空路径删除 `[-1,56,-1]..[0,56,0]` 四格支撑，验证下落、空中按 Space 不重新落地且不与固体重叠。这直接覆盖合同 A4 的“贴边仍受支撑、挖除全部支撑才下落”，并保留真实输入与权威状态接线。
2. “下台阶后可无跳跃立即反向回到高台”改为“先真实落到低一格地面，反向行走被高台侧面阻挡，按 Space 后才能返回高台且全程无重叠”。这直接保护“一格障碍必须跳跃”和取消旧脱离重叠补丁后的用户旅程。

旧 `changes/2026-09-04-center-of-mass-grounding/spec.md` 仍作为历史交付记录保留，草案没有静默改写历史 change。新的长期断言与当前批准 spec 第 29、31、120、136 行的明确替换一致。

## 重复度、确定性与成本

| 门禁               | 独立判断 | 证据与影响                                                                                                                                                                                                                                 |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 长期核心价值       | 通过     | 两项均是日常移动、挖掘、支撑和一格高差的核心回归，覆盖浏览器输入、Authority Worker、生产世界编辑和快照投影的跨层接线，纯 Vitest 不能代替。                                                                                                 |
| 重复度             | 通过     | `tests/physics/step-body.test.ts` 覆盖算法级支撑和跳跃；change E2E 覆盖自然河岸及 Worker 行为，但没有同时覆盖确定性四格支撑删除和下台阶后返台旅程。草案替换旧项且不增加用例数。                                                            |
| 确定性与 flakiness | 条件通过 | 固定 seed、隔离页面、等待权威与相机都到达夹具位置、以 `physicsTick` 而非固定 sleep 等待、按键用 `try/finally` 释放。返台前 `z` 位于 `-0.4..-0.3` 的等待依赖稳定墙面停止位置，但它是状态等待且窗口覆盖 0.32 半宽边界；最终 GREEN 仍需确认。 |
| 运行成本           | 通过     | 用例总数不变；新增等待最多 16 个物理 tick、两段受 15 秒状态超时约束的移动，增量有限。测试侧 Harness 类型镜像只增补现有 runtime、两个 Authority 字段和异步返回类型，没有导入新的运行代码。                                                  |
| 断言强度           | 通过     | 邻块支撑先持久在线、全部支撑删除后必须下降；高台侧面必须阻挡、按跳跃才返回；`colliding=false` 在关键阶段保留并增加。没有扩大容差或用位置变化代替碰撞正确性。                                                                               |

Harness helper 的 `removeVoxelAt`、`fillWorld`、`movePlayerTo` 与三个准备函数在生产入口已是异步方法；草案从 `page.evaluate()` 返回 Promise，并在夹具后同时等待 `onGround`、`colliding`、相机位置和 `serverPlayerPosition` 收敛，修复了“命令已完成但旧客户端 snapshot 尚未落位”的竞态。`HarnessSnapshot` 是测试侧结构子集；`runtime: 'integrated-server' | 'authority-worker'` 保留历史 change 的编译口径，当前用例仍可断言真实 `authority-worker`，新增的 `authority.{physicsTick,commitSequence}` 与生产快照一致，没有产生第二份运行实现。

## 实际证据与剩余门禁

- 初始草案 hash `efb44115d395b1c74c3eb0cdbaf7fd01e8160e6ef1a74ed902ac90f7b596dc06` 在隔离应用后使历史 `changes/2026-09-04-client-server-foundation/e2e/client-server-foundation.spec.ts` 出现 TS2367，因为测试侧 runtime 被收窄为只允许 `authority-worker`。该 hash 不批准。
- 最终草案仅把这一类型改为 `'integrated-server' | 'authority-worker'`；`world-play.spec.ts` 的 SHA-256 仍为 `1d4dee253d45d72acf097abeaf0e4d6de86052bef4322b1bcf82b532b3800b43`，没有改变行为断言、等待窗口或用例数量。新 patch hash 为 `313505dc2af8c6a5f5b10eb3b7a2467c63d1b73ec09552aae7361d4a9b28aa13`。
- `sha256sum` 复算 spec 与最终 patch 均匹配本评审绑定；`git apply -p0 --check` 与 `git diff --check` 通过。以 `009c0ee` 新建 `/tmp/seedlands-baseline-review-3135` 并精确应用最终 patch 后，`pnpm build` 通过，包括 Svelte、生产 TypeScript、测试 TypeScript 和 Vite 生产构建；历史用例未修改。
- `pnpm exec prettier --config .prettierrc.json --check /tmp/seedlands-baseline-proposal/harness.ts /tmp/seedlands-baseline-proposal/world-play.spec.ts` 通过。必须显式指定仓库配置，因为 `/tmp` 文件不会自行发现工作树中的 `.prettierrc.json`。
- 第一、二轮既有日志都在“仍有邻块支撑”阶段读到旧客户端位置而失败，串行第二项未运行；草案加入 Authority 与相机双位置等待后覆盖该竞态。
- 第三轮和 `run-009c0ee.log` 已越过邻块支撑与全部支撑删除后的下落检查，但在保留的 `afterSpace.colliding === false` 断言失败。独立精确复现证明 Authority 身体持续下落且没有穿透；客户端碰撞副本仍把三块已确认删除的支撑读为 Stone，约 5 秒后随可视 Mesh 重建才恢复，故这是碰撞副本一致性缺口，不能靠测试等待掩盖。
- 在隔离预览加入“世界编辑成功回执先同步已缓存 canonical 体素与 Chunk revision”的窄修复后，最终 patch 的 `harness.ts` 和 `world-play.spec.ts` 文件 SHA 与提案逐字一致。两条修改用例独立执行 2/2 通过，用时 10.4 秒；完整 `world-play.spec.ts` 7/7 通过，用时 20.9 秒。`expect(afterSpace.colliding).toBe(false)` 保留原样。

准入后的主线交付仍必须满足：

1. 将上述客户端碰撞副本同步修复与最终 patch 一并集成，在实际主线 HEAD 重跑两条修改用例和完整 `world-play.spec.ts`；不得删除 `afterSpace.colliding`、改成宽松条件或扩大数值容差。
2. 最终 change 的 A10 仍需按 spec 运行完整 Playwright baseline、静态检查和生产构建，并记录源 SHA；本评审只批准这份长期基线候选，不代替全 change 准出。
3. 若修改最终 patch 的行为、断言、等待窗口、runtime 类型或测试数量，本批准失效，必须以新 SHA-256 重新独立评审。

最终评审结论是“精确候选批准，主线交付继续 fail closed 到实际 HEAD 全部 GREEN”。原 RED 已定位为生产碰撞副本一致性问题，并以不等待可视 Mesh 的实现方向独立转为 GREEN。
