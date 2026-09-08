# 浏览器 Living World 路线与 Node 归档退出

- 状态：本地验收完成，待 PR 人类审核；2026-09-09。
- 授权：本轮用户明确要求冻结 Node Dedicated Server、从活跃主线删除产品适配与维护门禁并尽快发 PR；本次只执行该明确退役范围。Agent MVP 仅设计，不实施新增权限、协议或存档格式。
- 基线：origin/main `ec77fdd667458ec93ea426dbf81a142ac6028f91`，Node MVP 已合并；归档 tag `archive/node-dedicated-mvp-2026-09-09` 固定此提交。用户试玩结论来源于本轮声明及引用任务，不把历史验收冒充本轮复验。

## 目标与范围

Node 产品从 workspace、根 typecheck/build/test、Lint/依赖扫描、CI 和浏览器产品验收退出。移除 Node 产品适配、专项测试、Web↔Node 可玩 E2E 与专属启动/构建路径。保留 game-core/Web 分离、Authority Worker、单写者、平台实例端口、通用协议/事务/checkpoint/存档合同及禁止跨包反向依赖规则。Headless 本地开发能力继续可用，解除其对归档产品目录的依赖。

历史 change 的文字合同、证据及 Git 历史保留，不再维护其 Node 专属可执行样例；删除清单记录于交付。现行产品路线改为 Headless Developer Harness → Browser Single-player Agent MVP → Simulation LOD → World AI。沉淀产品方向并链接后续设计。

## 非目标

本 change 不实现 Agent MVP、REPL 能力扩展、新动作、新 Agent 授权/协议/存档格式；不实现 LOD、离线追赶、World AI、多人、SaaS 计费或生成平台；不改写通用世界规则与已完成实验数据。Node 归档后不承诺随 core/Gameplay/ECS/存档/协议变更继续编译运行。

## 可验证行为与实施前测试设计

1. Given 活跃 workspace，When 根静态/构建检查，Then 无 Node 产品目录或专项任务依赖，Web/core 检查仍通过。RED：当前 Node 包存在，typecheck 与 CI 依赖 Node，Headless 导入 Node 产品端口；用目录/脚本扫描固定证据。
2. Given 归档 tag，When 解析 Git 对象，Then 恢复完整退役前 tree 与历史证据；恢复只在独立 worktree，不能直接覆盖当前产品线。
3. Given Headless 单进程，When 多条世界查询/时间命令，Then 启动可用、状态保持且不加载 Node 产品目录。仅保留当前能力，不称新 REPL 已交付。
4. Given 浏览器默认单人会话，When 启动并操作，Then Worker Authority 与本地世界仍运行；以现有浏览器回归证明，不以 build 替代。
5. Given 包边界负例，When 导入已退役 Node 路径/包，Then 仍拒绝 Web→Node、core→app 及跨包相对导入。

## 验收与任务

- [x] 固定主线 SHA、建立并推送归档 tag；远端 peeled SHA 已验证为 ec77fdd667458ec93ea426dbf81a142ac6028f91。
- [x] RED 扫描、移除活跃依赖、保留 Headless 平台适配。
- [x] 更新长期产品基线、路线、代码地图、目录规则及入口。
- [x] 受影响确定性测试、pnpm verify:static、pnpm build、浏览器回归、Headless 多命令冒烟。
- [x] 语义 commit、推送 tag/分支并发 [PR #24](https://github.com/seedlands-game/seedlands-web-sandbox/pull/24)；人类审核与合并不自动执行。

## CI 准出修订

首次远端 run `34269805082` 固定了近战 E2E 的可执行 RED：三次既有 attempt 在累计 DOM 谓词上失败。只读诊断确认当前用例把持续的命中结果与瞬时 phase/combo 绑定为同帧要求；合并 tick 可以跳过中间相位投影，该要求不是现有结果合同。

修订验收：保留真实按住左键、5/7 点命中反馈、两次截图和目标权威终态；不要求当前 HUD phase 与结果同帧。新增确定性对照用例，以较大推进步长验证 phase 已离开 hit/active 已结束时，5/7 结果和目标扣血仍可检查。先跑该定向测试，再按 CI low 画质连续两次运行近战 E2E。不开新重试、不延长谓词超时、不改变攻击规则；截图不证明每次合并 tick 均显示了中间相位。第二次 CI 仍失败后，以完整 Chromium + SwiftShader 获取了实际 5+5+2 的 RED；场景验收增加队列清空与连续 8 帧 <100ms 的前置条件（15s 截止），不把冷启动掉帧中的连击保证纳入已验证范围。失败 JSON 和单变量对照见实施报告；保留真实 5+7、玩家受击及目标终态断言。

## 工作量与预算

当前归档与路线文档估计 1–2 PD，Agent 工作 2–5 小时，外部 CI 等待另计；非大规模实现。主任务负责路线与后续设计，Sol/high 有界完成退役实现（最多 3 Agent 小时），共享总规划 6 小时，保守预算建议 6×120%=7.2 小时，取整 8 小时。实际 token/credits/API 账单 unknown，不以 token 换算 credits；不是付费或 goal 授权。后续大规模 MVP 估算另列。

## Delivery Snapshot

本地验收完成，详细命令、RED/GREEN、计数、环境失败与成功重跑见[实施报告](implementation-report.md)。`pnpm verify:static` 通过，1133 测试通过、4 跳过；`pnpm build` 通过；Headless CLI 4/4 及真实多命令通过；Chromium 回归 20/20、资产集成 2/2、近战 1/1。不存在新增 Agent 运行时验收。

长期 docs baseline 已更新：产品定位、长期路线及来源、playbook、代码地图、目录规则、归档索引与 README/AGENTS，原因是明确改变当前产品载体和阶段顺序。后续具体方案见[单 NPC Agent MVP 设计](../2026-09-09-browser-agent-mvp-design/spec.md)。Node 历史 spec/交付/evidence 不改写；退役前完整树由已推送归档 tag 恢复。

实现子任务墙钟约 0.7 小时；主任务设计与集成的独立计费时长、token/credits/API 账单无法从当前运行环境准确取得，实际值标记 unknown。远端 CI 与 PR 审核状态以本功能分支最新 SHA 的 GitHub 检查记录为准，不预先声明通过或自动合并。
