# 动态实体局部阴影失效修复

**状态：已完成。**

## Context & Goal

局部灯使用按场景变化更新的 shadow map：灯位、启停或体素世界 revision 变化时请求一次 `THISFRAME`，其余帧保持 `NONE`。玩法实体仍作为动态 shadow caster 参与同一 shadow pass，但其新增、表现插值、旋转、受击形变和移除没有进入缓存失效条件。结果是破坏方块提升世界 revision 时，刚生成的掉落物会被写入局部阴影；拾取只移除玩法实体，不提升体素世界 revision，旧影子会一直留到下一次方块编辑。

完成态是：局部灯继续在静态场景缓存阴影；会改变投影的玩法实体表现变化在同一可见帧触发一次局部阴影更新；实体移除后下一次 shadow pass 不再包含该实体，不依赖后续体素编辑。

## Scope & Non-goals

本次包含：

- 为每个玩法实体表现维护单调的 shadow-caster revision，覆盖新增、移除、位置/姿态/旋转及短时受击形变。
- 让局部灯的缓存失效同时比较体素世界、灯槽与 shadow-caster revision。
- 在帧循环中先更新玩法实体表现，再决定本帧是否重画局部阴影。
- 保持 Low 无局部阴影、Medium/High 灯数和分辨率预算不变。

明确不做：永久恢复局部灯 `REALTIME`、关闭实体投影、修改太阳阴影策略、体素光传播、GI 或新的画质档预算。

## Behaviour

- Given 局部灯下没有变化的玩法实体，When 连续渲染静止帧，Then shadow-caster revision 与局部阴影更新计数保持稳定。
- Given 掉落物生成、下落、旋转或其他有投影的玩法实体改变表现姿态，When 当前帧提交新表现，Then 同一可见帧请求一次局部阴影更新。
- Given 掉落物被拾取或玩法实体被移除，When 表现节点销毁，Then 同一可见帧请求一次局部阴影更新以清除旧投影；无需等待下一次 `World.edit()`。
- Given 仅体素世界 revision 或灯槽变化，When 扫描局部灯，Then 既有一次性失效语义保持不变。
- Given Low 画质，When 动态实体变化，Then 不创建或重画局部阴影。

## Test Design

- `tests/app/gameplay-entity-presenter.test.ts` 先 RED：断言静态帧不提升 revision，掉落物的生成/旋转/移动及移除会提升 revision。
- `tests/app/advanced-lighting.test.ts` 先 RED：断言 shadow-caster revision 改变会使 `localShadowNeedsUpdate()` 返回 true，稳定 revision 返回 false。
- 受影响 Vitest 转 GREEN 后，分别运行 `pnpm verify:static` 与 `pnpm build`。
- 浏览器证据复用现有正式玩法链路，新增或扩展 change-local Playwright：在局部灯场景生成并移除掉落物，读取同一运行的 `shadowUpdateCount`，证明移除后计数增长且不依赖方块编辑。连续画面只用于确认残影清除，不以单张截图替代时序断言。

## Tasks & Evidence

1. [x] 读取项目规则、相关历史 change、帧循环、局部灯与玩法实体表现实现。
2. [x] 定位根因：shadow map 只绑定体素 world revision/灯槽，遗漏动态 shadow caster 生命周期与变换。
3. [x] 建立并记录实现前 RED。
4. [x] 实现最小缓存失效修复并完成定向测试。
5. [x] 完成静态、构建与浏览器分层证据，更新 Delivery Snapshot。

## 工作量与预算

N/A：这是单一浏览器表现链路内的小型缺陷修复，预计传统工程量低于 1 PD、Agent 连续墙钟低于 4 小时，不满足大规模 change 门槛；未创建 Goal，未主动派发子智能体。

## Delivery Snapshot

交付内容：

- `GameplayEntityPresenter` 为每个表现实体维护 revision；根节点平移/旋转/缩放、移动姿态开始/持续/停止、新增、移除和异步模型替换都会改变对应 revision。静止实体不改变。
- `AdvancedVisualEffects` 只把有机会进入实际有阴影灯范围的实体纳入稳定签名；签名、体素 world revision 或灯槽任一改变时，本帧使用 `THISFRAME`，下一静止帧恢复 `NONE`。远处活动实体不会触发局部阴影重画。
- 帧循环先推进玩法实体表现，再计算局部阴影失效，因此移除节点和清理 shadow map 发生在同一可见帧。Low/Medium/High 的灯数、阴影数和分辨率预算均未改变。
- 新增 change-local 浏览器回归：同一真实 High 画质洞穴中生成并移除掉落物，生成和移除都会提升 `shadowUpdateCount`，而全过程 `worldRevision` 不变；移除后连续静止帧计数再次稳定。

分层证据（2026-09-09）：

- 定向 Vitest：`tests/app/advanced-lighting.test.ts` 与 `tests/app/gameplay-entity-presenter.test.ts` 共 11/11 通过；相关文件 ESLint 通过。
- `pnpm verify:static` 通过：236 个测试文件通过、2 个按既有条件跳过；1169 个用例通过、4 个跳过；Prettier、ESLint、ls-lint、TypeScript 与 Svelte 检查均通过。
- `pnpm build` 通过：Rust artifact fingerprint、SSG、类型检查和 Vite 生产构建均成功；仅保留既有的大 chunk 提示。
- 最终浏览器阴影门禁 2/2 通过：既有“静止阴影不重复更新”与新增“掉落物移除后无需方块编辑即可重画”同时为绿色。新增用例保存了移除前后两张同次运行的原始 Canvas 帧作为补充观察；主结论以实体生命周期、相同 world revision、shadow 更新计数与后续稳定帧的联合读回为准，不以单张截图代替时序证明。
- 扩大运行旧 `repair.spec.ts` 时，采集 Pointer Lock 与灯笼碰撞两个非阴影用例失败；在完全不含本次修改的 `01bab28ace506685f39c1d4a86fec541cbbf2f1b` 临时 worktree 上隔离复跑得到相同失败和位置，因此记录为当前基线缺口，不归因于本次改动。临时 worktree 和测试服务均已清理。

长期 docs baseline 不更新：该修复补齐既有“场景变化才失效”的阴影合同，没有改变产品方向或长期架构边界。运行产物不纳入版本控制。

实现前 RED（2026-09-09）：

- `pnpm exec vitest run tests/app/advanced-lighting.test.ts tests/app/gameplay-entity-presenter.test.ts`：2 个文件中新增的 2 项断言按预期失败，其余 8 项通过。`localShadowNeedsUpdate()` 在 caster revision 从 7 变为 8 时仍返回 `false`；`GameplayEntityPresenter.shadowCasterRevision` 尚不存在，读取得到 `undefined`。这分别锁定了局部灯缓存条件和动态表现 revision 两处缺口。
