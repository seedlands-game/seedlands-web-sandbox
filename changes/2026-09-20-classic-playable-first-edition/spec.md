# Classic 初版：设计与可玩交付

状态：Active / 实施中。基线 fba4486；功能分支 feat/classic-beta173-playable。承接 2026-09-16 Beta 1.7.3 v16 的全范围清单。

## 用户结果与新授权

2026-09-20 用户要求自主检查基线、完成设计并推进到 Seedlands 引擎上的完整 Minecraft 初版；此前阻塞不再阻止推进，记录供后续优化。尽可能不运行原版；必要时优先 Web 或静音/headless，避免干扰电脑。

本轮授权取代旧 change 的整份合同 hash 审核、全来源/夹具先审完才施工、Kernel 另行审批及性能/资产评审者待定等施工前置条件。保留权限、单权威、数据兼容、来源诚实和原创资源要求。缺失实现不是优化完成，未执行不是 PASS。不自动合并、改变远端权限或采购。

## 范围

完整目标沿用 Beta 1.7.3 主世界单人 Survival：地形/洞穴/矿物/群系、采集建造、工具、合成冶炼、库存容器、生命食物护甲、昼夜天气、流体火爆炸、生物、农业、钓鱼、驯服、轨道/矿车/船、特殊物品、死亡重生、保存恢复、完整菜单输入和原创音画。红石电路、多维度、联机继续排除。

功能完成度按原 522 父项、618 有限变体、8 开放状态族登记；精确原版等价度另记差异。可用功能的原版细节差异可以留作优化；缺失功能保持 TODO 并继续实施。不能把既有 16 体素/19 物品原型或首日流程称作全范围完成。

## 决策

1. 增量扩展现有 Kernel/stdlib/Classic/Web，复用事务、世界、Chunk Mesh、Worker、物理、工位和 IndexedDB。
2. EaglerPorts 仅作必要时外部参照；本次 live API 列表没有 b1.7.3，其他版本不能充当精确 oracle。嵌入另一个完整运行时不能证明 Seedlands 引擎，不采用该实现路线。
3. 旧数字 palette 保留，新内容追加稳定 ID；原版 ID 仅作 referenceId。生成改动用新 generatorVersion；未知内容/保存身份先拒绝，不静默转换。
4. 本地构建/测试低优先级串行；Vitest 1 worker；Chromium headless、mute-audio、单 context、960×540、Low 画质。功能运行不宣称性能收益，结束关闭进程。
5. 恢复唯一 apps/web/tests/e2e/classic-runtime.spec.ts，生产构建后登记 source/lock/file digest，再运行 preview；Headless 和真实键鼠证据分别记录。CI 增加实际产品作业，不修改远端保护。

## 行为与验收

- 空背包进入世界，通过有限资源完成木材→工作台/木镐→石料/煤铁→冶炼/铁镐→箱子/建造；真实库存扣除、耐久更新，缺料/越距拒绝。
- 挖放的正式 Authority 状态、掉落/库存和 Chunk 画面一致；取消/旧 epoch 不写回。
- 保存后重新打开同源世界，体素、库存、工具、容器、时间及熔炼中间进度恢复，不重复初始物品。
- 食物恢复生命；玩家无自动饥饿消耗，满血/非法操作不扣物品；死亡掉落与合法重生。
- 夜间敌人正常移动攻击，庇护阻挡，玩家可反击；农业/火/流体/运输/特殊物品按 design 的状态机实现并持久化。

## 测试设计与 RED

基线 production build 已 PASS（macOS/Node 24，不是 Linux CI）。源码明确缺失多数内容、农业/火/运输、Beta 食物规则和活跃 E2E。新行为在实际 owner 最低充分边界先 RED；逐阶段记录命令与结果。

先恢复有限资源成长与保存 Headless 用例建立 control；唯一浏览器线路从真实按钮与键鼠进入、移动、挖放、背包/合成、保存重开。Harness 只初始构造和读取，不能中途代操作。计数、启动或截图单独不证明旅程。

后续定向测试覆盖状态机、失败原子性、随机边界、保存、资源守恒和异步新鲜度。精确来源审查不作为施工门槛；未测行保持 NOT_RUN。

## 任务

- [x] 基线、旧合同、源码、EaglerPorts 核对。
- [x] 新授权、全范围设计与预算登记。
- [ ] 生产身份、Headless、静音 E2E 和 CI。
- [ ] design S1–S7 全部纳入功能实现。
- [ ] 全范围游玩和保存证据；差异账没有未实现必需项。
- [ ] 静态检查、commit、推送及 PR。

## Delivery Snapshot

尚未交付；build 不能代表产品验收。旧候选 PENDING/NOT_RUN 不改 PASS。长期 docs 更新本次验证边界；架构和产品路线不变。证据见 evidence.md，覆盖见 coverage.json，预算见 estimates.md。

## 续作：本机输入隔离（2026-09-21）

用户实测此前 Chromium Pointer Lock 抢占本机鼠标，作为观察 RED。当前 macOS 验收使用系统 Chrome 强制 headless，CI使用锁定Playwright配套Chromium headless；禁止headed/PWDEBUG和外部可执行路径覆盖。此前专用Headless Shell缺Pointer Lock，配套151在macOS触发锁限流，均有失败记录，系统Chrome153已通过。输入继续走真实页面Pointer Lock和Playwright键鼠，退出释放锁。单浏览器/静音/单worker运行，不启动原版Minecraft。

验收：选项违规在启动产品旅程前明确失败；正常线路记录 Headless userAgent、Pointer Lock 生效、转向与移动结果，并完成原有 C0–C5 断言。用户鼠标没有被抢占属于用户可观察项，自动化只证明使用配套 Chromium 的无窗口模式及真实页面输入路径。

## S0 CI 恢复合同

每个 PR/main push 保留现行静态与 Kernel/stdlib 选择器，另执行明确的 Classic Headless 五项合同、一次 Production build，再让 Chromium job 下载同一 apps/web/dist（含隐藏 manifest）并校验前后身份。产品任务本阶段全量执行，不引入可降低覆盖的 selector。固定实际 checkout SHA；浏览器安装来自锁定 Playwright，使用 channel=chromium/headless/mute-audio/1 worker。上游失败不得伪装成功，不新增部署或权限。新增 tsconfig.classic-tests.json 检查当前唯一 E2E、配置与五项 Headless 合同。CI 自身未远端执行前记 NOT_RUN。

原09-16设计目录带contract-snapshot.json逐字节摘要（交接时已有27处漂移，不能称为通过快照），作为本轮对照原文保留，不格式化重写它的冻结文件。现有七个格式差异文件按精确路径加入.prettierignore（沿用旧冻结合同的做法），只为该目录保留START-HERE.md名称例外；生产/测试源码检查范围不变。本轮新spec与实现仍遵守格式和命名规则。

## S0 Logic 恢复运行

真实C4显示NPC有效路径与terrain窗口完整、驱逐计数为0，但Logic提交计数停在夹具的确定性推进。BrowserAuthorityDeterministicAdvance在推进中接收最后回执时不安排下一次观察，恢复clock run也未启动观察请求。AuthorityRuntime.resume必须重新请求一次Logic观察，让后续回执驱动链继续；不更改地形驻留、过期意图检查或控制owner。回归覆盖暂停推进耗尽最后请求后resume的新观察及真实NPC移动/完成。
