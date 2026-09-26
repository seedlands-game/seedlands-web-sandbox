# V2 Equipment Core Artifact Build 证据

阶段：V2-ARTIFACT-BUILD-01
状态：production build 与 artifact verification 通过；未运行 Browser、Cua 或 CI。

## 源码与隔离

- 已推送 source SHA：`50a1e6ec72583ad4f5feef057a692709da577b19`。
- clean detached worktree：`/private/tmp/seedlands-v2-acceptance-50a1e6ec`。
- 构建前 HEAD 匹配，tracked diff/index 为空，`apps/web/dist` 不存在。
- 根、stdlib、Web 与 Classic 的 `@seedlands/*` 均解析到 acceptance tree 自身；只复用主工作树的第三方
  `.pnpm` store，`.pnpm-task-run-state-v1` 是 acceptance tree 内真实目录。

## 唯一构建与复验

唯一 production build：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c \n+  'pnpm build 2>&1 | tee .../evidence/v2-artifact-build-01/build.stdout.log'
```

窗口 `v2-artifact-build-01` 从 `2026-09-25T12:03:56.658Z` 到 `12:04:19.684Z`，
`PASS/exit 0`。Pack build、Rust artifact、SSG、Web typecheck 与 Vite production build 均成功；Svelte
为 `0 errors / 0 warnings`。本树没有第二次 build。

对同一树和同一 dist 的唯一 artifact 复验：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -o pipefail -c \n+  'pnpm harness:artifact 2>&1 | tee .../evidence/v2-artifact-build-01/artifact-verify.stdout.log'
```

窗口 `v2-artifact-verify-01` 从 `2026-09-25T12:04:27.860Z` 到 `12:04:29.723Z`，
`PASS/exit 0`。build 与复验输出的 identity 完全一致：

```text
sourceSha=50a1e6ec72583ad4f5feef057a692709da577b19
sourceDigest=147101872e3de0ce5f4a793bef4fe334a91c1dd9aecbf27ebcc961ef708b1131
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=94d72b2fd976fe58f5a0e9a09870853c6e9e2358dc4fc2026a7b39b344c507f6
files=276
builtAt=2026-09-25T12:04:18.160Z
```

磁盘 `apps/web/dist` 共 277 个文件，其中 276 个是 artifact map 条目，另一个是 receipt 自身。
`harness-artifact.json` SHA-256 为
`924b33af48a6919c7ba6ec1fe8d3772e7182daa2369923ebbdad8dd363b1ed15`；dist `packs.lock.json` SHA-256
为 `fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332`。

## 媒体与后验

源与 dist 的 `playbooks/classic/assets/audio/to-far-shores.mp3` 均为 `2976045` bytes、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`；Pack lock 条目记录
`contentType=audio/mpeg`。构建后 acceptance tree tracked diff/index 仍为空，端口 4273 无监听且无本树残留进程。
该 tree/dist 按要求保留，不清理九棵 V1 acceptance tree。

本证据只证明 `50a1e6ec...` 的 production artifact 可重复验证，不证明共享 death RED、equipment UI、combat
armor、V4 restore、Browser/Cua、人类听觉、性能、CI/review 或完整 194 项矩阵。

## BUILD02：Equipment Web UI + combat + death spine

- 已推送 source SHA：`1bbe3a60d55ffa5d05e405377624fbbd942e6327`；tree
  `4d70cef0e00c8617290159e1aa83a685126b1fc4`。
- clean detached worktree：`/private/tmp/seedlands-v2-acceptance-1bbe3a60`。构建前 tracked diff/index 为空、
  `apps/web/dist` 不存在；根、stdlib、Web 与 Classic 的 `@seedlands/*` 均解析到该 tree 自身，第三方
  `.pnpm` store 复用，task-state 位于该 tree。
- 唯一 `pnpm build`：window `8894f626-5da4-4e7e-8844-a188b3d6d58f`，UTC
  `2026-09-25T14:29:55.261Z` 至 `14:30:19.167Z`，`PASS/exit 0`。Pack build、Rust artifact、SSG、
  Web/Svelte types 与 Vite production build 均成功；Svelte 为 0 errors / 0 warnings。
- 同一 dist 的唯一 `pnpm harness:artifact`：window `0c7ede3b-213b-4238-902a-d6781392dbd1`，UTC
  `2026-09-25T14:30:29.214Z` 至 `14:30:31.121Z`，`PASS/exit 0`。没有第二次 build 或 artifact verify。

两次输出的 identity 完全相同：

```text
sourceSha=1bbe3a60d55ffa5d05e405377624fbbd942e6327
sourceDigest=021861359f16eb748ddc8dfd4bcde9a4d4738ecd3f8a1b98079d11024b3be2e5
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=7e0d5f80a2751b914ff16f24af6d967dbc300b31b7f11db532c9c947596c0a78
files=276
builtAt=2026-09-25T14:30:17.636Z
```

磁盘 `apps/web/dist` 共 277 个普通文件，其中 276 个是 receipt map 条目，另一个是 receipt 本身；生成的
`artifact-map.sha256.log` 与 `dist-files.sha256.log` 逐字节一致，missing/extra 均为空。
`harness-artifact.json` SHA-256 为
`aa4f6d8056335413523964fd1d2d4630c5261fb7ee4477c879a54ad0c145281a`，dist `packs.lock.json` SHA-256
为 `fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332`。

源与 dist 的 `playbooks/classic/assets/audio/to-far-shores.mp3` 均为 `2976045` bytes、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`；Pack lock 同时包含该路径、digest
与 `audio/mpeg`。构建后 acceptance tree tracked diff/index 为空，端口 4273 无监听，提升权限的只读
进程检查为 `ACCEPTANCE_PROCESSES_0`。该 tree/dist 按要求保留，旧 V2 tree 与九棵 V1 tree 均不清理。

BUILD02 artifact 包含已提交 equipment UI、registered armor 与公共 death policy/source/series spine；仍未包含
Classic death policy 安装、`death-inventory-policy-unavailable` producer reason、Combat/Vitals/Needs/Autonomy
death producer 或 NPC intrinsic drops。未运行 Browser、Cua、CI、deploy 或 merge，构建通过不能替代真实装备旅程。

## BUILD03：Classic Death + Registered Needs

- 已推送 source SHA：`b2b07417ec01870c4ce20befdf29f433f26fc88d`；tree
  `4b96f69d6cadb83e60b0eae23e9f37eea7bc7482`。
- clean detached worktree：`/private/tmp/seedlands-v2-acceptance-b2b07417`。构建前 tracked diff/index 为空、
  `apps/web/dist` 不存在；根、stdlib、Web 与 Classic 的 `@seedlands/*` 均解析到该 tree 自身，第三方依赖复用，
  `.pnpm-task-run-state-v1` 是该 tree 内真实目录。
- 唯一 `pnpm build`：window `a5f25826-0c9d-4e28-8f38-2fc752f54145`，UTC
  `2026-09-25T19:00:26.903Z` 至 `19:00:50.814Z`，`PASS/exit 0`。Pack build、Rust artifact、SSG、Web/Svelte
  types 与 Vite production build 均成功；Svelte 为 0 errors / 0 warnings。
- 同一 dist 的唯一 `pnpm harness:artifact`：window `5bca9179-2047-42ae-ab5e-f54d2b5c4154`，UTC
  `2026-09-25T19:01:05.466Z` 至 `19:01:07.392Z`，`PASS/exit 0`。没有第二次 build 或 artifact verify。

两次输出的 identity 完全相同：

```text
sourceSha=b2b07417ec01870c4ce20befdf29f433f26fc88d
sourceDigest=4e0e1af0636cdd3fa064201ba0701421f9fa292bfb52e19b68a963ead0471445
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=fee7cf82c0746cb1b7bedab9d7c4fe1c901f57f2a281ebc2a217cf40fa773a60
files=276
builtAt=2026-09-25T19:00:49.242Z
```

磁盘 `apps/web/dist` 共 277 个普通文件，其中 276 个是 receipt map 条目，另一个是 receipt 自身。首次离线 map
脚本误按“SHA+路径”整行排序，导致 276 项顺序不同并由 `cmp` 拒绝；没有修改 dist，也没有重跑 build/verify。保留
该 attempt-01 map/摘要后，最终改为先按路径排序再计算 SHA，`artifact-map.sha256.log` 与
`dist-files.sha256.log` 逐字节一致，SHA-256 均为
`650d7b11ba5ad48944687a14c925235cd57430c5e730426ba1f753e90e7d6c2e`。

`harness-artifact.json` SHA-256 为
`c2f14ef757be3721a6ae1371142e2c60284e652cb5511c17e8ca05c5c4f7d889`；dist `packs.lock.json` SHA-256 为
`d365ec8409eee8b1d0155cb0e0ec2fb6e966e1bf351696496314e5cac01950b7`。源与 dist 的
`playbooks/classic/assets/audio/to-far-shores.mp3` 均为 2,976,045 bytes、`audio/mpeg`、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`，Pack lock 条目一致。生成 Pack
manifest 确认唯一 `seedlands:overworld-death-inventory-policy` 提供 `seedlands:death-inventory-policy`，定义包含
player retain 与 creature/npc despawn 策略。

构建后 acceptance tree tracked diff/index 仍为空，端口 4273 无监听且本树残留进程为 0。该 tree/dist 按要求
保留，旧两棵 V2 与九棵 V1 acceptance tree 均未清理。BUILD03 包含 GIT26/GIT27 的 Combat、direct Vitals、
registered Needs、Classic death policy 与精确 V4 predecessor；未运行 Browser、Cua、CI、deploy 或 merge，不能据此
宣称真实装备/死亡 UI/save、完整 194 矩阵或完整 V2 GREEN。

## BUILD04：Equipment Harness Oracle + Canonical Fixture

- 已推送 source SHA：`00009bf26c821d115264d224899dafde0d6cc163`；tree
  `e263d29f14a607103c3a80a40a9b7bed4997c58d`。
- clean detached worktree：`/private/tmp/seedlands-v2-acceptance-00009bf2`。构建前 tracked diff/index 为空、
  `apps/web/dist` 不存在；根、stdlib、Web 与 Classic 的 `@seedlands/*` 均解析到该 tree 自身，第三方依赖复用，
  `.pnpm-task-run-state-v1` 位于该 tree。
- 唯一 `pnpm build`：window `af3d2a23-1348-4faa-b79d-682b2dd82173`，UTC
  `2026-09-25T22:06:18.935Z` 至 `22:06:41.432Z`，`PASS/exit 0`。Pack build、Rust artifact、SSG、Web/Svelte
  types 与 Vite production build 均成功；Svelte 为 0 errors / 0 warnings。
- 同一 dist 的唯一 `pnpm harness:artifact`：window `41a1a689-602f-4bea-813d-49ec3010bf5c`，UTC
  `2026-09-25T22:06:50.722Z` 至 `22:06:52.671Z`，`PASS/exit 0`；没有第二次 build 或 artifact verify。

两次输出的 identity 完全相同：

```text
sourceSha=00009bf26c821d115264d224899dafde0d6cc163
sourceDigest=315820d63fc0ca323380ca45b6a537cb541842a41e396f3bfe94b0507d062dff
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=fc7ac0053fd73c08035e95b41d39bf80889c7e23155a9e14d88a096f0b54f6e2
files=276
builtAt=2026-09-25T22:06:39.842Z
```

`harness-artifact.json` 的 276 项 file map 与按相对路径排序的磁盘 map 逐字节一致；dist 共 277 个普通文件，
另一个是 receipt 自身。receipt SHA-256 为 `fa846dd12d91662a0f64b6a109df4b9c366f94d18d5108de5e10f94d7ccfb92d`，
`packs.lock.json` SHA-256 为 `d365ec8409eee8b1d0155cb0e0ec2fb6e966e1bf351696496314e5cac01950b7`。源与 dist 的
`playbooks/classic/assets/audio/to-far-shores.mp3` 均为 2,976,045 bytes、`audio/mpeg`、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`，Pack lock 条目一致。首次后验只读探测
误猜 `dist/packs/resources/...` 路径及顶层 `.resources[]`，因此失败；该探测未改 artifact，随后按 receipt 路径和实际
`.packs[].resources[]` 读取成功，且未重跑 build/verify。

构建后 acceptance tree tracked diff/index 为空，端口 4273 无监听且本树残留进程为 0。该 tree/dist 按要求保留，
BUILD03、BUILD02、BUILD01 与九棵 V1 acceptance tree 均未清理。BUILD04 包含 equipment oracle 与 canonical fixture，
但未运行 Browser、Cua、CI、deploy 或 merge；不能据此宣称真实 equipment journey、death/durability-1/drop/respawn、
16 件护甲、194 项矩阵或完整 V2 GREEN。

## BUILD05：Door Exit Face Fixture

- 已推送 source SHA：`0a0a63188805f0a7d96221a841e2b6292fa97205`；tree
  `ab92a25e22c025d65a4948e469ededf29a6e4c71`。
- clean detached worktree：`/private/tmp/seedlands-v2-acceptance-0a0a6318`。构建前 tracked diff/index 为空、
  `apps/web/dist` 不存在；根、stdlib、Web 与 Classic 的 `@seedlands/*` 均解析到该 tree 自身，第三方依赖复用，
  `.pnpm-task-run-state-v1` 位于该 tree。
- 唯一 `pnpm build`：window `12d64223-ca76-490c-9b7c-057ce47de71c`，UTC
  `2026-09-26T00:16:42.589Z` 至 `00:17:05.396Z`，`PASS/exit 0`。
- 同一 dist 的唯一 `pnpm harness:artifact`：window `76f7a9d0-b0ac-4844-947d-ba058156922d`，UTC
  `2026-09-26T00:17:18.562Z` 至 `00:17:20.638Z`，`PASS/exit 0`。没有第二次 build 或 artifact verify。

两次输出 identity 一致：sourceDigest
`c86e64716b9bd29f79bcf7897437342f97766faaa110907fd12046f9e0f64bc2`，lockDigest
`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`，artifactDigest
`fc7ac0053fd73c08035e95b41d39bf80889c7e23155a9e14d88a096f0b54f6e2`，276 项，builtAt
`2026-09-26T00:17:03.654Z`。ExitFace 仅修改测试/fixture，因此 artifact digest 与 BUILD04 相同；source identity 已换代。

receipt SHA-256 为 `869ad08581fec7c293523c51ae997041674ab0fba95bb5b9d99164ba434cc8e1`。276 项 receipt map 与磁盘 map
逐字节一致，SHA-256 均为 `9a78dca8ded37d3e49db705c66489b557229121d4c94056a78eba530b6d4f731`；dist 共 277
个普通文件。首次磁盘 map 命令误用 zsh 特殊变量 `path`，覆盖 `PATH` 并使 `/usr/bin/shasum` 查找失败，得到空文件；
该结果原样保留为 `dist-files-attempt-01.sha256.log`，随后改用 `entry` 与绝对 `/usr/bin/shasum` 正确采集，未改 artifact、
未重跑 build/verify。

`packs.lock.json` SHA-256 为 `d365ec8409eee8b1d0155cb0e0ec2fb6e966e1bf351696496314e5cac01950b7`。源与 dist 的
`playbooks/classic/assets/audio/to-far-shores.mp3` 均为 2,976,045 bytes、`audio/mpeg`、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`，Pack lock 条目一致。构建后 tree
tracked/index clean，4273 无监听且本树残留进程为 0；新 BUILD05、4 棵旧 V2 与九棵 V1 tree/dist 全部保留。

BUILD05 未运行 Browser14、Cua、devserver、CI、deploy 或 merge。它不改变 Browser13 的失败事实，也不能证明门出口
face 的真实 Browser 路径、V2 equipment journey、death/durability-1/drop/respawn、16 件护甲、194 项矩阵或完整 V2
GREEN。
