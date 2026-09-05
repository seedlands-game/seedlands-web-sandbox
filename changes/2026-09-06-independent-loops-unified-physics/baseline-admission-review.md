# 长期浏览器基线独立准入评审

## 评审绑定

- 评审配置：请求使用与草案实现者独立的 `gpt-5.6-sol`、`xhigh`，只读评审。
- 批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`，复算 SHA-256 为 `c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`。
- 精确草案：`/tmp/seedlands-baseline-proposal/baseline.patch`，复算 SHA-256 为 `efb44115d395b1c74c3eb0cdbaf7fd01e8160e6ef1a74ed902ac90f7b596dc06`。
- 草案路径：`tests/e2e/support/harness.ts` 与 `tests/e2e/regression/world-play.spec.ts`；评审时仓库 HEAD 为 `1478910`。
- 限制：本评审未把草案应用到仓库，未修改生产代码或现有测试，未启动浏览器。浏览器结果只审阅草案目录中的既有运行日志，不能算作本评审者独立执行证据。

## 结论

对精确 patch 作**设计条件准入**：它适合替换现有长期基线中的两条过期几何语义，核心价值、重复度、确定性和维护成本均达到准入要求，也没有通过删除碰撞断言来放宽行为。但当前仍不满足执行准出：第三轮预跑在 `expect(afterSpace.colliding).toBe(false)` 得到 `true`，串行的下台阶用例因此尚未运行。只有精确 patch 在当前生产实现上保留该断言并最终 GREEN 后，才能实际进入 `tests/e2e/` 长期基线。

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

Harness helper 的 `removeVoxelAt`、`fillWorld`、`movePlayerTo` 与三个准备函数在生产入口已是异步方法；草案从 `page.evaluate()` 返回 Promise，并在夹具后同时等待 `onGround`、`colliding`、相机位置和 `serverPlayerPosition` 收敛，修复了“命令已完成但旧客户端 snapshot 尚未落位”的竞态。`HarnessSnapshot` 是测试侧结构子集，`runtime: 'authority-worker'` 和 `authority.{physicsTick,commitSequence}` 与生产快照一致，没有产生第二份运行实现。

## 实际证据与剩余门禁

- `sha256sum` 复算 spec 与 patch 均匹配本评审绑定；`git apply -p0 --check` 通过，精确 patch 可应用到评审时工作树；`git diff --check` 无空白错误。
- `pnpm exec prettier --config .prettierrc.json --check /tmp/seedlands-baseline-proposal/harness.ts /tmp/seedlands-baseline-proposal/world-play.spec.ts` 通过。必须显式指定仓库配置，因为 `/tmp` 文件不会自行发现工作树中的 `.prettierrc.json`。
- 第一、二轮既有日志都在“仍有邻块支撑”阶段读到旧客户端位置而失败，串行第二项未运行；草案加入 Authority 与相机双位置等待后覆盖该竞态。
- 第三轮既有日志已越过邻块支撑和全部支撑删除后的下落检查，但在保留的 `afterSpace.colliding === false` 断言失败，收到 `true`；下台阶项仍因串行顺序未运行。该预跑目录标识为 `/private/tmp/seedlands-preview-c1b1827`，不能证明后续 `1745cfd` 碰撞容差统一后的当前生产实现。

实际纳入长期基线前必须满足：

1. 在当前生产提交上运行精确 patch 的两项修改用例，两项都 GREEN；不得删除 `afterSpace.colliding`、改成宽松条件或扩大数值容差来消除 RED。
2. 再运行完整 `world-play.spec.ts`，确认 Harness 异步类型与等待变化没有破坏其余五项长期旅程，并记录运行时间与源 SHA。最终 change 的 A10 仍需按 spec 运行完整 Playwright baseline、静态检查和生产构建。
3. 若只修生产物理且 patch 字节不变，本评审继续绑定同一 patch hash；若修改 patch 的行为、断言、等待窗口或测试数量，原准入失效，必须以新 SHA-256 重新进行独立评审。

评审结论是“候选设计通过、执行 fail closed”。当前 RED 是需要定位的生产或接线信号，不能作为删除碰撞断言的理由。
