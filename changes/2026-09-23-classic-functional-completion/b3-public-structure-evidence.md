# B3 公共 Structure 接线证据

日期：2026-09-24
基线：`ad3f1d5c9298c9fd0dc3f4a6e219d27a1186ebaf`
状态：root 已准出并完成 GIT-05 代码闭包提交；代码提交为 `be0bde7e3ba3ddc228efa93bd005b1b0ed4a6ad5`。

## 范围与 owner

- stdlib 公共组合：把已冻结的 Structure definitions/actions/state/host/runtime 接入 `GameplayRuntime`、`GameplayModuleRuntime`、`GameServer` loaded-only world port 和动态 Authority target port。
- Authority：`interact` target-first 路由、两阶段 Chunk preparation、普通 `begin-break`/计时完成、creative 即时破坏和 commit publication。
- Classic：安装 `classicStructureActionsModule`，规则只在 Playbook 中解释木门朝向、toggle、replaceable 和工具磨损；stdlib/Web 不识别 Classic ID。
- Browser ingress：只授予通用 `seedlands.structure` resource；客户端仍只提交通用 intent、voxel hit/adjacent 和 expected selection。
- B2 FACT、B2 hit gate 和 14 个 direct GameplayRuntime 测试夹具由独立 owner 修改，分别以 `b2-fact-delivery-evidence.md`、`b2-hit-gate-evidence.md`、`b3-fixture-closure-evidence.md` 为准。

未修改 A1 world/fluid 内核、Kernel、Media public runtime/snapshot/Web audio、Lighting renderer、浏览器 E2E、CI 或发布配置。

## 冻结合同

- 只有 composition 声明 `seedlands:structure-actions` 时才构造 registered Structure。声明后缺 `getLoadedCell` 或 `prepareVoxelEdits` 必须在构造期 fail-fast；无 capability 的其他世界保持 `null`。
- Structure definition、geometry、item identity、voxel semantics 和 action policy 全部来自当前 composition。`GameServer`、Gameplay、Authority 和 restore 后的动态 target port 使用同一世界实例，不使用 global 或 Classic storage-ID 分支。
- placement/toggle/break 均先从权威 actor selection、loaded cells 和 registry 解析；Authority 首次解析需要的 footprint/support Chunk，加载后再解析。客户端不能指定 operation、definition、state 或 bearing。
- hit/adjacent 必须正交、在交互范围内并通过双 LOS。placement 的 hit 还必须是当前 composition 中已加载且 `targetable=true` 的体素；该门禁在 public resolver 和 direct registered host 的 prepare/final validate 两层执行。背面伪造命中 fail closed。
- vertical face 不被一概拒绝：合法 top-face 由权威 actor 位置推导 bearing；bottom-face 若实际目标 footprint 被占用则按真实占位失败。
- 两格 world edits、inventory/drop/ECS、break cancellation、dependent removal、receipt、gameplay frontier 和 FACT delivery 先全部 prepare/validate，再按固定顺序同步 apply。FACT delivery 最后发生。
- 每次成功 Structure 写占一个 world revision 和一个 gameplay revision，并在操作前预留两个 Kernel commit slots。失败不得推进 world/gameplay/commit frontier、库存、掉落、Structure cells 或 mining state。
- 普通计时挖掘成功后的 receipt 继续由唯一 Structure owner 持有，再由 Gameplay lifecycle drain；不在已提交后复制到 Block receipt 队列。creative 即时破坏由同步调用显式 acknowledge 后交给 Authority。
- composition 声明 Media 时必须提供真实 dependent-removal owner；无 Media composition 仅能使用显式 non-owner participant，且要求 loaded cell 在 final validate 仍相同、facts 必须为空。

## RED 与修复轨迹

1. 历史 `classic-door-authority-red.test.ts` 初始 `4/4` 准确失败：placement 为 `item-not-placeable`，空手 toggle 落入 `no-selected-item`，batch host 不存在。
2. 公共接线过程中依次得到 `1/4`、`2/4`，暴露 operation input 多余字段和旧测试硬编码 north；改为通用 `{hit, adjacent}`，并按权威 actor bearing 断言实际 east state，基础 `4/4` GREEN。
3. 扩展到 normal mining、creative break、save/reopen 后 `8/8` GREEN；加入 Kernel MAX_SAFE 零写后 `9/9` GREEN。
4. 首次四向表把 actor 放在 hit 背面，得到 `18/19`，进一步真实化后四个背面输入均 `blocked`。按可见面的外侧修正正例，保留四个背面零写负例；最终扩展矩阵 `25/25` GREEN。没有删除 adjacent LOS。
5. 首次跨门/bucket/Station/ingress 组合为 `62/63`：普通 bucket 的 occupied 失败被 Structure dispatcher 抢先改成 `blocked`。修复为 resolver 明确 `not-structure` 后立即回原 item owner；Structure resolved/unavailable/malformed 仍 fail closed。最终组合 `71/71`。
6. product fail-fast 使 14 个直接使用完整 Classic composition、但不提供 Structure host ports 的 domain 测试出现 `33 failed / 14 passed`。独立 fixture owner 改为按被测真实 module dependency closure 组装，显式排除 Structure definitions/actions；原断言不变，最终 `47/47`。没有向通用 `classicOptions` 注入 fake air/no-op ports。
7. direct registered operation 可绕过 public hit gate 的 RED 由 B2-HIT-GATE-01 复现为 `8 failed / 13 passed`；private host 在 prepare/final validate 增加 composition semantics targetable gate 后，相关四套件 `31/31`。

## 最终行为证据

- Classic Authority 门矩阵：`classic-door-authority-red.test.ts` 当前 `25/25`。覆盖 survival/creative 放置、水平四向、合法 top-face、真实 bottom-face occupied、四个背面伪造、air hit、stale selection、持 water-bucket target-first、上下半 toggle、跨 Chunk unavailable 零写、上下半普通计时破坏、cancel、creative break、合法/孤立/三连 legacy、MAX_SAFE advance 零写和正式 save/reopen geometry。文件名保留历史 RED 身份，不表示当前仍失败。
- stdlib Structure 全域：13 files / 135 tests PASS。覆盖 definition/module/multi-edit/operation/action/target、registered runtime、FACT、direct hit gate、public Gameplay runtime、Authority preparation 和 Kernel capacity。
- Classic declarations/policy：3 files / 13 tests PASS。
- 外层交互回归：门、fluid interactions/buckets、item interaction、Structure pack、Station、Browser ingress/secondary input 共 9 files / 71 tests PASS。
- 14 个直接 GameplayRuntime domain fixtures：14 files / 47 tests PASS。`classic-structure-interactions.test.ts` 仅保留 legacy `world.structures` domain 行为，不作为 registered 门证据。
- 格式化后的直接复验：stdlib 7 files / 57 tests PASS；Classic 门 + fluid interactions 2 files / 35 tests PASS。
- non-Classic control：`fixture:gate` 使用自己的 item/voxel/geometry/policy，通过正式 `GameServer.structureTargets.resolve/invoke` 放置；不导入 Classic definitions 或判断 Classic ID。

所有 Vitest 均经默认 `benchmark-window` 全机锁，固定 `--maxWorkers=1`。

## 最终静态证据

- `pnpm --filter @seedlands/stdlib typecheck`：PASS。
- `pnpm --filter @seedlands/playbook-classic typecheck`：PASS。
- `pnpm --filter @seedlands/web typecheck`：PASS；`svelte-check` 0 errors / 0 warnings。
- `pnpm exec tsc -p tsconfig.test.json --noEmit`：最终合并树 PASS。一次带时间戳的复验为 UTC `2026-09-24T12:26:57Z` 至 `12:27:23Z`，cwd 为本 worktree，exit `0`；之后格式化后再次 PASS。
- B3、B2 FACT/hit gate、fixture 全文件 targeted ESLint：PASS。
- 同文件集 Prettier check：PASS。
- `git diff --check`：PASS。
- B3 新增主文件 `todo/skip/pending/.skip/.todo` 扫描：无命中。
- 未运行 build、browser/dev server、WebGL、CI 或 PR review。

## GIT-05 隔离提交验证

基线为 `ad3f1d5c9298c9fd0dc3f4a6e219d27a1186ebaf`。首次把 B2 FACT/hit gate 拆成 7 文件批次后，detached staged tree 的 private suites 返回 `21 failed / 10 passed`，原因统一为缺少本轮公共 `playerInteractionOrigin` 导出；这准确证明该拆分不是可运行闭包。该批次未提交，index 随即恢复为空，临时树已清理。

最终以 55 个精确路径组成一个真实可编译闭包：B2 FACT/hit gate、公共 Gameplay/Authority/Classic 安装、真实门测试和 14 个 direct GameplayRuntime fixtures。验证树为 `/tmp/seedlands-git05-structure`，从上述基线 detached 创建，应用 `git diff --cached --binary` 生成的 patch，并用 APFS clone 提供现有 `node_modules`。验证时间为 2026-09-24 20:43–20:46（Asia/Shanghai）。

完整可重放命令与结果：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
PASS

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/playbook-classic typecheck
PASS

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
PASS；svelte-check 0 errors / 0 warnings

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
PASS

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
PASS

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/structure-definition-v1.test.ts packages/stdlib/tests/server/structure-definition-module.test.ts packages/stdlib/tests/server/structure-multi-edit-model.test.ts packages/stdlib/tests/server/structure-operation-model.test.ts packages/stdlib/tests/server/structure-actions-module.test.ts packages/stdlib/tests/server/structure-target-dispatch.test.ts packages/stdlib/tests/server/registered-structure-runtime.test.ts packages/stdlib/tests/server/registered-structure-fact-delivery.test.ts packages/stdlib/tests/server/registered-structure-hit-validation.test.ts packages/stdlib/tests/server/gameplay-structure-commit.test.ts packages/stdlib/tests/server/gameplay-structure-runtime.test.ts packages/stdlib/tests/server/authority-interaction-preparation.test.ts packages/stdlib/tests/server/authority-kernel-capacity.test.ts --maxWorkers=1
PASS；13 files / 135 tests

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config playbooks/classic/vitest.config.ts playbooks/classic/tests/structure-declarations.test.ts playbooks/classic/tests/structure-descriptors.test.ts playbooks/classic/tests/structure-placement-policy.test.ts --maxWorkers=1
PASS；3 files / 13 tests

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-buckets.test.ts apps/web/tests/integration/runtime/server/composition/classic-item-interaction-red.test.ts apps/web/tests/integration/runtime/server/composition/classic-structure-pack-assembly.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-block-stations.test.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/unit/worker/authority-worker-ingress.test.ts apps/web/tests/unit/client/creative-container-input.test.ts --maxWorkers=1
PASS；9 files / 71 tests

node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/classic-armor.test.ts apps/web/tests/integration/runtime/server/composition/classic-crop-runtime.test.ts apps/web/tests/integration/runtime/server/composition/classic-dungeon-runtime.test.ts apps/web/tests/integration/runtime/server/composition/classic-environment.test.ts apps/web/tests/integration/runtime/server/composition/classic-final-entities.test.ts apps/web/tests/integration/runtime/server/composition/classic-hostile-mechanics.test.ts apps/web/tests/integration/runtime/server/composition/classic-life-skills.test.ts apps/web/tests/integration/runtime/server/composition/classic-navigation-items.test.ts apps/web/tests/integration/runtime/server/composition/classic-progress.test.ts apps/web/tests/integration/runtime/server/composition/classic-projectiles.test.ts apps/web/tests/integration/runtime/server/composition/classic-spawning.test.ts apps/web/tests/integration/runtime/server/composition/classic-special-damage.test.ts apps/web/tests/integration/runtime/server/composition/classic-structure-interactions.test.ts apps/web/tests/integration/runtime/server/composition/classic-vehicles.test.ts --maxWorkers=1
PASS；14 files / 47 tests
```

同一 staged tree 的静态命令如下；`git diff-tree` 从固定代码提交读出本批全部 55 个 TypeScript 路径，因此文件集合可精确重放，不依赖当前 dirty tree。两条均 PASS，`git diff --check` 也 PASS。代码提交的自然 hooks 再次执行同一 55 文件 Prettier/ESLint 与 `ls-lint`，全部 PASS。

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint $(git diff-tree --no-commit-id --name-only -r be0bde7e3ba3ddc228efa93bd005b1b0ed4a6ad5 -- '*.ts')
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check $(git diff-tree --no-commit-id --name-only -r be0bde7e3ba3ddc228efa93bd005b1b0ed4a6ad5 -- '*.ts')
```

## SHA-256 manifest

以下为最终验证后、写本 evidence 前的工作树值。14 个 direct fixture 的逐文件 hash 见 `b3-fixture-closure-evidence.md`；B2 private FACT/hit gate 的逐文件 hash 见各自 evidence，本文列出其最终生产入口。

```text
ede876c9155c39f4720bc1d2ec6a4fe8889ccd19643eee4c25c8175da47ceca4  apps/web/src/worker/authority-worker-ingress.ts
fc4a2b3268b71327a04c9faf4a2337a982258e9f2a840a8e80704b287f44f638  packages/stdlib/src/server/authority/authority-mutation-preparation.ts
ce317bd04db4a55311277e6a94d31bec6a7e976d1f0b60ab6da876d425e5293e  packages/stdlib/src/server/authority/authority-player-action.ts
05c1ed98d3d8a76b852ef3b1be325efee2e47cd4daacc786a61d82e89bdb983d  packages/stdlib/src/server/authority/authority-runtime.ts
ab911366ae1521e2208cec55fc2504360f0dbcb7c5a0b0342ef1232fb0b641eb  packages/stdlib/src/server/authority/authority-session-server-port.ts
5c0f6511db20c5c27b58816fcf0ba42f94d73dfcd8108fc8ac99540dff52089f  packages/stdlib/src/server/authority/authority-structure-runtime.ts
5ab6305a1d57f467d9123cd2933873c60dd1f770089ea6bf66edda8871f184b4  packages/stdlib/src/server/composition/gameplay-actor-authority.ts
ed28c4872c1f28258acbc0d2eeca0233a09a3a4c7e6458fdcbb9b54745745190  packages/stdlib/src/server/composition/gameplay-composition.ts
c37094e888f811d8f83af893bfd09c3cf17f20d67458bcf7c2de24fd7bda3051  packages/stdlib/src/server/composition/mod-api.ts
2685e9b81d0a5c39f372645f1fc7921f5c4b946b693a272c45cc1e7badf2c8f9  packages/stdlib/src/server/game-server-gameplay-api.ts
e295a083bff2be792a283b884de101595f9d30a557977298bdeb508ed5fd5710  packages/stdlib/src/server/game-server-gameplay-host.ts
719a69ad0a3d4353526ef3f35dc59056b71b7242e22b85b8d6aa58a7bccd0ec4  packages/stdlib/src/server/game-server-gameplay-world-port.ts
ee4de746c4c20ab3bda59474f12c361a33c0c8e95e6fe4b5a8dc13b3a12fe97e  packages/stdlib/src/server/game-server.ts
09d3777ac186efa64f9f2dd485381ae6e4a7af5e7db8a8e9ae02dd835b94a057  packages/stdlib/src/server/gameplay/gameplay-geometry.ts
731f185f7b8b9ffaebc53d86be391215505828cfd81080dd5f7f4b5d89c67fdb  packages/stdlib/src/server/gameplay/gameplay-registered-adapters.ts
737a45ae716a2dde960e875ea3cf9a73aea9c32a45761dba535b4724cc065592  packages/stdlib/src/server/gameplay/gameplay-runtime-contracts.ts
53d7d1431693b796e41aff8506dfd8458268c95961448dc0e9a3928ca795dee6  packages/stdlib/src/server/gameplay/gameplay-runtime-lifecycle.ts
ed1fe98ce39c85cdbbb4f6309051ac79f83a53145066efbfbc8ffc2417003976  packages/stdlib/src/server/gameplay/gameplay-runtime.ts
cb2e5fc72bd2b4db4341177b1aa34d3a2835850be7f599aabf934a12f019349d  packages/stdlib/src/server/gameplay/gameplay-structure-commit.ts
0cd51d9268fa2dcc0c86f89f2fedacebc1aa54e0cea337bc5f284013c6d7ad64  packages/stdlib/src/server/gameplay/gameplay-structure-dependent-removal.ts
008d0a7e8d6a4bea1695aa6b0686b06e401dc4a407c3d59adae2997d6b41c443  packages/stdlib/src/server/gameplay/gameplay-structure-runtime.ts
9d2fa1d6b2db4edddb196c06b831fdf2491bffdd85a8c51946c824114a208567  packages/stdlib/src/server/gameplay/gameplay-structure-target-runtime.ts
d538d25d53942741e794f84d1ea430d0e551207796ea98bd846056456ea0b372  packages/stdlib/src/server/gameplay/modules/gameplay-module-runtime.ts
7983b0c837463bcfc561dd638f9c007ab3ca16b0c713bba6bf8d24df8238e2f2  packages/stdlib/src/server/gameplay/modules/registered-block-runtime.ts
36093708af5bca9fa6ca64dd86e73f483a94a991f15f8c0091f2cf30ff15160f  packages/stdlib/src/server/gameplay/modules/registered-structure-runtime.ts
b5800c0e86051bbb16f8bc8e76c9a96e2604f9d81b61615662e618f8056e9389  packages/stdlib/src/server/gameplay/modules/structure-host-commit.ts
a7babd1d53e5f98ebe7fc98fefe1bea933c4a083a84d5a877e61690577d0f2cb  packages/stdlib/src/server/gameplay/modules/structure-target-dispatch.ts
7f403dd6827c173331a6aaae3cc1e90bd48b99c10cf0cd3815ae344b03f5e14a  playbooks/classic/src/pack.ts
89794444d638d29ab64a1a9f1bd72e1c996b3a2af5f0d459e962bb14b825f230  playbooks/classic/src/structure-actions.ts
a06c1f2623c85b58e9f4fa7bc8684a46a8f37af291082f96d79306836eb61b8d  packages/stdlib/tests/server/authority-interaction-preparation.test.ts
2b57dcdea28578ea1e34291b735273d83ab1c746328ca4f885a19057775a09f6  packages/stdlib/tests/server/gameplay-structure-commit.test.ts
771e047209e6356e6b699b5afb46ef19994019ed97a083e74bcfa6c16de9e05d  packages/stdlib/tests/server/gameplay-structure-runtime.test.ts
674bb157c8d81a2e740f6661132e8428c4ba3d81a693f6ef820fbcc0a8947908  packages/stdlib/tests/server/structure-target-dispatch.test.ts
efc55ae05215eb3744dcdf8e470c7fc15ded1d79291f47a8eb4763a0ef8bcb38  apps/web/tests/integration/runtime/server/composition/classic-door-authority-fixture.ts
66d2d74c8457d5ca1650978146e3f9f8102a568b54d33964a697424201ae2ba2  apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts
bcbecc89d44492ea326296dcdbd1e46942c1256a2b4d8ef805c86da1db0866c6  changes/2026-09-23-classic-functional-completion/b2-fact-delivery-evidence.md
490e7b80b597fb61e1fe1f5e2600615942bc35c20eb816ed92684bcf39fc2515  changes/2026-09-23-classic-functional-completion/b2-hit-gate-evidence.md
d9cb24a58d5611c3ece76519163fa14554c7ad4bb770d53dc3f97ad1d11458f8  changes/2026-09-23-classic-functional-completion/b3-fixture-closure-evidence.md
```

## 明确未完成

- 未做真实浏览器键鼠门旅程、WebGL mesh/collision 观察或 Cua；因此不宣称“浏览器可玩”或 V1.9 完成。
- Media runtime、FACT projection、V4 optional media snapshot、Pack MP3 和 Web Audio 尚未公共接线。本阶段只保证无 Media composition 的 Structure removal 不吞 facts；真实 Media dependent removal 仍需下一公共阶段安装。
- 本阶段只完成木门，不扩 bed/trapdoor/ladder/route/transport，也不完成 194-item 全矩阵。
- 未运行 production build、全量测试、CI、PR review 或 Cloudflare preview；这些属于后续统一验收。
- 当前工作树仍有 Media、Lighting、保护清单和其他已分配修改；GIT-05 必须在隔离 staged tree 上验证精确依赖闭包，禁止 `git add -A`。
