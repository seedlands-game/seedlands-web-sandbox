# 验收范围修订：完成架构拆分，暂缓 Classic 玩法验证

> 2026-09-16 用户决策；本文件是对原批准 spec 验收顺序的实质修订。原 spec 和既有证据保持原字节。本修订需按 Breaking 流程审核精确 SHA-256 后，才能据此修改默认测试、CI 或交付状态。

## 用户目标与阶段边界

用户要求本次 #33 完成整个引擎的架构拆分，但战略性暂缓 Classic 的集成与端到端验证。当前自动化行为测试只保留 Kernel 和 stdlib 模块的确定性测试；Classic 后续完成时，再执行其集成与端到端验收。此决策改变验证边界，不表示现有 Classic、Web、Agent、浏览器或历史测试已通过，也不授权删除这些测试与失败证据。

本次仍只迁移现有能力，不加入新玩法、新 NPC/Utility/AI 能力、现代视觉或新 Playbook。Classic 必须作为独立 Playbook 承接原有默认内容和装配选择，不能仍隐身在 Kernel 或 stdlib 里；这里的“暂缓验证”仅指不证明它当前可玩、行为兼容或端到端可用。

## #33 的架构完成合同

- Kernel 是不预设物品、饥饿、战斗、NPC、行为树或默认地形的中性运行保证；现有机制按 owner 迁入可选 stdlib 模块，Classic 作为独立 workspace Pack 经公开接口显式组合。旧 `game-core` 的活跃生产职责退出，不留下默认玩法回流或永久全量 facade。
- Web、Agent 和 Headless 的活跃源码只从声明的公开入口消费新包；依赖方向、exports、注册与 provider 闭合，没有反向/循环依赖、私有跨包导入或第二份权威世界。仅有目录移动、包名变化或测试通过均不构成上述合同的证据。
- 行为测试执行集合仅为 `packages/kernel/tests` 和 `packages/stdlib/tests` 的确定性测试，覆盖无默认玩法的 Kernel、模块注册与隔离、单一状态 owner、确定性推进、事务/事件、存档与恢复、旧身份和失败原子性等已声明合同。新增或修复测试先在对应包取得可执行 RED，再由真实 owner 路径取得 GREEN；不以修改断言、跳过、删除或空匹配获得通过。
- 架构完整性另以源码依赖图、公开 exports、静态边界规则和相关 workspace 类型检查证明；这些是结构/编译证据，不计入 Kernel／stdlib 行为测试数量，也不冒充 Classic 玩法验证。若仍有活跃旧入口、反向依赖或新宿主无法编译，#33 的架构合同不算完成。生产运行、Classic 内容行为、跨宿主集成、浏览器线路及性能测量均不在本次验收范围。
- 最终记录绑定精确源码 SHA、工作树状态、执行命令和覆盖边界，区分 PASS、未执行和失败。可在所有上述架构条件闭合后声明“#33 架构拆分交付”，不得声明 Classic 可玩、原产品行为兼容或完整产品基线已验证。

2026-09-16 对干净的 `77857ca98fa1ec5e2618dea9cea815ada29e2b56` 执行本地 Vitest：

- `./node_modules/.bin/vitest run --config packages/kernel/vitest.config.ts --maxWorkers=2`：4 文件／28 测试通过。
- `./node_modules/.bin/vitest run --config packages/stdlib/vitest.config.ts --maxWorkers=2`：82 文件／530 测试通过。

两次运行均为 exit 0，输出没有 skipped、todo 或 pending；此证据只证明两个包的被测局部合同。当前尚未在最终源码上完成本节所列的架构静态与编译验收。

## 后续 Classic 与跨层验收

原 spec 中 Classic 玩法/内容、旧存档在实际宿主中的兼容、跨模块/跨宿主集成、生产构建、唯一 C0–C5 浏览器线路、Worker/Wasm/WebGL2 与 runtime benchmark 的验证均保留为后续未完成项；不以本次架构交付自动关闭。已有 C4 间歇失败和浏览器覆盖缺口继续开放；后续按最终源码重新取证，不能复用临时诊断或旧 SHA 的绿色结果。

本次可冻结架构责任和接口边界，但不能冻结“Classic 产品行为已通过”的基线。旧测试和证据保留并明确未执行，不把后置写成通过。当前 GitHub required checks 仍包含 Static verification、Production build 和 Chromium regression，且影响选择器存在 `spawnSync git ENOBUFS` 失败；本文件本身不修改 CI 或分支保护。#33 若要按新合同合入，需先形成与此边界一致、可审查且不伪造成功的门禁方案，解决当前 selector 阻塞；未经该方案和必要审批，仍保持 Draft，不以包内测试通过宣布 PR 已闭环。
