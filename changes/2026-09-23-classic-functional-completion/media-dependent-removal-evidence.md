# Media Dependent Removal 证据

状态：private Media owner checkpoint 完成；等待共享 owner 安装 B2 dependent-removal port 和 fact delivery。本文件不宣称公共 Gameplay/Authority、Classic、Web 或产品唱片旅程已接线。

范围：只修改 `registered-media-playback-runtime.ts`、既有 runtime test，并新增专属 `media-dependent-removal.test.ts`。未修改 Structure B2、GameplayRuntime、Authority、mod-api、Pack、Web 或 A1。

## RED

在生产实现前新增真实 `RegisteredMediaPlaybackRuntime` 场景并通过默认 `benchmark-window` 全机锁、Vitest `--maxWorkers=1` 运行：

```text
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- \
  pnpm exec vitest run --config packages/stdlib/vitest.config.ts \
  packages/stdlib/tests/server/registered-media-playback-runtime.test.ts --maxWorkers=1
```

首轮结果：`1 file / 14 tests`，`4 failed / 10 passed`。四个新场景都真实失败于 `prepareDependentRemoval is not a function`，证明 strict `prepareDeviceRemoval` 之外不存在 B2 mandatory participant 所需入口。

## 实现

- 新增 `prepareDependentRemoval(position)`，返回 `{ removed, ejectedItem, fact, validate, apply }`；既有 strict `prepareDeviceRemoval` 保留，已知非媒体 voxel 仍抛 `unsupported-media-device`。
- prepare 先读取已加载 voxel semantic id。`undefined` 明确报 `media-device-unavailable`；model selector 命中时复用 strict removal；已知非 device 只在该坐标没有 live/tombstone entry 时返回冻结的 `removed:false` participant；残存 entry 报 `media-device-orphaned`。没有 catch-all/no-op fallback。
- 非归属 participant 捕获 position、voxel id 和 runtime generation；validate 复核 generation、同一 voxel identity、仍非 model device、entry 仍不存在。strict device participant 继续复核 device identity、完整 state 和 generation。
- occupied device 的 `ejectedItem` 与 eject `fact` 继续由 `buildMediaPlaybackCandidateV1` 生成；item/track/fact 都是脱离的冻结值，不手写 Classic ID 或绕过 model。
- 两个 device participant 可以在同一 generation 下全部 validate，再按顺序 apply。apply 不读 `getVoxelId`、不调用外部 port、不重新校验 generation；第一个 apply 增加 generation 不会使已验证的第二个 apply失败。任一 participant validate 失败时，outer owner 尚未进入 apply，两个 entry 都保持。
- device apply 只删除已捕获 key 并增加 generation；非归属 apply 只消耗 validated/used 标记。空 tombstone 与 occupied entry 都按既有 live-entry capacity 计数，dependent device removal 实际删除 entry 并释放容量；非归属 participant 不改变 entry 数或 generation。

## 定向覆盖

- 已加载 known non-device 且无 entry：显式 `removed:false`，validate/apply 成功；unknown 拒绝；strict API 对同一 non-device 保持 unsupported。
- orphan：occupied entry 的 voxel 改成 non-device 后，prepare 阶段拒绝且 checkpoint 仍 fail-closed。
- stale：non-device prepare 后 voxel 变成 device，validate 拒绝；另一 media commit 改变 generation 后也拒绝。既有 strict removal 测试继续覆盖 device prepare 后 voxel 变 non-device。
- 两个 occupied device：先 prepare 两项，再 validate-all、apply-all；两项均删除，返回 exact frozen `ejectedItem` 与 eject fact，读回都回到 revision 0 空 owner。
- 第二 participant validate 失败：第一项即使已 validate 也不 apply；两个 occupied entry 均保留。
- 容量：既有 `maxDeviceInstances=2` 测试现在使用 `prepareDependentRemoval` 删除一个空 tombstone；删除前第三坐标插入因 capacity 拒绝，删除后插入成功。

## 最终验证

所有重负载命令均通过 `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- ...` 独立持锁；Vitest 均为 `--maxWorkers=1`。

- Media suites：`media-playback-model`、`media-playback-module`、`media-playback-host-commit`、`registered-media-playback-runtime`、`media-dependent-removal`，最终 `5 files / 28 tests passed`。
- `pnpm --filter @seedlands/stdlib typecheck`：实现落盘后的首次运行 PASS。最终复跑被并行 A3 文件阻塞：`packages/stdlib/src/server/game-server.ts:108 TS2353`，`voxelGeometry` 尚未出现在 `GameServerGameplayWorldPort`；不是 Media 文件诊断，本任务未越权修复。
- targeted ESLint：首轮仅因将新测试追加到既有文件导致 `max-lines` 失败；将新场景迁入专属 test 后最终 PASS，未放宽规则。
- targeted Prettier check：PASS。
- 本任务文件 `git diff --check`：PASS。
- 未运行：build、browser/dev server、Web tests、全仓 tests、CI。

## 剩余公共接线

- B2/Structure 的 `prepareDependentRemoval` port 仍未绑定到本 runtime；本任务没有修改 B2 文件或公共组合根。
- `fact` 只随 participant 返回给未来共享 owner；尚未纳入现有 committed fact/receipt delivery port。outer owner 必须在 world/entity/media 同一 validate-all/apply-all transaction 成功后才发布，失败不得发布。
- `ejectedItem` 使用 Mod definition identity；B2/shared owner 仍负责通过 composition identity resolver 转为实际 drop storage id。
- 破坏唱片机后的 Web stop/audio release、Pack MP3 与 Browser 旅程仍属于后续公共/Web 接线。

## 冻结 SHA-256

```text
registered-media-playback-runtime.ts       6fa37ac9318bf8bb810a240e151336060bbe673defac262d6fe5d524f7676876
registered-media-playback-runtime.test.ts  c84f48eed52cd05af63bf698fcb198edfbfb31d1fae5ef4b33fc10ffc3436cdb
media-dependent-removal.test.ts            077b500d41fd7f0a43ded6caf4a2b395cf88ae589dc40df05dcda9d6f49df47c
```
