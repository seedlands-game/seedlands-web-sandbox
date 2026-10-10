# V2 Post-Drift Direction 证据

阶段：`V2-EQUIPMENT-POST-DRIFT-DIRECTION-CLOSE-14`

状态：FIXTURE_DETERMINISTIC_STATIC_GREEN，等待 root 独立准出。Browser22 保持正式 FAIL：C0-C3、完整 V1、
resources placement 与三格 wood 真实采矿/清空/掉落/独立入包 PASS；wood pickaxe 起、stone、iron、装备 pointer、
C4/C5 与保存恢复 NOT REACHED。Browser19 首 iron inventory pickup 仍 NOT PROVEN。

MAP01 输入为 SOURCE11 `40190d99bdf880e3d0678e8c6d2efb6477e1754dce57fbd2f509e3e233983c11`、
MANIFEST21 `c627fc471c55eee7c7cfc3d367610bb0b3f72bd64e0815d487c57c5cd85a4b4c`、delivery
`ba13b9c41eea62b534524c50a1e4b23603262bf7a25c32617487fa163c1b7579`。

## Rejected Close-13

未准出的 Close-13 在替换前已把 controller、测试、spec、合同和 raw 共 20 个原文件逐字节归档到
`evidence/v2-equipment-post-drift-direction-close-14/rejected-close13/`。四个活动文件在归档时通过 `cmp`，raw 目录通过
`diff -qr`；清单 SHA-256 为 `953279a278b5038d8bba9f8dee000bf666791d4be765d6af03268be1d2ecf1e7`。
状态明确为 `UNAPPROVED / REJECTED_REAL_DRIVER_DEADLINE_UNREACHABLE`，不能复用其 GREEN。

随后只撤除了可定位为 Close-13 的 timeout catch、13 个测试实例和 spec 声明。controller 与既有
`equipment-resource-route.test.ts` 一度恢复到 HEAD/BUILD13 行为基线；原 Close-13 raw 目录保持未改。

## RED 与实现

新 RED 直接调用真实 `followEquipmentRoute` 与 `classifyEquipmentRouteWait`，重放 Browser22 两组 outer wait：
`@8674 -> @8880 -> @8883 -> @8885` 和独立 counterfactual
`@8885 -> @9107 -> @9110 -> @9112`。单文件结果为 `4 failed / 3 passed`；四个失败均因旧 x-only 实现给下一
`driver.walk` 继续传 `KeyS`，期望为一次性 `KeyW`，不是 import/collection 失败。三个 PASS 为 driver rejection 原对象
传播和两组真实 `horizontalMouseCorrectionToRoute` A/B。

实现只在 `followEquipmentRoute` 增加局部 `nextDirection`：每轮读取后立即清空；只有 wait result 被现有 classifier 复核为
drift 时，才以该轮实际 direction 的反向值重设。该 direction 同时用于本轮真实 walk、strict arrival 和后续 wait
classifier。arrival 仍直接返回，普通 non-wait 更新下一轮恢复 x-based rule，driver exception 无 catch。

Close12 `equipment-arrival-during-aim.test.ts` 仅把原 drift 后 sentinel 方向从 `KeyS` 更新为 `KeyW`；同 snapshot、
mouse/keyboard 零输入和 outer wait 断言全部保留。

## GREEN 与静态门禁

- 最终新测试 `1 file / 7 tests PASS`。两组 trace replay、one-shot consumption、连续 drift 交替、driver error identity
  与两个真实 aim A/B 全部通过。
- 最终 affected 为 `14 files / 145 tests PASS`，Vitest `maxWorkers=1`。覆盖 Close12 arrival handoff、Close10 pickup
  refresh/default、resource route、arrival drift、grounded route、route aim、target aim、door collision/exit/readiness、
  mining aim、route progress 与 scenario。
- Classic test types 与 root test types PASS。Classic types 首轮暴露 TS7022；只给局部 direction 添加显式
  `RouteDirection` 标注后通过。
- 3 个变更 TS 的 ESLint PASS。前两轮均指出三个 trace 数字字面量会损失精度；改为 `Number('原始十进制')` 后通过，
  不截断数据、不加 suppression。
- 五路径标准 Prettier PASS。初检仅新测试需格式化，执行标准 Prettier 后重新跑新测试、完整 affected 和 ESLint。
- scoped diff PASS：tracked 仅 controller、Close12 测试和 spec；untracked owner 为新测试和合同；index 空；
  Close13 controller/test 已恢复基线、catch 与未批准合同从工作集移除、原 raw 和 rejected archive 均保留；新增
  `prettier-ignore` / `eslint-disable` 为 0。两次 scope 脚本错误（未跟踪文件不出现在 `git diff --name-only`，以及
  `nextDirection` 实际出现 4 行而非 3 行）原样保留，不作为门禁 PASS。

本阶段没有修改 `harness.ts`、`target-aim.ts`、`mouse-input.ts`、`equipment-journey-support.ts`、route progress、
scenario、production、Browser22/MAP01、tasks/state 或长期 docs。45s/20s/80ms、18/19、step80、0.13、
`.06/.08/+-0.45`、坐标和独立 itemCount 断言均未改变。未运行 build、Browser23、Cua、CI、Git/index、push、
deploy 或 merge。fixture/static GREEN 不等于产品 GREEN。

预算登记保持 AI 1-2h、硬上限 3h、传统 0.25-0.5 PD，120% 容量 AI 2.4h/传统 0.6 PD；credits、费率、
API 等价费用、额度与占比 unknown。长期 docs 不更新，因为本片只调整 V2 fixture 内部方向状态机，没有新增 owner、
公共 API 或目录职责。
