# V2 Browser23 Canonical Budget Map 01

状态：`MAP ONLY / NO IMPLEMENTATION / NO Browser24`。本阶段只读取 BUILD14 acceptance source 与已封存的
Browser23 report/receipt/trace 诊断，没有修改 source、test、spec、tasks、execution-state、累计 Browser 报告或历史 evidence，
也没有运行行为测试、build、artifact、browser、Cua、CI、Git、部署或合并。

## 冻结输入

- BUILD14 acceptance source 为 `0eafd4273bc1f5a23e7d147ded37801436074015`，tree 为
  `a1cbf676594be93a86c77afcbb59dacc1611899e`；只从
  `/private/tmp/seedlands-v2-acceptance-0eafd427` 读取源码。主工作区 HEAD 为
  `2db4c5fd8cf81294d164b128d667f73fa7e5f01f`，其已有 dirty 未作为源码。
- Browser23 原冻结身份为 SOURCE22 `d275044b38e568f82eb054f11356fa1ea12faa5a0bf363b46bb80fdd485b1160`、
  MANIFEST127 `f144b09a24ebb6bd0d8e0a11d99407e24f1ccc36f126664cba2679faf55e2316`、delivery
  `bf8b7aecfb5a5ad348e03445e766212570bfdee0685931ed13a7196102b7b04c`。GIT39 包装恢复只把一个 2800-byte
  `error-context` 归档路径从 `.md` 改为 `.md.log`；当前 SOURCE22 不变，MANIFEST127 为
  `e985c56ac652b7af5c1c84bb4853f06d9f321c3754bd6fbb5e94f115c03fd188`，delivery 为
  `35842ab0daeebd431707a12f92bcf34a48ce25b9b28a2b13e78b9997134fc941`。旧身份及文件由 GIT39
  `prior-packaging` 映射验证，frozen raw/report 字节与本 MAP 诊断均未改变。
- 同一 GIT39 的 hook JSON 包装恢复随后把四份机械 JSON raw 改为同名 `.json.log`。当前 Browser23 SOURCE22
  仍不变，MANIFEST127 为 `bada5a3115c8d1b16fe7802e25e1c6bfe87b53f2174dc7008ffecd3def4f29e3`，delivery 为
  `c81a6f68c2453a232172678b17f0cd963945bec3fcad27586b2905ce18ac9428`；上一轮 identity 与原始 raw 字节由
  `prior-hook-json` 映射验证。本 MAP 的预算、终态和 trace 诊断结论不变。
- Browser23 只有一个 Chromium attempt、单 worker、retry 0。主测试 status=`timedOut`、runner exit 1；本 MAP 不改变
  该正式 FAIL。

## 预算事实

`classic-runtime.spec.ts:75` 的 canonical main 总预算为 `720000ms`。`harness.ts` 的普通 route `45s`、snapshot poll
`20s`，equipment route 的共享 `45s` 与最多 `20s` wait，以及 target aim 的 18 moves/19 observations，都是独立的
业务/安全上限，不能因总预算变化而放宽。

Browser23 从 main start 到 C5 完成用了 `718819ms`。C0、C1、C2、C3、V1、V2、C4、C5 八个显式阶段合计
`704373ms`，其余 C0 后准备和阶段间 gap 合计 `14446ms`。V2 为 `426474ms`，占该 C5 完成窗口 59.33%；
C4 为 `149669ms`，占 20.82%；V1 为 `47810ms`，占 6.65%。C5 后玻璃步骤在 `+718822ms` 开始，主预算在
`+720000ms` 触发。清理期间在途调用继续完成 V5、detailed evidence 与最终断言，最终断言 offset 为
`727316ms`；这些 cleanup 中的局部完成不能把 Playwright 结果提升为 PASS。

`canonical-timing.json.log` 只聚合 V2/C4 的**直接子 step**，没有递归累加父子层：

- V2 直接 step 的区间并集覆盖 `377784ms`。其中 128 次 `mouse-input.ts:36` 的 `Wait for timeout` 合计
  `192535ms`，均对应现有 1500ms Pointer Lock 安全 cooldown；poll `36336ms`，Evaluate 的去重区间
  `79795ms`，未被直接 step 覆盖的 wall time 为 `48690ms`。
- C4 直接 step 覆盖 `95820ms`；179 个 `harness.ts:126` poll 合计 `84647ms`，未覆盖 wall time 为
  `53849ms`。其中约 `53344ms` 可由 177 个 300ms jump pulse 的 key-down/key-up 间隔机械解释，但这些间隔仍按
  gap 保存，不伪装成 Playwright step。

这些数值只是一次 Browser23 失败运行的诊断，不是性能样本、A/B、p95 或稳定性证明。

## 演进结论

有限 Git 历史给出明确顺序：

1. `5d05607027ad0781a349bec37bb49c1c485b8b99`（2026-09-25，V1 browser oracles）把同一 main test 从
   `480000ms` 调到 `720000ms`，并在 C3 与 C4 之间加入 V1。
2. `3df61d38b0b0de55c48ab709afd6315aa9f23ff2`（2026-09-26，equipment journey observability）随后把完整
   V2 插入同一 main test，并扩展 C5 的装备恢复断言，但 `720000ms` 没有重新登记。

因此“720 秒早于完整 V2 且新增 V2 后未同步重登记”有源码与 commit 证据；这不表示任意加长都会正确，也不说明
当前 helper 有性能退化。

## 候选比较与推荐

推荐下一阶段做一个有界 Harness 合同收口，而不是 gameplay 修复：

1. **采用：有限总预算 + 独立终态/trace 收尾合同。** 以 Browser23 完成最终断言的 `727316ms` 乘一次 120%
   得 `872779.2ms`，向上登记为 `900000ms` canonical main budget。另以最终断言到 context close 的
   `34967ms` 乘 120% 得 `41960.4ms`，向上登记有限 `60000ms` project/finalization budget，并在 runner 返回后严格
   校验失败 trace；这保留同 runtime、保存、恢复和续交互链。900 秒是有来源的下一次验收预算，不是性能门槛或
   已证明稳定值。
2. **暂不采用：消除 fixture 成本。** V2 的 128 次 Pointer Lock cooldown 合计 `192535ms`，C4 的 poll 与 pulse
   也占主要时间，但它们当前承担真实输入安全和 Authority readiness。任何去除/合并都必须先做同身份 A/A 与单轴 A/B，
   证明输入、strict arrival、保存恢复和 trace 语义不变；本单样本不能把它们判为冗余。
3. **不推荐本轮：拆分旅程。** 拆 V2/C4/C5 会破坏“同一运行时内采集装备 -> 保存 -> 新 epoch 恢复 -> 继续真实操作”
   的证据链，或迫使重复 fixture/setup；除非另立跨测试持久化合同，否则不是本次 timeout 的最窄修复。

停止线：不得修改 45s/20s/pulse/aim/tolerance/route/坐标，不删除或重排 C0-C5、V1、V2、玻璃、V5 及保存恢复
断言；不得用 900 秒声称稳定性。若下一次唯一 canonical 在 900 秒内不能在 main 函数正常返回，或 60 秒收尾仍产生
不完整 trace，则保持 FAIL，封存新时序并回到独立 fixture-cost 或 Playwright finalization 根因调查，不继续加预算。

## 终态与 Trace 合同

`evidence.ts:91-108` 当前把每次 writer 调用都 append 到名为 `attempts` 的数组；`attachClassicFailure` 和
`attachClassicEvidence` 可为相同 `{test, project, retry}` 各写一条。Browser23 因而得到同一 main attempt 的 FAIL 与 local
PASS 两条记录，另有 skipped non-Classic 的 FAIL 记录。aggregate 使用 `every(PASS)`，所以本次仍正确保持 FAIL；但
`classic.mjs:27-32` 的 benchmark 分支要求 `attempts.length===1`，结构语义已不可靠。仅改展示命名不够。

后续最小终态合同应：以 `{test, project, retry}` 唯一 upsert canonical main 记录；分开记录
`runner/testOutcome`、`assertionEvidenceStatus` 与 phase；任一 timeout/failure 终态不可被稍后 local assertion PASS 覆盖；
skipped/其他测试不得污染 canonical main receipt；runner 对 correctness 和 benchmark 都验证唯一终态记录，benchmark
额外保留 measured 条件。RED 必须覆盖 FAIL->local PASS、PASS->FAIL、同 key 重写、skipped non-main、缺失/malformed
receipt，且都只算一个实际 attempt。

原 trace 在 producer 退出后固定为 `1269815136` bytes、SHA-256
`fa61f3c1962a0134a85c9cb72eee911f141804f04cc39f764a3d949ca5fbcc48`；25 片重组 SHA 相同只证明封存字节一致。
`zipinfo -t` exit 9 且缺 EOCD/中央目录，完整条目与缺失范围未知。report 显示 context fixture 从 `+720775ms` 到约
`+762283ms`，同时出现第二个 `30000ms` timeout；Playwright 源码还显示 trace stop 使用 project 默认 timeout 槽。
这些事实支持“总超时后的 in-flight cleanup、context close 和 trace finalization 存在竞争”的诊断，但没有序列化第二个
timeout 的具体 runnable，不能证明它唯一由 trace stop 引起。

未来最窄 trace 合同：原始失败 trace 只在 producer/runner 退出后读取；若 `trace.zip` 存在，必须在有限收尾预算内通过
中央目录/EOCD 与全 entry CRC 校验，失败则记录 `TRACE_INCOMPLETE` 并保持 canonical FAIL，绝不 repair 后冒充原件；
若 PASS 模式因 `retain-on-failure` 没有 trace，明确记录 `NOT_EXPECTED`。收尾超时、receipt 缺失/歧义或 trace 不完整都不
触发自动重跑。

## 可执行 RED 与 Ownership

建议 root 只准出一个 `V2-CANONICAL-BUDGET-AND-FINALIZATION-CLOSE`：

- `classic-runtime.spec.ts`：只把 main 总预算改为命名的有限 `900000ms`；其余单段预算与旅程语义不变。
- `playwright.config.ts`：为默认/project finalization 登记有限 `60000ms`，保留 main/visual/modular 各自更明确的预算。
- `classic-support/evidence.ts` 与一个新定向 unit test：同一 attempt 唯一终态、fail precedence、local assertion 状态分栏、
  skipped non-main 不污染。
- `scripts/harness/classic.mjs` 与定向 runner/fixture test：process exit、唯一 canonical receipt 和失败 trace 完整性相互
  校验；不自动 repair、不 retry。
- 当前 change 的新合同/spec/evidence 仅由 root 指定唯一 owner 更新。production、scenario、route/aim/mouse helper、V1/V2
  行为、历史 Browser23 raw 均只读。

最小 RED：静态预算合同先因 720s/30s 失败；receipt reducer 用 Browser23 形状证明同 attempt FAIL 后 local PASS 仍只有
一个 terminal FAIL，且 non-main skipped 不进入；runner fixture 证明 malformed/missing/重复 receipt 或存在但 CRC/EOCD
无效的失败 trace均非成功。GREEN 后只运行定向 deterministic/static/type/format；真正产品准出仍只能由新 source/artifact
上的唯一 Browser24 完成。

## 仍缺的交付证明

- Browser23 已证明 V2 19 checkpoint、三类资源独立 `itemCount` 入包、装备矩阵、durability `132 -> 128 -> 127`、
  C5 epoch 换代与装备/耐久恢复；但整个 canonical attempt 仍为 FAIL。
- V2 当前合同要求恢复使用新 epoch/current projection；Browser23 没有直接 assert 或记录新 object reference，仍是 V2
  browser gap。
- 16 件 armor 全变体、194 项行为矩阵、真实死亡、equipment drop、respawn 是完整产品验收缺口，不由预算收口代替。
- V3 structure/climb/route/transport 和 V4 lighting/WebGL2 视觉矩阵是后续独立阶段；本任务不扩大其 implementation。
- pageErrors/failedResponses 只在 detailed local record 中为空；不能覆盖 runner timeout。性能仍为 `NOT_MEASURED`，
  Cua/人类音频未运行。

## 预算

本 MAP 阶段传统估时 `0.25 PD`，AI 目标 `<=1h`、硬上限 `1.5h`。建议后续收口传统 `0.25-0.5 PD`，AI
`1-2h`、硬上限 `3h`，120% 容量为传统 `0.6 PD`、AI `2.4h`。credits、费率、API 等价费用、当前额度与占比
均为 `unknown`。长期 docs 不更新：本片只诊断 V2 canonical Harness 的内部预算和终态证据合同，没有改变 owner/API。
