# 破坏裂纹纹理稳定性修复

**状态：已完成；Agile flow 的 RED、实现与分层准出均已闭环。**

## Context & Goal

玩家反馈破坏方块时裂纹纹理会出现怪异旋转。源码核对确认 `crackCanvas(stage)` 把 `stage * 11` 直接加入每条分支角度，并且每一阶段重新计算起点与线段；因此进度从一阶切换到下一阶时，不只是新增裂纹，已有裂纹也会整体换方向和位置，形成旋转/跳动错觉。

完成态：裂纹固定在目标方块的世界朝向与六个表面上；阶段增加时只延长既有分支或增加新分支，已经出现的线段坐标不变。相机轻微转头时，覆盖层随方块透视变化但不会在表面滑动或自行旋转。取消、切换目标和完成破坏仍立即清除。

## Scope & Non-goals

本次包含：抽取无 DOM 的确定性裂纹线段生成函数；让十阶 Canvas 纹理由同一份固定主拓扑的递增前缀生成；保留现有世界对齐 Box、alpha cutout、depth bias、权威 `breakAction` 和十阶量化；补充真实按住挖掘、阶段切换及轻微转头取证。

明确不做：删除覆盖层、恢复独立进度条、改变挖掘时长、复制 Minecraft 纹理、改动方块选择/碰撞/存档或把覆盖层写入世界。

## Decisions

采用固定主拓扑而不是为每阶重新随机/旋转生成。主拓扑由固定分支角度、固定起点和固定折线路径组成；阶段只决定可见线段数量。这样可直接以“当前阶段线段数组必须是下一阶段的严格前缀”验证稳定性，同时保持原创程序纹理。

## Behaviour

- Given 同一目标从阶段 0 前进到 9，When 任意相邻阶段切换，Then 前一阶段的全部线段在后一阶段保持相同坐标、顺序和方向，后一阶段只增加线段。
- Given 玩家固定镜头按住左键，When 裂纹跨越多个阶段，Then 裂纹从既有路径继续扩展，不出现整张图旋转、翻面或跳到另一位置。
- Given 采集仍指向同一方块，When 相机轻微转头，Then 覆盖层世界坐标保持目标方块中心，纹理只发生正常透视变化，不相对方块表面滑动。
- Given 松开左键、目标变化或破坏结束，When 权威 `breakAction` 消失，Then 覆盖层下一可见帧关闭。

## Test Design

- `tests/app/break-overlay-pattern.test.ts`：在实现前导入尚不存在的纯生成合同；检查十阶非空、严格增长、每阶是下一阶前缀、相同调用完全确定。预期 RED：模块不存在。
- `changes/2026-09-05-stable-break-overlay-texture/e2e/stable-break-overlay.spec.ts`：真实 Pointer Lock 与左键按住，在固定目标的早/中阶段分别取帧；轻微转头后目标坐标不变；松开后覆盖清除。视觉旋转在实现前由连续帧人工观察记录，精确前缀规则由 Vitest RED/GREEN 负责。
- `changes/2026-09-05-stable-break-overlay-texture/midscene/stable-break-overlay.yaml`：并排读取真实输入 Playwright 生成的早期、中期与轻微转头原始帧，确认裂纹递增且没有整体旋转/滑动。

## Acceptance & Evidence

| 编号 | 准出标准                                               | 证据类型                    | 当前 |
| ---- | ------------------------------------------------------ | --------------------------- | ---- |
| A1   | 十阶裂纹使用同一固定拓扑，旧线段在后续阶段坐标不变     | Vitest、Static              | 通过 |
| A2   | 真实按住挖掘跨阶段时只扩展裂纹，不整体旋转或跳位       | Playwright-change、Midscene | 通过 |
| A3   | 轻微转头时覆盖层仍贴合相同方块，取消后立即清除         | Playwright-change、Midscene | 通过 |
| A4   | 不恢复进度条、不改变挖掘时长，现有破坏与渲染基线无回归 | Static、Build               | 通过 |

## Tasks & Current State

1. [x] 核对当前 Git、既有 change、覆盖层源码与用户反馈。
2. [x] 定位阶段角度/起点重算是旋转错觉的直接根因。
3. [x] 写入并执行预期 RED。
4. [x] 实现固定主拓扑，跑 GREEN 与真实浏览器/视觉准出。
5. [x] 更新交付快照，仅暂存本 change 文件并创建本地语义化提交；不 push。

当前阻塞：无。

实现前 RED（2026-09-05）：`pnpm exec vitest run tests/app/break-overlay-pattern.test.ts` 按预期失败，测试文件无法导入尚不存在的 `src/app/break-overlay-pattern.ts`，证明固定主拓扑合同尚未实现。

实现后 GREEN 与准出（2026-09-05）：

- `pnpm exec vitest run tests/app/break-overlay-pattern.test.ts tests/app/break-overlay.test.ts`：2 个文件、4 个用例通过；验证十阶严格递增、相邻阶段前缀不变、确定性与原有量化/清理状态机。
- `SEEDLANDS_STABLE_BREAK_FRAME_DIR=/tmp/seedlands-stable-break-frames SEEDLANDS_E2E_PORT=4192 pnpm exec playwright test changes/2026-09-05-stable-break-overlay-texture/e2e/stable-break-overlay.spec.ts --workers=1 --timeout=60000`：1/1 通过；真实 Pointer Lock 与按住左键取得早期、中期、轻微转头三帧，目标位置始终为 `[0,50,-3]`，松开后覆盖清除。
- 原 change 的真实采集回归 `--grep "真实按住采集"`：1/1 通过；没有恢复 `#break-progress`。
- Midscene 对三张真实输入帧的并排对比最终通过：中期沿早期主分支继续扩展；转头后只发生正常透视变化，没有纹理自转或滑动。首次实时单帧断言把目标金框和八格快捷栏误判为悬浮框/进度条，改用项目既有的只读并排原始帧方法后通过；未把误判冒充产品失败或成功。
- `pnpm format:check`、`pnpm lint`、`pnpm lint:paths`、`pnpm typecheck` 与 `pnpm build` 均通过；构建只保留既有的大 Chunk 体积提示。

## Delivery Snapshot

交付内容：新增 `src/app/break-overlay-pattern.ts`，用 12 条固定分支、每分支 6 段组成 72 段原创主拓扑；阶段 0–9 只截取严格递增的前缀。`src/app/voxel-break-overlay.ts` 改为逐段绘制该固定拓扑，移除所有随 `stage` 改变角度、起点和线宽的逻辑。覆盖实体的位置、旋转、depth bias、十阶状态、挖掘时长、取消路径和 UI 均未改变。

运行产物 `test-results/`、`midscene_run/` 与 `/tmp/seedlands-stable-break-frames` 不纳入版本控制。实现基于 `47faa0177bf31051421c8143e9668eca85f68586`；交付 commit 与本文件位于同一提交，精确 SHA 记录于最终回复。未 push、未发布、未修改存档。
