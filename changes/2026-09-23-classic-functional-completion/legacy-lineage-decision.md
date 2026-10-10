# 旧存档 Composition Lineage 决策

状态：只读调查完成。结论为保留现有精确 Classic lineage，不用当前 identity 替换旧测试，也不放宽为任意旧 Pack。本文没有运行测试、构建或浏览器，没有修改 production/test。

## 审计身份与范围

- 冻结 Git HEAD：`78545d877ed08ee0613a690ff53e36b0c2120b69`，tree `688573af263778e7f4be5f03e2bcb6e9568f6e3c`。
- 当前工作树明确纳入 794 对 `gameplay-registered-needs.test.ts` 的未提交 fixture 修订，以及 954 对 `playbooks/classic/src/pack.ts`、`retired-actors-migration.ts` 的未提交 Media 兼容修订；`checkpoint-identity.ts` 与 HEAD 相同。
- 输入 evidence：`media-fixture-closure-evidence.md` SHA-256 `ec0901a4c17a83e4c749b4b2fbd812e0ad80c12804dae0fa4374363355c374d7`。其中 `102 passed / 2 failed` 是既有证据，本审计未重跑。
- captured fixture：`base-checkpoint.json.gz` SHA-256 `f8ef2fbdad68a16fdcd2e5bea59b0fd96cdcc76ee697daf7f0dea6bff86329cc`；解压字节 SHA-256 `c6f431f19bc45e5405d6991b1a6560bdebb62ac5b086011e70c701719600d0aa`；Git blob `51989b626cc8f5624ad755f279dfa7dc3ca99016`。
- 未覆盖：相邻 mining runtime owner 缺陷、任意其他旧 Pack、真实浏览器 IndexedDB 迁移执行、当前未提交 Media/Structure 的行为正确性。

## 决策

保留该测试所代表的支持合同，但名称和证据边界必须准确：

1. `gameplay-registered-needs.test.ts` 构造的是一个 `GameplaySnapshotV3`，只从 captured fixture 取得外部 `legacyCompositionIdentity`；它不是直接加载 captured V4 world，也不能证明该 V3 payload 的历史字节 provenance。
2. 该组合不是偶然误用。原测试在 `6c7124a6f41e9069b07b7dd39593cd2ea2de5907` 已固定“旧 shared NPC needs phase → per-actor phase”；`5a5f0a5ea7e4a8e59597cb9c575b37997f4a933d` 将宽泛 `allowLegacyCompositionMigration: true` 收紧为 `capturedLegacyCompositionIdentity()`。同一变更的断言迁移账本保留测试标题和全部 27 个直接断言，`reviewRequired=false`。
3. captured identity 是可信 Classic source envelope：其 receipt 在 `697c7ae25f3654329105b8d01226dc2b95390c82` 声明 base `c18a890c7f97f76421e13565ec628d8c50a942da`、正式 Authority runtime、Pack 摘要和 fixture 哈希；change 路径与稳定 fixture 路径使用同一 Git blob。
4. 因 V1–V3 schema 没有 embedded `composition`，外部 identity 是宿主提供的来源声明。测试证明的是“在精确 Classic 来源声明下，V3 needs domain migration 经 composed restore 仍成立”，不是任意 V3 都属于 Classic。
5. 不建议把该用例改成仅 domain migration 并删除 full-Classic admission。可以另补 stdlib 纯 codec 测试，但不能替代已有跨 composition 合同；长期文档仍明确要求已有 main 存档经显式迁移、core V1–V4 迁移继续维持。若产品要终止该 lineage，必须另行修改 spec/docs/迁移账本，而不是换新 identity 让测试表面变绿。

## Identity 来源与差异

### Captured 来源

- receipt：`697c7ae:apps/web/tests/fixtures/checkpoints/base-checkpoint-receipt.json`。
- 捕获 base：`c18a890c7f97f76421e13565ec628d8c50a942da`。
- world ID：`seedlands:g4:kernel-migration-c18a890-v1`；runtime：`authority`；gameplay snapshot：V4。
- embedded Pack：`seedlands:overworld@1.0.0`，manifest `e3c199e87d101672c1635d481771972edbf39deb43c336063ab3753d0b01bb89`，entry `924d61fc72f253c85e191caa79f1c7ff51f83bc6237ad613a7c0c5595c2c169f`，resources `[]`。
- canonical JSON 辅助摘要：完整 composition `d34c16d56c4e68211deb3331607b0a581f69b8ac1e201287842d0967f6107ad2`，definitionMap `16d5f2052e4d7a70f527947e552035de9b26431ec7715f9b2fc6a715c609d5a1`。这些是审计辅助值，不是 wire 字段。
- `capturedLegacyCompositionIdentity()` 只读取 `args[0].snapshot.gameplay.composition`；当前 needs 测试第 174–218 行另行生成 V3 payload，再把该 identity 作为 `GameServer` host option 传入。

### 与其他 predecessor 的区别

- captured Pack 摘要精确等于 `checkpoint-identity.ts:18-21` 的 `KERNEL_MIGRATION_PREDECESSOR_OVERWORLD`，不是 inventory-pointer 前驱，也不是 NPC-composable 前驱。
- `apps/web/tests/fixtures/npc/main-composition.json` 是 NPC-composable identity：Pack digest 为 `05bc…/7583…`；captured 是 `e3c1…/924d…`。两者 definitionMap 也不同：captured 为 17 modules/16 capabilities，NPC fixture 为 16/15，差异是 captured 含 `seedlands:behavior-registry-module` 与 `seedlands:behavior-registry`。

### 当前拒绝根因

`createCompositionCheckpointGuard()` 没有保存冻结的 predecessor graph。它从当前 target identity 动态派生三个候选：替换 Pack digest，做 `legacyContentDefinitionMap()`，再删除 worldgen 或 behavior registration。V1–V3 分支只允许外部 identity 等于这三个动态候选（当前文件第 192–200 行）。

这套“当前图减法”最初可以表达迁移时相邻 predecessor，但不是稳定 lineage：

- `d1e692cab525eab55f05805a6601ffb4bb1dcfa1` 首先为 Classic inventory 增加 `seedlands:player-inventory-layout` capability及 `definitionIdentity`。逆变换只删除 capability 的 `definitionIdentity`，没有删除新增 capability，因此 captured graph 已不再相等。
- `6b82a5d264d148acd1eaafabc5a15663c3cb1d8b` 删除 captured 中的 feeding modules/rules并新增 Classic-owned snapshot migration capability；后者虽被 split filter 排除，已删除的旧注册不会由 target 反推回来。
- `cb5d3efbec704e100dfc6ec5ce7a6416b3056f49` 把 voxel definitions 与 presentation resource 纳入当前 Pack/definition identity；captured definitionMap没有 `schemaVersion`/`voxels`，当前 helper只删除 `schemaVersion`，不删除 `voxels`，同时 items/recipes也已演进。
- `b08f500cc624d230eefa117b69dceb958e96aff1` 和 `be0bde7e3ba3ddc228efa93bd005b1b0ed4a6ad5` 再加入 geometry、Structure、item/fluid interaction 模块及其 capability/resource/state/operation。
- 当前未提交 Media 又加入 media module/resource/state/operations，但 evidence 已证明 `78545d87` 的 pre-Media target 同样拒绝，所以 Media 不是首因。

`checkpoint-identity.ts:98` 虽计算 `explicitLegacy`，它只在 V4 embedded composition 分支第 203–212 行使用；V1–V3 分支完全不比较它。于是已知 captured digest 常量仍存在，也会在第 200 行得到 `Legacy gameplay composition identity is not an approved predecessor.`。

## 最窄正确修复

建议新增一个通用、有界、数据式 predecessor 合同，由 Classic 提供精确 allowlist，而不是继续在 stdlib 写 Classic ID/摘要或为当前图追加更多减法。最小形态：

```ts
type GameplaySnapshotPredecessorV1 = Readonly<{
  gameplayVersions: readonly (1 | 2 | 3 | 4)[];
  identity: CompositionCheckpointIdentity;
}>;

type GameplaySnapshotMigration = Readonly<{
  predecessors?: readonly GameplaySnapshotPredecessorV1[];
  migrate(snapshot: unknown, context: GameplaySnapshotMigrationContext): MigrationResult;
}>;
```

- `playbooks/classic` 新增 production-owned 冻结 identity 数据，内容精确等于 captured composition；不得从 `apps/web/tests` 或 `changes/` 运行时读取。`classicRetiredActorsMigration` 声明这一 predecessor及适用 schema，Pack entry digest负责绑定声明代码。
- `resolveGameplayComposition()` 先取得当前 Pack 的 migration capability，再把其有界 predecessor 列表传给通用 guard。建议最多16项、完整 clone/deep-freeze、重复identity拒绝。
- `checkpoint-identity.ts` 只实现通用 canonical exact compare。V1–V3 必须同时具备 host-observed `legacyCompositionIdentity`，且它精确命中当前 Pack声明的 predecessor及对应version；缺失或任一字段/摘要变化都拒绝。绝不能用 `legacy === explicitLegacy`，因为两者若来自同一调用参数，会退化为调用者自我批准。
- V4 使用 snapshot 内嵌 composition作为 observed identity；只允许 current identity或Pack声明的精确 predecessor。Pack migration仅对已批准来源重投影到 current，再由 guard确认最终 identity。现有 target-derived Classic constants应迁出 stdlib；若为控制本次规模而分步，至少本次 kernel-migration lineage不能再依赖 current-target subtraction，并登记余下硬编码前驱迁出任务。
- 当前真实 Browser 创建路径 `authority-worldgen-runtime.ts:35-57` 明确从 options 排除了 `legacyCompositionIdentity`，Persistence record也只保存 gameplay snapshot、generator/provider等字段，没有独立 composition lineage。若产品确实要恢复 V1–V3，必须由受信任的旧 IndexedDB/schema迁移路径选择已知 predecessor并传入；不得相信V3 payload自报，也不得对用户导入的任意V3默认赋予Classic身份。没有这一步，只能声称 codec/integration修复，不能声称真实浏览器旧存档恢复。

## 必需测试范围

1. 保留 `gameplay-registered-needs.test.ts` 当前 `GameServer.restore()` 路径：synthetic V3 + 精确 captured external identity通过，4.4s shared phase在下一0.6s迁到 actor并归零global accumulator。
2. 在 stdlib codec owner补纯 V3 needs phase测试，证明domain transform本身不依赖Classic；它是补充，不替代第1项。
3. guard正例：target继续增加一个无关module/capability时，冻结 predecessor仍可接受，证明不再从target反推。
4. guard负例：缺 external identity、改 manifest digest、改 entry digest、删/改一个definitionMap operation/module/capability/resource/state codec，均在安装 owner前拒绝。非Classic composition不得继承Classic allowlist。
5. V4正负例：精确 captured embedded composition可迁移；一字段篡改拒绝且旧live world保持。保留现有 pre-pointer、pre-Media及retired-actor用例，不用新identity替换旧fixture。
6. `autonomy-restore-capacity.test.ts` 的V3候选必须继续到达actor limit并保持live owner不变，避免identity gate遮蔽真实容量边界。
7. 若接入真实Browser lineage：覆盖受信任旧record→精确identity→恢复，以及未知来源/导入V3拒绝；没有这两条不能宣称产品兼容。

## Root 可执行方案

1. 先由 stdlib owner定义上述通用 predecessor 数据合同与 guard 参数，禁止 Classic常量继续增长；Classic owner新增冻结 source identity并挂到现有 migration capability。
2. 先让 needs与autonomy两条V3测试到达各自原断言，再跑 composition checkpoint 的所有精确identity篡改负例；任何为了GREEN替换 captured identity或删除V3断言的方案拒绝。
3. 单独决定Browser V1–V3 provenance：若旧 IndexedDB lineage可由既有schema/迁移标记可靠识别，则接入 host-observed identity并做产品恢复；若不可识别，明确保留原数据并向用户报不兼容，同时修订当前“V1–V4维持”的文档承诺。不要用通用fallback猜测。

## Findings

### [P1] Target-derived predecessor 会随当前 Classic 图增长而拒绝已冻结的精确旧来源

- 位置：`packages/stdlib/src/server/composition/checkpoint-identity.ts:99-200`；触发链为 `GameServer.restore → GameServerGameplayHost.prepareRestore → GameplayRuntimeCheckpoint.restore → createCompositionCheckpointGuard.validateGameplay`。
- 触发：V1–V3 payload由host附上 captured `e3c1…/924d…` identity，当前 target已新增inventory layout、voxels、Structure/interactions并删除feeding注册；动态逆推候选不再等于冻结captured graph。
- 影响：恢复在needs phase迁移前拒绝；现有明确支持的V1–V3 Classic lineage不可用，但失败保持原子/fail-closed，没有数据静默损坏。
- 规则：PROTOCOL-01、COMPAT-01、冻结迁移 spec “精确旧存档 admission”“默认旧存档继续可用”及当前 docs 的 V1–V4合同。
- 建议：使用Classic-owned有界精确 predecessor allowlist；stdlib只做通用精确比较，不再从当前target减字段猜历史。
- 置信度：高。

### [P1] 当前 Browser product host 无法为无 embedded identity 的 V1–V3 提供可信 lineage

- 位置：`apps/web/src/worker/authority-worldgen-runtime.ts:35-57` 明确省略 `legacyCompositionIdentity`；`PersistenceWorldRecord`只保存 `gameplaySnapshot`、generator/provider等字段。
- 触发：真实浏览器存储中存在 V1–V3 gameplay snapshot并按当前 Classic打开。
- 影响：即使修复单测注入和通用guard，生产Worker仍不会提供外部source identity，恢复将报 identity unavailable；若直接默认允许，则任意V3也会被误归为Classic。
- 建议：只在受信任旧存储schema/迁移路径可证明来源时映射到Classic声明的精确 predecessor；未知来源继续拒绝并保留旧数据。
- 置信度：高（代码路径明确；当前仓库没有证明真实用户V1–V3记录是否仍存在，实际用户影响规模未知）。

Coverage：完成指定 lineage、guard、Classic migration、fixture、needs测试、相关V4 identity负例与Browser host入口的只读审计；未运行测试/build/browser，未审计其他旧Pack。
