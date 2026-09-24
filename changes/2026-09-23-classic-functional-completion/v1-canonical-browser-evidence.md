# V1 Canonical Browser 正式验收证据

阶段：`V1-CANONICAL-BROWSER-01`
结论：**FAIL，启动门禁阻塞；V1 旅程未执行。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt。

## 身份与入口

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-60843904`
- HEAD：`60843904909b2439725a40bc1d4e725de8fcda18`
- `git status --short`：无输出。
- artifact source SHA：`60843904909b2439725a40bc1d4e725de8fcda18`
- artifact digest：`3700a6551d1d359a099bfd757b1820ba84f891233d00a53c029b75bef5b30e5c`
- artifact receipt SHA256：`79f9cce2743a66f2598076540a88b351165fa7e8a085fe33952a274405839656`
- dist：276 个文件，约 21 MiB；未重建、未修改。
- 唯一入口：根 `pnpm harness:classic`；内部调用 `playwright test --config playwright.config.ts`。配置只匹配 `apps/web/tests/e2e/classic-runtime.spec.ts`，`workers=1`、headless、严格端口 4273，并由 Playwright 管理既有 dist 的 preview。
- `harness:classic` 自身不持有机器锁，因此本次只在外层使用一次默认 `benchmark-window`，没有嵌套锁。

## 正式 Attempt

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-01-60843904 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-24T21:28:56.064Z` 至 `2026-09-24T21:29:28.495Z`。
机器窗口：`6a28eddc-274a-4684-a71a-55bf63f905ff`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：2 failed，1 skipped；没有 retry 或第二次 Harness 调用。

- 主 canonical：C0 启动步骤约 11.4 秒失败。
- Classic 视觉回归：同一启动入口约 11.2 秒失败。
- 非 Classic smoke：按既有条件 skipped。
- Harness receipt：`status=FAIL`，主 canonical `stages={}`、`current=null`。

## 首个根因

两条 Classic 测试都在点击“进入世界”后返回开始页，页面显示：

```text
Pack presentation resource lock is invalid.
```

`startClassicWorld()` 随后等待 `#start-card` 隐藏 10 秒超时。超时是表象；首个产品根因是 Pack presentation loader 与正式 Pack lock resource schema 不兼容：

1. dist `packs/packs.lock.json` 中 presentation/audio resource 使用正式四字段结构：`{ path, sha256, size, contentType }`。
2. `apps/web/src/client/presentation/pack-presentation-loader.ts:84-86` 的 `lock()` 只接受精确两字段 `{ path, sha256 }`。
3. `loadBrowserPackPresentationCatalog()` 在约第 224 行执行 `pack.resources.map(lock)`，因此第一个四字段 resource 在读取 presentation bytes 前即被拒绝。
4. 网络 trace 显示 `packs.lock.json` 和 `overworld.manifest.json` 都返回 HTTP 200；dist presentation 文件实际 SHA256 为 `a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b`、大小 720，与 lock 一致。故障不是网络、缺文件、digest 不匹配或等待时间不足。

本租约不授权修改 production/test，也不授权第二 attempt，因此没有放宽 validator、改 timeout、修改 dist 或重跑。后续修复应让 loader 对 manifest lock 和 resource lock 使用各自精确 schema，并继续验证 resource 的 `size`/`contentType`，不能丢弃正式字段或放宽成任意对象。

## V1 关键结果

以下均为 **未观测（NOT OBSERVED）**，原因是世界未通过 Pack presentation 启动门禁，不能据此判断功能通过或失败：

- water-bucket 倒 source 与空桶收回；
- 木门两格跨 Chunk 实际 mesh、epoch、关闭碰撞和打开穿越；
- jukebox/record-13 的单次 fact、projection 与真实 audio phase；
- save/return/continue 的新 epoch、门/slot 恢复与 resumePending；
- 手势续播、eject stop；
- 离开世界后的 audio 清理。

## 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-01/`

- `381e0504e63d62f4c305dfe8ed3e4667a110baf92d40429178c31fe0567b5bf2` `classic.json`
- 原始内容 SHA-256 `bbed198ebd90402211c7e3e556437f00c6581a11bcf149830fa96098ce4bcf65`，deterministic gzip `e6ed91f11a34e29b83983154a5013863ea36023bd85df7fe7805364782cafe18`，`canonical-error-context.md.log.gz`
- 原始内容 SHA-256 `0d99cf273b9711d76686f2f3a2365a08b278e0835a247ed8c18e4721ec7ecff4`，deterministic gzip `892da560b5752b0267e60404ca33f5cd076778842dd05996920c6f2f7e1e4fc8`，`visual-error-context.md.log.gz`
- `3240718b41843027e04a6fd79a5b90e447e8b2250d39b7ac693413ed9e1aa095` `canonical-trace.zip`
- `11d82d6fbc4931f535993451a5195374887016d9248b9f52662ca013be89178e` `visual-trace.zip`
- `79f9cce2743a66f2598076540a88b351165fa7e8a085fe33952a274405839656` `harness-artifact.json`
- `2a5994f2d745b9d873d6099c50d62e94c2b66cf467458be03a2ff87261040cdf` `performance-window.json.log`

## 运行后状态

- `harness:classic` 在失败后仍执行了 artifact 后验校验；没有报告 source、lock、files 或 artifact digest 漂移。
- 运行后 HEAD 仍为 `60843904909b2439725a40bc1d4e725de8fcda18`，`git status --short` 无输出，artifact receipt SHA256 仍为 `79f9cce274...9656`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；本次 preview 已由 Playwright 清理。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装或全局配置修改。

---

# Browser-02 正式验收追加

阶段：`V1-CANONICAL-BROWSER-02`
结论：**FAIL，C0 仍未关闭；Browser-01 的 resource-lock 兼容问题已关闭，但暴露了新的 host permission admission 缺口。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt。

## Browser-02 身份

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-a77f1f4e`
- HEAD：`a77f1f4e9fef107582a4d4b576889e3083b5893f`
- `git status --short`：运行前后均无输出。
- artifact source SHA：`a77f1f4e9fef107582a4d4b576889e3083b5893f`
- artifact digest：`b984a1c6c8ea700d753ea97f93f96ac85a93b0cbf9aad25d3f8b0bcad32b2487`
- artifact receipt SHA256：`f35872ae48e3934c37310bdbe3bd67902c1c4b8df0cf2ce5e19bd5b75dd4f890`
- dist：276 个文件；未重建、未修改。
- 最新远端 `0fabcd40` 只含后续 evidence/state，不替换本次 artifact。

## Browser-02 唯一 Attempt

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-02-a77f1f4e node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-24T22:03:47.609Z` 至 `2026-09-24T22:04:20.180Z`。
机器窗口：`21665d89-17d2-45ae-b742-d28d56f5e73f`，`waitedMs=2`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：2 failed，1 skipped；没有 retry 或第二次 Harness 调用。

- 主 canonical：C0 启动步骤约 11.5 秒失败。
- Classic 视觉回归：同一启动入口约 11.4 秒失败。
- 非 Classic smoke：按既有条件 skipped。
- Harness receipt：`status=FAIL`，主 canonical `stages={}`、`current=null`。

## C0 进展与新首因

Browser-01 的 resource lock schema 问题已关闭：Browser-02 trace 中 `packs.lock.json`、`overworld.manifest.json`、`playbooks/classic/presentation.json` 和 `to-far-shores.mp3` 均成功返回 HTTP 200，presentation/audio 已通过正式四字段 resource lock 校验。

随后 Authority Worker 在 Pack 装配时抛出：

```text
Pack permission was not approved by the host: seedlands:overworld -> seedlands.structure
```

页面返回开始页并显示同一错误，`startClassicWorld()` 等待 `#start-card` 隐藏 10 秒后超时。超时仍是表象；新首因是 host-owned permission admission 与 Pack manifest 的权限请求不闭合：

1. `overworld.manifest.json` 的 `seedlands:overworld-structure-actions` 请求 `seedlands.structure: read,execute`；behavior registry 也请求 `seedlands.structure:execute`。
2. dist `packs/host-admissions.json` 的 `seedlands:overworld` permissions 完全缺少 `seedlands.structure`。
3. 对 manifest 所有 module permission 与 host admission 做集合差分，唯一缺口是：

```text
seedlands.structure:read
seedlands.structure:execute
```

4. 生成源 `scripts/product-pack-admissions.mjs` 的 `overworldPermissions` 同样没有 `seedlands.structure`，而 `build-gameplay-packs.mjs` 正式从该 host policy 生成 `host-admissions.json`。
5. `packages/stdlib/src/server/composition/assembly.ts` 的 fail-closed 检查正确拒绝未批准权限；不应放宽 assembly 或从 Pack 请求反向生成 host grant。后续修复应由产品 host policy 明确批准 Classic Structure 所需的最小 `read,execute`，再生成新 artifact。

## Browser-02 V1 关键结果

以下仍为 **未观测（NOT OBSERVED）**，原因是世界在 Authority Pack 装配阶段、ready 之前失败：

- water-bucket 倒 source 与空桶收回；
- 木门两格跨 Chunk 实际 mesh、epoch、关闭碰撞和打开穿越；
- jukebox/record-13 的单次 fact、projection 与真实 audio phase；
- save/return/continue 的新 epoch、门/slot 恢复与 resumePending；
- 手势续播、eject stop；
- 离开世界后的 audio 清理。

## Browser-02 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-02/`

- `381e0504e63d62f4c305dfe8ed3e4667a110baf92d40429178c31fe0567b5bf2` `classic.json`
- 原始内容 SHA-256 `604ba927567ae429d5aa1c6431636f8fd01a5dd401c1271545934924f8a43239`，deterministic gzip `f1d31e4e33878d599451887abf2df5ddd03c6f5247c59ddbdc884b5fe74ceca8`，`canonical-error-context.md.log.gz`
- 原始内容 SHA-256 `0cfa3047a282327cf547b4b1486b1e0ca41fb9733ebfe2d5a2102b648c5e4ff3`，deterministic gzip `d33ef23e304bca5d9e09e71baae1d8b29e12c730291894f1e30a74dbbbfc88c0`，`visual-error-context.md.log.gz`
- `5b4213a9350881011414a8b28ab6535880207d3c987a538502ff4775aa286c70` `canonical-trace.zip`
- `33bc25be50a90e39e21f8d1127d99f3e126778a5e911a400ff51a182221bfc88` `visual-trace.zip`
- `f35872ae48e3934c37310bdbe3bd67902c1c4b8df0cf2ce5e19bd5b75dd4f890` `harness-artifact.json`
- `322b3ee011afa91354b5eb89da80322f3b18934aaf1ac65481dba78b28c27b71` `performance-window.json.log`
- `7259ae5ae2a3ba7ace583ec04b20e4ab27f784556156b491195cd53bfa2cd735` `host-admissions.json.log`
- `14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3` `overworld.manifest.json.log`
- `954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5` `packs.lock.json`
- `a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b` `presentation.json`

## Browser-02 运行后状态

- `harness:classic` 失败后 artifact 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `a77f1f4e9fef107582a4d4b576889e3083b5893f`，`git status --short` 无输出，artifact receipt SHA256 仍为 `f35872ae48...4f890`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；进程核验只命中执行查询本身，没有本树 Playwright、Chromium 或 Vite preview 遗留。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或测试/production 修改。

---

# Browser-03 正式验收追加

阶段：`V1-CANONICAL-BROWSER-03`
结论：**FAIL；C0 与既有 C1-C3 已关闭，首个 V1 玩家动作在 water-bucket Authority LOS 被拒绝。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt。

## Browser-03 身份

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-8ae1f514`
- HEAD：`8ae1f514fa6e025ed31c4ab54ccf1c0960b8c586`
- `git status --short`：运行前后均无输出。
- artifact source SHA：`8ae1f514fa6e025ed31c4ab54ccf1c0960b8c586`
- artifact digest：`f278d8a1f51a31ff3c5620adfe2d46ab80340351d43dfc1ecd0033c218aa0224`
- artifact receipt SHA256：`636b046961e2bbf8be37ae48ede9e9b2501c8d8b4d5d8274842f80ef3045ed28`
- dist：276 个文件；未重建、未修改。
- host permission 差分为空；`seedlands.structure` 仅批准 `read,execute`。
- 最新远端 `7d6bcfcc` 只含后续 docs，不替换本次 artifact。

## Browser-03 唯一 Attempt

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-03-8ae1f514 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-24T22:24:18.324Z` 至 `2026-09-24T22:26:33.012Z`。
机器窗口：`cdb24cc2-3589-4194-9aef-fd56ee90b757`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：1 failed，1 passed，1 skipped；没有 retry 或第二次 Harness 调用。

- C0 PASS，约 3.9 秒；Browser-01/02 的两个启动阻塞均关闭。
- C1 PointerLock/真实移动/跨 Chunk PASS，约 17.8 秒。
- C2 真实采集/拾取/背包/合成 PASS，约 22.2 秒。
- C3 真实建造/进食/战斗/工作台 PASS，约 16.4 秒。
- V1 步骤运行约 12.0 秒后在第一条 water-bucket 旅程失败。
- Classic 视觉回归 PASS，约 31.7 秒。
- 非 Classic smoke 按既有条件 skipped。

Harness receipt 记录 C0-C3 为 PASS；失败时 `current` 仍为真实 Authority/browser 快照，关键值为 player `[65.95881945378738,32.600001,2.4981569866156805]`、`worldRevision=14`、`interactionAttempts=11`、`actionCompletionCount=13`、`actionFailureCount=0`。

## Water-bucket 首个根因

真实输入链已完成，不是选中、瞄准或 click 丢失：

- 创造目录按钮实际选中 `water-bucket`，hotbar active button 的 `data-item=water-bucket`。
- target card 与只读 aimed target 精确命中 floor `[68,30,2]`，adjacent 为预期空气 `[68,31,2]`。
- Playwright trace 记录一次真实 canvas right click。
- 随后 UI 显示 `无法交互 · blocked`，目标 voxel 在 5 秒观察窗内保持 Air `0`，未变为 Water `8`。

`blocked` 的确定性来源是公共 item interaction dispatcher 的 hit LOS：

1. `packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts:277` 从 hit voxel center 向 `actor.position` 调用 `traceVoxelRay`。
2. 本次 hit center 为 `[68.5,30.5,2.5]`，actor position 为 `[65.95881945378738,32.600001,2.4981569866156805]`。
3. 按 `voxel-ray.ts` 的实际 1/8-block 采样重放，hit LOS 依次经过 `[68,30,2]`、`[67,30,2]`、`[67,31,2]`、`[66,31,2]`、`[66,32,2]`；`[67,30,2]` 是 canonical floor Stone，因此返回 `blocked`。
4. adjacent LOS 的采样格为 `[68,31,2]`、`[67,31,2]`、`[67,32,2]`、`[66,32,2]`，均为空；fluid candidate 若目标被占用会返回独立 `target-occupied`，本次没有进入该分支。
5. 项目对 Structure/Media 路径已有 `playerInteractionOrigin(position) = [x,y+1.6,z]`；item dispatcher 此处使用 actor feet，导致合法的向下交互射线先穿过相邻 floor。

因此首因是 Authority 公共 item-interaction LOS origin 与已有玩家交互眼位语义不一致，而不是 scenario 坐标、创造目录 selected item、浏览器输入、fluid handler、世界写入或 5 秒等待阈值。后续修复应在公共 item interaction dispatcher 使用可信 `playerInteractionOrigin(actor.position)` 并保留 hit/adjacent 双 LOS、安全距离和现有墙后负例；不能在场景绕过、放宽 blocked、增加 Harness 写口或改 fluid handler。

## Browser-03 V1 结果矩阵

- water-bucket：**FAIL at first action**；真实 select/aim/right-click 已证明，Authority 返回 `blocked`，目标仍 Air。
- empty bucket 收 source：**NOT REACHED**。
- door 两格/双 Chunk mesh+epoch/collision/toggle：**NOT REACHED**。
- record fact/projection/audio：**NOT REACHED**。
- restore/resumePending/新 epoch：**NOT REACHED**。
- gesture resume/eject/audio cleanup：**NOT REACHED**。
- C4 streaming 与 C5 save/continue：**NOT REACHED**。
- 既有 Classic 视觉回归：**PASS**。

## Browser-03 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-03/`

- `010d69f890dea55ad2a1610ce0316c4ffb0de235263a66ee58813c3390a8f05c` `classic.json.log`
- 原始内容 SHA-256 `5537a948f745541a108a24064b6c402683da83915d2729b02a7f53a420143385`，deterministic gzip `41a4c3d64189eea4c9106925327b226ac250f6f54ed72e0e2c786558c7e60363`，`canonical-error-context.md.log.gz`
- 原始 trace SHA-256 `fb0dbcd0cb210018a8b6f473d89bbfdc598c51a464863136e73f835d5a009042`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `3f6719ffc182c7fe49da1cf8c2ac4f77b0f4db523b8335dd0956260ab5398bfd` `canonical-trace.zip.part-aa`（85000000 bytes）
  - `b10ac536783db0a01fb8abd49ae2c4289198462f1e379b931e8de0304c78821d` `canonical-trace.zip.part-ab`（85000000 bytes）
  - `7674d3f39f6c6a36a04cdef4da496388600425ded4669b6254574123d5c4e378` `canonical-trace.zip.part-ac`（23342205 bytes）
- `3a9f138aa3adc2b9d286ed014999c9d1817bd9d6e4bebcb7a3a4dc1621ce1ace` `diagnosis.json`
- `636b046961e2bbf8be37ae48ede9e9b2501c8d8b4d5d8274842f80ef3045ed28` `harness-artifact.json`
- `ceaf85efcbe2b2698f2b599a51d2e348fcac135639fe0164dc966c428bb8c3b1` `performance-window.json.log`

## Browser-03 运行后状态

- `harness:classic` 失败后 artifact 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `8ae1f514fa6e025ed31c4ab54ccf1c0960b8c586`，`git status --short` 无输出，artifact receipt SHA256 仍为 `636b046961...5ed28`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN`、Chromium、Playwright 与 `vite preview` 进程查询均无输出；本次资源已清理。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或测试/production 修改。
