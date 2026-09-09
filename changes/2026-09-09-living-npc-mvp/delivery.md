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
