# V1 路线模式闭环合同

阶段：`V1-ROUTE-MODE-CLOSE-01`
状态：fixture 修正实施；Browser GREEN 待后续独立准出。

## RED 基线

Browser-05 唯一正式窗口 `319d5d90-396a-4e4d-84f9-caaccf4fdabb` 已证明水桶放 source 与空桶收 source 的正式 Authority/Web 旅程通过。随后 canonical fixture 在创造模式飞行仍启用时调用 `walkTo(page, door.approach, { jump: true })`：玩家 x/z 已到 `[67.4773,0.4280]`，目标为 `[67.5,0.5]`，但 `Space` 在飞行模式中使 y 到达 34.7，终态 `onGround=false`、`colliding=false`，`walkTo` 的落地 predicate 等待 20 秒后失败。Browser-05 的门、媒体、C4/C5 与保存恢复均未触达，不能据此形成生产缺陷结论。

## 可验证行为

1. 水桶放置 Water source、空桶收回为 Air、creative hotbar 保持 bucket 的既有断言全部完成后，fixture 复用现有 `switchToSurvival(page)`。
2. 模式切换只经正式 `KeyE` 背包/创造目录 UI：点击“切换生存模式”，等待“背包与合成”对话框可见，再按既有路径关闭背包。
3. 在发送门路线的真实移动输入前，fixture 必须从既有只读 snapshot 等到 `onGround && !colliding`。
4. 通用 `walkTo` 保持 `acknowledgedInputSequence` 前进、落地且非碰撞的原合同；门路线仍保留 `jump:true`，坐标、地形、超时及所有门、媒体、保存恢复断言不变。
5. 不允许 teleport、world command、直接 runtime/mode 调用、Harness 新写口或客户端玩法 ID。

## 后续模式链

- 门 approach 从生存模式开始；到位后选择 wooden-door 才通过正式 UI 再进入创造模式，放置后既有 `switchToSurvival` 先于碰撞与穿门检查。
- jukebox approach 在门流程已经恢复的生存模式中移动；选择 jukebox/record-13 临时进入创造模式，媒体断言完成后既有 `switchToSurvival` 恢复生存。
- C4 从生存模式开始。保存恢复前的 mode 因此仍为生存；恢复后的首次 jukebox approach 不需要额外模式切换，eject fixture 结束时仍沿既有路径恢复生存。

## 证据边界

- 本阶段只运行 Classic 测试类型检查、定向 ESLint、Prettier 与 diff 检查；不启动浏览器、build、Cua、dev server 或 CI。
- 静态通过只记为“fixture 修正完成，browser 待复验”。
- 真正 GREEN 必须由 root 准出、954 生成语义提交和新 identity artifact 后，唯一 canonical Browser-06 证明正式模式切换后落地可达，并继续完成门、媒体、C4/C5 与保存恢复旅程。
