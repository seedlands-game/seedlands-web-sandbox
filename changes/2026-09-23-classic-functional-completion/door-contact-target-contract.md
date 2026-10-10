# V1 门接触位 Toggle 目标闭环合同

阶段：`V1-DOOR-CONTACT-TARGET-CLOSE-01`

状态：fixture 修正与静态验证完成；Browser GREEN 待后续唯一 Browser-11。

## Browser-10 RED

Browser-10 唯一正式窗口 `af18e91d-2d06-48f5-8350-1b95eadbe25d` 先证明新 closed-door oracle 在真实 Authority 正交推进下 PASS，随后在 `aimAtVoxelWithRealMouse(page, door.lower)` 失败。结束位置为 player `[70.49250030517578,32.599998474121094,0.4989718496799469]`、server `[70.49249900119875,32.6,0.4989718402279727]`，view `[-97.8,-88]`；最后 12 次 target-card 全部为 upper `[70,32,0]`，`interactionAttempts=13` 没有增加。诊断 SHA256 为 `33d89bf5ed78984cbf3c7ae3cc0e73ed2f631758468df70766562f369b53f111`。

这是 fixture 的 target-selection 边界：闭门 probe 把玩家留在接触面，eye y=`32.6` 处于 upper voxel cell；从此位置对 lower center 做无 adjacent 瞄准时，upper 会是稳定的首个实体门格。失败发生在右键之前，不证明 Structure toggle 或 Authority 失败。

## 可验证行为

1. `expectClosedDoorBlocks()` 完成后的首次 toggle 显式调用 `aimAtVoxelWithRealMouse(page, door.upper)`，仍通过同一 helper 的 exact target-card/Harness target 判定和真实 PointerLock 输入，然后才发送真实 canvas 右键。
2. 不增加动态 upper/lower fallback，不改 `aimAtVoxelWithRealMouse` 成功条件，不改 target/adjacent、PointerLock、坐标、timeout 或 180 次预算。
3. 首次 upper toggle 后原有 door pair 变化、open descriptor 无 collision、mesh 旋转与 Chunk revision 断言原样继续。
4. 真实穿过已开门后，仍对 upper 右键关门，再对 lower 右键打开；两个 half 的 targetability 覆盖不削弱。
5. jukebox/media、C4/C5、save-return-continue、runtime/developer epoch、resume/eject/cleanup 旅程与断言顺序不改。

## 证据边界

- Browser-10 作为真实执行 RED，不为单行 target 替换增加镜像 Vitest，不重跑 browser。
- 本阶段只修改 `v1-slice.ts` 的首次 toggle 目标和当前 change 文档；不修改 production、scenario、Harness、aim/target-aim、closed-door oracle 或共享 execution state。
- Classic/root test types、定向 ESLint/Prettier/diff 只证明 fixture 与静态边界完成。真实首次 upper toggle、门后旅程与 jukebox/media/C4/C5/save 须由 GIT18/BUILD12 后的唯一 Browser-11 验证。
