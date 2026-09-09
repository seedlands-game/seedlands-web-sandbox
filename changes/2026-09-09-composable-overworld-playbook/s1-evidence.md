# S1 每世界装配、完整性与授权接缝证据

## 范围与结论

本记录只覆盖 S1 的公共接缝：每世界 Pack/模块确定性装配、作者 facade、宿主完整性适配、动态资源登记，以及经既有 `WorldResourceAuthorizer` 的模块执行授权。它不表示 GameplayRuntime 已迁移，也不表示第一方 Playbook、ECS、Browser/Headless 产品启动或 T01–T03/T06 的后续真实玩法消费者已全部交付。

作者唯一公开入口是 `@seedlands/game-core/mod-api`。它提供 `definePack`、descriptor/manifest/注册 facade 和受限调用类型；`definePack` 返回普通 `PackDefinition`，不生成或伪造完整性回执。装配、世界创建和授权工厂只从宿主入口 `@seedlands/game-core/server/composition/host-api` 导出。

首版 capability 与 Pack 依赖只接受精确版本并做字符串相等；版本范围直接拒绝。本期构建产物入口限定为无代码 import 的单文件 ESM。宿主适配器用 TypeScript AST 拒绝静态、重导出和动态代码依赖，验证整份锁清单中的 manifest、entry 和资源真实字节、schema、精确资源集合与 realpath containment，全部通过后才从已校验字节的 data URL 执行任何 Pack。

## RED

在生产入口和脚本存在前执行：

```text
pnpm exec vitest run tests/server/composition/world-pack-assembly.test.ts tests/server/composition/mod-authorization.test.ts tests/scripts/pack-integrity.test.ts

Test Files  3 failed (3)
Tests       1 failed | 2 passed (3)
```

- 两个 composition suite 在收集阶段因 `@seedlands/game-core/mod-api` 缺少 `./mod-api` export 失败，证明 T01/T03/T06 所需公开入口和宿主执行接缝不存在。
- 完整性合法加载路径因 `scripts/pack-integrity.mjs` 不存在失败，证明 T02 没有真实的预执行 artifact adapter。
- 当时两个完整性负例仅因脚本缺失而表面通过，未计为 RED 证据；随后已改为断言精确 stderr，并补齐实际字节、批量预检、AST 依赖和 symlink 负例。

独立审阅修复先执行了新增负例：

```text
pnpm exec vitest run tests/server/composition/world-pack-assembly.test.ts tests/server/composition/mod-authorization.test.ts tests/scripts/pack-integrity.test.ts

Test Files  3 failed (3)
Tests       5 failed | 24 passed (29)
```

五个失败精确证明：core 的重复 provider selection 会静默 last-wins；adapter 会执行含重复 selection 的 Pack；异步 executor 会看到调用后被修改的原 input；adapter 返回的 manifest 与 loaded descriptor 只浅冻，嵌套字段可被改写。

## GREEN

S1 新增定向合同：

```text
pnpm exec vitest run tests/server/composition/world-pack-assembly.test.ts tests/server/composition/mod-authorization.test.ts tests/scripts/pack-integrity.test.ts --reporter=verbose

Test Files  3 passed (3)
Tests       31 passed (31)
```

覆盖：

- T01：输入顺序无关的 code-unit 稳定 Pack/module/definition 顺序；重复 Pack/模块/定义、Pack 或 capability 循环、缺 provider、精确版本不匹配、双 Playbook、重复 provider selection、未批准替换均在 register/world factory 前失败；产物与注册表冻结，缓存注册 facade 在装配阶段后关闭。
- T02：adapter 对真实 manifest/entry/resource 字节计算并核对 SHA-256；资源缺失、篡改、坏 manifest descriptor schema、重复 provider selection、静态/动态未锁代码依赖和 symlink 越界均在 ESM 入口执行前失败，后一个坏 Pack 也会阻止前一个 Pack 执行。ESM 入口执行后，adapter/core 再核对 loaded descriptor 与 manifest，差异会在模块 `register` 和 world factory 前失败；这层检查不能倒推为 ESM 入口无副作用。adapter 返回 manifest、receipt 和 loaded descriptor 的非污染式深冻结快照。最终 world creation 运行时拒绝没有 integrity receipt 的普通定义，合法 receipt 可进入 factory。
- T03：provider Pack 经公开 facade 注册两个新 item 和 capability，第二 Pack 按声明消费 capability 并注册引用这些 item 的 recipe；未声明 capability、未知 item、重复 item 和未批准 provider replacement 均拒绝。
- T06：模块资源先登记到既有 authorizer；未知资源/主体、self 读取他人目标、未获宿主批准的 Pack permission、缺 executor 均 fail closed 且 executor 未运行；执行上下文固定宿主 principal、原始 actor、Pack/module provenance 和同一已授权 target。参数只接受有界 JSON-compatible 数据，经宿主注入的 `CoreClone` 复制并深冻结后才交给 executor；异步 executor 不会观察调用方后续突变，input 内的 actor/target 也不能重绑执行 context。factory 捕获创建时绑定和 executor，事后修改 options 不会重绑。

受影响的授权回归：

```text
pnpm exec vitest run tests/server/world-resource-authorization.test.ts tests/server/gameplay-command-persistence.test.ts tests/server/world-harness-session.test.ts

Test Files  3 passed (3)
Tests       21 passed (21)
```

类型、边界与静态检查：

```text
pnpm --filter @seedlands/game-core typecheck
# exit 0

pnpm exec tsc -p tsconfig.test.json --noEmit
# exit 0

pnpm exec eslint packages/game-core/src/server/composition packages/game-core/src/server/harness/world-authorization.ts scripts/pack-integrity.mjs tests/server/composition tests/scripts/pack-integrity.test.ts
# exit 0

pnpm exec prettier --check packages/game-core/src/server/composition packages/game-core/src/server/harness/world-authorization.ts packages/game-core/package.json scripts/pack-integrity.mjs tests/server/composition tests/scripts/pack-integrity.test.ts
# All matched files use Prettier code style

pnpm exec vitest run tests/governance/pack-api-boundary.test.ts tests/governance/pack-api-consumer.test.ts

Test Files  2 passed (2)
Tests       14 passed (14)
```

## 仍未验证与后续依赖

- 当前 descriptor 只冻结了本接缝实际消费的 identity、exact version、capability、resource、permission 和 replacement 字段；D1 的 component/schema/codec、生命周期、调度 before/after 与事件/事务阶段仍须由后续真实 S2/S3 消费者收敛，不能把空字段提前当稳定 API。
- 还没有第一方 Pack/Playbook、GameplayRuntime owner 迁移、production ECS、checkpoint 组合身份或 Browser/Headless 启动接线；这些属于后续阶段。当前 adapter 是 Node 工程宿主入口，Browser 组合加载未接入。
- core 的完整性回执类型只是可信宿主提供的结构声明，不能自行证明字节；真实锁清单与字节一致性由 `scripts/pack-integrity.mjs` 验证，core 随后复核 receipt 结构和业务 schema。两者都不证明作者可信，也不提供同 realm 恶意代码隔离。首版拒绝外部代码依赖并要求构建后的单文件 ESM，不解析任意 semver 范围。
- 本子任务未运行全量 `pnpm verify:static` 或 `pnpm build`；由主任务集成后统一执行并区分静态/构建证据与产品验收。

## 主任务最终审阅修正

在上述 31 项 GREEN 后，独立回读发现 JSON 快照的 `__proto__` setter 边界。主任务补真实负例先取得 RED，再用无原型对象和自有数据属性修正；最终定向合同为 3 files、32 tests passed。独立回读已通过；全量门禁与源码身份以 [主证据](evidence.md) 的最后记录为准。
