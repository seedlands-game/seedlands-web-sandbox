# 持续指针输入候选与 Browser12 checkpoint

时间：2026-10-08，Cloud 隔离检出。基线 `1df46ae08f09691a1b939d5e8be00ae3112a30ab`，base `fba4486e433c145db658f6b1598b70c47f759c8a`。本记录为提交前候选检查，不代表新 SHA 的浏览器或 CI 已通过。17:52 UTC 主对话实际周剩余额度93%；本环境没有产品额度 UI，不能自行核实型号元数据或换算百分比。

## 已确认的失败与反例

- 本地 Browser12完整选择：主旅程 FAIL、visual FAIL、modular SKIP。主旅程在 C3 held combat 失败，正式 owner 最后结果 `sequence:3, comboStep:1, damage:2`，观察到伤害5/5/2；不能由 step结束行宣称通过。后续visual启动卡仍可见，未就绪。旧 Browser11 visual单独 PASS 不覆盖完整旅程。
- `1df46ae` 的 CI [run37812574457](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/37812574457)：deterministic、headless、architecture、build、Static verification PASS；Chromium CANCELLED，preview SKIP。首次旅程15分钟终态失败；重试被job期限取消。只有日志能确定运行到V2，不能替代各阶段receipt或完整PASS。
- 实际安装的 mousedown→browser pointer envelope→worker pump→注册 Combat 停顿反例：Authority独立推进43步，主线程timer和render均不推进。旧行为仅第一击5；有效RED日志 `held-main-blocked-red-07.log`，候选验证第二击7。测试仍使用fake worker派送，不宣称真实worker/browser验收。
- 排队续期先于worker service的租期反例：候选初版1 FAIL / 11 PASS；修复后12/12 PASS。已过期手势不能通过新续期复活，必须新mousedown。

## 候选变化与责任边界

浏览器私有 pointer envelope携带真实方向、手势、序号和同realm单调绝对时间。worker在原串行host operation中最多每200ms尝试一次，不补积压；每次读取canonical玩家、角色引用/模式、实体和loaded-cell遮挡，经原授权attack transaction进入Combat。输入意图租期2秒，过期、pause/resume、引用变化和释放退休手势；不保存到gameplay/save协议，不建立另一套Combat或移动owner。

结果按session/runtime epoch、序号去重；允许64项窗口内乱序回执交付一次，其gameplay仍走原revision gate。RPC和Chunk继续共用原请求序号。玩家输入/结果、周期快照、world RPC准备按现有职责提取，500行门禁保留。

新增原生startup phase marks仅诊断save flush、scene、materials、media、worker和first-visible，不参与就绪/验收。Playwright保留commit元数据，关闭自动完整PR diff元数据：已安装1.62.1原实现会无filter fetch base再完整diff，CI已有相应超时。精确artifact及canonical receipt门禁、原job/test timeout、真实输入和断言全部保留。

## 终态证据

Cloud新输出独立路径 `/workspace/pr41-recovery-20261008-root-01/` 与 `/workspace/pr41-recovery-20261008-fixtures-01/`，历史sealed文件未改。

- 完整Classic headless：33文件172/172 PASS，`worker-pointer-headless-01.log`，76.97s。随后仅修类型adapter及invalid-direction表格正确传入整向量，受影响6文件59/59 PASS，`worker-pointer-focused-02.log`；未无理由重跑全套。
- 实际鼠标释放、blur、unlock、hidden和dispose停止：玩家输入文件18/18 PASS，`held-stop-boundaries-green-12.log`。停止后Authority-only推进43步不新增攻击，已开始swing仍按原结果结算。
- 实际AuthorityRuntime fresh target、当前方向、未知cell fail closed、loaded遮挡：3/3 PASS；正式客户端copy/gesture/duplicate/reordered/epoch门禁和既有请求测试在上述focused结果中通过。
- Web生产types与Classic测试types PASS，`worker-pointer-types-07.log`、`worker-pointer-classic-types-02.log`；scoped ESLint PASS，`worker-pointer-lint-07.log`。前序types/max-lines失败日志保留，不冒充初跑通过。
- 新候选完整build、真实browser三测试、精确SHA CI和preview：待运行。原V2/V3/V4、modular与194项完整产品验收仍未关闭。当前不可宣布可合入。
