# 准备与实施阶段证据

## 基线与范围（准备阶段）

- 2026-09-09 `git fetch origin --prune` 成功。
- GitHub live readback：PR #25 为 MERGED，合并时间 `2026-09-09T09:02:48Z`，merge SHA `01bab28ace506685f39c1d4a86fec541cbbf2f1b`。
- 从该 main 提交建立 `codex/composable-overworld-playbook`；切换前工作区干净，原 `codex/gameplay-foundation` 分支未删除。
- 没有合并、cherry-pick 或依赖 `codex/living-npc-mvp`；不要求它先完成。
- 本批只写 docs 与 change 文档，生产源码、锁文件、依赖版本、权限策略、存档和测试口径未修改。

## 源码与合同检查

实读 EntityStore、PlayerState、GameplayRuntime 的角色/库存入口，Item/Recipe registry、GameplaySnapshot V1/V2/V3、WorldResourceAuthorizer、共享 Harness 文档和 package scripts。缺口见 spec 的 Current evidence；这些是静态调查，不是本期 RED/GREEN。

2026-09-09 实读 bitECS 与 Koota 维护者文档作为 ECS 准入候选核对；未安装，未将 GitHub main 能力当成已发布包验收：

- [bitECS Introduction](https://github.com/NateTheGreatt/bitECS/blob/main/docs/Intro.md)：存储布局不受强制、查询与外部系统调度可分开；数值 ID 及回收需要稳定身份适配。
- [Koota](https://github.com/pmndrs/koota)：组件/trait 与查询作为另一候选；当前不据此宣布性能或接入成本优于既有实现。

准入必须补具体发布版本、许可、依赖与运行测试，不能因候选文档存在就进入生产。现有 `docs/ecs-animation-research.md` 作为历史入口，不作为新版本通过证据。

## 本轮验证记录

- `git diff --check`：通过（跟踪文件的空白检查）；新增文档另做换行/尾部空白检查。
- `pnpm exec prettier --write`（本批七个 Markdown 文件）：退出 1，工具尚未开始。pnpm 自动依赖校验报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`：`devalue@5.9.2 could not be checked against minimumReleaseAge (version not present in registry manifest)`。
- 未修改锁文件、registry、供应链门禁或 hook，未使用 `--no-verify`；没有拿直接执行底层二进制绕过该门。该失败是工具链前置，不是产品用例 RED。
- `pnpm verify:static`、`pnpm build`：本轮未运行，同一 pnpm 前置已拒绝；不重复安装碰运气，不声称通过。
- 新产品测试：未运行，将在精确审核之后、对应实现之前取得 RED。ECS 依赖尚未准入/安装。
- 文档格式未通过正式 formatter；本批未 commit、未 push、未发交付 PR。文件保留在独立功能分支工作区。
- Node 内置文件/路径检查：七个 Markdown 的本地相对链接均存在，末尾换行及尾部空白检查通过；未校验远程链接或所有标题锚点。估算算术检查通过：22/36 PD，45/80 活跃小时，9.5/19 工具等待小时，保守关键路径加 buffer 为119小时。

## 审核与交付边界

架构知识文档为用户已确认方向的沉淀；生产改造因公开合同/存档/跨模块属性，按开发治理停在精确 hash 审核门。用户本轮“推进至交付”不被解释为绕过该门。

当前尚无生产 commit、产品验收或交付 PR；后续按 spec S1–S6 逐阶段补证据，不能以文档完成替代完整目标完成。

## 2026-09-09 续接实施

- 通过 Codex `read_thread` 读取「玩法线推进」；最近四个 turn 的 API items 为空，因此以当前磁盘合同、SHA 和用户本轮精确批准为实施依据，未猜测缺失消息。
- 当前 HEAD 仍为 `01bab28ace506685f39c1d4a86fec541cbbf2f1b`，分支 `codex/composable-overworld-playbook`。接手时七份未提交文档与已批准合同一致，未混入其他分支。
- 批准 spec 摘要 `40daf17358a3fb5a86d08ea25aecbf6896922274f16a68d02c557bb38139bb53`、附件摘要 `47bfd5e2e053842fff1fafebbe993b019b362254c6b3592f01ec398bb7921c40` 已从真实文件重新计算并匹配；原始字节保存在 `evidence/*-approved.txt`。
- `pnpm --version` 为 11.25.0。正常 `pnpm exec prettier --check` 先通过 supply-chain policies 并完成工作区依赖检查；上轮供应链失败本轮未重现，未更改 registry、锁文件或安全策略。随后 formatter 正常运行，指出三份 Markdown 排版问题（这是格式失败，不是产品 RED）。
- 按项目版本化 agent-work-routing 源校验父子合同，S1 请求 `gpt-5.6-sol/high`，单个 native child；无外部写入、无继续委派、无生产 ECS 依赖安装权限。主任务独占文档/准入实验/静态边界，写路径互斥。实际计费模型/用量未回显，记 unknown。临时交接合同不进入产品仓库。

### S1 主任务补充验证

- `pnpm test tests/governance/pack-api-boundary.test.ts` 初次实际运行：9 failed / 3 passed，失败原因是当前 ESLint 无该边界，非法导入未拒绝。规则落地后 12 passed；补 import type 负例后 13 passed。连同既有 client/app 边界共 17 passed。
- 规则覆盖普通 import、re-export、动态 import、require、import type、路径逃逸与不可解析导入；仅放行真实 mod-api 和同一 Playbook 目录文件。
- `tests/governance/pack-api-consumer.test.ts` 使用独立临时项目和实际 package exports，严格 ES2022 无平台 ambient 类型检查、neutral bundle、Node runtime 均通过；验证作者 facade 不导出宿主工厂，definePack 不含假 integrity。此测试落地时接口修正已完成，首次运行就是 GREEN，不另称为 RED。
- ECS 隔离执行及未验证边界见 [准入补充合同](ecs-admission.md)。没有安装生产 ECS 依赖，未把隔离实验当成 T04/T12 生产验收。
- 已检查批准的 `evidence/*-approved.txt` 原始字节，两份 SHA 均与本轮获批摘要一致；格式修正不改变归档副本。

### ECS 准入独立复核

- 请求只读 Sol/xhigh reviewer，未继续委派、未安装生产依赖。首轮指出 query 精确成员/延迟删除、空间索引证明、存档内动作与外部引用区分、运行包身份、字段 owner 切换五项缺口。
- 修正实验与合同后第二轮结论为 `PASS_BOUNDED`：六份绑定摘要一致，admission 与 artifact receipt 的 manifest/lock/integrity/LICENSE/runtime input 链一致，10 个 control 输入匹配当前源码，发布包文件逐字节匹配为 87/18。reviewer 未独立重跑安装或实验；实际运行由主任务完成。
- 对非公共 registry 地址做脱敏后重跑包体核验，87/18 文件仍全部匹配；没有更改候选版本、包体、适配选择或实验结论。原始安装传输 URL 仍为 unknown，不以当前配置推断历史来源。
- 该结论只允许把具体合同交用户精确审批；生产安装、owner 迁移和 V1/V2/V3 动作迁移 fixtures 尚未执行，S2 未完成。

### 集成门禁首轮

- `pnpm verify:static` 的 SSG、format、ESLint 均通过；路径检查拒绝新增 `approval/` 目录，尚未进入全量测试和类型检查。
- 将批准原始字节移动至既有允许的 `evidence/*-approved.txt` 并更新引用，保持 SHA 不变；未放宽路径规则。随后重新执行完整门禁。

- 第二轮完整门禁通过 SSG/format/ESLint/paths；coverage 为 240 files passed、2 skipped、1 failed，1204 tests passed、4 skipped、1 failed。唯一失败是既有 `client-app-boundary-eslint` 首项 5000ms timeout（5686ms），不是断言不符；当时 build 并行，资源竞争是待验证解释而非已证明根因。保留失败，不修改时限或规则。
- `pnpm build` 单独记录 exit 0：Rust artifact fingerprints、SSG、Svelte/TS 与 Vite 生产构建完成；Svelte diagnostics 为 0 errors/0 warnings。Vite 既有大 chunk 提示不作为性能验收或阻塞。

### 审阅前集成 GREEN

- 超时的既有 ESLint suite 单独运行 4/4 passed，原时限和断言保持不变。
- 构建结束后重新执行原命令 `pnpm verify:static`：exit 0；SSG、format、ESLint、路径、coverage、core/Web/test/tools 类型检查全部通过。241 test files passed / 2 skipped，1205 tests passed / 4 skipped。既有 world 覆盖率口径 lines 96.89%（780/805）；此数字不覆盖新增 composition 全部源码，不能当全项目覆盖率。
- `pnpm build`：exit 0，作为独立构建证据。以上不宣称性能收益；单独/整套复验均通过仍不能证明首轮超时只由本任务构建造成。
- 本轮未运行真实浏览器旅程：S1 没有 UI/输入或产品启动接入；T04–T14、默认 Playbook 和跨宿主产品验收仍待后续阶段。未启动 dev/preview server。

### S1 独立审阅后的修正轮

首轮完整门禁通过的 S1 源码身份保留在 `evidence/s1-source-receipt-pre-review.json`，不是最终准出声明。只读 Sol/xhigh 独立审阅发现：重复 providerSelections 会被 Map 覆盖；异步调用 input 未快照；完整性 adapter 的嵌套 manifest/descriptor/receipt 仅浅冻结。另指出 loaded descriptor 一致性只能在 import 后验证，原证据把拒绝时点写得过早。以上由原实施者补负例并修正，不调整已批准的 D2/D5 合同。

reviewer 同时确认新长期测试覆盖独立包 exports、真实字节/副作用边界、装配与授权规则，具有独立保护价值；未要求删除重复重测试。它们不取代 S2/S3 的真实玩法消费者验收。

修正轮新增用例先运行得到 3 files、5 failed / 24 passed：两种重复 provider selection 未拒绝、async executor 观察调用后突变且 input 未冻结、adapter 允许嵌套描述改写；失败与独立审阅触发条件一致。

### 修正后集成复验

- 修正后的定向合同 3 files、31 tests passed；core/test 类型、定向 ESLint 和格式通过。
- 重新执行 `pnpm verify:static`：exit 0，241 files passed / 2 skipped，1212 tests passed / 4 skipped；SSG/format/ESLint/paths/coverage/core/Web/test/tools types 全部通过，world 覆盖率口径未变。
- ECS 六份绑定文件摘要已复核；任务拥有的隔离安装目录已清理，复现入口与报告留在本 change。

### 独立审阅收敛

- 局部回读确认前四项已修正，另发现 JSON 快照的普通对象赋值会把自有 `__proto__` 当原型 setter；必填 schemaVersion 可从继承链读取。主任务补真实 manifest 负例，RED 为 1 failed（adapter 错误 resolved ok:true）/10 skipped。
- 快照改用无原型对象与自有数据属性，嵌套描述不触发 setter。相同负例断言明确 schemaVersion 错误且 ESM 副作用文件不存在；3 files、32 tests 全部 GREEN。
- 最终只读局部审阅结论 `bounded pass`，未发现剩余 S1 阻塞；reviewer 核验 adapter SHA `2f4d0ce0f8796366495897f75af4592c0f46373a69a3d07cfeed4b8a235dc769`、完整性测试 SHA `6f9bc530fe8287578c84471c81174995f3a2e0e00ea1fb36d16bf09265a15268`。本轮 reviewer 未重跑测试，测试/构建由主任务执行。
- ECS 六份绑定摘要也经独立回读全部 MATCH，非公共 registry 标签已脱敏，两个包体 receipt 分别 87/18 文件；准确依赖合同可交用户精确审核。

### S1 最终本地阶段快照

- 最后一处 JSON 快照修正后，原命令 `pnpm verify:static` 再次 exit 0：241 files passed / 2 skipped，1213 tests passed / 4 skipped，完整覆盖率与类型门禁通过。
- 随后串行执行 `pnpm build`，exit 0；无新的生产代码修改发生在这两项检查之后。文档仅补终态，独立审阅已收敛。最终 S1 源码/配置/测试摘要见 [source receipt](evidence/s1-source-receipt.json)。
- 原批准 spec/附件字节及 ECS 六份绑定摘要再次一致；生产 lockfile 没有新增 ECS。保存本地语义阶段 commit；整个 change 仍 Implementing，未 push/发 PR/merge，T04–T14 的产品交付不因此完成。
- 下一门明确来自已批准 D3：具体 `bitecs@0.4.0` 生产依赖与适配合同经精确 hash 批准后，继续 S2 owner/存档迁移。S3–S6 未开始，不重复申请原方案批准。
