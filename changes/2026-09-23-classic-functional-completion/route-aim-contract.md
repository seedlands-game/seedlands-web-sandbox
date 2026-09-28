# Shared Route Aim 有界合同

阶段：`V1-ROUTE-AIM-BOUNDED-CLOSE-11`

状态：合同冻结，等待可执行 RED/GREEN。依据为 MAP01 SOURCE19
`5848879ef25500c0c786ada0d86d84e91c17c06f3ed8b96912e341ac6061525a`、MANIFEST4
`7f788fe22817bb678067f9731a986fc3bb56ed144f651756440f5f70ff0e49b4`、delivery
`852f5fac254fd209235eec0813613d241ba1226b45da560aed72cd13be9a2d45`。

## 行为

1. `correctMouseToRoute` 保留参数和 `Promise<void>`，只把旧 12 moves 静默耗尽改为 shared 有界 fail-closed。
2. 最多调用 `move` 18 次、`observe` 19 次。null 占 observation 配额，不 move、不复用旧 snapshot；短暂 null 后
   仍可使用后续有效 observation，最后为 null 或持续 null 时抛稳定 unavailable。
3. target、player、yaw 必须有限。非有限值抛 stable invalid；player x/z 与 target 精确重合时方向未定义，抛 stable
   undefined-direction。该错误不证明 route 尚未完成，位置完成仍由 caller 的 `reachedRouteTarget` 所有。
4. 每个有效 observation 调用既有 `horizontalMouseCorrectionToRoute`，不复制角度算法。只有真实
   `abs(dx)<1` 正常返回；否则在尚有 move 配额时调用 `move(dx,0)`，再重新 observation。
5. 第 18 次 move 不构成成功；第 19 次 observation 仍不满足时抛 stable exhaustion，并包含 target、direction 与
   last dx。no-response 只在同一固定上界耗尽，不另加随机 early retry。
6. helper reject 必须在 `walkTo` keyboard down 前向上传播。Close10 true/default 路径在 helper 成功后保持当前
   refresh/deadline 行为。

## 不变量

- 不改 `MAX_MOUSE_STEP=80`、生产/fixture sensitivity `0.13`、45/90s route、20s poll、80/100/300ms pulse、
  1250ms closed-door input、720000ms canonical、voxel aim 180、`.06/.08/.45`、路线或坐标。
- 不改 `walkTo`、`v1-slice`、`mouse-input`、`route-progress`、Close10、production 或 V1/V2 组合顺序。
- 不增加 callback、第二 helper 调用、fallback、teleport、setView 或 Harness 写口。
- 固定 pose 的 `ceil(180/(80*0.13))=18` 只证明全 yaw 域需要的 move 上界；动态 route vector 必须逐帧重算，
  不能据此宣称必达。

## RED / GREEN

- Browser20 TSV 的 13 个真实 observation/12 moves 前缀必须使旧 helper 的静默成功 RED；没有第 14 个记录时新合同
  在执行第 13 个真实 correction 后按 observation 配额明确 unavailable。任何追加 GREEN 帧都标为生产公式生成的反事实。
- W/S、X/Z 正负与 wrap `±180°` 固定 pose 通过真实 helper/correction，fake move 只做
  `yaw -= dx*0.13`；最远案例恰为 18 moves，并由第 19 次 observation 成功。
- 覆盖第 19 次仍未收敛、持续/瞬时 null、invalid、精确零/近零 vector、no-response 和输入不变。
- fake Page 直接调用真实 `walkTo`；default 与 `refreshAfterCorrection=true` 均须在 shared helper 耗尽时零
  keydown/up。既有 Close10 12 tests 继续通过。

## Ownership 与预算

实现 ownership 仅 `target-aim.ts` 的 route helper、一个新 route aim contract test、当前 spec/合同/证据。其他 helper、
caller 和 production 默认只读。建议 AI 1-2h、硬上限 3h；传统 0.25-0.5 PD。credits、费率、API 等价费用、额度与
占比 unknown；120% 保守容量为 AI 3.6h、传统 0.6 PD，但不扩大本阶段硬上限。长期 docs 不更新，因为本片只收紧
既有 canonical fixture helper，不改变生产架构或公共协议。
