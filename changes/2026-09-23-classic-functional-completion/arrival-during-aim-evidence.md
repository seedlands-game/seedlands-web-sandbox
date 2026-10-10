# V2 Aim 期间到达交还证据

阶段：`V2-ARRIVAL-DURING-AIM-CLOSE-12`

状态：FIXTURE_DETERMINISTIC_STATIC_GREEN。Browser21 保持正式 FAIL：C0-C3、完整 V1、resources-placed 和第一格 wood
采矿/清空/实际入包 PASS；返回 approach 的 dynamic route aim FAIL；其余 V2、C4/C5 与保存恢复 NOT REACHED。

MAP01 输入为 SOURCE15 `50c8c21b93c186427a27e47623e151b736bc17528fb4319a8aae2b6e35d991f3`、MANIFEST4
`486c335f220d9bacb1ea4019c81db44f7df36129e32c9b59d86c7410125e73a0`、delivery
`0e32bc91a71db284838265ecb5192fefb72dc7540c2c7a3eeca2537655538fc6`。

## RED

窗口 `v2-arrival-during-aim-close-12-red` 直接调用真实
`followEquipmentRoute -> walkTo -> correctMouseToRoute`，以 Browser21 `@6696/@6753/@6755` 作为 outer baseline、
walk current 与 correction observation。旧实现继续 mouse 并以 `lastDx=-80` exhaustion，未把同一 client-reached /
server-late snapshot 交还 outer。最终测试字节取得 `1 file / 6 failed / 1 passed`：其余失败覆盖 typed angle/route
outcome、V2 exact-zero handoff 和三个原 deadline 边界；唯一 PASS 是现有 strict 负例。该 RED 不是 import/collection
失败。

## 实现

- `correctMouseToRoute` 以泛型保留完整 observation，并返回 `angle-aligned` 或 `route-reached` typed outcome。可选
  `routeReached` 在每个有效 finite observation 后、zero-vector/angle/move 前调用。
- `walkTo` 仅在既有 `refreshAfterCorrection=true` 时注入复用 `reachedRouteTarget` 的 client predicate，以及
  observation-await 后和 move 前的原 deadline 检查。terminal 同一对象在 helper 返回后的 deadline 检查通过后直接
  交回 outer；angle-aligned 继续 Close10 的 post-correction refresh。
- 默认省略/false 不使用新 wrapper，不增加 Date.now/snapshot 或改变输入；closed-door direct caller 不传 predicate，
  保持 18 moves/19 observations 的纯角度 fail-closed。outer strict/wait/drift owner、预算和所有容差均未改变。

## GREEN 与静态

- 新行为测试 `1 file / 7 tests PASS`。主用例证明 `@6755` 同对象交还、mouse/keyboard 均为 0；真实 outer strict
  保持 false，记录的 `@6759` 相对它分类为 drift，下一 driver 仍为同 waypoint/KeyS 并由 sentinel 终止。
- affected 最终 `13 files / 138 tests PASS`、`maxWorkers=1`。中途 `3 failed / 135 passed` 和
  `1 failed / 137 passed` 原样保留；原因是 Close10 true-path 旧测试仍预期 terminal 后多一次 refresh。测试改用
  angle-aligned 但未到达样本后，refresh await deadline 与 null fail-closed 继续受测，没有削弱默认兼容断言。
- Classic test types、root test types、5 个 TS ESLint、精确 Prettier 与 scoped diff PASS。ESLint 首轮因
  `harness.ts` 超过既有 max-lines 失败；Close12 初版随后在 `walkTo` 新增多处 inline `prettier-ignore` 并压平控制流。
  虽未改 `.prettierignore`，这仍是新增格式豁免，因此当时的 Prettier PASS 不证明正常格式达标。format closure 已先
  原字节归档该 release，再把 `ClassicSnapshot` 等价拆到 `harness-snapshot.ts`、移除本片新增 suppression 并恢复标准
  Prettier。因为只做 type-only 移动与格式恢复，按授权不机械重跑已通过的 138-test closure。

本阶段不运行 Browser22、build、Git、Cua、CI、部署或合并。fixture/static GREEN 不改写 Browser21，也不证明完整 V2
产品 GREEN；Browser19 首 iron inventory pickup 仍 NOT PROVEN。

## GIT-37 隔离交付

- baseline：`24dc3a1daca6e629ca273ea07aeae50eb4be868a`。
- 精确九路径 binary patch SHA-256：`8d55c757e842d65ce710f3e4af83f5e404516bcc9388fa578b63017a1116f4b5`。
- detached tree：`/private/tmp/seedlands-git37-arrival-during-aim`；离线 frozen 安装后 root 与 Web 的
  `@seedlands/*` workspace links 均指向该树内部。
- 单一默认 benchmark-window staged gate：`13 files / 138 tests PASS`，Classic/root test types PASS，6 TS ESLint
  PASS，九路径常规 Prettier PASS，精确 staged scope PASS；Vitest `maxWorkers=1`。
- 代码 commit：`99b895067324ae930fd5dbd6bb227c578c499c8d`，自然 hooks 的 Prettier、ESLint 与 `ls-lint` PASS。
- Browser-21 仍为 FAIL；Browser-19 首 iron inventory pickup 仍 `NOT_PROVEN`。BUILD13、Browser22、Cua、CI、
  deploy、merge 均未运行。
