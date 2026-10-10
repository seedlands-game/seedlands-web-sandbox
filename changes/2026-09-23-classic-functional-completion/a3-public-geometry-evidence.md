# A3.3 公共 Geometry 接线证据

日期：2026-09-24
基线：`7e57f2e5452bec7e10945baf4f12f5f40a5df0f7`
范围：将 A3.1 的 per-composition voxel geometry capability 接入真实 Classic Pack、Structure definitions-ready closure、GameServer/Gameplay/Authority、AuthorityReady/mesh payload、Worker/Web 和 PlayerController。

## 冻结合同

- `voxelGeometryForComposition()` 是唯一 composition 解析入口。每次 assembly 拥有自己的 registry；没有 capability 时返回 `undefined`，继续使用 legacy `0..88` geometry。
- `GameServer` 从当前 composition 解析一次 registry，并把同一实例交给 Gameplay、Authority collision、creative landing、placement occupancy 和 post-commit recovery。没有 global setter 或 Classic storage-ID 分支。
- Browser worldgen preparation 保留同一 registry。显式传入 `AuthorityRuntime` 的 registry 必须与当前 composition capability identity 相同，否则在创建 GameServer 前 fail-fast。
- AuthorityReady 和 mesh payload 只投影 frozen JSON-compatible descriptor；Browser 在替换 ready/world/cache 前验证 semantics closure。非法 restore 保留旧 registry、旧 runtime epoch 和旧控制状态。
- `PlayerController` 每次构造 collision query 时从当前 `World.authority` 读取 semantics/geometry；restore 后不会持有旧 registry。
- `registered-structure` definitions-ready 必须取得 geometry capability，且每个 state/part descriptor 都存在；descriptor collision 与 Structure state、voxel semantics 一致，render material 属于该 voxel。legacy `52` 继续走兼容解析，不要求注册 descriptor。
- Classic Pack 安装 geometry module 和 Structure definition module，使 `89..104` 全部进入真实 composition。B2 operation module 不在本阶段安装。

## RED

首次运行 Web composition 两个用例：2 files / 3 tests，2 failed / 1 passed。

- 真实 Classic Pack 没有 `STRUCTURE_DEFINITIONS_CAPABILITY`。
- Browser worldgen preparation 没有输出 composition geometry。
- 无 geometry capability 的 legacy compatibility 用例已通过，不把 collection/import failure 当 RED。

首次 stdlib public consumer 集合：7 files / 45 tests，2 failed / 43 passed。两项均为旧 fixture 不满足新 definitions-ready closure：一项 descriptor material 未包含于 voxel semantics，另一项 legacy collision 负例未安装其声明所需 geometry capability。修正 fixture 后 45/45 通过，未放宽生产校验。

## GREEN

所有 Vitest 命令均使用默认 `benchmark-window` 全机锁和 `--maxWorkers=1`。

1. A3.1/A3.2/A3.3 stdlib 完整定向集合：10 files / 66 tests PASS。覆盖 registry、Structure closure、Authority collision/ready/mesh、player occupancy、model/mesh 和 legacy fallback。
2. Web/Worker/Classic composition 完整定向集合：13 files / 56 tests PASS。覆盖真实 Classic Pack assembly、两个相同 storage ID `500` 的非 Classic registry 隔离、错配 registry 启动拒绝、AuthorityReady/mesh、Browser/Worker mesh、item/debug consumer、restore 和 PlayerController。
3. Classic declarations/descriptors：2 files / 8 tests PASS。
4. 职责提取后直接回归：stdlib 4 files / 22 tests PASS；Web 4 files / 17 tests PASS；最终 composition 2 files / 4 tests PASS。
5. `@seedlands/stdlib` typecheck：PASS。初次准确暴露 `GameServerGameplayWorldPort` 缺少 `voxelGeometry`；修复后通过。职责提取后的两处纯类型错误也在最终检查前关闭。
6. `@seedlands/web` typecheck：PASS，`svelte-check` 0 errors / 0 warnings。
7. `@seedlands/playbook-classic` typecheck、`typecheck:classic`、`tsc -p tsconfig.test.json --noEmit --pretty false`：全部 PASS。
8. 精确路径 ESLint：PASS。首次报 `authority-runtime.ts`、`authority-session.ts`、`gameplay-runtime.ts` 超过 500 effective lines；已通过窄 geometry adapter 和 landing factory 职责提取关闭，没有禁规则或压缩测试。
9. 精确路径 Prettier、`git diff --check`、`TODO/FIXME/.skip/.todo/as any` 扫描：PASS / 无命中。

## 行为证据

- 两个独立 composition 均注册 storage ID `500`，分别产生 west-thin 与 east-thin geometry；Authority、mesh payload 和真实 TypeScript Worker mesh 输出互不污染。
- west composition 携带 east registry 时，`AuthorityRuntime.create()` 在 world 创建前拒绝；有效 Browser preparation 传递的是当前 composition capability 的同一实例。
- 同一个 voxel 在 blocking/open 两个 composition 中分别影响 Authority 下落、placement occupancy 和 post-commit recovery；缺 capability 的 legacy composition 不输出 geometry projection。
- Browser restore 接受合法新 projection 后清理旧 prepared mesh；非法 sparse geometry restore 被拒绝，并保留上一个 registry 与 runtime epoch。
- 同一个 `PlayerController` 在 world geometry 从 open 切为 blocking 后，碰撞查询立即使用新 registry。
- Classic assembly 同时暴露 Structure 和 geometry capability，`89..104` 每个 variant 有 descriptor；closed collision 非空，open collision 为空。

## 明确未完成

- 本阶段没有安装 B2 Structure operation module；放置、上下半 target toggle、跨 Chunk 两格事务仍由后续公共 B2 接线完成，不能宣称门已可玩。
- 未运行 build、browser/dev server、WebGL shader/像素、Cua、save/reopen、全量 deterministic、CI 或 PR review。生产 WebGL 与真实浏览器门旅程仍是后续验收。
- 本阶段不修改 A1 world/fluid 内核，不接 Media/Lighting，不将 geometry 写入 deterministic save；descriptor 由已验证 Pack identity 在 restore 时重建。

## 文件 SHA-256

以下 hash 是最终验证后的工作树值；部分公共文件含并行已冻结的 A2/V1.2 增量，GIT-04 必须按依赖闭包和 hunk 精确暂存，不能整仓 `add`。

```text
45aa89be02583b76bcd2415d66ad0e35f5d3bf8a80a6781e1b9e946cf36f0d03  packages/stdlib/src/server/authority/authority-runtime-geometry.ts
4398357395638931fd7a0a7e13b99b12a8f163efb23596a375dde2bc011637ce  packages/stdlib/src/server/authority/authority-ready.ts
b6451b35109881a94f2e0909d47a81e91ef6ff344d46c2773e25d0955becdc93  packages/stdlib/src/server/authority/authority-runtime-options.ts
6a42e4e89c1f69826fc571e8c8823216e38a1c070b5a3dc216acda5a0b454f3b  packages/stdlib/src/server/authority/authority-session-options.ts
99300425b4e29c8d443218534ec46e033f845f0cb4b57050b2db850d0d12f5a2  packages/stdlib/src/server/authority/authority-session.ts
4836a8cc03e04e7684cc40d03918b9890da8bef76da312cbb92e2b3dc8fc9a7a  packages/stdlib/src/server/authority/creative-physics.ts
2cb4b398a824cb02227117a26dabc048317ba73529791cf677c201ea6607f44b  packages/stdlib/src/server/authority/authority-runtime.ts
2a7a57adc1258ed431abd8e84e2d3b3f002799011fb37fd57a8dc9644a907305  packages/stdlib/src/server/game-server.ts
e23b990047f777ab544ecbd3c37dc4c321e10244ec73dc6d7c1895c43a2c0828  packages/stdlib/src/server/game-server-gameplay-host.ts
cb551492c66518994ab27c1e3ee3f02fa25a3550dbae49cdecee7aca7f500f2d  packages/stdlib/src/server/game-server-gameplay-world-port.ts
2694d671527aac9c46e1904975363688f6bc6aaa008f481d50fc917dac3a3683  packages/stdlib/src/server/gameplay/gameplay-domain-adapters.ts
cc8bc65ae9296073f2fa4a23f2e13dc415086925d26dc7b5ac750e422db34b91  packages/stdlib/src/server/gameplay/gameplay-mode-landing.ts
bb2636767c03b2cb318f910001ee5a0ce5c31e8b41a12aadeb07fc53ff2e399a  packages/stdlib/src/server/gameplay/gameplay-runtime-contracts.ts
f2ba7cd58cf785435299c8387cd9cf586c0799091281bb99448de65db3629e9c  packages/stdlib/src/server/gameplay/gameplay-runtime.ts
4346c669aed049cf434871de76026ae4e409e2a0a789253c0c51b9b7d1cd0a4b  packages/stdlib/src/server/gameplay/modules/block-interaction-runtime.ts
099024504897642955b436c5e6ffd0a4d70de05c2194f1a5b4ca4bb3e3826192  packages/stdlib/src/server/gameplay/modules/block-host-commit.ts
8b0eba2584e519fcc3c2a37ebe2f08b0f2a2d20417764d09dccbd2a1348ed82f  packages/stdlib/src/server/gameplay/modules/voxel-geometry-module.ts
37a7560fe80b2c6889a33f6c05cc08f190588108def5613e3c0e6bc9d474dbd8  packages/stdlib/src/server/gameplay/modules/structure-definition-module.ts
25cea37507babfb7ba70f10f2055b95532ac31088aef8a141ba752be72061f38  packages/stdlib/src/server/composition/mod-api.ts
62be12efd1f5159cd35f3ec58941e230386420bb98650ada1f857fc92dd10ee0  apps/web/src/worker/authority-worldgen-runtime.ts
cf5d64a29b7462ccb13edd3dcf42e5f77872ee37afc4b91fb9c092f951363dbe  apps/web/src/app/player/player-controller.ts
342662576c76ada82e1eb9228243db0d680dcbbfeae9ed59ade5bd76bb8cfa1e  playbooks/classic/src/pack.ts
86f239ba0ff0df2227cf90c5d4332a09c379d73babc4a0a9f19f7996d3691c6f  apps/web/tests/integration/runtime/server/composition/classic-structure-pack-assembly.test.ts
68f058941c0e0e6ecfee89552c543f55dab27a086d99c7cf4416eaea67797ccb  apps/web/tests/integration/runtime/server/composition/geometry-capability-integration.test.ts
af7c3f4d35362e70fb2de6203723ec186d93b2727ee1620bab42182d13e2fb84  packages/stdlib/tests/server/structure-definition-module.test.ts
45aee07cf7c869d445674422617b8f5223afe7779128825e04d61a4f64542004  playbooks/classic/tests/structure-declarations.test.ts
815ccfe2e0a4dc8740f490e6a49df8ca03674d999c56cae312c7e5d004f85fc7  apps/web/tests/unit/app/player-input-gates.test.ts
```

A3.1/A3.2 consumer 文件的最终验证 hash 分别保存在 `a3-geometry-evidence.md`、`a3-authority-geometry-evidence.md` 和 `a3-web-worker-geometry-evidence.md`；本文件不重复伪装其 ownership。
