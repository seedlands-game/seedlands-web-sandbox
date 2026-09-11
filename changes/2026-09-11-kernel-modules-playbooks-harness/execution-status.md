# 实施状态

2026-09-11，用户明确回复“批准”，授权实施 spec SHA-256 `c1d8ef071a3a48db32ee4750b7771df0dc934baada55567fb880da9e56f8041e`。批准稿保持原字节；其中 Proposed/等待审批标题是冻结时状态，本文件记录实时实施状态。用户随后明确要求 ESLint 独立包/独立测试、根目录不放测试、集成及全流程回归归 Web，见 scope-amendment.md。

当前：**Implementing；尚未达到验收、提交和 PR 准出。**

- S0：保存 c18a890 的基础世界/物品/行为 checkpoint、工位在途 checkpoint、真实 PG 认知配对 checkpoint；原始压缩字节和摘要保持不变。CI 基线为 Chromium 有失败，不宣称旧基线全绿。
- S1/S2：game-core 源已拆迁至 Kernel/stdlib/Classic；中性注册分面、GameServer 组合式 host、细分内容 capability 和 executable provider 已接入。独立风险复核发现恢复时 shared EntityStore 分叉、事务提交段可部分失败、旧存档布尔放行三个硬缺口，正在完成候选发布与精确身份修复，不能以移动目录或局部绿测替代架构合同。
- 测试归属：根 tests 已移除。各 workspace 拥有独立 Vitest 配置；ESLint 插件不属于根 Vitest projects，由独立包命令执行。跨宿主/装配/数据面与 Classic 内容集成测试归 apps/web/tests/integration。原隐式内容用例改为显式 Classic fixture，断言不因迁移删除。
- S3：base/head 影响选择器、严格产物身份、执行账本、独立 baseline 候选/接受入口已实现。缺 base/未知依赖保守 full-new，空匹配、丢失旧合同、产物字节或源码变化不能 PASS。CI 已接入可信 base selector、缺基线 full-new、同一生产 artifact；当前仓库治理与 raw runtime baseline 合同定向测试已通过。
- S4：唯一 Classic spec 与同线路采样正在补齐实际 UI/工位/持久化阶段；当前 pnpm build 已通过并用于线路诊断，尚未取得完整浏览器 PASS。

已取得的局部证据：ESLint 独立 66 用例、类型/构建通过；Kernel/生产 revision owner 的定向测试通过；旧 V1/V2 composition checkpoint 7/7 通过；影响选择器 15 用例、产物/baseline 3 用例、Skill 可移植链接 3 用例通过；Classic 内容合同 2 用例通过。Rust 输出迁至有效目录后重建并通过源/二进制指纹校验。

早期完整扫描因迁移中的输入/API 而中止（exit 130）。随后第一次完成的 full-new 扫描为 422 files：401 PASS、21 FAIL；2165 tests：2124 PASS、41 FAIL，不能作为全量准出。失败包括旧隐式内容、provider 注入、真实原子性错误和无界并发下超时。已保留原失败回执，并逐组修复验证；runner 本地并发限定为 4、CI 为 1，没有放宽测试时限。最终源码冻结后仍须完整重跑。

所有权：源码/包迁移由 kernel_stdlib_migration 负责；classic_execution 只写 canonical/support/scenarios；eslint_package 完成插件后转入 CI、Evidence Skill 与架构门禁；根配置、测试迁移、selector/runner、其他长期文档与最终集成由主 owner 负责。执行者不推送、不改凭据或批准 spec。

验收完成后按仓库长期授权进行语义化提交、push 和一个最终 PR，读回远端 SHA/PR 后停止，不自动合并或常驻跟进 CI。

## 本阶段读回（18:48 本机时间附近，仍非最终准出）

- Agent 服务 187/187，Web app 单元192/192、client343/343、Worker35/35已分别通过。目录迁移遗漏的8处vi.mock路径已修复，断言保留。
- 冻结认知存档实际PG/WS导入与重复导入拒绝1/1通过；base/station与原子替换4/4、clock14/14为阶段证据，后续源码变化后须重跑。
- 独立插件66、影响计划15、工程/架构大组77/79后修复2个旧CI入口断言，定向CI+artifact13通过；runtime baseline/window/active-history8通过。
- stdlib旧默认Classic夹具已显式化；尚有真实运行时语义失败由源码owner修复，未改期望隐藏回归。
- 新增web-runtime-test-map记录4个真实Headless/GameServer组合测试从Web unit归入Web integration；active checkpoints复制保持原始gzip字节，认知fixture SHA为c9d937c5b961f1aaea6e306f98f60a4cca6cc6a9cf6442135732b8df3f8e7d04。

## 20:17 附近检查点（仍非最终准出）

- 独立 ESLint package 11 files / 66 tests PASS；两组规则补回遗漏边界后定向 20/20 PASS。Web Worker bootstrap 原握手、去重和 ArrayBuffer transfer 测试已恢复，11/11 PASS。
- 422 个冻结 base 确定性测试文件完成路径与直接断言索引；治理合并和新 provider 身份造成的变化另行说明，AST 数量不能替代语义等价证明。
- 工程/架构定向 20 files / 86 tests PASS，包括同 source 篡改影响计划不能跳过必要测试的负例。覆盖率语义集合仍包含原 world 目录的全部 15 个源文件。
- Classic 生产 dist 诊断 C0–C4 PASS，真实连招、NPC 活动和同 Chunk 新 trace 已观察；C5 新 epoch 后 Web 镜像体素读回 0 而期望 4，仍在区分恢复缺陷与目标 Chunk 未就绪，保留 RED。该 dist 不是最终源码产物。
- 当前没有完整新有效基线 PASS、最终 Classic PASS 或可接受的 runtime baseline；没有提交、push 或 PR。

## 20:58 附近检查点（仍非最终准出）

- 一次运行时完整扫描 402 files / 2089 tests PASS，无 pending/todo；world 行覆盖率 96.98%（837/863）。该扫描早于最后的权威会话时钟合并，不能作为最终源码证据。
- 当前完整选择计划 READY / full-new，437 个活跃确定性测试文件全部入选，无漏选。独立插件再次 11 files / 66 tests PASS。
- Kernel 对象别名和候选释放取得 5 个真实 RED 后修复：删除钩子先修改对象再抛错、跨 storage 候选失败、checkpoint/event 外部修改、清理失败时仍逆序释放其他资源，以及成功 fork 的最终释放。Kernel 当前 18/18 PASS。
- 外部性能窗口 receipt、测量摘要、采样时间和 candidate/accept 的绑定已接线；伪造、复用或缺失窗口会拒绝。真实 local/runtime 采样尚未执行。
- Classic runner 不再只信顶层 PASS，校验本次 run、产物、C0–C5、Worker/Wasm/backend、可见提交 trace 与 benchmark mode。HTML 改动会失效旧构建；源变动和产物变动分别校验。
- CI static job 补完整 Git 历史，保证能重新计算可信 base/head 的必需测试集合；定向 RED/GREEN 已取得。Skill 相对依赖链接与 stdin helper 导入已补齐。
- 独立风险复核仍指出 AuthoritySession 的本地 clock/commitSequence 与 Kernel owner 并存。正在保持既有多频算法和顺序的前提下，把会话调度状态注册到同一 Kernel runtime，删除第二权威提交序号；完成后须重跑频率、事务准入、保存与外部 mutation 反例。
- 最终构建、完整 Classic C5、有效性能候选、最终 Git 审阅和 PR 尚未完成。

## 21:45 附近检查点（仍非最终准出）

- 上次完整 static：427 files 中 424 PASS / 3 FAIL，2205 tests 中 2202 PASS / 3 FAIL。两项为工程子进程与运行时并发的 5 秒超时；已把 Web engineering/architecture 作为独立顺序进程执行，不放宽时限。另一项为拒绝恢复期间合法 pause/resume 的提交序号断言，已验证恢复自身不提交、两次控制动作各提交一次。
- 保存新增真实队列结算 RED：冻结 envelope sequence 2、实际 Kernel 3。现在先生成 Gameplay 快照结算队列，再读取同一 owner frontier；普通与 portable 回归加原保存测试 9/9 PASS。
- Kernel 事件待消费队列新增容量、显式确认与恢复合同；20,000 次真实消费循环和超限原子拒绝通过。中性 Kernel 当前 4 files / 26 tests PASS。身份输入复制冻结、组件 null、对象别名与资源释放均有定向测试。
- Authority 多实体推进在最大提交序号附近的原子性，以及通用 KernelRuntime 模块 codec 边界的对象别名，仍由源码 owner 收口；完成后重新冻结、全量验证与构建。

## 22:50 附近检查点（仍非最终准出）

- 完整 `pnpm verify:static` 已 PASS：run `2026-09-11t14-21-12-743z-9d66a050`，409 runtime files / 2117 tests、11 ESLint files / 66 tests、22 Web engineering files / 107 tests，共 442 files / 2290 tests 全通过，无 pending。world 行覆盖率 96.98%（837/863），原 80% 门禁保留。该证据早于后续暂停和 provider budget 修复，不冒充最终源码结果。
- 角色创建幂等测试在 V8 coverage 下的独立 RED 为 5.14 秒；将世界创建与释放移入各自显式 5 秒 fixture hook，测试自身保持 5 秒和全部断言后，单项通过并被上述完整扫描覆盖。单文件诊断覆盖率不足 80% 的失败也保留。
- 生产 Classic 首次在初态保存失败：pause 采样推进 active time 却未同步 debt。pause/resume 同步 `active - integrated` 后，2 个真实 RED→GREEN 和原会话/时钟共 13 tests PASS，完整测试类型、lint 与 build PASS。
- 后续 Classic run `2026-09-11t14-44-57-341z-6b7463ae`：C0–C4 PASS；C5 Authority 与 portable checkpoint 的体素为 4，恢复后的 Authority 仍为 4，Web mirror 初始 0 后同步到 4，新 epoch 和库存一致。失败为恢复后的 NPC lifecycle 是 deceased，正在核对保存前状态；尚无完整 C5 PASS。
- Authority 原恢复/拾取/schedule/Block/Combat/Character 容量源已有上界和正反例；独立审阅继续指出第三方 provider 多次 operation 和逃逸 callback context 的预算缺口。预算及同步 callback lease 补丁正在收口，尚未验收。

## 23:10 附近检查点（仍非最终准出）

- Classic run `2026-09-11t15-01-42-528z-5a574ade`，sourceDigest `20232ca6293037370c815c4a086396bfa51cab16fbc0c648611eea4a3fbb2062`，artifactDigest `4847b0592002a337ea86059a242a6a3fbf68a6dacd846fe62eada3ef7afbf7e3`：C0–C3 PASS，C4 NPC 活动失败，C5 未执行。新增保存前观察证明 NPC 从 health20 经四次 attacked 到 health0/killed；初次怀疑 hostile 距离过近，后续源码核对已排除：该对象是没有 autonomous/archetype 的固定战斗靶。NPC 距拆除工作台仅2.5格，证据指向玩家持续左键误伤；NPC/home/food 已移至 x96.5，与工作台隔21.5格，仍处48格活动半径内。
- `Behavior actor domain binding is unavailable` 发生于死亡清理时，与 killed 同时；base 中已有同一 cancel/context 路径，不能据此声称逃跑启动失败导致死亡。保持原活动、存活和恢复断言。
- 独立审阅对象 `5824a63610a7ef9d8a66cde8dadc34d50b564f16` 已确认 provider 每 callback128预算、finally lease失效和 Character 全局生命周期预算闭合。唯一剩余P1是同一 advance 由 queued BLOCK_BEGIN 新建并完成的 break 未进入 settlement 上界，源码 owner 正在补齐同一 flush 限额及真实 GameServer 上界反例。

## 23:33 检查点

最终 `pnpm verify:static`：run `2026-09-11t15-18-56-226z-dee595cc`，411 runtime files /2122 tests、11 ESLint files /66 tests、22 Web engineering files /107 tests，共444 files /2295 tests全部PASS，pending0。格式、lint、路径、生产/测试/tools类型与SSG均通过，world行覆盖率96.98%。详见evidence/static-checks.json。

队列Block旧公式真实故障注入RED：实际提交196次而上界144。源码按字节恢复，新公式容量来源5/5 GREEN；主owner已直接复核共享64限额与同轮settlement预算，最后P1闭合。测试夹具准备失败未计为真实RED。

接下来先创建本地实施提交固定source SHA，再构建与执行唯一Classic/runtime测量线路；完整浏览器验收、基线候选与PR仍未完成，不标Delivered。
