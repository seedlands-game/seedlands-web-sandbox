# Shared Route Aim 有界证据

阶段：`V1-ROUTE-AIM-BOUNDED-CLOSE-11`

状态：FIXTURE_DETERMINISTIC_STATIC_GREEN。

Browser20 保持正式 FAIL：C0-C3 PASS，V1 closed-door probe 输入前 route aim 未收敛，V2/C4/C5 未到达。
Browser19 的首 iron inventory pickup 仍为 NOT PROVEN。本阶段只验证 fixture deterministic/static，不替代 Browser21。

输入 MAP01 SOURCE19 `5848879ef25500c0c786ada0d86d84e91c17c06f3ed8b96912e341ac6061525a`、
MANIFEST4 `7f788fe22817bb678067f9731a986fc3bb56ed144f651756440f5f70ff0e49b4`、delivery
`852f5fac254fd209235eec0813613d241ba1226b45da560aed72cd13be9a2d45` 已由 root 独立准出。

## RED

可信 RED 窗口 `v1-route-aim-bounded-close-11-red-02` 直接运行新 `route-aim-contract.test.ts`，结果为
`1 file / 17 failed / 1 passed`、exit 1。旧 helper 的可观察失败包括：

- Browser20 的 13 个真实 observation 前缀只读取前 12 个、执行 12 moves 后静默 resolve；
- W/S、X/Z、wrap `±180°` 固定 pose 均只执行 12 moves，而合同要求完整域最多 18 moves 并最终 observe；
- 持续 null、invalid、精确零 vector 与 no-response 均静默 resolve；
- default 与 Close10 refresh 的真实 `walkTo` 都在 helper 静默耗尽后发送 keyboard pulse。

首个 RED 也为 `17 failed / 1 passed`，但 fake Page 的 canvas width 会让未来 GREEN 触发无关 Pointer Lock 边界；调整
测试仪表后才取得 red-02 作为可信行为 RED。更早一次 shell 命令因 evidence 目录尚未创建而在启动 benchmark/test 前
拒绝重定向，未取得窗口、未运行测试、未生成日志，不计为 RED attempt。

## 实现

- `correctMouseToRoute` 保留签名；私有上界为 18 moves/19 observations。
- target 与有效 observation 的 player/yaw 均校验 finite；精确零水平 vector 明确 undefined-direction。
- null 消耗 observation 配额、不 move、不复用旧值；短暂 null 可恢复，最终 null 明确 unavailable。
- 每个有效 observation 复用 `horizontalMouseCorrectionToRoute`；只有真实 `abs(dx)<1` return。第 18 次 move
  后必须第 19 次 observation，仍未收敛则包含 target/direction/lastDx 的 exhaustion。
- 没有修改 `walkTo`、V1 caller、mouse/relock、route predicate、Close10 或 production。helper reject 会在两条
  `walkTo` 路径 keyboard down 前自然传播。

## GREEN 与静态

最终格式化字节上的 release 结果：

- `green-release`：`1 file / 18 tests PASS`。
- `affected-release`：route aim、target aim、pickup refresh、route progress、door collision/exit/readiness、scenario、
  equipment mining/resource/arrival/grounded 共 `12 files / 131 tests PASS`，`maxWorkers=1`。
- `classic-types-release`、`root-types-release`、两份变更 TS 的 `eslint-release`、五个 SOURCE 路径的
  `format-release`、`scoped-diff-release` 均 exit 0。
- 所有正式门禁通过独立 default benchmark reservation；Vitest 单 worker，没有嵌套锁或吞掉失败 exit。

中途结果原样保留：实现后首轮 GREEN `18/18`、affected `131/131`；Classic types 首轮发现测试 partial snapshot cast
和 async push 返回类型，修正测试后通过。Prettier 首轮只报告新测试，锁内 write 仅改变该文件；之后对最终字节重取
全部 release 门禁。为确认首轮 format 报错范围曾额外执行一次未加锁的同 argv `prettier --check`，它不是门禁，
仍只报告同一个新测试。

## 边界

18 moves 只证明固定 route vector、正常 `0.13°/unit` 响应的完整 yaw 域；动态漂移仍须在同一界内逐次重算，
耗尽即失败，不声称必达。Browser20 保持 FAIL、V2 NOT REACHED；Browser19 首 iron inventory pickup 保持
NOT PROVEN。本阶段未运行 build、Browser21、Cua、devserver、CI、Git/index/push、deploy 或 merge；fixture/static
GREEN 不等于产品 GREEN。长期 docs 未更新，因为本片只收紧 canonical fixture helper，不改变生产架构或公共协议。

预算：传统 0.25-0.5 PD；AI 预计 1-2h、硬上限 3h。credits、费率、API 等价费用、额度与占比 unknown。
