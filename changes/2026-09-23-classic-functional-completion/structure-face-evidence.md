# V1 Structure 命中面服务端证据

状态：`V1-STRUCTURE-FACE-CLOSE-01` 实现与定向服务端验收已获 root 准出，交 `GIT-14-STRUCTURE-FACE` 合并。Owner：Paseo `4a5710a7-3644-43f3-a42a-5647711ac047`。行为、类型与源码静态检查的有效运行时间为 2026-09-25T03:14:21.745Z 至 2026-09-25T03:38:51.577Z（UTC）；最终文档格式与完整 scoped diff 检查持续至 `03:41:48.719Z`，不扩展行为验收。

## Browser-06 事实与实现

- Browser-06 diagnosis 路径为 `evidence/v1-canonical-browser-06/diagnosis.json`，SHA-256 `4fef2ba0d25395c44a04e195c662f64f96e5136eacf3dd1e10e5edf4a944d0e2`。source `5d52330fa58d315e9e10b1298e1bdc65e2321898`，artifact `a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02`，window `e9b56811-33d6-4f8d-aefc-036a17d076e0` FAIL。C0-C3、water place/pick、正式 UI 切生存、落地、走到门与 visual PASS；木门真实右键 `hit=[70,30,0]`、`adjacent=[70,31,0]` 后 Authority 返回 `blocked`，world revision `141` 不变；门两格、Media、save 未触达。
- 独立核对 `apps/web/src/app/game-harness.ts:252-254`：`serverPlayerPosition` 在 authority body y 上加 `PLAYER_FEET_OFFSET`。证据值 `[67.35381531679855,32.600001,0.6452957045056721]` 是 eye；正式 fixture 使用 body `[67.35381531679855,31.000001,0.6452957045056721]`，没有重犯 Browser-03 的 eye 再加 1.6。
- 内部 `gameplay-geometry.ts` 新增 `voxelAdjacentFacePoint`，计算 `hit center + (adjacent-hit) * (0.5 + 1e-6)`；未加入 package/mod-api 公共 export。Structure dispatcher 与 registered host 初次/final revalidation 同步使用该点作为 hit LOS endpoint；adjacent center LOS、hit/adjacent center 各 5 格、ownCells、loaded/targetable、authorization、selection、support/occupancy 与事务重验保持。
- `item-interaction-module.ts` 只删除等价局部实现并复用 helper；fluid policy、Classic binding、manifest、协议和 global `traceVoxelRay` 未改。

## RED

Authority RED 精确 argv：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts --maxWorkers=1 --reporter=json -t 'Browser-06 door'
```

window `b751dc08-591c-4608-9eb6-0e74fa3b2c38`，UTC `03:15:28.392Z..03:15:30.439Z`，exit 1。receipt 原字节副本 `authority-red-performance-window.json.log` 与源 SHA-256 同为 `3c1134c11c9c5ebfd0d00cebad1dcd7c06bb78cbe91a2d80deebeb127fbad088`。工具侧 stdout 仅是 excerpt：唯一用例在新测试第 35 行失败，实际 `success=false/reason=blocked` 对比 success 期望，其余 25 项因 `-t` 跳过；不将 excerpt 冒充完整 JSON，也没有仅为补日志重跑。

direct registered host reason RED 精确 argv：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/registered-structure-hit-validation.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-structure-face-close-01/direct-host-red-full.json -t 'Browser-06 exposed'
```

原 argv 的 outputFile 为 `direct-host-red-full.json`；归档时仅改名为 `direct-host-red-full.json.log` 以避免格式化 hook 改写原始字节，SHA-256 仍为 `cf4479d9aeb0dbfdddb244cbddd64615d2a73ac2cbcf9750b761fc6d3c8f6c37`，明确实际返回 `ok=false/code=OPERATION_FAILED/message=blocked`。window `c2a0220f-7772-4d21-9de9-36d2fc933236`，UTC `03:18:28.331Z..03:18:30.113Z`，exit 1；receipt 副本 SHA-256 `be5a7dfce5c67b9115e517d369da4a1582aed73ad4735be7f31fac130905547b`。更早的 `direct-host-red.json.log` 只是 excerpt，不单独证明 reason。该 RED 绕过 dispatcher，证明 host 必须同步修复；success 断言失败后未虚构后续零写断言已执行。

## GREEN 与失败归因

Structure 核心精确 argv：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/gameplay-geometry.test.ts packages/stdlib/tests/server/structure-target-dispatch.test.ts packages/stdlib/tests/server/registered-structure-hit-validation.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-structure-face-close-01/stdlib-structure-green.json
```

- 首轮 window `5adeca3a-739e-4d83-9200-9cddf304384c` 为 `43 passed / 2 failed`，完整输出保留为 `stdlib-structure-first-attempt.json.log`。一项是负 X IEEE-754 表示的 exact equality，改为 12 位近似断言；另一项 fixture 用 `server.edit` 加墙同时推进 revision，先触发 `Structure projection observation is stale.`，见 `host-final-validation-stale-diagnostic.json.log`。两项均为测试表达/夹具问题，不是 production 回归。
- final-validate 改用既有 `cellOverrides` 改 readCell 而不推进 revision；window `5d92ba39-ee21-4185-965e-4029bcf52a2b` PASS，证明 prepare 后新增 LOS 墙在最终 revalidation 返回 `blocked`，Structure world/gameplay/inventory/receipt/fact/participant 零写。
- 最终 window `12f59f60-6b9e-4b0c-9326-f8a3b2ea6e8e`，UTC `03:27:46.992Z..03:27:53.459Z`，`45/45 PASS`。完整 JSON SHA-256 `11b734f5db7395a4555fc4a1a6ddd2fbc0a0503d6f0c5c4d12dc1df0ba646407`。覆盖六方向 helper、非 Classic direct host、dispatcher fallback/ownCells/unknown/range/non-orthogonal/wall、四向 placement、existing 上下 half、actor/world stale、初次/最终 LOS 和多参与者原子失败。

Classic Authority 精确 argv：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-structure-face-close-01/classic-door-authority-green.json
```

最终 window `d599c859-fb99-4b9a-a987-0b862156d77b`，UTC `03:37:17.446Z..03:37:24.382Z`，`26/26 PASS`；JSON SHA-256 `6fc57efa50f9dd4c84e916da3537d00b6f8cacb76d8f4460271bb16c20c391a4`。Browser-06 body/floor fixture 原子写 lower `[70,31,0]` 与 upper `[70,32,0]`，response commits 1、mutation count 2、inventory revision +1、world/gameplay revision 各 +1、commitSequence +2，木门被消费。全文件还覆盖四向/top、support/occupied、背面、air/stale、existing 上下 half/ownCells、跨 Chunk unknown、break/toggle/cancel/save 与失败零写。

本段三条 GREEN 命令的原 argv outputFile 分别为 `stdlib-structure-green.json`、
`classic-door-authority-green.json`、`fluid-security-regression.json` 和 `classic-fluid-regression.json`；
归档时仅追加 `.log` 后缀，内容与已核 SHA 不变。`host-final-validation-diagnostic.json` 同样只归档为
`host-final-validation-diagnostic.json.log`，没有格式化或改写。

item/fluid 等价提取回归精确 argv：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/item-interaction-security.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-structure-face-close-01/fluid-security-regression.json
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1 --reporter=json --outputFile=changes/2026-09-23-classic-functional-completion/evidence/v1-structure-face-close-01/classic-fluid-regression.json
```

security window `911652fa-bd79-4168-8ba3-b04d48c5db52` 为 `26/26 PASS`；Classic fluid Authority window `8e5805f0-1c15-49de-8841-2754358f496f` 为 `15/15 PASS`。这只证明 helper 提取等价，不把既有 fluid 能力重新归因给本任务。

## 类型与静态验证

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit --pretty false
```

stdlib type window `bd16815b-e96b-4161-80be-27528903d609` PASS；root test type `9c5c0a8a-1009-4270-87d6-d0c6a5a1ee56` PASS；最终 Classic test type `a2f85343-f216-48b0-abff-58660baafac2` PASS。定向 ESLint `0c3b468b-43db-4e01-a48a-b6ce165fdd53` PASS，Authority 测试最终增量 ESLint `da6d6861-402e-41ab-a420-f7c6821c2ac5` PASS。

首次 Prettier check `041f0fb4-fb2e-49f7-980c-a9f5bd70788c` 只报新 helper test，定向 write `9b4b9227-90d1-4bc1-803e-244de34b6a73` PASS；最终本域 Prettier `1fb8ca2e-5328-446e-8342-e156258d7c88` PASS，Authority 测试最终增量 Prettier `d035bc51-eae2-4802-9955-bca073088085` PASS。最终 scoped diff check `d262dfd4-023d-43ef-80c0-4078992e53ab` PASS。所有列出的 window receipt 均从真实 `harness/results/performance-windows/<runId>.json` 按原字节复制到 evidence 目录，逐份 source/copy bytes 与 SHA-256 相等。

最后两份原始 receipt 已在 GIT-14 开始时补归档：文档 format window `4e97e060-e403-407b-9bd0-c73c307e8ea9` 为 `PASS/exit 0`，source/copy SHA-256 均为 `b811a161dee3077554660ba082bf048b86fbcb4b7055f05682df68b5a1768f3a`；最终完整 diff window `ba82957f-b381-4ebd-af86-b629c5098736` 为 `PASS/exit 0`，source/copy SHA-256 均为 `db991542a000454ac474dc68b38b066b28a5695ed4fc1210c4c9e8d4cc80f678`。两份副本分别为 `document-format-final-performance-window.json.log` 与 `complete-diff-final-performance-window.json.log`。

## GIT-14 隔离合并门禁

唯一 Git writer 从 `dead94f56771d40e45e9ebf4c3fee9a30c9bf12c` 构造 57 路径 detached staged tree，
binary patch SHA-256 为 `d8c8aa06e0982e40552f9042b92261c703e88ebe8f02c66a8d68fc8fb80f5a99`；
根与 package 级 `@seedlands/*` 均物理解析到隔离树自身源码。下列命令均使用默认机器锁，Vitest
固定 `--maxWorkers=1`，原始 receipt 在临时树清理前逐字节复制到本 evidence 目录：

- Structure core `4 files / 45 tests PASS`：window `ee8ea95d-ba38-415a-8bf3-6927265d944c`，SHA-256 `8030cc5e5a192dcec90e5138b549f9458a3f12bc5004b6f4aa255d431b862eac`；
- Classic door Authority `1 file / 26 tests PASS`：window `43f18b68-478e-46e8-958e-c112ed466aa8`，SHA-256 `19b807967473846666ecc246b9a28f57f566c9084669bbb2ccbedb080ae4c8b3`；
- fluid security `1 file / 26 tests PASS`：window `123524b5-9412-414e-8166-5871acc5cc45`，SHA-256 `790a9ea03f95e5ac30125161706434f5c79445d4dde60db29a1f734dc109cbab`；
- Classic fluid Authority `1 file / 15 tests PASS`：window `eda6e7d4-5434-4f67-96e8-86f172345732`，SHA-256 `be276b08efced814e0ed0755b3c96c30c0980db5f20a2582424b50a57f4564e1`；
- stdlib typecheck：window `662d3158-5439-48fb-881c-08197b5f4eb3`，SHA-256 `f85f30120aa651f0749de8e6ab1be422cd390bdbc531d673633cbbdc57d264fe`；
- root test typecheck：window `0f775a85-ebef-48ee-8797-3b61b75add5c`，SHA-256 `76900dc2e223df876796b22c9e660b42f10a565cb2104ffc41f8e73e686f450a`；
- Classic test typecheck：window `72f97354-be29-4bb4-9bd6-c44566ed1845`，SHA-256 `ebb2100beab538b7e09b8c12134c00b49b3ef846ad67b431e170cdbc275bab93`；
- 7 个实际变更 TS 的 ESLint：window `e8f08a1c-ffb5-4647-9b7f-e9be6f013e06`，SHA-256 `5737443610000d2b96c51edf594f1ec58e81cbb81e9ae555fd636776f41749ee`；
- 7 TS 与可格式化 change 文档的 Prettier：window `db584a54-7cc7-4bcd-8f33-6f32e7e192a2`，SHA-256 `92382e3ff5f48bd4bc951fae6154f823282eee03e96eb28104065dc237660342`；
- 非原始证据 scoped cached diff：window `67343e59-f328-4a64-92db-335b2bb11ba8`，SHA-256 `9a985c9f2e9a4e5a9700aa9ee959d28fa783eb5abf9d57196302a7dad7ce331f`。

全部 10 个 window 均 `PASS/exit 0`。Browser-06 error context、trace、截图、测试 JSON 与所有
`*.json.log` receipt 未进入 formatter，保持原始字节。

## 文件身份与未覆盖

生产与测试文件的最终 SHA-256 在 checkpoint 读回并报告；本 evidence 自身 hash 也由 checkpoint 给出，避免自引用。长期 docs baseline 未更新：本次是当前 change 冻结范围内的窄服务端几何修复，没有改变长期架构或治理规则。

未运行 build、browser、Cua、dev server、CI、Git commit/push、全量 deterministic 或完整 Classic headless。本阶段只证明服务端两层 Structure reachability；真正门 mesh/collision/toggle、Media、C4/C5、save-return-continue 的产品 GREEN 仍需 root 准出、唯一 Git writer 提交、新 clean artifact 与唯一 Browser-07。Browser-06 的门两格、Media 与 save 仍是 NOT REACHED；不得以本地 Authority GREEN 宣称产品可玩、Browser GREEN、合并 GREEN 或可发布。
