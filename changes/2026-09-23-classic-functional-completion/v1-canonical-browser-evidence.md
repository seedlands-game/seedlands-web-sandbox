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

# Browser-12 正式验收追加

阶段：`V1-CANONICAL-BROWSER-12`

结论：**PASS；唯一 canonical Chromium attempt 完成 C0-C5、完整 V1 水桶/门/唱片机旅程、保存恢复与 Classic 视觉回归。该结论是 headless Playwright 合同，不替代 Cua 或人类听觉验收。**

浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，`retries=0`。

## Browser-12 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-87e64e0b`
- HEAD/source：`87e64e0b244a971540227b2d829b950362797816`
- source digest：`c5a6bafe5ba3c7b96b78f79502083795426cdca32826f181f84416baf46c6c3b`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`551dc1c4bbac44a590f2899a68bc483d22ede667a140bda123bae9d2a57fe6c7`
- dist：276 个 stamped 文件、磁盘 277 个文件（含 receipt）、无 symlink；未重建或修改。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-12-87e64e0b node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

机器窗口/run ID：`2401a5ed-b68b-48c7-93f5-138046e9629a`，UTC `2026-09-25T08:28:40.549Z` 至 `2026-09-25T08:34:09.921Z`，`waitedMs=1`，`exitCode=0`，`measurement.status=NOT_RECORDED`。Harness 内 correctness sample 为 `NOT_MEASURED`，本结果不作性能准出。

Playwright：`2 passed / 0 failed / 1 skipped`，单 worker、单 Chromium、无 retry、无第二 Harness 调用。

- C0 PASS，3.5 秒。
- C1 PASS，18.1 秒。
- C2 PASS，21.5 秒。
- C3 PASS，16.4 秒。
- V1 step PASS，43.8 秒。
- C4 PASS，2.5 分钟。
- C5 PASS，13.3 秒。
- 重开后玻璃放置 PASS，1.8 秒；V5 金钻目录与钻石块建造 PASS，3.0 秒。
- Classic 视觉回归 PASS，32.7 秒；non-Classic smoke 按既有条件 skipped。

## V1 与恢复结果

- 四项音量与旧 file upload 移除、water-bucket 放 source、empty bucket 收 source：**PASS**。
- 正式 UI 切生存、落地无碰撞、真实走到门：**PASS**。
- 门 support+adjacent 瞄准、两格原子放置、closed descriptor、跨 Chunk mesh/epoch/vertex/index：**PASS**。
- closed Authority probe 的居中路线、fresh ack、safe corridor 和持续 6 tick 阻挡：**PASS**。
- probe 后真实 `KeyS` 回同一 plan approach、client/Authority 退出 target cell、upper+近侧 adjacent 同轮 exact、真实右键与 Authority toggle：**PASS**。Browser-11 的 null adjacent fixture 阻塞已在真实路径关闭。
- open descriptor 无 collision、mesh 薄轴旋转、Chunk revision 前进、真实穿越，以及后续 upper 关闭/lower 再打开：**PASS**。保存前门为 open pair `[95,96]`。
- jukebox support+adjacent 真实 PointerLock、右键放置、record-13 插入、单一 insert-and-activate fact、projection playing 与 headless audio phase：**PASS**。
- C4 四个 Chunk center 往返、资源有界、同 Chunk 新 trace 经 Worker complete、mesh commit 和 postrender：**PASS**。
- C5 正式保存返回继续：**PASS**。Authority/checkpoint/derived 保存前后门均为 `[95,96]`、jukebox 为 `67`、world revision 为 `146`；Authority world epoch 从 `seedlands:classic-canonical-runtime-v11:1:world:0` 换为 `seedlands:classic-canonical-runtime-v11:2:world:0`。developer world identity 的独立换代及 Browser runtime epoch 的独立换代均由同一完成的 C5 断言验证。
- restore 后 record slot/revision 保留、`playing=false`、`resumePending=true`、无旧 forwarded batch；真实 PointerLock gesture 后续播，随后真实 eject 得到空 slot/eject fact/audio idle，离开世界后 audio release：**PASS**。
- receipt `pageErrors=[]`、`failedResponses=[]`；最终正式移动、恢复后工作台交互、玻璃与钻石块操作也完成。

上述 V1 瞬时 media、mesh 与输入细项由同一次完整结束的内联断言证明；Harness receipt 另保存 C0-C5、restore authority/checkpoint/derived 状态和最终快照，但未单独序列化每个 media 瞬时对象。headless audio phase 只证明 Web Audio 可观察合同，不证明人类可听体验。近接触薄门 origin-cell 无 entry face 的产品限制也未被修改；本轮证明的是 fixture 通过真实键盘退回后可执行。

## Browser-12 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-12/`

- `classic.json.log`：Harness 原始 PASS receipt，包含唯一主 attempt、C0-C5、artifact/Pack/Worker/WebGL2、restore 与 final evidence。
- `performance-window.json.log`：原始外层机器窗口 receipt。
- `runner-output.jsonl` / `runner-exec-event.json.log`：从本次 Trae 会话按 process `8943` 和对应 call IDs 机械抽取的完整 11 段 tool output 与最终 `completed/exit 0` 事件。
- `harness-artifact.json` 与 `playwright-last-run.json.log`：冻结 artifact receipt 与 Playwright 通过状态。
- 成功运行没有生成 `trace.zip`、`error-context.md` 或 screenshot；实际产物集合记录于 `generated-artifacts.txt`，没有伪造空附件。
- 全部 SHA256 见阶段 checkpoint manifest。

## Browser-12 运行后状态

- 锁内 `pnpm harness:artifact` 后验 PASS：窗口 `fc715cf2-caaf-4eea-9c16-e5ed80a73557`，source/lock/276-file map/artifact digest 无漂移。
- HEAD 仍为 `87e64e0b244a971540227b2d829b950362797816`，验收 tree 的 tracked/index clean，artifact receipt SHA256 仍为 `551dc1c4bbac44a590f2899a68bc483d22ede667a140bda123bae9d2a57fe6c7`。
- 最终资源检查须确认 `4273` 无监听、本树 Browser12/Playwright/Chromium/preview 无遗留且 benchmark lock absent 后释放租约。
- 未启动 Cua、第二浏览器路线或第二 attempt；未运行 build/CI，未修改 source/test/dist/baseline，未执行 Git/index/push/deploy。

---

# Browser-11 正式验收追加

阶段：`V1-CANONICAL-BROWSER-11`

结论：**FAIL；Browser-10 的接触位 upper 精确目标已获得且真实右键已发送，但该次观察没有正交 `adjacent`，Web 在 Authority 分派前进入放置 fallback；门未 toggle，后续 jukebox/media/C4/C5/save 未触达。**

浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，`retries=0`。

## Browser-11 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-6614a1f6`
- HEAD/source：`6614a1f675c93043a19fe225acab5a382481ad13`
- source digest：`384fffd9c685041e8780bb66fe544714c674418c44819b5999397bb34bc97dfa`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`fddd6f3bd09102e329d387caa078c89c66915c5ba54be1bb31ec8f7026818db0`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt）；未重建、未修改。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-11-6614a1f6 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T07:39:19.793Z` 至 `2026-09-25T07:41:50.031Z`。

机器窗口：`192d22bd-b0b2-4290-bfbf-3de62e2c9b86`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。

Playwright 结果：`1 failed / 1 passed / 1 skipped`，单 worker、单 Chromium、无 retry、无第二 Harness 调用。

- C0 PASS，3.5 秒。
- C1 PASS，18.0 秒。
- C2 PASS，21.0 秒。
- C3 PASS，16.0 秒。
- V1 step 在 26.1 秒处失败；step 标题不表示整段通过。
- Classic 视觉回归 PASS，31.4 秒。
- non-Classic smoke 按既有条件 skipped。

## Upper 目标与首因

本轮在失败前再次通过正式 UI/PointerLock 路径完成四项音量和旧 file upload 移除检查、water-bucket 放 source、empty bucket 收 source、正式 UI 切回生存并落地、门两格原子放置、closed descriptor 与双 Chunk mesh/epoch/vertex/index，以及正交 Authority closed-door probe 的 safe corridor、fresh ack 和持续 6 tick 阻挡。

接触位后的首次瞄准精确观察到 upper `[70,32,0]`，随后真实 canvas 右键执行；这关闭了 Browser-10 的 lower half 不可获取问题。但同一次 target observation 的 `adjacent` 为 `null`，而 fixture 调用 `aimAtVoxelWithRealMouse(page, door.upper)` 时没有声明所需面。只读生产路径确认：

1. `performVoxelTargetInteraction` 遇到 `target.adjacent === null` 直接返回 `fallback`，不会构造或发送 Authority `interact`。
2. `performSecondaryInteraction` 随后因仍无 adjacent 显示裸文案 `无法放置`；这与 trace UI 一致，而不是 `无法交互 · <Authority reason>`。
3. 失败观察窗中门始终为 `[93,94]`，`worldRevision=142`；`interactionAttempts` 从 13 增到 14 只证明真实右键输入到达客户端，不证明 Authority Structure toggle 已分派。
4. 失败快照为 player `[70.49250030517578,32.599998474121094,0.49733904004096985]`、server player `[70.49249900007506,32.6,0.49733905377911297]`、view `[-90.12999999999998,-27.44]`、grounded true、colliding false。

首因分类为 **canonical fixture 只要求 upper target，却没有要求可交互的正交 adjacent face**。本轮没有进入 Authority/Structure dispatcher，因此不能据此判定 Structure toggle 产品拒绝。最窄后续应在不削弱 exact target 与真实 PointerLock/右键的前提下，从接触位选择可观察门面并明确校验非空正交 adjacent；后续 upper/lower 两半覆盖仍应保留。

## Browser-11 触达矩阵

- C0-C3：**PASS**。
- Classic 视觉回归：**PASS**。
- V1 四项音量与旧 file upload 移除：**PASS**。
- water-bucket 放 source / empty bucket 收 source：**PASS / PASS**。
- 正式 UI 切生存、落地无碰撞、真实走到门：**PASS**。
- 门 support+adjacent 真实 PointerLock、两格原子放置、closed descriptor、双 Chunk mesh+epoch/vertex/index：**PASS**。
- closed-door 正交 Authority 推进、safe corridor、fresh ack、6-tick 持续阻挡：**PASS**。
- 接触位 upper exact target 与真实右键输入：**PASS**；同次 adjacent 为 `null`。
- 首次 door toggle：**FAIL before Authority dispatch**；Web 显示 `无法放置`，门 `[93,94]` 与 world revision 均不变。
- open mesh/no-collision/revision、穿越及后续 upper/lower toggle：**NOT REACHED**。
- jukebox support+adjacent 瞄准/放置、record-13 fact/projection/headless audio：**NOT REACHED**。
- C4 streaming、C5 save-return-continue、developer/runtime 各自 epoch 换代、resume/eject/audio cleanup：**NOT REACHED**。
- Cua 与人类听觉体验：**NOT RUN**。

## Browser-11 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-11/`

- `classic.json.log`：Harness 原始 receipt。
- `performance-window.json.log`：原始机器窗口 receipt，window/run ID 为 `192d22bd-b0b2-4290-bfbf-3de62e2c9b86`。
- `runner-output.jsonl` / `runner-exec-event.json.log`：从本次 Trae 会话按 process `64322` 与对应 call IDs 机械抽取的 5 段原始 tool output 和最终 exit 1 事件。
- 原始 trace SHA256 为 `e58670b499b5df7c7dca0fd5b2d6599b6860ff28df99c7b684dd6d02ccff45ea`，204874565 bytes；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组。
- `failure-page.jpeg` 为 trace 最后一帧；`failure-page-source.txt` 保留原始 trace entry 名。
- `harness-artifact.json`、`playwright-last-run.json.log`、`canonical-error-context.md.log` 和 `diagnosis.json` 均已保留；全部 SHA256 见阶段 checkpoint manifest。

## Browser-11 运行后状态

- 锁内 `pnpm harness:artifact` 后验 PASS：窗口 `3ffe3f47-cd6f-44ce-a38f-df501373963c`，source/lock/276-file map/artifact digest 无漂移。
- 运行后 HEAD 仍为 `6614a1f675c93043a19fe225acab5a382481ad13`，`git status --short` 无输出，artifact receipt SHA256 仍为 `fddd6f3bd09102e329d387caa078c89c66915c5ba54be1bb31ec8f7026818db0`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；本树 Browser11、Playwright、headless Chromium、`vite preview` 均无遗留，benchmark lock 为 absent。
- Browser-11 唯一浏览器租约在证据归档与最终资源核验后释放。没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git/index/push、部署、全局配置或 source/test/dist 修改。

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

# Browser-10 正式验收追加

阶段：`V1-CANONICAL-BROWSER-10`

结论：**FAIL；Browser-09 的 closed-door 斜向绕边 oracle 问题已在真实 Authority 正交推进中关闭，随后 fixture 在门接触面试图重新瞄准 lower half 时始终命中 upper half，未发送 toggle 右键；jukebox/media/C4/C5/save 未触达。**

浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，`retries=0`。

## Browser-10 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-9727dbb9`
- HEAD/source：`9727dbb985d68e4e427759871f097abf43a8809e`
- source digest：`36d6de793361f23867dcff467f660d91f8752b871c32ee3db25248566bb5c0a2`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`f5f175d1de7c079927bc5a26569be8b79bb39915e85477994843455d0c5b68ff`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt），无 symlink；未重建、未修改。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-10-9727dbb9 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T07:07:05.931Z` 至 `2026-09-25T07:10:05.327Z`。

机器窗口：`af18e91d-2d06-48f5-8350-1b95eadbe25d`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。

Playwright 结果：`1 failed / 1 passed / 1 skipped`，单 worker、单 Chromium、无 retry、无第二 Harness 调用。Classic receipt 的 `attempts` 数组记录主旅程与未选的 non-Classic scenario，不是 retry 计数。

- C0 PASS，3.6 秒。
- C1 PASS，17.8 秒。
- C2 PASS，20.5 秒。
- C3 PASS，16.5 秒。
- V1 step 在 54.0 秒处失败；Playwright 列表中的 step 标题不表示整段通过。
- Classic 视觉回归 PASS，31.5 秒。
- non-Classic smoke 按既有条件 skipped。

## 闭门 Oracle GREEN 与后续首因

本轮在失败前已通过正式 UI/PointerLock 路径完成四项音量和旧 file upload 移除检查、water-bucket 放 source、empty bucket 收 source、正式 UI 切生存并落地、走到门位、门 support+adjacent 瞄准、两格原子放置、closed descriptor 与双 Chunk postrender mesh/epoch/vertex/index。

新 closed-door oracle 已用真实输入通过：fixture 先将 Authority 位置对齐门中线，用 PointerLock 将 `W` 对准门法向，再在 fresh ack 和 safe corridor 内推进到接触面并持续至少 6 个 Authority ticks 不穿透。完成后 player/server 仍为 `[70.49250030517578,32.599998474121094,0.4989718496799469]` / `[70.49249900119875,32.6,0.4989718402279727]`，与 voxel `93` 的接触面一致。Browser-09 的斜向绕边 oracle 缺口因此已在 browser 实际关闭。

随后流程仍处于该接触位，eye y=`32.6` 位于 upper voxel `[70,32,0]` 内，却调用无 adjacent 的 `aimAtVoxelWithRealMouse(page, door.lower)`。该 center-based 瞄准在 180 次校正后的最后 12 次 target-card 全部为 upper `[70,32,0]`，最终 view 为 `[-97.8,-88]`；从未返回 lower，因此后续 `clickCanvasCenter(..., 'right')` 没有执行，`interactionAttempts` 保持 `13`。

首因分类为 **canonical fixture 在门接触面从 upper cell 重新获取 lower half 的不可见目标**，而不是 Structure toggle 或 Authority 失败：本轮根本没有发送 toggle 动作。最窄后续是复用已经可 target 的 upper half 发送首次 toggle，或先用真实移动退回 lower 可见位；仍必须保留 exact target readback 和真实 PointerLock/右键，不应修改 production 或放宽 oracle。

## Browser-10 触达矩阵

- C0-C3：**PASS**。
- Classic 视觉回归：**PASS**。
- V1 四项音量与旧 file upload 移除：**PASS**。
- water-bucket 放 source / empty bucket 收 source：**PASS / PASS**。
- 正式 UI 切生存、落地无碰撞、真实走到门：**PASS**。
- 木门 support+adjacent 真实 PointerLock 瞄准、两格原子放置、closed descriptor、双 Chunk mesh+epoch/vertex/index：**PASS**。
- 新 closed-door 正交 Authority 推进、safe corridor、fresh ack、6-tick 持续阻挡：**PASS**。
- 接触面上重新瞄准 lower half：**FAIL**；只观察到 upper half，未发送右键。
- 开门 toggle/mesh/no-collision、穿越、上下 half toggle：**NOT REACHED**。
- jukebox 的 Browser-08 特定瞄准、放置、record-13 fact/projection/headless audio：**NOT REACHED**。
- C4 streaming、C5 save-return-continue、developer/runtime 各自 epoch 换代、resume/eject/audio cleanup：**NOT REACHED**。

## Browser-10 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-10/`

- `classic.json.log` / `classic-runtime-failure.json.log`：Harness 原始 receipt 与 trace 内自动附加的失败快照。
- `performance-window.json.log`：原始机器窗口 receipt，window/run ID 为 `af18e91d-2d06-48f5-8350-1b95eadbe25d`。
- `runner-exec-event.json.log` / `runner-output.jsonl`：从本次 Trae 会话按精确 call id 机械抽取的 argv/cwd/exit 事件与 6 段原始 tool output。
- 原始 trace SHA256 为 `3b15e827788d179c863f2e1e943e0eef9f16c052de6b0f69a66334d7326d25e1`，244108063 bytes；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组。
- `failure-page.jpeg` 是 trace 最后一帧；`failure-page-source.txt` 保留原始 trace entry 名。
- `harness-artifact.json`、`playwright-last-run.json.log`、`canonical-error-context.md.log` 和 `diagnosis.json` 均已保留；精确分片与全部 SHA256 见 checkpoint manifest。

## Browser-10 运行后状态

- 锁内 `pnpm harness:artifact` 后验 PASS：窗口 `21e64b1e-0841-4861-b97e-1a3d661156ec`，source/lock/276-file map/artifact digest 无漂移。
- 运行后 HEAD 仍为 `9727dbb985d68e4e427759871f097abf43a8809e`，`git status --short` 无输出，artifact receipt SHA256 仍为 `f5f175d1de7c079927bc5a26569be8b79bb39915e85477994843455d0c5b68ff`。
- 本章与 `diagnosis.json` 的 evidence-inclusive Prettier 终检窗口 `99b15b04-bfea-44d8-be90-d9595a9c2ded` PASS；累计报告 tracked diff 窗口 `5fd2eee7-de22-4e7d-a482-c69b8e2cfcee` PASS；新 diagnosis 的 no-index diff 窗口 `294b5a09-1cdd-49d1-aa7b-2695757906f7` PASS。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；排除查询自身后，9727 验收树、run ID、Playwright、headless Chromium 和 `vite preview` 无匹配进程；benchmark lock 不存在。
- Browser-10 唯一浏览器租约在归档与资源核验后释放。没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git/index/push、部署、全局配置或 source/test/dist 修改。

---

# Browser-09 正式验收追加

阶段：`V1-CANONICAL-BROWSER-09`

结论：**FAIL；Browser-08 的新瞄准控制已在门 support 与 door lower 的真实 PointerLock 路径中到达，但本轮在关闭木门的碰撞 fixture oracle 失败；jukebox/media/C4/C5/save 未触达。**

浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，`retries=0`。

## Browser-09 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-244b18e3`
- HEAD/source：`244b18e311c2091ab4bd03082aa02deee1a9c09f`
- source digest：`78246a53f8f391e5aa4d1a4aeccc1318de26325909b96a544cb5a041eefe5f02`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`bcd6f60bba3091dfd40e5aad90d98224198c2037b4dfd5aae2ad4418938140a2`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt），无 symlink；未重建、未修改。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-09-244b18e3 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T05:56:53.068Z` 至 `2026-09-25T05:59:25.453Z`。

机器窗口：`c95e4fa0-e195-4c43-88e5-1f011dbee53e`，`waitedMs=2`，`exitCode=1`，`measurement.status=NOT_RECORDED`。

Playwright 结果：`1 failed / 1 passed / 1 skipped`，单 worker、单 Chromium、无 retry、无第二 Harness 调用。Classic receipt 的 `attempts` 数组另记录主旅程与未选的 non-Classic scenario，不是自动重试计数。

- C0 PASS，3.5 秒。
- C1 PASS，18.5 秒。
- C2 PASS，22.8 秒。
- C3 PASS，16.7 秒。
- V1 step 在 25.0 秒处失败；Playwright 列表中的 step 标题不表示整段通过。
- Classic 视觉回归 PASS，31.6 秒。
- non-Classic smoke 按既有条件 skipped。

## 真实触达与首因

本轮在失败前已通过正式 UI/PointerLock 路径完成四项音量与旧 file upload 移除检查、water-bucket 放 source、empty bucket 收 source、正式 UI 切回生存并落地、走到门位、选择木门、精确瞄准 support+adjacent 并放置两格门。门的 closed descriptor 与两个 Chunk 的 postrender mesh/epoch/vertex/index 断言也已通过；voxel `93` 的 collision box 为 `min=[0.8125,0,0]`、`max=[1,1,1]`。

失败位于 `expectClosedDoorBlocks()`：新瞄准器用真实 PointerLock 成功重新获取 door lower，fixture 按住 `W` 1.5 秒后得到 player x=`71.343017578125`，超过固定断言 `<70.75`。这不是输入 ack 丢失：ack 从 `5549` 增至 `5640`，`KeyW` down/up 均在 trace 中。

权威 trajectory 证明关闭门碰撞实际生效，而 fixture 路径绕过了门边：

1. 按键前 player/server 为 `[68.46859,32.6,-0.44895]`，view yaw/pitch 为 `[-107.94,-35.5]`，`W` 产生同时 `+x/+z` 的斜向移动。
2. 玩家 AABB 半宽为 `0.32`；门的世界 x 碰撞面起点为 `70.8125`，因此接触时中心 x 应为 `70.8125 - 0.32 = 70.4925`。
3. trace 中权威 x 恰在 `70.49249948474204` 连续停留，同时 z 从约 `0.719995` 增至 `1.320614`；这与门碰撞面与 player AABB 的理论停点精确一致。
4. 玩家沿 z 滑出门有限宽度后，x 才恢复增长到 server `71.128954` / client `71.343018`，于是“1.5 秒后只检查 x”将绕行误判为碰撞未生效。

因此首因分类为 **canonical fixture 的 closed-door 路径/oracle 与新薄门形状不匹配**，不是门碰撞完全失效。后续应让 fixture 从不可绕边的正交路径尝试穿越，或在沿边滑出前观察权威停靠；不应放宽产品碰撞合同。本租约不授权修测试或再跑一次，因此仅保留证据交回 root 裁决。

## Browser-09 触达矩阵

- C0-C3：**PASS**。
- Classic 视觉回归：**PASS**。
- V1 四项音量与旧 file upload 移除：**PASS**。
- water-bucket 放 source / empty bucket 收 source：**PASS / PASS**。
- 正式 UI 切回生存、落地无碰撞、真实走到门：**PASS**。
- 木门 support+adjacent 真实 PointerLock 瞄准、两格原子放置、closed descriptor、双 Chunk mesh+epoch/vertex/index：**PASS**。
- 关门 collision descriptor 非空：**PASS**；不可穿越的路径 oracle：**FAIL**，真实轨迹先停在理论碰撞面、再绕过门边。
- 开门 toggle/mesh/no-collision、穿越、上下 half toggle：**NOT REACHED**。
- jukebox 真实瞄准/放置、record-13 fact/projection/audio：**NOT REACHED**。Browser-09 不能将 Browser-08 的特定 jukebox aim RED 改写为 PASS。
- C4 streaming、C5 save-return-continue、developer/runtime 各自 epoch 换代、resume/eject/audio cleanup：**NOT REACHED**。

## Browser-09 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-09/`

- `classic.json.log`：Harness 原始 receipt。
- `performance-window.json.log`：原始机器窗口 receipt，window/run ID 为 `c95e4fa0-e195-4c43-88e5-1f011dbee53e`。
- `runner-exec-event.json.log` / `runner-output.jsonl`：从本次 Trae 会话按精确 call id 机械抽取的 argv/cwd/exit 事件与 6 段原始 tool output。
- 原始 trace SHA256 为 `b2f33477da8610f35d3554ebc71be3d8d949c8a3a6b7775093c76722e05656da`，214231022 bytes；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `200b70e946d90b4000d63d1c5f74f8e7f089bcd96f71c54360a5a7ab15411a14` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `d1e539a3b5d6a7ec9dd6ddff6d2036b28c1e1693b666b8400c2748853672b73f` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `61f3d4ae539157e68bb24b6edc1907b1098e6e4f78b19aa5483be9507a41042c` `canonical-trace.zip.part-ac`（54231022 bytes）
- `failure-page.jpeg` 是 trace 最后一帧；`failure-page-source.txt` 保留原始 trace entry 名。
- `harness-artifact.json`、`playwright-last-run.json.log`、`canonical-error-context.md.log` 和 `diagnosis.json` 均已保留。各文件最终 SHA256 见本阶段 checkpoint manifest。

## Browser-09 运行后状态

- 锁内 `pnpm harness:artifact` 后验 PASS：窗口 `36b570b8-dd76-4662-ab24-1d8fad8368ec`，source/lock/276-file map/artifact digest 无漂移。
- 运行后 HEAD 仍为 `244b18e311c2091ab4bd03082aa02deee1a9c09f`，`git status --short` 无输出，artifact receipt SHA256 仍为 `bcd6f60b...140a2`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；排除查询自身后，244b 验收树、run ID、Playwright、headless Chromium 和 `vite preview` 无匹配进程；benchmark lock 不存在。
- Browser-09 唯一浏览器租约在归档与资源核验后释放。没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git/index/push、部署、全局配置或 source/test/dist 修改。

---

# Browser-06 正式验收追加

阶段：`V1-CANONICAL-BROWSER-06`
结论：**FAIL；Browser-05 的模式/落地路线 RED 已关闭，水桶放/收后正式切回生存、落地且无碰撞，并真实走到门位置。木门选择与右键已发生，但 Structure target-first dispatcher 仍以 solid support center 做 LOS，返回 `blocked`，两格门未提交。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，没有重试。

## Browser-06 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-5d52330f`
- HEAD/source：`5d52330fa58d315e9e10b1298e1bdc65e2321898`
- `git status --short`：运行前后均无输出。
- source digest：`a0775d3e5cc3747f5bd34fea09b3a1c40dc117e41c88beb7117d1a72888fb7e9`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02`
- artifact receipt SHA256：`5f55da779eb0365b78dc67ac6c34c633f4e82143dbf3d065e340eb5a031a7756`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt）；未重建、未修改。
- route-mode fixture SHA256：`caff0d9b46387e0e24b169c8d8362153c2d61ad35434637e2bd9aacd4a1699c6`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-06-5d52330f node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T03:03:27.691Z` 至 `2026-09-25T03:05:55.024Z`。
机器窗口：`e9b56811-33d6-4f8d-aefc-036a17d076e0`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：1 failed，1 passed，1 skipped，共约 2.4 分钟；没有 retry、第二次 Harness 调用或第二条浏览器线路。

- C0 PASS，约 3.9 秒。
- C1 PASS，约 17.8 秒。
- C2 PASS，约 20.9 秒。
- C3 PASS，约 17.0 秒。
- V1 step 约 22.7 秒后在门 pair 断言失败。
- Classic 视觉回归 PASS，约 31.2 秒。
- 非 Classic smoke 按既有条件 skipped。

## Route-mode GREEN 与门首因

Browser-05 的路线缺口已由真实产品行为关闭：水桶放/收断言完成后，trace 记录正式 UI 点击“切换生存模式”；snapshot 随后达到 `onGround=true && colliding=false`，真实 `walkTo` 把玩家移动到 door approach。失败终态玩家为 `[67.3538,32.6000,0.6453]`，服务端位置 `[67.3538,32.600001,0.6453]`，速度为零、落地且无碰撞。

随后 trace 证明：

1. 正式背包 UI 再次切到创造模式，选择 `wooden-door`，active hotbar 校验通过。
2. 真实鼠标将 target 调整到 support `[70,30,0]`，adjacent 为 `[70,31,0]`，并发生 canvas 右键。
3. UI 明确显示 `无法交互 · blocked`；`worldRevision` 保持 141，两格 `[70,31,0]` / `[70,32,0]` 在 5 秒内没有进入门 storage ID 89..104。
4. `structure-target-dispatch.ts` 从 support center `[70.5,30.5,0.5]` 向可信眼位追踪。按 `voxel-ray.ts` 的 1/8-block 采样和本次服务端位置确定性重放，路径依次经过 `[69,30,0]`、`[69,31,0]`、`[68,31,0]`、`[68,32,0]`；canonical floor 将 `[69,30,0]` 固定为 Stone 3，因此 dispatcher 在 invoke registered Structure operation 前返回 `blocked`。
5. adjacent center `[70.5,31.5,0.5]` 到眼位只经过 `[69,31,0]`、`[68,32,0]`，均为空。该差异与 fluid/item 路径已采用 shared-face endpoint 解决的 Browser-04 几何问题同型。

因此本次实际首个拒绝位于 **Structure target-first dispatcher 的 hit-center LOS**。`structure-host-commit.ts` 的提交前重验证也仍使用 hit/adjacent center；后续修复必须在 dispatcher 与 host 两层统一由已校验的正交 hit/adjacent 推导 shared face endpoint，同时保留 adjacent-center LOS、Manhattan 邻接、距离、授权、selection freshness、support、occupancy 与墙阻挡，不能只修前门让 host 再拒绝。本阶段只记录诊断，不改生产或测试。

## Browser-06 触达矩阵

- C0-C3：**PASS**。
- V1 四项音量与旧上传入口移除：**PASS**。
- water-bucket 放 source：**PASS**。
- empty bucket 收 source：**PASS**。
- 正式 UI 切回生存、`onGround && !colliding`、真实门 approach：**PASS**；Browser-05 RED 已关闭。
- 木门选择、瞄准与真实右键：**PASS as input reachability**；Authority 返回 `blocked`，无世界提交。
- 门两格原子放置、mesh+epoch、关闭碰撞、打开穿越及上下 half toggle：**FAIL at placement / remainder NOT REACHED**。
- jukebox/record-13 的单次 fact、projection 与真实 audio phase：**NOT REACHED**。
- C4 streaming：**NOT REACHED**。
- C5 save/continue：**NOT REACHED**。
- save-return-continue 后的新 epoch、门/slot、resumePending、无旧 fact：**NOT REACHED**。
- 真实 gesture 续播、eject stop、离开世界 audio 清理：**NOT REACHED**。
- Classic 视觉回归：**PASS**。

## Browser-06 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-06/`

- `7b66aea9c5a4c64c1674b1db1afa0834917bdd0e0e1660a086687f8d8f7410fd` `classic.json.log`
- `6b19d2d8e479f5de4a3198d5e97c154318771e6de1e6850e635aa29c492f2394` `canonical-error-context.md.log`
- 原始 trace SHA256 `391cc2feb90c5cc9dafed2f2f24f31f5272adbebecf2684fcf82f5815473b84d`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `a3428a6b55be60cc063d05cb2ecc891a7f30f5d4c767c3da2f17cf705ffb60f0` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `f454ea3fd11e334ddffe382a5e9ae6b4a2682861bfa3fe6ccc1e93a0e33569bc` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `957f4e7ab4d92b8f99f2c9f912815639cd3ed9f8481c605eb9be5d42033a3575` `canonical-trace.zip.part-ac`（42566366 bytes）
- `5f157c6dae31e6db51febe4d09e7b0314b8519b24c29d1bb75bf289e9d6b9eb3` `failure-page.jpeg`；显示木门已选中、准星位于地面 support。
- `5f55da779eb0365b78dc67ac6c34c633f4e82143dbf3d065e340eb5a031a7756` `harness-artifact.json`
- `0026c444dd0ee940c4f4a5a2cc0e5e1c2b40be16471214841ee64f2dcf956b25` `performance-window.json.log`
- `5262b31103943407deaf88a647802902459402b0d8f03911857af87b24844110` `playwright-last-run.json.log`
- `diagnosis.json` 的最终 SHA256 见阶段 checkpoint manifest。

## Browser-06 运行后状态

- `node scripts/harness/artifact.mjs` 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移；运行后 HEAD 仍为 `5d52330fa58d315e9e10b1298e1bdc65e2321898`，`git status --short` 无输出。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；排除查询自身后，acceptance-tree、run-id、Chromium、Playwright 与 `vite preview` 进程复核输出 `NO_MATCHING_PROCESSES`。
- Browser-06 唯一浏览器租约在归档与上述清理核验后释放。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或 production/test/dist 修改。

---

# Browser-08 正式验收追加

阶段：`V1-CANONICAL-BROWSER-08`
结论：**FAIL；fixture epoch 身份域修复已使完整木门旅程通过。随后玩家走到唱片机位置并选中 jukebox，但真实鼠标瞄准在相邻地板格间振荡，未发送 jukebox 右键；媒体、C4/C5 与保存恢复未触达。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，没有重试。

## Browser-08 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-06f42f5d`
- HEAD/source：`06f42f5d0943c2f12a24264d9e5e607b22b33dee`
- `git status --short`：运行前后均无输出。
- source digest：`607294f043101061d632e0b669b9aafe367c68ea6dc67d9dc1037f37cc94c245`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`6aa1a95de2f549dbf82186ca018a2bc1d272124e54269a11a99c00b33f4e9bd2`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt）；未重建、未修改。
- 两份 fixture SHA256：`v1-slice.ts` 为 `88b960730997418fb0a7cce8057b6b8c067b7c57e39225197bf0b7cddba08ddc`，`classic-runtime.spec.ts` 为 `3acb6e8bc9df85de32924ee9a9290b8e8c276c9a433d0e869ed07873242e00e0`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-08-06f42f5d node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T05:08:11.975Z` 至 `2026-09-25T05:11:26.509Z`。
机器窗口：`8c83c1ed-9482-464c-a2b0-89f70e52b78e`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
最终 runner exec event 记录同一 argv/cwd、duration 194.455 秒、exit 1。Playwright 结果：1 failed，1 passed，1 skipped，共约 3.1 分钟；没有 retry、第二次 Harness 调用或第二条浏览器线路。

- C0 PASS，约 3.9 秒。
- C1 PASS，约 17.5 秒。
- C2 PASS，约 23.6 秒。
- C3 PASS，约 17.2 秒。
- V1 step 约 58.5 秒后在 jukebox support 瞄准失败。
- Classic 视觉回归 PASS，约 33.2 秒。
- 非 Classic smoke 按既有条件 skipped。

## 门 GREEN 与首因

Browser-07 的 epoch fixture 缺口已关闭。本次同域 baseline 让 closed/open mesh 的 exact epoch、vertex/index 与 media baseline 校验继续执行，并完成完整门旅程：

- 水桶放 source、空桶收 source、正式 UI 切生存和门 approach 均通过；
- 木门两格原子提交、descriptor、两个 Chunk 的闭门 mesh 薄轴、每个 mesh 的 vertex/index/runtime epoch 均通过；
- closed collision 存在，真实前进输入被门阻挡；
- lower half 右键打开后两格状态同步变化、collision 为空、mesh 薄轴旋转且 Chunk revision 前进；
- 玩家真实穿过打开的门；upper half 右键关闭、lower half 再次右键打开均通过。

终态 `worldRevision=145`，与放置后的 revision 142 再增加三次 toggle 一致。随后玩家到达 jukebox approach `[73.5,2.5]`，最终位置 `[73.7430,32.6000,2.7646]`、`onGround=true`、`colliding=false`，并通过正式创造目录选中 jukebox。

首个失败发生在 `placeSelected()` 的 `aimAtVoxelWithRealMouse(page, [76,30,2], [76,31,2])` 内，尚未调用 `clickCanvasCenter`：helper 用真实 Pointer Lock mouse 最多校正 180 次，但最后观测持续在 `[75,30,2]` 与 `[75,30,3]` 间振荡，从未重新取得 support `[76,30,2]`，最终由 `aim.ts:99` 抛错。失败页也显示 jukebox 已选中且准星落在邻近地面。

因此本次首因分类为 **canonical fixture 的真实鼠标瞄准收敛失败**，不是 jukebox 或 media 生产失败；没有 jukebox 右键、voxel 提交、record insert、fact、projection 或 audio 结果可供判断。本租约不授权修改 fixture 或第二次 attempt，只保留原始证据交 root 裁决。

## Browser-08 触达矩阵

- C0-C3：**PASS**。
- V1 四项音量与旧上传入口移除：**PASS**。
- water-bucket 放 source、empty bucket 收 source：**PASS**。
- 正式 UI 切回生存、落地、真实门 approach：**PASS**。
- 门两格原子提交、descriptor、双 Chunk mesh vertex/index/exact runtime epoch：**PASS**。
- closed collision、lower half 打开、打开 mesh 旋转、真实穿越、upper half 关闭、lower half 再打开：**PASS**。
- jukebox approach 与正式创造目录选中：**PASS**。
- jukebox 瞄准：**FAIL**；未发送右键。
- jukebox 放置、record-13 insert、fact/projection/audio：**NOT REACHED**。
- C4 streaming：**NOT REACHED**。
- C5 save/continue：**NOT REACHED**。
- restore 后新 runtime epoch 与 developer identity 各自换代、门/slot、resumePending、无旧 fact：**NOT REACHED**。
- 真实 gesture 续播、eject stop、离开世界 audio 清理：**NOT REACHED**。
- Classic 视觉回归：**PASS**。

## Browser-08 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-08/`

- `0d6fbd6d89dcdf7c09559688bca7f47f40a3dfff70d6c1900594184989b43ee8` `classic.json.log`
- `d8302ce9b6fa5f171f5d996dea077ea3d7f81d58c39c1cf228565fc71bd9ecb4` `canonical-error-context.md.log`
- 原始 trace SHA256 `c44963dfd3d562a69b36e5ec0011fd32e4a99b623d34c931562d8ee38bc776cc`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `303293e409205dc73c18c5715585e27ad13d5350e71d425d09cba83bfac2a451` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `ffb0a43d1628d4a7fc74d1aad2f0584f59bf7aef0edc07095944eb024d826b92` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `74597b582c1ee58c4e60942f8cdd020f4be09e8a74a8578ab6b88db6ee74c7ed` `canonical-trace.zip.part-ac`（80000000 bytes）
  - `c0ed8b04395f92fde0b016a24a6c8ba2a8e62492329ae2336a41a90af20ff618` `canonical-trace.zip.part-ad`（53161054 bytes）
- `7c35fa0a3bb40a88f9bc6f202c0cb91d4e07501e2413cace03b66ccc933c9518` `failure-page.jpeg`；显示 jukebox 已选中、准星位于邻近地板。
- `6aa1a95de2f549dbf82186ca018a2bc1d272124e54269a11a99c00b33f4e9bd2` `harness-artifact.json`
- `f9a447eb98548ae134839d5c63090734b6b31390b850218f77c22b4dfbb78fe8` `performance-window.json.log`
- `5262b31103943407deaf88a647802902459402b0d8f03911857af87b24844110` `playwright-last-run.json.log`
- `runner-output.jsonl`：仅包含 session `23823` 的七个原始终端 chunk；最终 SHA256 见 checkpoint manifest。
- `runner-exec-event.json.log`：唯一 Harness argv/cwd/duration/exit 的平台原始事件；最终 SHA256 见 checkpoint manifest。
- `artifact-postcheck-window.json.log`：锁内 artifact 后验校验窗口；最终 SHA256 见 checkpoint manifest。
- `diagnosis.json`：机器可读触达矩阵与首因；最终 SHA256 见 checkpoint manifest。

## Browser-08 运行后状态

- 锁内 `node scripts/harness/artifact.mjs` 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `06f42f5d0943c2f12a24264d9e5e607b22b33dee`，`git status --short` 无输出，artifact receipt SHA256 仍为 `6aa1a95d...f4e9bd2`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；按可执行名过滤 Chromium、Playwright 与 `vite preview` 的进程复核输出 `NO_BROWSER_OR_PREVIEW_PROCESSES`。
- Browser-08 唯一浏览器租约在归档与上述清理核验后释放。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或 production/test/dist 修改。

---

# Browser-07 正式验收追加

阶段：`V1-CANONICAL-BROWSER-07`
结论：**FAIL；Structure shared-face 修复已使木门完成两格原子提交，并产生两个 Chunk 的闭门薄轴 mesh。首个失败是 canonical fixture 把 developer world owner epoch 与 Browser Authority runtime epoch 当成同一身份比较；碰撞/toggle、媒体、C4/C5 与保存恢复尚未触达。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，没有重试。

## Browser-07 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-46b81735`
- HEAD/source：`46b8173538f7e162f79c16fc92864139b3bc24a8`
- `git status --short`：运行前后均无输出。
- source digest：`96532a3ecc82140d83d3d5c1b32c533d3f449d3c26269929295d8dfe7af717d9`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`78f2ce2396d8bc8314dd048d491e3b5dd4191f5a2d2ef04bd6c9aa752c253259`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt）；未重建、未修改。
- Pack lock SHA256：`863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b`。
- MP3：2976045 bytes、`audio/mpeg`、SHA256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-07-46b81735 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T04:17:17.773Z` 至 `2026-09-25T04:19:43.946Z`。
机器窗口：`e28f49a7-1346-4b0d-ae03-d324449ca752`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
最终 runner exec event 记录同一 argv/cwd、duration 146.113 秒、exit 1。Playwright 结果：1 failed，1 passed，1 skipped，共约 2.4 分钟；没有 retry、第二次 Harness 调用或第二条浏览器线路。

- C0 PASS，约 3.5 秒。
- C1 PASS，约 17.8 秒。
- C2 PASS，约 21.1 秒。
- C3 PASS，约 16.4 秒。
- V1 step 约 21.5 秒后在门 mesh epoch oracle 失败。
- Classic 视觉回归 PASS，约 31.7 秒。
- 非 Classic smoke 按既有条件 skipped。

## 门进展与首因

Browser-06 的 Structure hit LOS 阻塞已关闭。正式旅程完成水桶放/收、UI 切生存、落地和门 approach 后，真实选择 wooden-door 并右键：

- door pair storage ID 范围断言通过，两格均为合法门 variant；
- `worldRevision` 从 Browser-06 同边界的 141 前进到 142；
- `lastCommitMutationCount=2`，证明本次世界提交包含两格；
- geometry descriptor 存在、非 full-face occluder、恰有一个 box；
- lower/upper 分属两个 Chunk，两个 `FaceMaterial.WoodenDoor` postrender mesh 都存在且闭门薄轴均为 X 轴。

随后 `v1-slice.ts:126` 在进入 per-mesh 循环前比较 epoch 失败：fixture 预期 `seedlands:classic-canonical-runtime-v11:1:world:0`，Harness media snapshot 返回 `seedlands:classic-canonical-runtime-v11:1`。只读合同与源码确认：

1. `v1-harness-contract.md` 冻结 mesh/media `worldEpoch` 由 Browser Harness 组合层取当前 Authority `runtimeEpoch`，用于阻止旧 renderer/media owner 冒充当前世界。
2. Browser Authority 初次 runtime epoch 为 session epoch `…:1`；`game.ts` 用同值绑定 rendered world 与 media。
3. fixture 的 `runtimeEpoch()` 实际调用 `__seedlandsHarness.world.identity()`，得到 developer world/persistence owner epoch `…:world:0`。
4. 两个值都合法，但属于不同身份域，不能直接相等比较。当前实际 mesh/media epoch 与冻结 Harness 合同一致，因此首因是 **canonical fixture epoch-domain mismatch**，不是 renderer/media stale 绑定。

本租约不授权改测试或再跑；后续最窄修复应让 canonical fixture 从同一 Browser Authority/runtime 观察面取得期望 epoch，或把已返回的当前 mesh/media epoch 作为同域基线，并继续验证 restore 后 epoch 必须变化。不得删掉 epoch 断言、改成仅非空或拿 developer world owner epoch冒充 runtime epoch。

## Browser-07 触达矩阵

- C0-C3：**PASS**。
- V1 四项音量与旧上传入口移除：**PASS**。
- water-bucket 放 source：**PASS**。
- empty bucket 收 source：**PASS**。
- 正式 UI 切回生存、落地、真实门 approach：**PASS**。
- 木门两格原子提交：**PASS**；world revision `+1`，本次 mutation count 为 2。
- 门 geometry descriptor 与两个 Chunk 的闭门薄轴 mesh：**PASS**。
- 每个 mesh 的 vertex/index/epoch 断言：**NOT REACHED**；在进入循环前的 media worldEpoch 比较失败。
- 关闭门 collision、开门/toggle/穿越、upper/lower half：**NOT REACHED**。
- jukebox/record-13 的单次 fact、projection 与真实 audio phase：**NOT REACHED**。
- C4 streaming：**NOT REACHED**。
- C5 save/continue：**NOT REACHED**。
- save-return-continue 后的新 epoch、门/slot、resumePending、无旧 fact：**NOT REACHED**。
- 真实 gesture 续播、eject stop、离开世界 audio 清理：**NOT REACHED**。
- Classic 视觉回归：**PASS**。

## Browser-07 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-07/`

- `4810362ebdcb1f5df6b3adbd96a6cec962b592c3a4ea1f9acdfecf59037df8e1` `classic.json.log`
- `b1133457838c5e10ff77ce23247e78545642ac8f9f92b348b698910f7d0f0d1f` `canonical-error-context.md.log`
- 原始 trace SHA256 `cefdba6113f360990f1f4bbfc7a527cffa12049725ae0c7914648512dd6727ec`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `46539d2fec26abe7655be36121b3bf916b6903327e385f8bfc489310cab1b78b` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `adedd31ac1bb789fc41255c2967b2387f9679dd427f7a923805ffc9f1ab913fc` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `fae18b3e21201cd308edf794e4ee883f68e1e4f9b05f1ea673ee93c75d255413` `canonical-trace.zip.part-ac`（40427454 bytes）
- `0d28f42969d28741b727e3229e23d516c5299461cf753a41adadc9677d62a191` `failure-page.jpeg`；Playwright 失败后暂停菜单页面，不作为 epoch 根因的独立证明。
- `78f2ce2396d8bc8314dd048d491e3b5dd4191f5a2d2ef04bd6c9aa752c253259` `harness-artifact.json`
- `8b26fca2c415b76bf1657aca81e167068af8c344444105855bdaf2e997a4bbd9` `performance-window.json.log`
- `5262b31103943407deaf88a647802902459402b0d8f03911857af87b24844110` `playwright-last-run.json.log`
- `runner-output.jsonl`：仅包含 session `34037` 的五个原始终端 chunk；最终 SHA256 见 checkpoint manifest。
- `runner-exec-event.json.log`：唯一 Harness argv/cwd/duration/exit 的平台原始事件；最终 SHA256 见 checkpoint manifest。
- `artifact-postcheck-window.json.log`：锁内 artifact 后验校验窗口；最终 SHA256 见 checkpoint manifest。
- `diagnosis.json`：机器可读触达矩阵与身份域诊断；最终 SHA256 见 checkpoint manifest。

## Browser-07 运行后状态

- 锁内 `node scripts/harness/artifact.mjs` 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `46b8173538f7e162f79c16fc92864139b3bc24a8`，`git status --short` 无输出，artifact receipt SHA256 仍为 `78f2ce23...c253259`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；按可执行名过滤 Chromium、Playwright 与 `vite preview` 的进程复核输出 `NO_BROWSER_OR_PREVIEW_PROCESSES`。
- Browser-07 唯一浏览器租约在归档与上述清理核验后释放。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或 production/test/dist 修改。

---

# Browser-07 正式验收追加

阶段：`V1-CANONICAL-BROWSER-07`
结论：**FAIL；Structure shared-face 修复已使木门完成两格原子提交，并产生两个 Chunk 的闭门薄轴 mesh。首个失败是 canonical fixture 把 developer world owner epoch 与 Browser Authority runtime epoch 当成同一身份比较；碰撞/toggle、媒体、C4/C5 与保存恢复尚未触达。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，没有重试。

## Browser-07 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-46b81735`
- HEAD/source：`46b8173538f7e162f79c16fc92864139b3bc24a8`
- `git status --short`：运行前后均无输出。
- source digest：`96532a3ecc82140d83d3d5c1b32c533d3f449d3c26269929295d8dfe7af717d9`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e`
- artifact receipt SHA256：`78f2ce2396d8bc8314dd048d491e3b5dd4191f5a2d2ef04bd6c9aa752c253259`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt）；未重建、未修改。
- Pack lock SHA256：`863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b`。
- MP3：2976045 bytes、`audio/mpeg`、SHA256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-07-46b81735 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T04:17:17.773Z` 至 `2026-09-25T04:19:43.946Z`。
机器窗口：`e28f49a7-1346-4b0d-ae03-d324449ca752`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
最终 runner exec event 记录同一 argv/cwd、duration 146.113 秒、exit 1。Playwright 结果：1 failed，1 passed，1 skipped，共约 2.4 分钟；没有 retry、第二次 Harness 调用或第二条浏览器线路。

- C0 PASS，约 3.5 秒。
- C1 PASS，约 17.8 秒。
- C2 PASS，约 21.1 秒。
- C3 PASS，约 16.4 秒。
- V1 step 约 21.5 秒后在门 mesh epoch oracle 失败。
- Classic 视觉回归 PASS，约 31.7 秒。
- 非 Classic smoke 按既有条件 skipped。

## 门进展与首因

Browser-06 的 Structure hit LOS 阻塞已关闭。正式旅程完成水桶放/收、UI 切生存、落地和门 approach 后，真实选择 wooden-door 并右键：

- door pair storage ID 范围断言通过，两格均为合法门 variant；
- `worldRevision` 从 Browser-06 同边界的 141 前进到 142；
- `lastCommitMutationCount=2`，证明本次世界提交包含两格；
- geometry descriptor 存在、非 full-face occluder、恰有一个 box；
- lower/upper 分属两个 Chunk，两个 `FaceMaterial.WoodenDoor` postrender mesh 都存在且闭门薄轴均为 X 轴。

随后 `v1-slice.ts:126` 在进入 per-mesh 循环前比较 epoch 失败：fixture 预期 `seedlands:classic-canonical-runtime-v11:1:world:0`，Harness media snapshot 返回 `seedlands:classic-canonical-runtime-v11:1`。只读合同与源码确认：

1. `v1-harness-contract.md` 冻结 mesh/media `worldEpoch` 由 Browser Harness 组合层取当前 Authority `runtimeEpoch`，用于阻止旧 renderer/media owner 冒充当前世界。
2. Browser Authority 初次 runtime epoch 为 session epoch `…:1`；`game.ts` 用同值绑定 rendered world 与 media。
3. fixture 的 `runtimeEpoch()` 实际调用 `__seedlandsHarness.world.identity()`，得到 developer world/persistence owner epoch `…:world:0`。
4. 两个值都合法，但属于不同身份域，不能直接相等比较。当前实际 mesh/media epoch 与冻结 Harness 合同一致，因此首因是 **canonical fixture epoch-domain mismatch**，不是 renderer/media stale 绑定。

本租约不授权改测试或再跑；后续最窄修复应让 canonical fixture 从同一 Browser Authority/runtime 观察面取得期望 epoch，或把已返回的当前 mesh/media epoch 作为同域基线，并继续验证 restore 后 epoch 必须变化。不得删掉 epoch 断言、改成仅非空或拿 developer world owner epoch冒充 runtime epoch。

## Browser-07 触达矩阵

- C0-C3：**PASS**。
- V1 四项音量与旧上传入口移除：**PASS**。
- water-bucket 放 source：**PASS**。
- empty bucket 收 source：**PASS**。
- 正式 UI 切回生存、落地、真实门 approach：**PASS**。
- 木门两格原子提交：**PASS**；world revision `+1`，本次 mutation count 为 2。
- 门 geometry descriptor 与两个 Chunk 的闭门薄轴 mesh：**PASS**。
- 每个 mesh 的 vertex/index/epoch 断言：**NOT REACHED**；在进入循环前的 media worldEpoch 比较失败。
- 关闭门 collision、开门/toggle/穿越、upper/lower half：**NOT REACHED**。
- jukebox/record-13 的单次 fact、projection 与真实 audio phase：**NOT REACHED**。
- C4 streaming：**NOT REACHED**。
- C5 save/continue：**NOT REACHED**。
- save-return-continue 后的新 epoch、门/slot、resumePending、无旧 fact：**NOT REACHED**。
- 真实 gesture 续播、eject stop、离开世界 audio 清理：**NOT REACHED**。
- Classic 视觉回归：**PASS**。

## Browser-07 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-07/`

- `4810362ebdcb1f5df6b3adbd96a6cec962b592c3a4ea1f9acdfecf59037df8e1` `classic.json.log`
- `b1133457838c5e10ff77ce23247e78545642ac8f9f92b348b698910f7d0f0d1f` `canonical-error-context.md.log`
- 原始 trace SHA256 `cefdba6113f360990f1f4bbfc7a527cffa12049725ae0c7914648512dd6727ec`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `46539d2fec26abe7655be36121b3bf916b6903327e385f8bfc489310cab1b78b` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `adedd31ac1bb789fc41255c2967b2387f9679dd427f7a923805ffc9f1ab913fc` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `fae18b3e21201cd308edf794e4ee883f68e1e4f9b05f1ea673ee93c75d255413` `canonical-trace.zip.part-ac`（40427454 bytes）
- `0d28f42969d28741b727e3229e23d516c5299461cf753a41adadc9677d62a191` `failure-page.jpeg`；Playwright 失败后暂停菜单页面，不作为 epoch 根因的独立证明。
- `78f2ce2396d8bc8314dd048d491e3b5dd4191f5a2d2ef04bd6c9aa752c253259` `harness-artifact.json`
- `8b26fca2c415b76bf1657aca81e167068af8c344444105855bdaf2e997a4bbd9` `performance-window.json.log`
- `5262b31103943407deaf88a647802902459402b0d8f03911857af87b24844110` `playwright-last-run.json.log`
- `runner-output.jsonl`：仅包含 session `34037` 的五个原始终端 chunk；最终 SHA256 见 checkpoint manifest。
- `runner-exec-event.json.log`：唯一 Harness argv/cwd/duration/exit 的平台原始事件；最终 SHA256 见 checkpoint manifest。
- `artifact-postcheck-window.json.log`：锁内 artifact 后验校验窗口；最终 SHA256 见 checkpoint manifest。
- `diagnosis.json`：机器可读触达矩阵与身份域诊断；最终 SHA256 见 checkpoint manifest。

## Browser-07 运行后状态

- 锁内 `node scripts/harness/artifact.mjs` 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `46b8173538f7e162f79c16fc92864139b3bc24a8`，`git status --short` 无输出，artifact receipt SHA256 仍为 `78f2ce23...c253259`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；按可执行名过滤 Chromium、Playwright 与 `vite preview` 的进程复核输出 `NO_BROWSER_OR_PREVIEW_PROCESSES`。
- Browser-07 唯一浏览器租约在归档与上述清理核验后释放。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或 production/test/dist 修改。

---

# Browser-05 正式验收追加

阶段：`V1-CANONICAL-BROWSER-05`
结论：**FAIL；C0-C3、V1 音频设置、水桶放 source、空桶收 source 与 Classic 视觉回归通过。随后在门放置前，创造飞行与 `walkTo(..., { jump: true })` 的落地等待条件冲突，门、媒体、C4/C5 和保存恢复均未触达。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，没有重试。

## Browser-05 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-0d199371`
- HEAD/source：`0d19937123506d5e6b30af8ad9ebdf40aad28509`
- `git status --short`：运行前后均无输出。
- source digest：`44a0e80f849cae44124228f464d6e7916801440aff2db6fd1cb84e95573cffb2`
- lock digest：`44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`
- artifact digest：`a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02`
- artifact receipt SHA256：`e41beefb89468632986960b4e7adcca5218a7e15eed63bd43937f274271a8637`
- dist：276 个 stamped 文件，磁盘共 277 个文件（含 receipt）；复用既有产物，未重建、未修改。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-05-0d199371 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-25T02:28:16.369Z` 至 `2026-09-25T02:30:56.127Z`。
机器窗口：`319d5d90-396a-4e4d-84f9-caaccf4fdabb`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：1 failed，1 passed，1 skipped，共约 2.6 分钟；没有 retry、第二次 Harness 调用或第二条浏览器线路。

- C0 PASS，约 3.5 秒。
- C1 PASS，约 17.6 秒。
- C2 PASS，约 20.7 秒。
- C3 PASS，约 15.8 秒。
- V1 step 约 35.9 秒后失败。
- Classic 视觉回归 PASS，约 31.5 秒。
- 非 Classic smoke 按既有条件 skipped。

## V1 进展与首因

本次已越过 Browser-04 的 fluid target 阻塞。`completeV1SliceBeforeSave()` 依次完成以下正式产品断言：

1. 设置页仍有总音量、音乐、音效、环境四项，且旧文件上传入口不存在。
2. 通过创造目录选择 `water-bucket`，真实瞄准 `[68,30,2]`、右键 adjacent `[68,31,2]`，权威/浏览器 voxel 变为 Water `8`，fluid cell 为 source。
3. 通过创造目录选择空桶，真实瞄准 source 并右键，voxel 恢复 Air `0`，active hotbar item 保持 `bucket`，符合 creative 不消耗/不产生余物合同。

失败发生在下一行 `v1-slice.ts:179` 的 `walkTo(page, door.approach, { jump: true })`，尚未选择或放置木门。现有 trace、receipt 与最终页面帧共同证明：

1. `selectCreativeItem()` 为选择水桶而正式点击“切换创造模式”；产品同时启用 creative flight，并显示“创造模式 · 不受伤害”。
2. 门路线 helper 仍按 `jump:true` 对 `Space` 做真实 key down/up；在飞行模式中 `Space` 是上升而非地面跳跃。
3. 最终 x/z `[67.4773,0.4280]` 已满足门 approach `[67.5,0.5]`，但 player/server y 停在 `34.7000`，`serverPlayerVelocity=[0,0,0]`、`colliding=false`、`onGround=false`。
4. `walkTo()` 在每次真实输入脉冲后要求 `acknowledgedInputSequence` 前进且 `onGround && !colliding`；创造飞行悬停不会重新落地，所以该 predicate 等待 20 秒后超时。
5. 终态 `water.bodyFraction=0`、`swimming=false`、`wading=false`，故不是残留水体让玩家无法落地。

因此首因分类为 **canonical route 的地面跳跃 helper 与已启用的创造飞行语义不兼容**。这不是门 runtime、门 geometry/collision、媒体或保存恢复的失败，因为对应动作均尚未发生。本租约不授权改场景、测试或产品，也不授权第二 attempt，因此仅保留证据并交接后续修复。

## Browser-05 触达矩阵

- C0-C3：**PASS**。
- V1 四项音量与旧上传入口移除：**PASS**。
- water-bucket 放 source：**PASS**；目标为 Water，fluid sidecar 为 source。
- empty bucket 收 source：**PASS**；目标回到 Air，creative hotbar 仍为 bucket。
- door 两格跨 Chunk、实际 mesh+epoch、关闭碰撞、打开穿越及上下 half toggle：**NOT REACHED**；失败发生在门 approach，木门尚未选择/放置。
- jukebox/record-13 的单次 fact、projection 与真实 audio phase：**NOT REACHED**。
- C4 streaming：**NOT REACHED**。
- C5 save/continue：**NOT REACHED**。
- save-return-continue 后的新 epoch、门/slot、resumePending、无旧 fact：**NOT REACHED**。
- 真实 gesture 续播、eject stop、离开世界 audio 清理：**NOT REACHED**。
- Classic 视觉回归：**PASS**。

## Browser-05 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-05/`

- `322cc3a21f502f3fd246b3169a753b26ec44f2284d21c08eacb822656b151770` `classic.json.log`
- `734ea10e15da2203932d000953ed5260a6780f08b471d6c60361397de72a5854` `canonical-error-context.md.log`
- 原始 trace SHA256 `977dcaa7b32e99010dd8c93d85469661c8aa95ad4c56a82412658a160ba32fee`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `7f9a76a214740e2318129589ffa02bfb50dada2f4747721cfe4265a4f6f61de2` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `72e77ce70169dcb49bcd589e008f5050aa8633826c9ecc229b087424450da1a1` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `37121cbc5571f35e528ce702e4f2bc97fd9b1b23351bd7986ad77881e8df59b2` `canonical-trace.zip.part-ac`（78915766 bytes）
- `d8df0d0632e65266db12529f263f2ce71837cb0103225f8cb4c34c4cecfb063f` `failure-page.jpeg`；trace 中最后一个页面帧，显示创造模式、空桶选中与高处悬停。
- `e41beefb89468632986960b4e7adcca5218a7e15eed63bd43937f274271a8637` `harness-artifact.json`
- `a969ac79399721c1f904a692fdfb6a4a8d82737842694b6e681c496df1285978` `performance-window.json.log`
- `5262b31103943407deaf88a647802902459402b0d8f03911857af87b24844110` `playwright-last-run.json.log`
- `diagnosis.json` 的最终 SHA256 见阶段 checkpoint manifest。

## Browser-05 运行后状态

- `node scripts/harness/artifact.mjs` 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `0d19937123506d5e6b30af8ad9ebdf40aad28509`，`git status --short` 无输出，artifact receipt SHA256 仍为 `e41beef...1a8637`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；排除查询自身后，acceptance-tree、run-id、Chromium、Playwright 与 `vite preview` 进程复核输出 `NO_MATCHING_PROCESSES`。
- Browser-05 唯一浏览器租约在归档与上述清理核验后释放。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或 production/test/dist 修改。

---

# Browser-04 正式验收追加

阶段：`V1-CANONICAL-BROWSER-04`
结论：**FAIL；C0-C3 与 Classic 视觉回归通过，首个 V1 water-bucket 动作仍被 Authority 以 `blocked` 拒绝。Browser-03 的脚位 origin 缺口已关闭，本次暴露的是 solid hit center LOS 的第二个几何问题。**
浏览器租约：本阶段唯一 Playwright/Chromium owner；只执行一次正式 attempt，没有重试。

## Browser-04 身份与命令

- 保留干净树：`/private/tmp/seedlands-v1-acceptance-23069d71`
- HEAD/source：`23069d710086597964e0976dd6228ca4f7b1bb79`
- `git status --short`：运行前后均无输出。
- artifact digest：`1df45ffb2a7a95b4cd02375b6b1e92a3fe92d701636f19fecd01e15127df918e`
- artifact receipt SHA256：`9fd52ead183af6487030fb24b6f522a84e45e46d08a335cad88f94b2aa00a1b8`
- dist：276 个文件；复用既有产物，未重建、未修改。
- 公共 dispatcher origin 修复文件 SHA256：`5d0e61e339297314e0342a17fa4b32191b3384ff4b16c601e9e678056659cd0a`。
- fluid host origin 修复文件 SHA256：`89421e4f4be44d0a18e22965f73745dffb3a4f905ca1c1b61765a178eede062f`。

精确命令：

```sh
env SEEDLANDS_HARNESS_RUN_ID=v1-canonical-browser-04-23069d71 node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
```

时间：`2026-09-24T23:06:54.252Z` 至 `2026-09-24T23:09:09.134Z`。
机器窗口：`f8c8c820-8145-49b9-bffe-a83f52203fca`，`waitedMs=1`，`exitCode=1`，`measurement.status=NOT_RECORDED`。
Playwright 结果：1 failed，1 passed，1 skipped；没有 retry、第二次 Harness 调用或第二条浏览器线路。

- C0 PASS，约 3.5 秒。
- C1 PASS，约 18.7 秒。
- C2 PASS，约 22.1 秒。
- C3 PASS，约 15.8 秒。
- V1 步骤约 12.8 秒后在第一条 water-bucket 动作失败。
- Classic 视觉回归 PASS，约 30.7 秒。
- 非 Classic smoke 按既有条件 skipped。

## Water-bucket 结果与首因

真实浏览器链已到达创造目录选择、瞄准与 canvas 右键：active hotbar item 为 `water-bucket`，target card 为 hit `[68,30,2]`，其正交 adjacent 为 `[68,31,2]`。右键后 UI 明确显示 `无法交互 · blocked`；`apps/web/tests/e2e/classic-support/v1-slice.ts:171` 在 5 秒内持续读到 Air `0`，未得到 Water `8`。失败 receipt 为：

- camera/player `[65.34008026123047,32.60000228881836,2.6025679111480713]`；
- `serverPlayerPosition=[65.34008376511767,32.600001,2.602567930028762]`，该 Harness 字段已包含 `PLAYER_FEET_OFFSET=1.6`，对应 Authority body 约为 `[65.34008376511767,31.000001,2.602567930028762]`；
- `interactionAttempts=11`、`worldRevision=14`、`commitSequence=48937`、`actionCompletionCount=12`、`actionFailureCount=0`。

本 artifact 已包含 dispatcher 与 fluid host 的可信眼位 origin 修复，因此这不是 Browser-03 的旧脚位问题。现有 trace 与只读源码重放把剩余拒绝收敛到 hit LOS 的终点语义：

1. dispatcher 从服务端可信眼位向 solid hit voxel **中心** `[68.5,30.5,2.5]` 追踪。
2. 该线段会采样相邻 floor Stone `[67,30,2]`，因此得到 `blocked`。
3. 由正交 `hit -> adjacent` 推导的共享面中心 `[68.5,31,2.5]`，以及 adjacent center `[68.5,31.5,2.5]`，均不穿过该 floor。
4. 客户端协议只提交整数 hit/adjacent，不提交 camera、yaw、operationId、itemId 或不可信精确命中点。

因此当前首因分类为 **solid hit center LOS 与有效暴露面不一致**。后续最窄安全修复应由服务端从已校验的正交 hit/adjacent delta 推导共享面中心作为 hit 可见性终点，同时继续保留 adjacent-center LOS、Manhattan 邻接、半径、授权、选择新鲜度与隔墙拒绝。此处仅记录诊断，不表示修复或产品通过。

## Browser-04 V1 触达矩阵

- C0-C3：**PASS**。
- Classic 视觉回归：**PASS**。
- water-bucket 放 source：**FAIL at first V1 action**；真实 select/aim/right-click 已发生，Authority 返回 `blocked`，目标保持 Air。
- empty bucket 收 source：**NOT REACHED**。
- door 两格跨 Chunk、实际 mesh+epoch、关闭碰撞、打开穿越及上下 half toggle：**NOT REACHED**。
- jukebox/record-13 的单次 fact、projection 与真实 audio phase：**NOT REACHED**。
- C4 streaming 与 C5 save/continue：**NOT REACHED**。
- save-return-continue 后的新 epoch、门/slot、resumePending、无旧 fact：**NOT REACHED**。
- 真实 gesture 续播、eject stop、离开世界 audio 清理：**NOT REACHED**。

## Browser-04 原始证据

目录：`changes/2026-09-23-classic-functional-completion/evidence/v1-canonical-browser-04/`

- `169e6670bda5fc440fe1769f6c8375f40966ec279e07caac0f89e63657457c09` `classic.json.log`
- `5537a948f745541a108a24064b6c402683da83915d2729b02a7f53a420143385` `canonical-error-context.md.log`
- 原始 trace SHA256 `0368e687a480be80c7ac0c1874df005c60359b13f9cda3c60ba19b99dbee19cd`；按文件名字节序执行 `cat canonical-trace.zip.part-* > canonical-trace.zip` 可无损重组：
  - `10b87883df87f2ae8c7164851ba0a8be3cbb513f696559def503739b2da4d647` `canonical-trace.zip.part-aa`（80000000 bytes）
  - `1bfd2cbb559218b7bfcc0b066908fef5c6dcdb3b02b94f310229529fdba7c065` `canonical-trace.zip.part-ab`（80000000 bytes）
  - `8f93862599bc68803d93493c5d48b0c26d54101db762c71e4ed9bf0513ac574e` `canonical-trace.zip.part-ac`（33643417 bytes）
- `9fd52ead183af6487030fb24b6f522a84e45e46d08a335cad88f94b2aa00a1b8` `harness-artifact.json`
- `5fa808bf046bd4c606b329fd5411df6473443da37a933927a75907e02803259a` `performance-window.json.log`
- `diagnosis.json` 的最终 SHA256 见阶段 checkpoint manifest。

## Browser-04 运行后状态

- `harness:classic` 失败后 artifact 后验校验 PASS：source、lock、276-file map 与 artifact digest 均未漂移。
- 运行后 HEAD 仍为 `23069d710086597964e0976dd6228ca4f7b1bb79`，`git status --short` 无输出，artifact receipt SHA256 仍为 `9fd52ead...00a1b8`。
- `lsof -nP -iTCP:4273 -sTCP:LISTEN` 无输出；排除查询进程自身后的 acceptance-tree、Chromium、Playwright 与 `vite preview` 进程复核输出 `NO_MATCHING_PROCESSES`。
- Browser-04 唯一浏览器租约在归档与上述清理核验后释放。
- 没有启动 Cua、第二浏览器路线或第二 attempt；没有 build、CI、Git commit/push、部署、依赖安装、全局配置或 production/test/dist 修改。

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
