# 可组合内容注入闭环

状态：Active。用户要求直接实施，不再把 Classic 内容写死在 stdlib/Web，并把旧汇报长期停留的 94% 推进到可验证 100%。本 change 按 Breaking 管理；不改变单权威、WebGL2、紧凑数值体素存储和旧 Classic 存档 ABI。

## 用户结果、长期愿景与硬约束

### 用户结果

1. 方块、光照、实体原型、worldgen provider 与资源绑定由 Pack/Playbook 提供，宿主只消费公开合同。
2. Classic 是普通消费者；新增一个非 Classic Playbook 时，不修改 stdlib 或 Web 的内容枚举/分支。
3. PR 完成静态、确定性、production build、唯一 C0–C5、CI 与独立审阅，达到可交给人类合入的状态。
4. 旧 94% 不再作为主观估算；进度以冻结范围的任务/证据账为分母，全部核销后才是 100%。

### 长期愿景

同一小内核、标准机制和宿主可组合不同的体素开放世界；Pack 可携带 code/data/resources/UI/render/AI 分面。Classic 与未来 Modern 都不拥有引擎特权路径。

### 硬约束

- 旧 Classic numeric voxel IDs、generatorVersion 与存档 bytes 不重解释。
- 世界权威、事务、存档与 Worker 边界不下放给表现资源。
- WebGL2 保持不变；不引入 WebGPU 或逐体素 Entity。
- Pack 资源继续经过同源、大小、路径和 SHA-256 校验；不存在任意 URL 直通。
- 没有受控 A/B 不宣称性能提升。

## 现状与纠偏

现有架构已实现 Pack/module lifecycle、capability/provider selection、item/recipe/block rules、actor profiles、standard worldgen provider 和资源完整性清单；不是从零搭插件系统。剩余特权路径是：

- stdlib `Voxel.*` 决定 solid/targetable/renderable、light emission/cost 与面材质；composed world 的 block rules 只能补玩法属性。
- actor profile 虽由 Pack 提供，但 `ACTOR_ARCHETYPES`、协议和恢复仍限制为 stdlib 固定名单。
- Pack `resources` 只参与完整性校验；Web 的 Classic asset catalog 仍是表现真值。
- builder/click-conversion 证明了替代配方与玩法模块，但没有同时证明自定义 voxel/light/actor/resource/worldgen。

旧 Reporter 的 93–94% 来源于过期 `coverage.json` 与人工阶段估算：已实现项没有及时核销，浏览器/性能/远端 CI 被混在同一百分比，分母也没有冻结。因此本 change 不沿用该百分比。

## 推荐架构

### 1. 冻结的内容注册表

在既有 content module/registration 增加 namespace-qualified voxel definition：稳定字符串 id、V1 有界 numeric storageId（0–4095）、物理标志、0–15 emission、1–16 propagationCost、表现引用。assembly 验证 ID/数值唯一、引用闭合并冻结为 capability。Classic 可继续使用 0–88，但语义由 Pack 注册。

### 2. 生产消费者只读 registry

- Authority gameplay、光照、导航、射线、生成安全检查从 world composition 的 registry 取得体素语义。
- Browser Authority ready 投影只读的紧凑 voxel semantics；World block-light 与碰撞派生使用同一 composition identity/revision。
- Rust/Wasm mesh 保持 numeric 数据面；由冻结 material lookup 输入解释，不在 Rust switch 中增加新 Pack 名称。

### 3. Pack presentation manifest

Pack manifest 声明并锁定 presentation JSON 资源。JSON 只含有界数据：voxel/item/actor 的 texture/model/icon/material 引用与资源路径；Web 通用 loader 校验 schema、数量、路径和 digest 后构造外观目录。Classic 的程序化默认资产可作为宿主 adapter，但绑定关系由 Pack manifest 提供。

### 4. 开放 actor archetype

archetype 改为有界 namespace-qualified ID；旧 Classic 非命名空间 ID 作为显式 legacy alias。actor profile registry 是唯一准入名单，协议/存档校验调用 registry，不再用 stdlib 常量名单决定合法性。组件/行为仍由已加载标准模块赋予语义。

### 5. 无特权第二 Playbook

新增测试 Playbook `sample:modular-world`：自定义 voxel/light、actor profile、worldgen provider 与 presentation resource。构建/完整性/assembly/headless/Web 目录测试只通过公开 API；删除任一注册或宿主重新引用 Classic 枚举时 RED。

## RED / Given-When-Then

- Given 第二 Pack 注册 storageId 500 的透明发光方块，When assembly 与 block-light/mesh/presentation 消费，Then 无需修改 stdlib/Web 内容表即可得到该物理、光照和资源语义；当前 RED 为 registry/API 不存在。
- Given 第二 Pack 注册 `sample:sentinel`，When spawn→protocol projection→checkpoint→restore，Then profile 与身份保持；当前 RED 为 `ACTOR_ARCHETYPES` 拒绝。
- Given Pack presentation manifest，When production loader 校验，Then只有 lock 中同 digest 的同源资源可见；缺失/多余/越界/外链 fail closed；当前 RED 为 manifest 不被 Web 消费。
- Given Classic composed world，When加载旧 v2–v11 checkpoint/chunk，Then 0–88 语义与 bytes 不变；未组合 legacy helper 继续显式 fallback，但 production 不读取硬编码表。
- Given progress ledger，When任何功能、证据、CI 或 review 未完成，Then不得显示 100%；全部冻结项完成后自动汇总 100%。

## 验收层级

1. Kernel/stdlib：registry 冻结、冲突/越界/引用/恢复正反例；第二 Pack headless 旅程。
2. Rust/Wasm：material lookup 与 TS/staged/scalar/SIMD 等价。
3. Web：Pack presentation loader schema/digest、第二 Pack 目录/预览、Classic fallback 无回归。
4. Production：同一 artifact 的 Classic C0–C5 与一个有界第二 Pack smoke；错误账本为空。
5. 交付：完整静态/确定性、独立 P0/P1/P2 审阅、远端 CI 与 PR gate。

## 工作量与预算

传统工程量 12–20 PD。单 agent 45–80 小时；今晚关键路径 10–16 小时，保守 16 小时，20% 缓冲后建议 20 小时。允许复用现有只读 Reporter 与已运行审阅 agent，但不以并发掩盖总工时。分模型 credits、API 等价费用、账户额度分母与实际 token 分类不可得，均记 unknown；现有平台 Goal token 口径继续由工具记录。

## 任务状态

- [x] 读取 Reporter 历史架构审计并纠正过期事实。
- [x] 冻结 progress ledger 与剩余 6% 实际清单。
- [x] voxel semantics registry 与 Classic 兼容迁移。
- [x] actor archetype registry 去固定名单。
- [x] Pack presentation manifest 与 Web 通用消费。
- [x] 第二 Playbook 无特权证明。
- [ ] 静态、确定性、production、C0–C5、CI、独立审阅与 PR。

## V1 显式边界

- WebGL2 texture array 保持既有 92 个 material slot；Pack 可重绑 slot，但本期不动态扩容 atlas。
- V1 mesh semantics lookup 最多 4096 条，因此 Pack storageId 限制为 0–4095；世界缓冲仍保留 `Uint16` ABI。
- 外部 voxel topology 支持 `cube/water/glass/ice`；Classic 的 0–88 可继续使用既有 `model` geometry。未注册的外部 model geometry 在 assembly 前 fail closed。
- `host-admissions.json` 是宿主批准真值，Playbook/extension 均须匹配 exact id、version、integrity 与权限后才可执行。
