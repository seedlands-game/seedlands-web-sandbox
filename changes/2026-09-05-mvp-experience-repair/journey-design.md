# 修复版完整自然旅程回归

## 目标

本回归复验旧 MVP 的真实黄金旅程在本 change 的连续采集、输入门禁、掉落物理、实体呈现与流体改动后仍可完成：自然采木与拾取、合成、真实移动采石、制作照明、攻击夜行兽、食用浆果、保存退出并继续世界。测试不使用 `give-item`、`setVoxelAt`、传送、改时间或其他调试命令跳过任一玩法步骤。

## 当前设计

`e2e/natural-journey.spec.ts` 保留父 change 的固定 seed、自然树与采石场路径、鼠标键盘/GUI 输入和库存语义断言。采集完成不再等待 `worldRevision`，因为流体推进可在未破坏目标方块时递增 revision。新的 `mine()` 先断言目标非 Air，再只等待生产 Harness 的只读 `getVoxelAt(x,y,z)` 观察到目标变为 Air；放置步骤先断言目标为 Air，再按精确 Voxel ID 验证原木、灯笼与沙块，而非等待 revision 或任意非空气值。

采石路径按每一列的实际 `terrainHeight` 从顶层逐层真实采掘，形成可步行阶梯；每次主动采集都先读取目标非 Air，再等待该坐标实际变成 Air，连续采集已经顺带清除的下层不被伪装成新的独立动作，最终库存必须精确出现配方所需的4块天然 Stone。攻击期间 F3 仅作为只读语义观测取得动态实体位置和ID，实际伤害仍来自相机瞄准与左键；每次命中以权威 `query-entity` 生命下降为完成条件，至少观察一次生命降低，最终同时验证目标权威实体与呈现均消失。

保存继续的闭环不止比较库存文字：还复核同一敌人ID持续死亡、原木/灯笼/三块沙的精确体素、食用后的饥饿值、返回建筑附近后的活动灯光，以及库存槽位完全一致。`getVoxelAt` 与 `query-entity` 均为只读观察，不生成物品、不编辑世界、不传送、不推进时间。

Harness 启动会为诊断默认打开 F3；该测试先确认实体标签存在，按一次 F3 后确认标签隐藏，再走玩家视图。攻击阶段开启 F3 只读取语义实体位置，完成战斗后关闭；存档恢复阶段可再次开启只读诊断。攻击本身仍只用真实相机瞄准和左键。

## RED 历史与证据边界

实现前 `game-harness.ts` 尚未提供任意坐标的只读 `getVoxelAt`（snapshot 只有 `voxelAtOrigin`），因此完整旅程在首个采集观察点明确 RED；不会退回不可靠的 revision 等待，也不会用 debug 改世界伪造通过。主流程补入这个只读 Harness 合同后，再执行完整旅程。

实际记录：完整旅程在第一棵自然树的 `mine()` 即报 `Natural journey requires the production read-only Harness getVoxelAt(x, y, z)`，证明测试没有偷偷退回 `worldRevision`。该入口接线尚未落盘前，不执行后续完整回归。

接线后的重跑越过 `getVoxelAt`、自然树采集和木斧合成；旧测试的树→采石场直线移动在15秒后仍距目标14.19米，属于当前交互路径 RED。分段移动后，严格采集前置断言又发现旧采石场用单一高度访问了实际 Air；这证明旧 `worldRevision` 等待可能把无关推进误报为采集成功。修订后改为逐列实际高度、从可见表面向下开挖，不以 Harness 移动或体素编辑绕过路径。

后续逐段 RED 还捕获并修正了三项测试口径：连续采集会在鼠标释放前顺带清除下一层，因此已变 Air 的下层只记为同次真实采集结果，不再次冒充动作；沙块站位最初被已放原木遮挡，改为从西侧按远到近建造并要求目标卡精确命中天然地面；战斗后饥饿仍满时食用会被生产规则正确拒绝，因此恢复等待自然饥饿下降的步骤。

最终命令 `SEEDLANDS_E2E_PORT=4277 CI=true corepack pnpm exec playwright test changes/2026-09-05-mvp-experience-repair/e2e/natural-journey.spec.ts --grep "修复版自然资源" --retries=0` 明确退出成功，`1 passed (2.2m)`。完整日志保存于 `/tmp/seedlands-journey-logs/natural-journey-final.log`；该临时日志是本机运行证据，不作为仓库唯一交付材料。

## 准出

- Playwright-change：完整旅程通过、全程无 `pageerror`；严格证明自然木/石采集、GUI配方、4号原木/9号灯笼/6号沙块建造、动态目标真实受伤并死亡、食用，以及存退后建筑、灯光、饥饿、库存和敌人死亡状态一致。F3只提供只读观测与瞄准坐标，不调用任何跳过玩法的写命令。
- Manual supplement：末帧保存为 `evidence/natural-save-continue.png`，它含F3诊断与仍在streaming的场景，仅记录恢复后的UI/持物状态，不用它证明场景美观或完整加载；正式视觉准出使用独立场景与Midscene。
