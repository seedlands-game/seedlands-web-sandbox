# 浏览器持久伙伴交付记录

本地实现与独立审阅已完成；PR 的最新 SHA CI 终态以 PR 检查和交付回复为准。此记录区分模型语义、真实世界执行和工程门禁，不以任一层替代其它层。

## 可交付体验

浏览器进入世界后按 T，邀请阿岚。它拥有持久身份、性格、身体、行囊、连续目标和经历。没有模型连接时执行基础生活；连接本机服务后可交谈、决定觅食或同行，底层路径/物理/物品规则继续执行。受击先避险，目标失效有反馈；死亡保留角色终态，完整 checkpoint 保留身份及世界后果。

另一终端运行 `pnpm agent:dev`，把输出的 loopback URL 和临时配对码填入思考设置。已实际验证复用用户授权的 Midscene 环境凭据，密钥只存在于本机进程环境，网页不接收密钥。端点配置随 Midscene key 一起复用。

## 验收证据

| 范围           | 实际证据                                             | 边界                                                                         |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| 确定性角色     | `world-delivery.md`，core/Authority/Browser 绑定测试 | 真实 tick、动作、物品和存档，不代表模型智能                                  |
| 浏览器生活     | `evidence/browser-world-green.json`，早/中/恢复截图  | 同一实体移动、拾取、食用，hunger 实际下降，checkpoint 恢复                   |
| 浏览器双向连接 | `evidence/browser-controller-green.json`             | 真 WebSocket/Bridge/Authority，两轮工具回执；模型为明确的 fixture            |
| 真实日常认知   | `evidence/real-browser-green.json`，连续行走截图     | 实际 DeepSeek Flash 文本调用，真实玩家输入和 NPC 身体运动                    |
| 真实压缩       | `evidence/live-semantic-fixed.json`                  | 实际 Pro 读取完整公共历史，摘要经 Authority ACK 后轮换；人为降低阈值验证机制 |
| 上下文预算     | `docs/living-npc-cognition.md`                       | 128K/256K 是已实现容量选项；没有长窗口质量/时延 A/B                          |
| 独立审阅       | `integrated-review.md`                               | 冻结 114 文件及两轮增量复核；P1/P2 均修复，最终无残余具体发现                |

真实浏览器的两个回应分别表达“找一处安心生活、熟悉周围、收集食物”，以及“愿意同行，但不会服从不吃东西、硬闯危险地带的要求”。第二轮模型选择 follow 后，3.5秒连续 WASD 期间玩家位置从 `[0.5,58.6,0.5]` 到约 `[8.89,58.6,0.5]`，NPC 从 `[1.80,57,0.5]` 到约 `[9.54,57,0.5]`。这些位置来自 Authority/玩家快照，没有通过测试直接写身体位置。

本轮活人感工程观察：目标连续性2/2、事件响应2/2、真实后果2/2、人格一致性1/2，共7/8，无瞬移/虚构物品/全局信息越权的否决项。人格分保留一分：只有两轮真实浏览器交流及少量 Headless 样本，危险拒绝仍是谈话中的假设问题；实际受击避险由确定性测试证明，尚非长期玩家研究。

## 暴露并修复的问题

- 同 revision 的新事件曾被模型完成回写覆盖：保留新增尾部并补完整 tool pair。
- 合法的多个只读工具曾被拒绝：允许有界只读批次，语义写入仍必须单独提交。
- Pro 接收原生 assistant/tool 历史会继续生成工具控制标记：改成带来源和可信度的单份公共记录，剥离私有推理，拒绝工具/控制标记输出。保留 `pro-semantic-red.json` 原始失败，不用 HTTP 成功冒充语义正确。
- Browser Harness 把 world epoch 用于内部事务，导致所有世界命令被拒绝：使用当前 runtime snapshot 的 epoch，仍保留世界恢复新鲜度检查；恢复前后命令成功均有断言。修复同时回到前置 PR。
- 旧 Headless 子进程测试切换 CI 环境触发 pnpm 自动重建依赖：直接调用同一个 Node CLI，并保留真实独立进程和六条命令。
- 旧移动 fixture 只铺玩家狭长地板，测试食物掉到板外：为双身体旅程铺足够的正常世界地面，不改 NPC 行囊/饥饿。
- 真实浏览器测试直接退出 Pointer Lock 会按产品规则暂停：改走正式 T 交流路径。起始页全局 CSS 曾覆盖伙伴输入布局：在组件内限定样式优先级，并验证输入宽度。

## 模型用量与实现边界

截至首轮实测有完整回执的准入、失败及成功样本合计16次 Flash、4次 Pro；最后一次增量复验的用量缺口见下文。供应商回执总计 Flash 输入37,344（缓存24,832）、输出10,935；Pro 输入5,481、输出4,506。按采样日官方峰时价估算约 **$0.0454**，不是供应商账单。明细见 `evidence/provider-usage.json`；不从这批数千 token 请求推断满128K/256K的效果。

Flash 私有 wire history 仅在认知服务内存中。服务重启或重连以世界持久摘要和最多128条近期事件重建；没有承诺恢复尚未压缩的全部早期私有对话。身份、身体、行囊、目标、已提交摘要和终态事件由世界存档持久化。

本期可执行目标包括 idle、forage、follow、move-to、return-home；拾取/食用由执行层完成，避险由反射层完成。尚未交付自由建造、完整制作链和任意玩家能力。模拟LOD、离线追赶、World AI、多模态、多人、Dedicated 与玩法规则插件均不在本期。

## 下一阶段

1. 用真实游玩记录补齐动作丰富度与人格持续性：主动交谈、可理解的目标失败、采集/制作/放置等正常规则工具；先定义逐动作的世界后果和权限验收。
2. 用同一长经历任务做128K/256K受控对照，记录记忆保真、目标连续性、实际缓存、时延和预算；在证据出来前保持128K默认。
3. 将模拟LOD独立成 change，验证精度切换与状态连续性；其后再推进离线追赶。
4. World AI 再独立设计区域/聚居地目标与预算，复用个体事件/Action/存档合同，并保持全局信息与局部感知边界。

长期 docs baseline 已更新：`living-world-alignment.md`、`living-npc-cognition.md` 与代码地图明确当前三层回路、框架/模型、协议归属和后续路线；历史 H1/H2 设计保留并指向现行决策，不重写历史证据。

## 最终本地门禁

源码候选 `5dc9c0f`：`pnpm verify:static` 通过，249个测试文件通过、2文件跳过，1223测试通过、4测试跳过；所有静态/路径/格式/类型检查完成。独立 `pnpm build` 同时构建 Web 与本机认知宿主。

同候选最终共享 Harness/诊断+NPC 浏览器4/4通过（25.1秒）。旧浏览器20/20、资产2/2、近战1/1在冻结 `4fe7d32` 的独立工作目录通过；其后生产增量仅为新角色目标引用上限、非法发言原子性及伙伴CSS，已由受影响测试和最终4项浏览器覆盖。

审阅P1修复见 `target-bound-fix.md`；新增非法发言原子拒绝先得到状态被修改的RED，修复后角色focused11/11通过。最终增量独立复核见 `final-recheck.md` 和 `target-retention-recheck.md`。

最终复核补充：`5ee5b05` 修复满引用表受击时淘汰当前 follow 引用的问题。真实 `attackEntity` 回归先得到 `CHARACTER_TARGET_UNAVAILABLE` RED，共享可见/执行目标保留集合后12项角色测试通过；未重新观察，直接复用原引用重试。该轮独立复核无残余具体 P0/P1/P2；随后 GitHub 独立审阅补充的6项另见下文。受影响的两项 NPC 浏览器旅程再次2/2通过（11.9秒）。

前置 Harness PR #25 的 `b1b41cd` 已在 CI run `34330619783` 全绿（静态、构建、Chromium）。本 NPC PR 以 `codex/developer-world-harness` 为 base，待人类合并 #25 后再调整到 main；未自动合并。

最终类型检查发现可选参数被 closure 捕获时 TypeScript 不保留 `??=` 缩窄。`c48be63` 改为局部 `const retainedTargets`，不改变保留算法；全量250个测试文件/1224测试通过（4跳过），独立完整 typecheck 和 Web/Agent build 通过。该词法修正之后的完整静态命令再次记录至本地 release 日志，远端对最终提交重做相同门禁。

## GitHub 复核后的增量修复

`6a24891` 已通过远端完整 CI run `34332643341`，但 GitHub 独立审阅随后给出5项 P1与1项P2。Terra逐项核对均有效，见 `github-review-triage.md`。因此该提交仅作为通过工程门禁的中间候选，不作为最终准出。

Root 先复现 Browser Bridge 丢弃 observedCursor：桥与客户端两项 RED 均失败；把 cursor 经 MessagePort 保留到通用 bound intent 后，5项客户端用例通过。世界层继续验证同 revision 新对话产生的冲突；认知层补暂停/流式输入/预中止/工具种类边界；存档层补 action ownership 联结校验。最终证据在修复冻结后追加。

#25 已由外部合并到 main `01bab28`；其 tree `6d49e5cd2cec333ee69b4dd063cd3b9265f8a0f8` 与已集成的 `b1b41cd` 完全一致，`6a24891` 只补合并祖先关系，生产 tree 与 `9763281` 完全一致。#26 现直接面向 main。

修复冻结：世界侧17项focused通过，Root额外将 foreign action 改为与NPC目标同类型、同位置以单独约束 ownership，并验证双方 action 均不变；该2项复验通过。宿主侧先取得6个RED，修复后5文件28测试通过；包括新事件触发新决定、stale receipt 的 cursor 仍旧时等待更新观察，避免立即重试旧快照。详见 `github-world-fix.md`、`github-host-fix.md`。Root 的 Bridge 5项通过；完整静态、构建、Browser与独立复核在本冻结候选上重新执行。

## 最终增量验收

生产候选 `38771cc`：完整 `pnpm verify:static` 通过（252文件、1233测试通过，4测试跳过），独立 Web 与 Agent build 通过。修复后的 Browser 两项2/2通过（17.8秒）；真实 Flash 浏览器旅程1/1通过（27.2秒），两轮实际回应、连续玩家输入和 NPC 跟随、T回到交流与断连均通过，截图见 `evidence/final-real-companion-*.png`。人格回应明确“珍惜朋友、愿意同行，但会先保护自己”，与预设一致。

`github-recheck.md` 对28个差异文件独立复核，确认 GitHub 5项P1与1项P2全部解决，未发现新 P0/P1/P2。该源码此后仅增加测试 JSON 输出文件的持久化与交付记录，没有修改生产行为。

最后一轮使用 line reporter，内存 JSON attachment 未落盘，因此该轮精确调用数、token/缓存 usage 和坐标样本不可恢复；保留了真实断言日志和四张截图，不能将此前16 Flash/4 Pro的完整账本冒充最终总用量。该轮由测试限制为2–6 Flash，所以最终累计18–22 Flash、4 Pro，仍在22/4上限内。没有为补日志继续调用模型。未来同一测试会显式写 JSON 文件再附加 path；本轮用量缺口已写入 `provider-usage.json`，实际总价保持unknown。

## 第二轮恢复路径修复

`7c36c43` 的远端 CI run `34336382567` 全绿；GitHub review `5152630270` 又检出两条恢复路径 P1，独立分诊确认有效。因此继续修复，未把该提交当作最终交付。退避期新事件保留到期重试；终态目标受击后的恢复进入基础生活，避免永久 suspended。RED/GREEN 和冻结复核分别见 `github-backoff-fix.md`、`github-round2-triage.md` 及后续恢复报告。此轮不再消费真实 provider。

审阅监控修正：GitHub review 元数据可能先于 inline comments 可见；监控改为等待发布稳定后按确切 review ID 读取，不能以当前 commit_id 过滤重映射的旧评论，也不能在评论尚未发布时宣称零问题。

生产修复冻结 `26ea895`，`github-round2-recheck.md` 独立覆盖6个差异文件，确认两条P1解决且无新的具体P0/P1/P2。浏览器两项2/2通过（12.3秒）。首次全量coverage中新增Headless checkpoint测试耗时7.5秒，超过默认5秒而超时；没有断言失败。测试按既有同类30秒截止，并用onTestFinished保证两session清理；生产不变，完整门禁重新执行。

最终本地增量门禁：完整 `pnpm verify:static` 通过（254文件、1238测试通过，4测试跳过），独立 `pnpm build` Web/Agent通过。两项Browser旅程2/2通过（12.3秒）。生产仍为 `26ea895`，后续仅测试截止/清理和交付记录。两轮共8项GitHub发现均已修复并独立复核；远端最终SHA的CI与自动审阅以PR #26检查和最终交接为准。此轮不需要更新长期docs baseline：仅补齐现有事件调度、反射和持久化合同的恢复行为，未扩大产品范围。

## 第三轮边界修复

`0ce2bfc` 的远端CI run `34339142987` 全绿，但自动审阅 `5152979283` 新增4项P1，独立分诊均有效（`round3-triage.md`）。伙伴T与旧时间加速键冲突由真实浏览器复现：显式推进1秒，世界时间增长0.8小时而非正常0.04小时；因此将调试倍率移至Alt+T。重连历史采用首观察基线重建，不再自动重放旧决定；持久目标继续基础执行，后续新事件唤醒。核心补无actionId/危险暂停的follow目标联结，以及Actor注册失败的实体回滚。新验收仍不使用真实provider。

本轮长期docs baseline更新：`living-npc-cognition.md`明确重连历史边界，`developer-world-harness.md`明确互不冲突的玩家交流/调试快捷键；不扩大玩法范围。

第三轮冻结 `db00561`：完整static通过（256文件、1244测试通过，4跳过），独立Web/Agent build通过；两项Browser旅程2/2通过（13.3秒），包括权威时间倍率与重连后的新对话只决定一次。`round3-recheck.md` 对全部受影响源码/测试/E2E独立复核，确认4项P1及首观察初始化衔接解决，未发现新P0/P1/P2。此次之后仅补交付证据；实际模型/人格实测沿用前述样本，未增加provider调用。远端最终准出以PR #26最新SHA为准。

## 历史分页修复

自动审阅 `5153227643` 找出重连基线只覆盖首32条历史的P1。Root 用真实浏览器和70条历史复现：后续页cursor64/70在没有新对话时触发2次决定（期望0）。修复必须冻结首观察中角色完整eventCursor，所有后续历史页保留上下文但不唤醒；分页中途新发生的事件不得被移动的历史上界吞掉。此轮仍不调用真实provider。

`22f27f8` 的远端CI run `34341811816` 全绿。分页修复冻结 `7ff6325`：完整static通过（257文件、1245测试通过，4跳过），独立Web/Agent build通过；70条实际历史的Browser连接/新对话/断连重连旅程1/1通过（9.3秒），宿主80条混合历史/新事件与暂停/fallback覆盖44测试通过。`round4-recheck.md` 对全部三个源码/测试/E2E路径复核，确认历史分页P1解决，未发现新P0/P1/P2。后续仅追加交付记录；本期真实provider累计调用边界与usage缺口不变。

## 持续动作历史修复

`8f80eca` 的远端 CI run `34343453240` 全绿。自动审阅 `5153487626` 指出持续 follow 每秒新建 Action，而所有旧终态及路径永久写入 checkpoint。修复为有界动作结果历史，同时保留活动动作和角色待结算引用；旧大存档必须先校验联结再收敛历史。验证针对数量与序列化体积的确定上限，不据此宣称计时或帧率收益。此轮不再调用真实 provider。

长期 docs baseline 同步动作历史查询与淘汰语义，开发者需及时导出 trace/checkpoint 留存长期分析记录；角色已提交记忆与生活目标不依赖无限动作历史。

最终生产冻结 `3d1f5cd`：完整 `pnpm verify:static` 通过（259文件、1253测试通过，4测试跳过），独立Web/Agent构建通过；两项Browser旅程2/2通过（17.3秒），真实provider用例明确跳过。动作保留与存档新增/关联14测试通过，旧大存档、跨Actor序号、同tick完成顺序和800模拟秒重规划均覆盖。`round5-final-recheck.md`确认动作历史P1及额外序号P1/排序P2全部解决，未发现新具体问题。后续仅交付文档；远端最终SHA CI与自动审阅以PR #26和交接回复为准。

第六轮自动审阅 `5153861695` 发现序号耗尽检查仅在ActionRuntime内，Autonomy和Character可能在调用前先写状态。已通过完整simulation snapshot取得RED，修复将容量/输入预检前移到中断与目标修改之前；内部重规划耗尽改为具名目标失败，不中断世界推进。新增及关联12测试GREEN，完整门禁再次针对冻结生产执行。无新provider调用，仍属既有原子性合同修复，长期baseline不变。

`1044a50` 的远端 CI run `34347121272` 全绿。第六轮进一步统一所有非idle意图的容量预检，覆盖同目标但没有活动动作的follow；13项focused通过。Browser在 `8590f98` 两项2/2通过（18.1秒）；此后生产变化仅为同目标也进入容量预检，由新增确定性回归直接覆盖，最终远端仍对最新SHA执行浏览器门禁。

第六轮最终生产 `38c97f5`：完整static通过（259文件、1255测试通过，4跳过），独立Web/Agent build通过。`round6-final-recheck.md`确认同目标无Action边界已解决，无新具体P0/P1/P2。后续仅证据与交付记录；实际人格/模型用量沿用此前实测，无新增provider调用。

第七轮自动审阅 `5154055758` 补充观察游标关系与目标引用耗尽快照两项输入校验P1。目标引用修复先取得GameServer.restore接受耗尽快照的RED，加入序号增量空间校验后原子拒绝，冻结世界不变且随后真实攻击成功、角色进入避险；5项关联测试GREEN。Wire边界另行校验角色完整head、page cursor与事件关系；不能把认证浏览器提交的内部一致伪造状态当作可由类型校验鉴别的权威事实。两者无新增模型调用，保持原产品范围。

`9803ce9` 的远端CI run `34348976775` 全绿。Wire受影响17测试与宿主55测试通过；Root另补非零head却无尾事件的快照原子拒绝，避免恢复后与严格空页Wire不一致。整合core与host共14文件/60测试GREEN。两项自动审阅发现已修复，完整静态、构建、Browser与冻结独立复核随后执行；认证浏览器的自洽伪造状态仍非类型校验可以鉴别。

第七轮独立复核补充了分页连续性缺口。Root以32条 `[1..31,104]`（不是报告中的连续示例）和零号事件取得2项RED，修复以页尾减长度推导连续区间。初次完整static有一项Headless死亡绑定测试超过5秒；同次构建和Browser并发运行，不能断言超时根因。该文件单独重验4/4通过，未放宽超时或改测试；最终static将独立运行以确认。初次Web/Agent构建与Browser2/2通过（1真实模型用例跳过），无新增provider调用。

第七轮最终生产冻结 `51ab780`：完整static独立执行通过（259文件、1269测试通过、4跳过），独立Web/Agent构建通过，Browser两项2/2通过（真实provider用例跳过）。`round7-final-recheck.md`确认连续分页修复有效，无新具体P0/P1/P2。长期docs baseline不变，本轮只是既定Authority输入和存档合同的边界补全。后续仅交付记录；最新远端SHA的CI和自动复核结果以PR #26及最终交接为准。

主线同步：`3abf70b` 的CI未触发，GitHub读回CONFLICTING；主线已合入 #27 (`baeba09`)。恢复分支 `codex/living-npc-pre-main-sync-3abf70b` 保留同步前状态，合并 `4e39e48` 的唯一人工冲突处理是tsconfig.test.json并集。集成后完整static通过（260文件、1276测试通过、4跳过），Web/Agent build通过，NPC Browser2/2和共享Harness/诊断2/2通过；真实provider用例明确跳过。`main-sync-recheck.md`独立复核确认双方CI/测试/生产边界保留，无集成P0/P1/P2。长期baseline沿用双方现行docs，不重写主线历史。此前未触发CI不记为通过，最终SHA重新等待远端门禁。

第八轮自动复核实际绑定`3abf70b`（review5154415291），发现eventCursor耗尽的快照在下一条事件后越界。最终SHA `9964bed` CI run34353266285全绿，但其自动复核30分钟未触发，不能将旧SHA审核当作最新通过。Root补同类可递增字段审计：角色revision、policyRevision、memory.revision、集合sequence均保留增量空间；集合sequence非负；事件尾从正数连续到head。7项坏快照分别RED后GREEN，完整Authority快照原子不变，随后正常对话/观察/再次保存恢复；与host整合69测试GREEN。无新provider调用，长期路线不变。

第八轮最终生产冻结`2405493`：完整static通过（260文件、1283测试通过、4跳过），Web/Agent构建通过，NPC两项Browser通过，真实模型用例跳过。独立`round8-recheck.md`最终无新具体P0/P1/P2；复核中曾将 -1<0 错读为false的zeroEvent意见已由复核者撤回并记录，未因此更改正确代码。共享Harness在主线集成`4e39e48`两项通过，此后只修改存档非法输入拒绝。后续交付记录不改变生产行为，最新SHA远端门禁与自动审核单独核对。

CI run34357206570的Static/build通过，但历史近战首轮5s就绪断言失败、重试成功，被failOnFlakyTests正确标红。`ci-melee-triage.md`保留首轮trace缺失与retry实际就绪耗时边界。Root在同一用例注入6秒Authority Worker脚本延迟，旧等待RED；修复等待warning或完整guide的15秒启动阶段后同注入GREEN（15.6秒），移除注入正常旅程GREEN（9.3秒）。注入仅存在证据patch，生产无延迟；原战斗/受击/实体断言、90秒总预算、CI重试和flaky规则不变。这不是加载性能优化或基准结果。

第九轮暂停边界实现见`round9-pause-fix.md`：Game→Companion→Bridge在同一次暂停切换同步通知，迟到intent回WORLD_PAUSED且不触达Authority；memory仍走正常提交/回执。2项RED后3文件9测试GREEN，含首次暂停连接、恢复和压缩对账。Root另扩展真实Browser模型请求挂起→玩家暂停→AbortSignal→迟到完成→目标/发言不变→恢复的旅程，待整合执行。

第九轮世界修复见`round9-world-fix.md`：Logic读取由Character owner派生的持续目标，避险/已跟踪移动优先，非forage等待状态hold；forage保留已有探索。存档派生字段不作授权状态，restore重新构建。focused5文件27测试GREEN；flat fixture只证明到达保持及新规划/输入接纳，其身体续跟缺口由真实Browser补齐，不能把wish当运动。Root实际Browser两项18.7秒通过：到达无Action后跨90 Physics ticks保持（水平位移<0.02），真实WASD玩家移动>4格后NPC身体移动>1格且靠近玩家；在途模型暂停/迟到完成/恢复也通过。最终再次运行会显式保存JSON文件，避免line reporter丢失内存附件。长期docs baseline已补持续目标执行权和即时暂停/记忆对账边界，产品路线与模型预算不变。

第九轮最终生产冻结`a63398d`：完整static通过（262文件、1289测试通过、4跳过），独立Web/Agent构建通过。NPC2/2（18.7秒）、共享Harness/诊断2/2（8.8秒）、近战1/1（10.3秒）通过。后续套件覆盖了test-results，因此单独再次运行NPC2/2并立即保存JSON，未调用真实模型。实际身体记录从tick391到504保持同一位置；玩家随后前进8.42格，NPC身体从[1.95,57,0.5]到[0.535,57,-1.975]。暂停回执记录abort=true，迟到完成前后revision=3、目标和发言一致。证据见evidence/round9-*；这证明当前纵向切片的持续行为，不等价于长期人格质量或所有玩家能力。

`round9-recheck.md`独立静态复核31个冻结差异文件，无新具体P0/P1/P2。其指出的冻结树缺少新身体附件问题，已由本交付提交补入刚完成的实际Browser JSON与所有最终门禁日志。生产内容仍为a63398d，不因补证据重跑模型。最新远端CI与自动审核以PR最终SHA为准，未自动合并。

第十轮：b99b4b8的完整远端CI run34362232929全绿。自动review5155644015含两项意见：同名POI为实体作可见性证明有效，按命名空间修复；另一项将身体投影变化等同事务冲突，独立round10-observation-triage.md判定P1未成立。follow提交与执行校验实时实体，move-to固定坐标从当前身体寻路，发言没有指定收件人；不能每500ms变化就饿死慢模型。Root增加两秒连续身体/饥饿/可见集变化后固定坐标决定仍完成的合同回归，与旧cursor冲突用例共8测试通过。首次测试断言误将intent.goal放在消息顶层，修正后通过，这不是生产RED。长期docs补明确异步快照与动作前置条件，生产宿主协议未改。

第十轮生产冻结90650cd：完整static通过（264文件、1293测试通过、4跳过），独立Web/Agent构建通过，NPC两项真实Browser旅程通过，真实provider用例跳过。本轮身体保持/真实WASD续跟与暂停迟到完成JSON立即保存，见evidence/round10-*。三项namespace回归先RED后GREEN，普通follow使用提交时目标当前位置；宿主固定坐标连续性为现有合同回归，未改变模型协议。

round10-recheck.md独立覆盖16个冻结差异文件，无新具体P0/P1/P2。后续只增加本交付证据，最新SHA远端CI另行核对；自动审阅的一项有效意见已修复，另一项不成立的理由和合同回归公开在PR文档内。
