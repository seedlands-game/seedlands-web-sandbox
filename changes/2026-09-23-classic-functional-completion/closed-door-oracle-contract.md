# V1 关闭门碰撞 Oracle 闭环合同

阶段：`V1-CLOSED-DOOR-ORACLE-CLOSE-01`

状态：fixture 修正与确定性/静态验证完成；Browser GREEN 待后续唯一 Browser-10。

## RED 基线

Browser-09 唯一正式窗口 `c95e4fa0-e195-4c43-88e5-1f011dbee53e` 在 `expectClosedDoorBlocks()` 失败，诊断 SHA256 为 `c4e3ac0e4583ab07a2a1d7ea320d8d007e08f877e95ddf8dfb89df143cee99f8`。按键前 Authority 眼位为 `[68.46859339486005,32.6,-0.4489545940748269]`，view 为 `[-107.94,-35.5]`。closed voxel `93` 的 collision box 为 local x `[0.8125,1]`、z `[0,1]`，player half-width 为 `0.32`；理论接触中心 x 是 `70.4925`。

Trace 中权威 x 在 `70.49249948474204` 持续不变，同时 z 从 `0.7199951193123576` 滑至 `1.32061353847437`；玩家离开门的有限 z 宽度后 x 才继续增长。这证明关闭门碰撞实际生效，而旧 fixture 的斜向长按与最终 x 断言把绕边误报为穿门。Browser-09 保持 FAIL；jukebox 瞄准与后续旅程未触达。

## 可验证行为

1. fixture 从当前 scenario 门格、已注册 closed collision box 与 `bodyConfigFor('player')` 推导法向轴、接触面、门前 approach、法向 route target 与安全横向区间；不硬编码 voxel `93` 的形状或另造地形。
2. 先复用 `walkTo` 用真实键盘到门西侧面中部，再复用 `correctMouseToRoute` / `moveMouseBy` 用真实 PointerLock 把 `W` 对准门法向。开始前要求门仍为 closed pair、Authority 位置在门前、`onGround && !colliding`、玩家 AABB 完全位于门宽内且保留有界余量，yaw 校正误差小于 1 mouse unit。
3. 碰撞 probe 仍只发送真实 `KeyW`，以 1.25 秒/75 physics ticks 作内部上限，为 `keyup` 和末次 readback 保留 250 ms，不超过原 1.5 秒总 pulse 预算；通过 Authority snapshot 轮询实时收集 `serverPlayerPosition`、physics tick 与 acknowledged input sequence，不用固定 sleep 代替完成边界。`keyup` 必须在 `finally`。
4. PASS 必须同时证明：ack 新鲜、玩家确实向门推进、到达从 descriptor+AABB 推导的接触面附近、至少再持续 6 个 Authority physics tick 而法向位置不穿透，且全部采样中玩家 AABB 始终位于门横向宽度内。
5. Browser-09 斜向滑边轨迹、完全无碰撞穿越、角色未推进、横向越界、旧 ack 都不得 PASS；合法正交接触且 fresh 才 PASS。
6. 闭门 oracle 通过后原有 open/toggle/no-collision/真实穿门/上下 half、jukebox/media、C4/C5/save 断言原样继续；不将 descriptor 非空当作真实碰撞的替代。

## 证据边界

- 本阶段只修改 canonical fixture 与纯 oracle 测试，不修改 production、`harness.ts`、`target-aim.ts`、`mouse-input.ts`、scenario、坐标、timeout 或 1.5 秒预算。
- Browser-09 作为执行 RED，不重跑、不改写。确定性回归、类型与静态检查通过只证明 fixture oracle 闭合；真实门后旅程与 jukebox aim 仍须 GIT17/BUILD11 后的唯一 Browser-10。
