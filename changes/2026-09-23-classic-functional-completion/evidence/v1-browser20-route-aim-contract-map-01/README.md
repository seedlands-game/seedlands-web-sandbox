# Browser20 Route Aim 合同地图

阶段：`V1-BROWSER20-ROUTE-AIM-CONTRACT-MAP-01`

状态：只读诊断完成，等待 root 冻结实施合同。本阶段没有修改源码或历史 Browser20 证据，没有运行测试、build、
Browser21、Cua、Git、CI、部署或合并。Browser20 仍是 canonical fixture 的正式 FAIL；V2 未到达。本报告不把它称为
production 缺陷或 Close10 回归。

## 冻结输入

- 当前功能分支基线：`266f82cbcef5770d51b6d907723cb84f952d35a9`。
- BUILD11 Browser source：`73e8d4da504e3d21290fc82208b7e2516521515a`，tree
  `345682c2280824a294b5531b3a6654a71764c9cc`。本报告读取的相关源码与该 acceptance tree 逐字节相同。
- Browser20：SOURCE10 `0419909a5bf74910cce09b540a7ffd7040d7a960eb1ea2782d19e680cfdd9591`、MANIFEST48
  `d77403b9bccf928df5438e2fe2f27380719d26205ca578298a8fd57b3f66ca6c`、delivery
  `59431a5bbf81a5720592076120caac1a6bd5db71f4a2bdeb830cb05d9ded7621`。
- Browser20 结果：C0-C3 PASS，V1 在 closed-door `KeyW` probe 发出前 FAIL；door probe、V1 后续、V2、C4、C5
  均未到达。错误为 `v1-slice.ts:205` 的 route correction 期望 `<1`、实际
  `72.86287224169372`。

## 输入链与数学边界

生产输入与 fixture 算法的换算一致：

1. `configureClassicSettings` 把 `#mouse-sensitivity` 最终设回 `0.13`。
2. `PlayerController` 在 Pointer Lock 中执行 `yaw -= event.movementX * sensitivity`，默认 sensitivity 也是 `0.13`。
3. `horizontalMouseCorrectionToRoute` 将 `yaw-targetYaw` 归一化到 `[-180,180]`，除以 `0.13`，再 clamp 到
   `[-80,80]`。
4. `moveMouseBy` 通过真实 `page.mouse.move` 送入 movement；接近 canvas 64px 边界时先退出 Pointer Lock、等待
   1500ms、继续游戏并重新 lock，然后再移动；每次移动后等待两帧。

所以每个满幅 move 最多改变 yaw `80 * 0.13 = 10.4°`。合法归一化误差最大 `180°`，固定位置的完整 yaw 域至少需要
`ceil(180 / 10.4) = 18` 个 move。第 18 个 move 不能自行证明成功；必须有第 19 次真实 observation，再以真实
`horizontalMouseCorrectionToRoute` 得到 `abs(dx)<1`。现有 12 个 move 只覆盖 `124.8°`，不是完整域预算。

`18 moves + final observation` 只是固定 route vector、鼠标按 `0.13°/unit` 响应时的确定性上界，是需要 root 显式
冻结的新合同，不是原 12 次预算内修复。移动中的玩家会改变目标 yaw；新合同不宣称任意动态目标必然收敛，而是在同一
有限上界内根据每次最新 observation 成功或显式失败。

## Browser20 完整动态序列

机械逐行数据见 `closed-door-route-aim-observations.tsv`。以下不是用首尾插值：

- plan 初始 Authority observation：position `[67.32670621695529,32.6,0.6780099244880817]`、yaw `-86.75°`、
  tick/ack `12255/5483`。
- approach 返回：client `[69.45709228515625,32.599998474121094,0.4731168746948242]`、server
  `[69.5975040602879,32.6,0.626796087343078]`、yaw `41.17°`、tick/ack `12529/5765`。
- 第 1 次 correction observation 时 position 仍为
  `[69.55583739362123,32.6,0.5851294206764114]`，target yaw `-87.483083°`。第 2 次 position 漂到
  `[69.39230994509148,32.6,0.38707929317700357]`，target yaw `-93.077653°`。第 3 次以后 position 基本稳定在
  `[69.39230994509148,32.6,0.38617787241326273]`，target yaw `-93.102173°`。
- 12 次 observation 的 yaw 为 `41.17, 30.77, 20.37, 9.97, -0.43, -10.83, -21.23, -31.63, -42.03,
  -52.43, -62.83, -73.23`；每次真实 correction 都 clamp 为 `+80`，每次真实响应约 `-10.4°`。
- 第 8 个 move 前发生一次 canvas 边界触发的 Pointer Lock exit：等待 unlocked 为
  `112636.513-112637.423ms`，1500ms cooldown 为 `112638.258-114140.836ms`，重新 locked 检查为
  `114228.323-114230.947ms`；随后第 8 个真实 move 为 `114232.203-114241.136ms`。所有 observation 均
  grounded、non-colliding，tick/ack 前进，不支持输入停滞解释。
- 第 12 个 move 后，direct caller 的 assertion observation 为 yaw `-83.63°`，position 未再漂移，真实剩余
  correction `72.862872`。现有 helper 没有读取它，而是在第 12 个 move 后静默返回 `void`。

该序列可作为 RED 的真实前缀：前 13 个 observation（12 个循环 observation 加 assertion observation）必须逐值
重放。若测试为了证明响应正常时的 GREEN 再补一个 observation，它只能明确标为“按生产 `0.13` 换算的反事实下一帧”，
不能冒充 Browser20 已记录字段。Browser20 没有记录第 13 个 correction move 及其后 observation。

## Consumer 与现有测试地图

`correctMouseToRoute` 的源码调用点只有两个：

| consumer | 调用方式 | 当前耗尽后行为 | shared 合同影响 |
| --- | --- | --- | --- |
| `harness.ts:walkTo` | 所有 W/S route 的 shared helper | helper 静默返回后继续发 movement pulse | 新 helper 抛错时自然 fail closed，keydown 不发生；无需改 `walkTo` |
| `v1-slice.ts:expectClosedDoorBlocks` | approach 后 direct call | helper 静默返回，额外 observation/assertion 才暴露失败 | 新 helper 先明确失败；现有 postcondition 可保留 |

`walkTo` 的间接消费者包括：

- `classic-runtime.spec.ts` 的 chunk crossing、资源 approach、hostile/station、far turnaround 与 `KeyS` return。
- `harness.ts:mineVoxel` 的 out-of-range approach。
- `crafting.ts` 的 station approach。
- `equipment-journey-support.ts -> followEquipmentRoute` 的 V2 resource/workbench 路线；Close10 的
  `refreshAfterCorrection=true` 仍只负责 correction 后刷新路线 snapshot，不负责把 aim 耗尽改成成功。
- `v1-slice.ts` 的 water、door、closed-door retreat/traverse、jukebox 路线，以及 closed-door direct caller。

`horizontalMouseCorrectionToRoute` 除 helper 内部外，仅被 V1 closed-door postcondition 和 `target-aim.test.ts` 使用。现有
`target-aim.test.ts` 只有 W 正方向与已对齐 KeyS 的同步数值例，没有调用真实 async helper，也没有覆盖全 yaw 域、最后
move 后 observation、null、无响应或耗尽。`equipment-pickup-route-refresh.test.ts` 调用真实 `walkTo`，但其目标是 Close10
refresh/deadline/strict handoff，不冻结 shared aim 全域合同。

## 方案比较

### A. shared helper 新合同（推荐）

只修改 `target-aim.ts:correctMouseToRoute`：最多 18 次真实 move，最多 19 次 observation；每次都用最新 player/yaw
和现有 `horizontalMouseCorrectionToRoute` 重算。只有某次真实 observation 得到 `abs(dx)<1` 才正常返回。最后一次 move
之后必须再 observe。暂时的 null 消耗同一个 19-observation 配额但不 move；持续 null、非有限 observation、精确零长度
route vector、18 moves 后仍未收敛或 mouse 不响应均抛稳定、可诊断的 route-aim 错误。

优点：两个直接 consumer 与全部 `walkTo` 间接 consumer 得到同一 fail-closed 边界；不改变 step、sensitivity、route
timeout、容差或调用次数之外的路线规则；不需要第二次调用、fallback、callback 或复制算法。

影响：这是 shared fixture helper 的显式行为变化。原来耗尽/null 可静默返回并让 `walkTo` 发键；新合同会在 route aim
未证实时停止。该变化正是需要 root 审核冻结的范围，不能描述为默认行为不变。Close10 的 refresh 分支与默认分支都在
helper 成功后保持现有行为；helper 失败时两者都不得发送 movement。

### B. 只修 closed-door consumer（否决）

给 direct caller 增加循环、重复调用 helper 或 closed-door 专用 wrapper，可以绕过 Browser20 当前断点，却会：

- 复制算法或形成第二次调用/fallback，违反单一预算要求；
- 留下 shared `walkTo` 在同一 helper 静默耗尽后继续发 movement 的边界；
- 让 V1 direct caller 与 V1/V2 其他 route 使用不同成功定义。

因此 B 不是最小完整修复。不能靠改变 step/sensitivity、扩大 45s/20s/1250ms/720000ms/voxel aim 180/容差，
也不能叠加第二次 helper 调用。

## 建议冻结的 shared 合同

1. 保留现有参数和 `Promise<void>` 成功返回形状；调用点不需要接线变更。
2. 设私有确定性上界 `MAX_ROUTE_AIM_MOVES = 18`。循环允许最多 19 次 observation、最多 18 次 move。
3. null 消耗同一个 observation 配额但不 move、也不用旧值继续；持续到配额结束时抛稳定 unavailable 错误。有效
   observation 的 player、yaw、target 必须均有限，否则立即抛 stable invalid 错误。
4. route 水平向量精确为零时方向未定义，显式 fail closed；不要用 `atan2(0,0)` 生成任意 yaw。非零但接近目标的
   动态 observation 仍按现有 correction 处理，并受同一 18-move 上界约束。位置是否已 route-reached 仍由
   `walkTo/reachedRouteTarget` 所有，helper 不新增容差或 already-arrived shortcut。
5. 对真实 observation 调用现有 `horizontalMouseCorrectionToRoute`；仅 `abs(dx)<1` 正常返回。
6. 尚有 correction 且 move 额度未用尽时，调用一次现有 `move(dx,0)`，下一轮必须重新 observe；不得从 move 完成推断
   成功。
7. 第 19 次 observation 仍有 `abs(dx)>=1` 时，抛稳定 exhaustion 错误并包含 target/direction/last dx；不得 move
   第 19 次。mouse 完全无响应会在有限 18 moves 后进入该错误，不再静默返回。
8. helper 抛错自然阻止 `walkTo` 的 keyboard down。现有 45s/90s route timeout、20s wait、80/100/300ms pulse、
   1250ms door budget、720000ms canonical timeout、voxel aim 180、所有 route 坐标与容差不变。

固定姿态数学上界不涵盖任意动态 route vector；动态漂移或跨过目标导致的 target yaw 翻转必须在有限上界内重新计算，
若未收敛就明确失败。该边界避免无限循环，也避免把靠近/越过 route point 自动冒充已完成；route completion 仍由 caller
的现有 position predicate 决定。

## 可执行 RED

建议新增 `apps/web/tests/e2e/classic-support/route-aim-contract.test.ts`，直接调用真实
`correctMouseToRoute`/`horizontalMouseCorrectionToRoute`，不复制 correction 算法：

1. **Browser20 准确前缀**：逐值重放 TSV 的 13 个真实 observation。断言 helper 必须读取第 13 个 observation，不能在
   12 moves 后成功返回；它应据此发出 `72.862872` 的第 13 个 move，随后因没有第 14 个已记录 observation 而明确
   失败。若另一个 GREEN 用例追加成功 observation，必须标明是按真实 sensitivity 计算的反事实帧。
2. **全 yaw 域**：参数化 W/S、X/Z 固定 pose 及 wrap `+180/-180`。fake move 只执行生产公式
   `yaw -= dx*0.13`；断言最多 18 moves，并由最后真实 observation 的真实 correction `<1` 结束。
3. **最后 move 后读取**：构造恰需最后允许 move 的状态；断言成功需要第 19 次 observe。若第 19 次仍未对齐则明确
   exhaustion，不允许仅因 move 已调用而成功。
4. **null/invalid**：持续 null 用满 19-observation 配额后明确 unavailable 且零 move；短暂 null 后的有效观测仍可收敛。
   非有限位置/yaw 立即 invalid 且不 move；不得复用旧 observation。
5. **no progress**：move spy 不改变 yaw，断言最多 18 moves 后显式 exhaustion；不增加随机 early-retry 阈值。
6. **零 route vector**：player x/z 精确等于 target 时稳定 fail closed；近零非零向量只能真实收敛或在相同上界失败。
7. **默认 walk 边界**：用最窄 fake Page 调用真实 `walkTo`，让初始 position 未 reached、helper observation/mouse 无响应；
   断言 helper exhaustion 传播且 keyboard down/up 为 0。该用例不制造成功 driver，也不改 Close10 refresh 合同。

当前实现会在 Browser20 前缀第 12 个 move 后返回、全域例覆盖不足、no-progress 后静默返回并让 `walkTo` 发键，因此上述
是行为 RED，不是 missing import/collection RED。

## 建议 GREEN 与闭包

最小 ownership：

- `apps/web/tests/e2e/classic-support/target-aim.ts`：只改 shared route aim 的有界成功/失败合同。
- `apps/web/tests/e2e/classic-support/route-aim-contract.test.ts`：新增上述真实 helper 合同测试。
- 当前 change 的 `spec.md`、新 route-aim contract/evidence 与阶段 evidence。
- `harness.ts`、`v1-slice.ts`、`mouse-input.ts`、`route-progress.ts`、Close10 文件和 production 源码默认只读；若类型
  或错误传播不需要改动，不得顺手修改。

建议 GREEN closure：新 route aim test、现有 `target-aim.test.ts`、`equipment-pickup-route-refresh.test.ts`、
`route-progress.test.ts`、closed-door oracle/exit-face/相关 scenario tests，以及 Classic/root test types、变更 TS ESLint、精确
Prettier/scoped diff。是否纳入更宽 V1 deterministic closure 由 root 在实施阶段按实际 test argv 冻结；本阶段未运行任何
测试，不能写成 GREEN 或 Browser 产品通过。Browser21 必须在独立 lease 下验证，不能由 deterministic/static 代替。

## 预算与边界

- 建议实施 AI：1-2h，硬上限 3h；传统工程量约 0.25-0.5 PD。
- model credits、API 等价费率、当前额度与占比：unknown，不能换算。保守预算建议取上界的 120%，即 AI 3.6h
  容量、传统 0.6 PD；实际阶段仍受 root 给定硬上限约束。
- 本诊断没有性能测量、Cua 或人类听觉验收。长期 docs 不需要更新：这是现有 canonical fixture helper 的窄合同，
  不改变生产架构或长期产品边界。
