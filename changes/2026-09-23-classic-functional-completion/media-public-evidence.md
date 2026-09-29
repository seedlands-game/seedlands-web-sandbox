# Media Public 服务端与 Pack 证据

更新时间：2026-09-24T16:55:00Z

状态：**candidate GREEN，等待 root 独立读回与准出；不代表浏览器真实出声、完整 CI 或整项 Classic 完成。**

## 冻结合同

- stdlib 只提供可组合的 `MediaPlaybackModuleV1`、单槽设备状态、prepared host transaction、V4 optional child、权威 projection/fact 协议和有界 drain；不知道 jukebox、record 或音频 bytes。
- 实例身份固定为 `worldEpoch + position + definitionId`。外层 `AuthorityResponse.epoch` 是 Worker session，batch `worldEpoch` 是 runtime world epoch，两者不要求相等。
- 正式 drain 唯一签名为 `AuthorityRuntime.takeMediaFacts(worldEpoch): readonly MediaPlaybackCommittedBatchV1[]`，保留每次已提交事务的 batch 边界；projection 与 fact 使用独立消费游标。
- `MediaPlaybackProjectionV1.resource` 必填且与 slot 同为空/同存在；resource 是 `{ packId, path }`，由当前 composition 的 track 定义派生，不进入 durable snapshot。
- Classic `record-13` 绑定唯一 `seedlands:to-far-shores`；jukebox 的 `playOnInsert: true` 由可信 Pack 定义解释，普通 interact 一次提交 insert+playing intent。客户端不提交 operation、track 或策略。
- inventory、media state、gameplay revision 与 fact delivery 全部先 prepare/validate，再同步 apply；普通 Block/Structure 破坏的媒体 removal 与 world/drop/gameplay/fact 同一事务，fact 最后发布。
- epoch 内使用单一、有界 `generation` 高水位：同位置同 definition 破坏重建后的新 fact revision 严格大于旧 eject；不保留按历史坐标增长的无界 tombstone。高水位耗尽在 prepare 前拒绝并保持零写。
- 完整 projection 是当前实例集合。服务端维持单调 revision 前提；Web 的 absence/revision/epoch admission 见已由 root 窄准出的 `media-web-public-evidence.md`。
- 有状态或保留 revision 的媒体实例所在 canonical Chunk 通过 `media` residency owner pin；普通 eject 后仍保留实例 revision，真正破坏删除 entry 后解除 pin。

## 保存与精确前驱

- V4 只保存 `{position,snapshot:{deviceId,revision,slot,playingIntent}}`；不保存 resource、URL、bytes、cursor、AudioBuffer。恢复为 `playing=false,resumePending=true`，不重放旧 facts。
- restore 先解码完整候选并收集 media Chunk，加载候选 Chunk 后校验 voxel/device，再一次替换 live world；坏 schema、缺 track、device mismatch 或 composition mismatch 都保持旧世界。
- 从 detached HEAD `78545d877ed08ee0613a690ff53e36b0c2120b69` 实际构建 pre-Media Classic Pack：manifest `8c85965878299e56d918bdc89302789d38a26d3a04a1d924fe4e885daca3fae4`，entry `9a22f2d679b8a00bba8a66658457de477c1b05500cf353fb7ed368c6d69bf12a`，presentation `a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b`。
- detached baseline 的完整 canonical identity 与“当前 identity 精确移除 Media module/capability/resource/state/operations，再换入上述 Pack lock”的 canonical SHA 均为 `9f37a3280709cfde8454eeaea77b39efd0d0b01c694e8d5145ea6de4992b9269`，机器比较 `equal=true`。迁移仅接受该精确前驱；相邻 operation 篡改仍拒绝。

## Pack 与资产

- 最终临时构建目录 `/private/tmp/seedlands-media-final-pack-2`；未更新 `apps/web/public/packs`，未运行完整 product build。
- manifest SHA-256：`14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3`。
- entry SHA-256：`4f8cdb6d191a7111d14666a7d38dd778565bb811585c66b87a3ee9e47c414741`。
- presentation：`720` bytes，`application/json`，SHA-256 `a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b`。
- MP3：`2,976,045` bytes，`audio/mpeg`，SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。许可按 `ASSETS.md` 记录为用户提供、unknown；没有外传。
- lock resource exact keys 为 `path/sha256/size/contentType`；Node/Web loader 分别验证 shape、digest、size、MIME 与路径边界。音频独立 loader 的上限不放宽 presentation/image/GLB 限额。

## RED 与修复

- 非 Classic Authority 初次到达 Media owner 时曾因缺正式 state port/actor grant失败；改为 composition 驱动安装和条件授权后 GREEN。
- V4 restore 初次在候选 Chunk 加载前读 live world，得到 `media-device-unavailable`；改为 schema/model 预检后延迟到候选 Chunk 完成时校验，坏档仍在 live world 替换前失败。
- Classic 初次装配因 jukebox target 使用非注册 ID失败；改为真实 `seedlands:classic/jukebox`。
- 同位置重建初次产生 rev1，不大于旧 eject rev2；改为 epoch 内单一 generation high-water，新增真实 Authority 破坏/重建回归。
- root-test typecheck 捕获 runtime options 错误要求外部 `prepareFactDelivery` 和旧测试字段；改为 fact queue 单 owner。
- targeted ESLint 首次报告 5 个 `max-lines`；将 wire validator、Gameplay Media facade、restore type、metadata accessors和测试 fixture按职责提取，未加 lint disable。三组最终子进程和 wrapper 的结果分别记录在下文，不能用无 receipt 的挂起运行替代。
- 扩展 12-file Classic composition 扫描不是准出集合；完整命令、工作树状态和失败归属见下文。其余失败**尚未归因**，不能称为历史债务或 Media 回归；探索改动已全部撤回，不能通过放宽 Media Pack lock或 owner fail-fast使其通过。

## 最终验证

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/media-playback-model.test.ts packages/stdlib/tests/server/media-playback-module.test.ts packages/stdlib/tests/server/media-playback-host-commit.test.ts packages/stdlib/tests/server/registered-media-playback-runtime.test.ts packages/stdlib/tests/server/media-dependent-removal.test.ts packages/stdlib/tests/server/gameplay-media-fact-drain.test.ts packages/stdlib/tests/server/chunk-residency.test.ts --maxWorkers=1` -> `7 files / 43 tests PASS`。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/classic-media-authority.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-block-actions.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-buckets.test.ts apps/web/tests/integration/runtime/server/composition/classic-door-authority-red.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-block-stations.test.ts apps/web/tests/integration/engineering/pack-integrity.test.ts --maxWorkers=1` -> `7 files / 76 tests PASS`。
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/playbook-classic test playbooks/classic/tests/media-declarations.test.ts --maxWorkers=1` -> `1 file / 3 tests PASS`。
- `pnpm --filter @seedlands/stdlib typecheck`、`pnpm --filter @seedlands/playbook-classic typecheck`、`pnpm --filter @seedlands/web typecheck`、`tsc -p tsconfig.test.json --noEmit`、`tsc -p tsconfig.classic-tests.json --noEmit` 均在默认 benchmark lock 下 PASS。
- Targeted ESLint 分三组在默认 benchmark lock 下运行；完整 argv 与 child receipt 见下文，三组 child exit code 和 wrapper exit code均为 `0`。
- 精确文件集 Prettier PASS；`git diff --check` PASS。

### ESLint 可重放证据

三组都使用：

```text
SEEDLANDS_CHILD_RECEIPT=<receipt.json> node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- node /private/tmp/seedlands-run-command.mjs node node_modules/eslint/bin/eslint.js <files...>
```

临时同步 runner 的行为为 `spawnSync(command,args,{stdio:'inherit'})`，然后将 `{startedAt,endedAt,command,args,exitCode}` 写入 `SEEDLANDS_CHILD_RECEIPT` 并以同一 exit code退出；临时 runner/receipt 已在 checkpoint 前删除。以下 JSON 是删除前读回并持久化在本 evidence 中的完整 child receipt：

```json
{
  "group": "core",
  "startedAt": "2026-09-24T16:42:39.354Z",
  "endedAt": "2026-09-24T16:42:40.882Z",
  "command": "node",
  "args": [
    "node_modules/eslint/bin/eslint.js",
    "packages/stdlib/src/server/gameplay/modules/media-playback-model.ts",
    "packages/stdlib/src/server/gameplay/modules/media-playback-wire.ts",
    "packages/stdlib/src/server/gameplay/modules/media-playback-module.ts",
    "packages/stdlib/src/server/gameplay/modules/media-playback-host-commit.ts",
    "packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts",
    "packages/stdlib/src/server/protocol/media-playback-protocol.ts",
    "packages/stdlib/src/server/protocol/authority-worker-protocol.ts",
    "packages/stdlib/src/server/gameplay/gameplay-media-commit.ts",
    "packages/stdlib/src/server/gameplay/gameplay-media-facade.ts",
    "packages/stdlib/src/server/gameplay/gameplay-media-runtime.ts",
    "packages/stdlib/src/server/gameplay/gameplay-media-target-runtime.ts",
    "packages/stdlib/src/server/gameplay/gameplay-runtime-metadata.ts",
    "packages/stdlib/src/server/gameplay/gameplay-runtime.ts"
  ],
  "exitCode": 0,
  "wrapperExitCode": 0
}
```

```json
{
  "group": "host",
  "startedAt": "2026-09-24T16:42:58.390Z",
  "endedAt": "2026-09-24T16:42:59.306Z",
  "command": "node",
  "args": [
    "node_modules/eslint/bin/eslint.js",
    "packages/stdlib/src/server/authority/authority-media-runtime.ts",
    "packages/stdlib/src/server/authority/authority-gameplay-view.ts",
    "packages/stdlib/src/server/authority/authority-player-action.ts",
    "packages/stdlib/src/server/authority/authority-runtime.ts",
    "packages/stdlib/src/server/chunk-residency.ts",
    "packages/stdlib/src/server/media-world-residency.ts",
    "packages/stdlib/src/server/composition/gameplay-actor-authority.ts",
    "packages/stdlib/src/server/composition/gameplay-composition.ts",
    "packages/stdlib/src/server/composition/mod-api.ts",
    "packages/stdlib/src/server/game-server-gameplay-api.ts",
    "packages/stdlib/src/server/game-server-gameplay-host.ts",
    "packages/stdlib/src/server/game-server-gameplay-restore.ts",
    "packages/stdlib/src/server/game-server-restore-candidate.ts",
    "packages/stdlib/src/server/game-server.ts",
    "packages/stdlib/src/server/gameplay/gameplay-registered-adapters.ts",
    "packages/stdlib/src/server/gameplay/gameplay-runtime-checkpoint.ts",
    "packages/stdlib/src/server/gameplay/gameplay-snapshot.ts",
    "packages/stdlib/src/server/gameplay/modules/block-actions-module.ts",
    "packages/stdlib/src/server/gameplay/modules/block-host-commit.ts",
    "packages/stdlib/src/server/gameplay/modules/gameplay-module-runtime.ts",
    "packages/stdlib/src/server/gameplay/modules/registered-block-runtime.ts"
  ],
  "exitCode": 0,
  "wrapperExitCode": 0
}
```

```json
{
  "group": "tests-pack",
  "startedAt": "2026-09-24T16:43:11.056Z",
  "endedAt": "2026-09-24T16:43:11.990Z",
  "command": "node",
  "args": [
    "node_modules/eslint/bin/eslint.js",
    "packages/stdlib/tests/server/gameplay-media-fact-drain.test.ts",
    "packages/stdlib/tests/server/media-dependent-removal.test.ts",
    "packages/stdlib/tests/server/media-playback-host-commit.test.ts",
    "packages/stdlib/tests/server/media-playback-model.test.ts",
    "packages/stdlib/tests/server/media-playback-module.test.ts",
    "packages/stdlib/tests/server/registered-media-playback-runtime-fixture.ts",
    "packages/stdlib/tests/server/registered-media-playback-runtime.test.ts",
    "playbooks/classic/src/media.ts",
    "playbooks/classic/src/pack.ts",
    "playbooks/classic/src/retired-actors-migration.ts",
    "playbooks/classic/tests/media-declarations.test.ts",
    "scripts/build-gameplay-packs.mjs",
    "scripts/pack-integrity.mjs",
    "scripts/product-pack-admissions.mjs",
    "apps/web/tests/integration/engineering/pack-integrity.test.ts",
    "apps/web/tests/integration/runtime/server/composition/classic-media-authority.test.ts",
    "apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts",
    "apps/web/tests/integration/runtime/server/composition/gameplay-registered-block-actions.test.ts"
  ],
  "exitCode": 0,
  "wrapperExitCode": 0
}
```

此前四次无 child receipt 的 wrapper 运行没有可用 ESLint 结论：子进程已不存在、owner 文件缺失而 wrapper 仍停留；自有 wrapper PID `20555`、`23540`、`25715`、`27840` 经只读确认后以 `SIGTERM` 结束，终态 `143`。根因是一次失败的 detached baseline 命令留下空的 `/tmp/seedlands-benchmark-reservation/` 目录；确认 owner PID `16662` 不存在后删除 owner 文件，后续又确认目录为空并删除。只有上面三份 child `exitCode=0` 且 wrapper `exitCode=0` 的运行计入 PASS。

### 扩展 12-file 扫描（非准出）

完整命令：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/secondary-actor-permissions.test.ts apps/web/tests/integration/runtime/server/composition/actor-profile-closure.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-needs.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-inventory-actions.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-prepared-mode.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-feeding.test.ts apps/web/tests/integration/runtime/server/composition/block-content-ownership.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-combat.test.ts apps/web/tests/integration/runtime/server/composition/geometry-capability-integration.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-registered-block-actions.test.ts apps/web/tests/integration/runtime/server/composition/gameplay-mining-progression.test.ts --maxWorkers=1
```

12 个路径即为上面 argv 中的 12 个 `.test.ts`。首轮在 `HEAD 78545d87 + 当前 Media/Lighting/Web dirty`、上述 12 个 fixture 尚未试改的树上得到 `9 files failed / 3 passed；73 tests failed / 31 passed`。代表性原因：完整 Classic modules 被改装到新 Pack ID且 lock `resources=[]`，触发正式 Media resource/Pack lock fail-fast；direct `GameplayRuntime` fixture 安装完整 Media capability却缺 `getLoadedCell`；`actor-profile-closure` 的完整 Classic manifest与空 integrity resources不一致。

第二轮在 10 个临时 fixture 改动的**探索树**上得到 `7 files failed / 5 passed；65 tests failed / 39 passed`。当时仍失败的 7 个路径为：

```text
apps/web/tests/integration/runtime/server/composition/gameplay-registered-combat.test.ts
apps/web/tests/integration/runtime/server/composition/gameplay-registered-feeding.test.ts
apps/web/tests/integration/runtime/server/composition/gameplay-registered-needs.test.ts
apps/web/tests/integration/runtime/server/composition/gameplay-registered-inventory-actions.test.ts
apps/web/tests/integration/runtime/server/composition/gameplay-mining-progression.test.ts
apps/web/tests/integration/runtime/server/composition/secondary-actor-permissions.test.ts
apps/web/tests/integration/runtime/server/composition/gameplay-prepared-mode.test.ts
```

第二轮代表性原因分别为：`seedlands.structure` permission失去对应 resource provider；`grazer`、`night-stalker`、`settler` profile 不在当前 Classic profile；mining 期望 `stone-block` 但得到 `cobblestone`，另一个 restore 用例命中 disposed Kernel owner。没有完成 detached baseline 对照：尝试在 `78545d87` 临时 worktree启动 Vitest时因该临时依赖目录不能解析 `vitest` 直接 startup failure，benchmark cleanup另报 `kill EPERM`，所以这 7 个文件目前**尚未归因**。

10 个探索改动路径为 helper 加上述 7 个失败文件，再加 `actor-profile-closure.test.ts` 与 `block-content-ownership.test.ts`；已逐项撤回，`git diff --quiet` 对这 10 个路径返回 `0`。最终工作树没有重跑该 12-file扫描，因此不能把第二轮 `39 passed` 写成最终树结果。

## Root Gate 后的并行修订

- 本文件原 SHA-256 `f3bebad8fe79fa67ebbc30e0d9d28c19cc21748483a0e308bbe7fb1225a69153` 的 59 项 manifest 已由 root 逐项读回匹配；该快照先于 `MEDIA-ROOT-GATE-01` 的 generation 聚合容量复核。
- root 随后把 `packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts` 与 `packages/stdlib/tests/server/media-dependent-removal.test.ts` 临时独占交给 761。当前只读 SHA 分别为 `7a673f70d76702125934259ded243d8dd8e0e7a41b7378ae3ddeb683f412fbe9` 与 `578f4acab5c6778eb9ab0d86c5c0eeaad9fa313ef35e1448292794cb756bb304`，已不同于下方旧 manifest。当前 agent 未读取后宣称其行为通过、未修改、未测试；这两个路径以后应以 761 的新 evidence/manifest 为准。
- 因此本文件的 `43/43` 是上述 root 已核快照的证据，不覆盖 761 后续写入。合并树最终测试须在 761 checkpoint 与 root 准出后重跑。

## 文件 Manifest

```text
57c2e05240511d7ac50fbc3bc53bbc5979d2dc2dce982b07dbdecad0a3d49691  ASSETS.md
083d1babc367f88fe7a76c9a81f6da6419260f2dfa3f06134ca8f765f09ec008  packages/stdlib/src/server/authority/authority-gameplay-view.ts
5f5ee7d6de1cc2fe71726240b6969a3f0835ed697f2516427fbc3e21c2a21e5b  packages/stdlib/src/server/authority/authority-media-runtime.ts
093e88799e72348ae6f42ae35e1df60195d406f8e81419251ab207dc9d07ade7  packages/stdlib/src/server/authority/authority-player-action.ts
d1967fc80eea0968fed56a922220203ffa13c2f9f5e73731d6ea1d9c273938a0  packages/stdlib/src/server/authority/authority-runtime.ts
d8be96a19c6a66b95a3b35feb48d46445f3db4016810b545cdef99c05f7f40bd  packages/stdlib/src/server/chunk-residency.ts
efe3dd59dd7c6a71ecbf7f0f605b472fa61fe4ed4b71adc6caa87effa213e55a  packages/stdlib/src/server/media-world-residency.ts
359492417d044793d8f81e54957887133305dfc7fc952c640133fa75916fe5d5  packages/stdlib/src/server/composition/gameplay-actor-authority.ts
8f242fda11602259f49f034706e77b4844f28f062a1750680770bb5e648a7066  packages/stdlib/src/server/composition/gameplay-composition.ts
14397172c7a17d9e70e82d0cdd8baed7b8e030bc52534ccad880db6048256751  packages/stdlib/src/server/composition/mod-api.ts
fa2b1857a332e4294e2a5435d3c8294ed35642c5e150d7827802cac0101b4d8c  packages/stdlib/src/server/game-server-gameplay-api.ts
c84971dca98f0bbc9096dd2b9fce5462e38c2d8d92a71afedb0f940bf4753186  packages/stdlib/src/server/game-server-gameplay-host.ts
73bf417593fdfb7a2c84ca3be61c6081364ce105fa8d4d5be2d79ac5faaaa656  packages/stdlib/src/server/game-server-gameplay-restore.ts
8d6b9973242c81b685c3ad0023e1c3c05e67a2d42fed42aa5b07e264e8bd953d  packages/stdlib/src/server/game-server-restore-candidate.ts
0ce7b0d274218d977c7c112e3e229213e1efec106aeb7d39504f0ea64fd76927  packages/stdlib/src/server/game-server.ts
4a95fd36c27bbffab2f9c22500b6af626aff91e3f4ac4053432553614895df29  packages/stdlib/src/server/gameplay/gameplay-media-commit.ts
5323a9a2095db6b575ee4e9c9366347396a22b42586a20156ae5716076be6cd1  packages/stdlib/src/server/gameplay/gameplay-media-facade.ts
3927d24fd745a5f3eb61972a3d46041737eeac7a5643b6b16e309cf4a90ee265  packages/stdlib/src/server/gameplay/gameplay-media-runtime.ts
56322e13aa687370fabbf869c412de8468e3aaf407136478561990e4a7936e6f  packages/stdlib/src/server/gameplay/gameplay-media-target-runtime.ts
02324e105f56bab4825aa21c6bf4e4d98e6ac3ccab0332dd3994ff875870ab3d  packages/stdlib/src/server/gameplay/gameplay-registered-adapters.ts
1711988131c6482e4aba1c48c60c5dbb7047ff3c3f88764a02c872cdaddb1595  packages/stdlib/src/server/gameplay/gameplay-runtime-checkpoint.ts
693a181b28616a366eda88ae3a3a7b341010086a41f25aaa17832138ee976f26  packages/stdlib/src/server/gameplay/gameplay-runtime-metadata.ts
0d57e9ca0c2ed34d50ebf5356826b2acbeda30fc4ce77db8fa3598711f114626  packages/stdlib/src/server/gameplay/gameplay-runtime.ts
58abd5e350b951b7d4965dfce166e58f115dbf94f0df48f4fe1cc68aee4a67ea  packages/stdlib/src/server/gameplay/gameplay-snapshot.ts
6890c6e14b7b63076205239bb01cf75a64ac5a0ab7da5e7a76ce51a9ef2ea274  packages/stdlib/src/server/gameplay/gameplay-structure-commit.ts
aaf317e35d657c87448b3f9374c5ae71e3a8e619d9440239965944977ab16f64  packages/stdlib/src/server/gameplay/gameplay-structure-runtime.ts
81570ba0c6ae707dad33c2947b1e4aec18366702a91ddcda7557a6edea228295  packages/stdlib/src/server/gameplay/modules/block-actions-module.ts
f6a4e81b7c3da5b992431005ee6fe3277ea7a053aa87aae48d8ea44861df9385  packages/stdlib/src/server/gameplay/modules/block-host-commit.ts
6662f71283d150889ebffe6abb3d877858e7a33d5505a2db7fd4608497150816  packages/stdlib/src/server/gameplay/modules/gameplay-module-runtime.ts
eb5c8dc8885bedad88b6bfb6091f8b828d54f5f6a2a72c86e90bca0bfea7dbf2  packages/stdlib/src/server/gameplay/modules/media-playback-host-commit.ts
1fe9a6cb896d1cf534fa732b115625e217ec26b2430385c544426b34cd4d2627  packages/stdlib/src/server/gameplay/modules/media-playback-model.ts
0ca4f7c2d4095c92a0c2fa0007ebdf51174ea188a2205cc8ea2ab5211e529280  packages/stdlib/src/server/gameplay/modules/media-playback-module.ts
95082afcef66ca2da9387153b3f3c3d67d5b376a2dcd5ec231b7676167172ed9  packages/stdlib/src/server/gameplay/modules/media-playback-wire.ts
c9cf5c434633f5ac1511ac662b23bcd3515caf2695a3d0e38fe55615a880abdf  packages/stdlib/src/server/gameplay/modules/registered-block-runtime.ts
4f3487fae6d76d4cd0d524b283f8d6a5cff3558cef5abc407e8787bbd4234c69  packages/stdlib/src/server/gameplay/modules/registered-media-playback-runtime.ts
d8a81c0c0da05c5d5ed55146d855d5436483ebf6bacbd951c684626e9721be9d  packages/stdlib/src/server/protocol/authority-worker-protocol.ts
77e1e32c723b4a249bdfa4ebc62245c7b6a6d986d21bbcaf16a3b885c6880439  packages/stdlib/src/server/protocol/media-playback-protocol.ts
f26305d2f31c0d2cc0e2f3b569ea8e57d36aa846254648c6cc3c5f33a9f9a935  packages/stdlib/tests/server/gameplay-media-fact-drain.test.ts
bc389b5765deb8798ca0170cf7116f73ee0d85a7e2bdb5012dd703cc7f176e1d  packages/stdlib/tests/server/media-dependent-removal.test.ts
bddbbe0f2a57940e2f1ba7a16fc6f5acad00a265ef5fa447a22bfcfccf8ca2d1  packages/stdlib/tests/server/media-playback-host-commit.test.ts
a25538fd6ce47b3c317fd1a25e3abecdf0ca695c7370e42430a97cbb77864085  packages/stdlib/tests/server/media-playback-model.test.ts
091926e5ba7b966cab908db2ad1166585281c1f3736a61f5c1056324fb76d060  packages/stdlib/tests/server/media-playback-module.test.ts
ec940e4715102c0497122ee8171f63acec41dd6c17e0d9a1f7145251d7941762  packages/stdlib/tests/server/registered-media-playback-runtime-fixture.ts
912099a437f309da398bb7ecbe11c5f99038598ffebe2fdb84aa4e76e59b89ae  packages/stdlib/tests/server/registered-media-playback-runtime.test.ts
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  playbooks/classic/assets/audio/to-far-shores.mp3
e3ede420705615b06919153b3dade740a42893a6e1cec639b6d67cc9add20fca  playbooks/classic/src/media.ts
53943a1bf96eec6664312748489b8098e3d007cf3ad4593163a610ae3af35386  playbooks/classic/src/pack.ts
19ceab52725b8192e979a58c7ed0284136b8b6b1e3b3ad49b1891a587b3be610  playbooks/classic/src/retired-actors-migration.ts
71afa85e2e17320eea704418d2f0cfb4c5879257bdb2902b47bbade43996589a  playbooks/classic/tests/media-declarations.test.ts
72bf8e8c91c5a138aca831a570af9bee20264eec9e890948d6d06f1931f57248  scripts/build-gameplay-packs.mjs
6ac0608a3dd45b7f703d40542f0903414ad8c864f3231478852066055285ae6c  scripts/pack-integrity.mjs
119af85fd18d81f576df92d4c21d1e1f92f3eb4c87d521ae13ebd3725c62d1b4  scripts/product-pack-admissions.mjs
ae2a9fc830dcd1f070c90b4ea1d7ef8fe2d060d12f0b4ea068ddfffd72b980f0  apps/web/tests/integration/engineering/pack-integrity.test.ts
19388b45b458f1fea5580bd68c1c425b31d2cef197187056cac6c325771592ff  apps/web/tests/integration/runtime/server/composition/classic-media-authority.test.ts
ec940f436471f10379a133d5335f7e8653dfb33245d0d96e9adb332217355ae2  apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts
9297dd3027281d99b690a6014f565b1b3ffc741463d5eaecb7fa00b58ee38110  apps/web/tests/integration/runtime/server/composition/gameplay-registered-block-actions.test.ts
ab34ca36feca95dcea62e2eb3f40904e37bf5db7e068e451f60705cc4079ed2e  changes/2026-09-23-classic-functional-completion/media-asset-evidence.md
f3118844daa4ce43bf84fd0710a6c90b4ceb371029b8d43ac4ea2e62cc5bd211  changes/2026-09-23-classic-functional-completion/media-dependent-removal-evidence.md
c0f4ee4dc79e48eaffef638be1444c9ccfb6bb49135ef326f9a7db955869ccf3  changes/2026-09-23-classic-functional-completion/media-web-public-evidence.md
```

## 未完成/非本阶段证据

- 未运行 browser、dev server、完整 production build、全量 deterministic、CI、PR review 或 Cloudflare preview；不能宣称游戏内已真实听到 MP3。
- Web 线的 `14 files / 95 tests`、Web typecheck/lint/format 已由 root 独立核验，evidence SHA-256 `c0f4ee4dc79e48eaffef638be1444c9ccfb6bb49135ef326f9a7db955869ccf3`；本阶段未重复无变化的 Web 行为测试。
- 当前工作树同时含 Lighting 与后续 V2+ 模型改动；本 manifest 不包含这些文件。Git index 为空，等待 root 按 hash 独立读回后准出 Git 批次。
