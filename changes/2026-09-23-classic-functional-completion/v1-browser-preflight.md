# V1.9 浏览器验收预检

## 目的与边界

本文件只冻结后续一次“水桶 → 门 → 唱片”的真实浏览器旅程。它不启动构建、Preview、Chromium、Cua/Jev 或测试，也不把单元测试、CLI 存在、静态代码或陈旧产物视为可玩证据。唯一浏览器必须由 root 发放租约，并在同一生产 `dist` 上串行完成 canonical Harness 与 Cua/Jev 观察。

## 当前已核实

- 唯一生产构建入口是 `pnpm build`；它生成 `apps/web/dist/harness-artifact.json`。`node scripts/harness/artifact.mjs` 校验 `sourceSha`、`sourceDigest`、`lockDigest`、文件清单和 `artifactDigest`。
- 唯一 canonical Chromium 入口是 `pnpm harness:classic`，只运行 `apps/web/tests/e2e/classic-runtime.spec.ts`，单 worker、headless，并在运行前后复核同一 artifact。
- 当前 `dist` 不可复用：receipt 的 `sourceSha` 为 `50e780b576c36573e0d47399656a962a9787f5a2`，调查时 HEAD 为 `ad3f1d5c9298c9fd0dc3f4a6e219d27a1186ebaf`，校验准确失败为 `BLOCKED: Stale production identity: sourceSha`。这是代码冻结后正常重建 production artifact 的前置依赖，不是否定当前实施；执行验收时必须重新读取 HEAD，不能复用这里的值。
- canonical Harness 已支持真实 Pointer Lock、持续按键、相对鼠标输入、voxel/world/checkpoint/save readback、Worker/Wasm/WebGL2 identity 和保存后继续世界。
- `window.__seedlandsAudio` 可读取音频汇总并捕获 `audio/webm`；当前 Harness 没有媒体播放 fact/status，也没有目标 geometry descriptor 或 mesh vertex readback。
- Cua Driver `0.28.2` 的 daemon 在调查时运行，mode 为 `standard`，session 数为 `0`，录制未启用；Accessibility 与 Screen Recording 权限为 `true`，但 direct capture 为 `not_checked`，所以截图/录像能力仍是 unknown。
- Jev runner v2、`uv 0.12.5`、锁文件、虚拟环境和 Vision OCR 存在。未读取凭据，live Jev 服务是否可用为 unknown。
- 当前 Jev action schema 没有持续 key-down/up、Pointer Lock 相对 mouse move 或 `window.__seedlandsHarness` oracle。只读查询的 Cua `browser_pointer` 公开 schema 支持 hover/right-click/double-click/scroll/drag，`press_key` 是单次 press-and-release，`move_cursor` 是绝对坐标；这只证明当前公开 schema 未表达 held-key/relative move，尚未做 runtime 动作实测，不能推断 Cua 执行层一定可用或不可用。
- Classic 唱片声明要求 `playbooks/classic/assets/audio/to-far-shores.mp3`，大小 `2976045` bytes，SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。Spec 103 已冻结精确本地源 `/Users/bytedance/Downloads/_sorted/media/overworld/Lifeformed × Janice Kwan — To Far Shores.mp3`、保留原件的复制授权及许可登记；当前仓库缺少目标文件是已派发 `MEDIA-ASSET-01` 的实现依赖，不要求用户提供、下载或寻找替代资产。Pack 的 media resource/module 仍待公共安装。

## 必须先关闭的门禁

1. **B3 Structure 公共安装**：生产 composition 必须完成 registered target-first place/toggle/break、跨 Chunk batch、geometry 投影与 Web consumer 接线；不能以私有模型或 staged assembly 代替。
2. **Media 资产与公共安装**：`MEDIA-ASSET-01` 从 Spec 103 的已授权本地源复制并核验上述 bytes/hash；随后 Pack resource、media module、fact/snapshot、Web loader/player 必须真实连通。该项是已安排的实现依赖，不是外部资源阻塞，也不得改用测试音源、下载源或外部 URL。
3. **场景与 Harness 窄扩展**：在现有 `canonical-runtime-v11.json` 和唯一 browser spec 内加入水桶、跨 Chunk 门、唱片机旅程；增加只读的 registered geometry/mesh 结果与 media playback/fact readback。不得新增第二套浏览器系统。
4. **Cua 产品 GUI 可执行性**：可枚举 DOM 动作优先由 Jev 选择并交同一 Cua 执行。3D canvas/Pointer Lock 没有可靠语义候选或 chooser 不能表达时，可由 VLM 读取 fresh Cua screenshot，再由同一 Cua 执行和读回；缺口消失后恢复 Jev。Jev 服务 unavailable 本身不构成整段旅程的 hard stop，也不要求本 change 修改全局 runner。只有 Cua 权限不足或执行层经实际尝试无法交付必要动作时才记录 BLOCKED 并交 root 裁决，禁止换旧执行器或绕过 Cua 约束。
5. **新 artifact**：所有上述代码与资产落定后才允许一次 production build。构建后任何源码、锁文件或 Pack 变化都使 receipt 失效，必须停止而不是重建后混用旧证据。

## 串行执行合同

以下是后续 root 持有唯一浏览器租约时的顺序；本预检未执行：

```sh
# 1. 在工作树稳定后生成一次生产 artifact。
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm build
node scripts/harness/artifact.mjs

# 2. 用同一 dist 跑唯一 canonical Chromium Harness 机器验证，禁止重建。
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:classic
node scripts/harness/artifact.mjs

# 3. canonical 结束并释放其 Chromium 后，单独启动同一 dist 的 Preview。
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- \
  pnpm --filter @seedlands/web preview --host 127.0.0.1 --port 4273 --strictPort

# 4. root 发放唯一 Cua browser_new 租约后，可枚举 DOM 步骤从新目录运行 Jev。
/Users/bytedance/.local/share/cua/jev-runner/run.sh \
  --task changes/2026-09-23-classic-functional-completion/evidence/v1.9/browser-task.json \
  --output-dir changes/2026-09-23-classic-functional-completion/evidence/v1.9/<run-id>/jev
```

第三条是持锁的长驻进程，不能在其内部再次套 benchmark lock；由 root 管理生命周期。Cua 必须绑定新建的 loopback `browser_new` target，禁止接管已有窗口/profile、旧 browser fallback 或 `cua_repl`。每个动作前 fresh snapshot/rebind；两次一致观察或视觉观察加独立只读 oracle 是优先的可靠性做法，不在本预检中新增为 acceptance 门禁。Jev unavailable 或 canvas 不可枚举时按上节使用 VLM 感知与同一 Cua 执行，不能切换为 Playwright 完成产品 GUI 验收。

同 artifact 身份必须同时保存：

- 构建前后的 Git SHA 与 source/lock digest。
- `apps/web/dist/harness-artifact.json` 原件及校验输出。
- 浏览器从同 origin 获取的 artifact receipt、Pack lock/composition identity、Worker/Wasm/WebGL2 identity。
- Harness 与 Cua/Jev 的 run id、目标绑定和起止时间。

若页面 watermark 存在可辅助观察，但只有构建显式提供 `VITE_COMMIT_SHA` 时才可信；它不能替代 receipt。

## 最小真实旅程

场景准备遵循当前 spec：使用同一 canonical scenario、已批准 fixture 准备规则或正常创造目录，不由本预检另立限制。水桶、门和唱片的产品行为仍须通过创造目录/背包/快捷栏及 canvas 的真实产品输入完成，不能以只读 Harness 结果冒充操作。

1. **进入与身份**：点击“进入世界”，确认 Pointer Lock、Pack/composition、artifact、Worker/Wasm 与 WebGL2 readback 均属于本次 run。
2. **水桶**：通过“创造内容目录”把水桶放入快捷栏并选中；对可见目标面真实点击。观察交互反馈、手持物状态与权威 voxel/source 状态一致；unknown/unloaded 或不可替换目标必须零写且有失败反馈。
3. **跨 Chunk 门**：把木门放入快捷栏，在支撑面顶面真实放置，使 lower/upper 位于 `y=31/32`。方向只由 Authority 已验证 hit/adjacent 法向及冻结的确定性地表 bearing policy 推导，客户端不提交 definition/state/variant/orientation。上下任一半用空手交互均切换同一 root；closed 是定向薄碰撞，open 是旋转可见 mesh 且空碰撞，不得消失或回退 cube。
4. **唱片**：真实放置唱片机，把唱片 13 放入快捷栏并对其交互。观察已提交 media fact、播放器状态、可听输出/音频捕获和资源 hash 一致；重复、stale、unknown 失败不得重复消费或叠播。
5. **保存重开**：点击“保存并返回主菜单”再“继续世界”。重新读取同一世界 identity/checkpoint：水体、门两格 variant/orientation/open 状态、唱片机与已提交媒体状态符合冻结的恢复合同；不允许沿用前一 epoch 的 geometry/media registry 缓存。

## 当前 Spec 的 RED 与观察映射

以下只把当前 spec 的既有验收映射到唯一 canonical spec 与产品 GUI，不新增 acceptance；若表述与当前 spec 冲突，以 spec 为准。自动化先形成可执行 RED 再完成 GREEN，集合保持有界：

- `artifact identity`：receipt、Pack lock、composition、Worker/Wasm/WebGL2 同 run；陈旧或不一致立即失败。
- `bucket authoritative edit`：真实输入后 source/target/inventory/receipt 一致；unknown、stale、不可替换时 revision 和 inventory 零变化。
- `door atomic target-first`：跨 Chunk两格 place 一次提交；任一半 toggle；unknown/stale/孤立 legacy/三连 legacy 全部 fail closed；break upper/lower 只产生 single drop，并与 inventory、media-dependent removal、receipt 同事务。
- `door geometry`：四方向 closed/open 的实际 mesh bounds/normals/UV 与 descriptor 相符；closed AABB 阻挡、open AABB 不阻挡；save/reopen 后一致。只验证 voxel ID 或 registry getter 不算通过。
- `record lifecycle`：真实输入消费唱片并产生一次 fact；Pack 资源 bytes/hash、loader、player、四路音量与音频 capture 可关联；重复/重开遵循恢复合同。只有 audio unit test 或波形文件不算可听验收。
- `epoch isolation`：新世界/restore 重建只读 geometry/media projection；相同 storage ID 不复用旧 composition 描述符。

Cua 视觉观察至少覆盖：持有物/快捷栏变化、跨 Chunk 门关闭与开启外观、玩家能否穿过 open 门且被 closed 门阻挡、唱片交互反馈、保存返回与继续。Harness readback只补充权威状态、mesh/collision、media 和 identity，不替代这些可见/可操作结果。WebGL compile、实际 mesh readback 与截图必须来自同一 run。

## 证据位置与停止条件

统一目录：`changes/2026-09-23-classic-functional-completion/evidence/v1.9/<run-id>/`。至少保存 `harness-artifact.json`、identity/readback JSON、canonical Harness 报告、Jev task/result、Cua target metadata、关键截图与录屏、音频 capture 及其 hash。截图/录像必须在 fresh exact-target capture 成功后才可承诺；建议文件为 `visual/01-bucket.png`、`02-door-closed.png`、`03-door-open.png`、`04-record-playing.png`、`05-restored.png`、`journey.mp4`，实际扩展名以 Cua 输出为准。

任一情况立即停止对应验收并记录 BLOCKED，不继续制造替代证据：B3 或 Media 未安装；`MEDIA-ASSET-01` 复制后的 MP3 bytes/hash 不符；最终 artifact 校验失败；唯一浏览器租约不可用；Cua exact-target capture、权限或必要动作的实际交付失败；只读 geometry/media oracle 不足以证明当前 spec；世界重开或 epoch identity 不一致。Jev credential/runtime 不可用时允许按规则改用 VLM 感知和同一 Cua 执行，不单独阻塞全任务。

当前结论：静态入口和证据合同已定位；代码冻结后的 production rebuild、B3 产品接线、`MEDIA-ASSET-01` 与 Media 产品接线尚待完成，Cua direct capture 和必要 3D 动作的 runtime 可用性仍为 unknown。因此现在不启动或宣称 V1.9 可玩验收；后续必须由 Cua 完成产品 GUI 旅程，canonical Playwright 只提供既有唯一 Harness 的机器验证。
