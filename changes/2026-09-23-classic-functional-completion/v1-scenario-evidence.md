# V1 Harness 场景证据

记录时间：2026-09-25 04:18:22 CST
基线：GIT06 `1b98df45`
阶段：`V1-HARNESS-SCENARIO-01`

## 实施边界

- 唯一 canonical Playwright 线路仍为 `apps/web/tests/e2e/classic-runtime.spec.ts`，原 C0-C5、视觉回归、Modular Pack smoke、性能 baseline 与阈值均未删除或削弱。
- 主跑道统一下移 29 格：floor `y=30`、air `y=31..37`、player `y=32.6`；resource、hostile、build、station 只改 y，原 x/z 路线完整保留。
- 新增 `v1Slice`：water `[68,31,2]`、door lower/upper `[70,31,0]`/`[70,32,0]`、jukebox `[76,31,2]`。门的 support 为 `y=30`，上下格明确跨 `cy=0/1`。
- `prepareInitialState` 和自然实体清理均在 baseline 前；baseline 后物品选择、mode 切换、放置、toggle、移动、保存/继续、音频手势和 eject 全部使用现有 DOM、PointerLock、键盘和鼠标输入。V1 helper 不含 Harness 世界写入、赠物、teleport、直接 runtime 或 `any`。
- 正式只读 oracle 直接消费共享类型：geometry descriptor、两个 door Chunk 的 postrender mesh summary（含 `worldEpoch`）、media projection/fact/audio phase。descriptor 不冒充 mesh，`lastForwardedBatch` 不冒充 audible playing。
- canonical test timeout 从 480 秒调整为 720 秒，仅容纳新增的同线路真实输入旅程；未改性能采样 baseline 或阈值。

## 旅程合同

- 水桶通过创造目录取得，正式 interact 放置 Water source；空桶正式 interact 收回 source，目标恢复 Air，创造快捷栏仍为 bucket。
- 木门一次右键后 lower/upper 同时成为注册 variant；上下半都可 toggle。关闭态在生存模式阻挡，打开态允许真实移动穿过。两个垂直 Chunk 的实际 WoodenDoor material mesh 均验证薄轴从 x 旋转为 z，并与 Authority/runtime `worldEpoch` 一致。
- 唱片机由普通 place 放置；`record-13` 一次 interact 产生且仅产生一个 `insert-and-activate` fact。projection、forwarded batch 与 audio `phase=playing` 分别验证。
- 保存前 Authority 与 checkpoint 都持有同一 door pair。继续世界后 epoch 改变，door/media slot/revision 保持，projection 为 `resumePending` 且 `lastForwardedBatch=null`；真实 canvas gesture 后 audio 才进入 `playing`，旧 fact 不重放。空手真实 interact eject 后 projection slot 为空、fact 为 eject、audio idle；离开世界后 audio world runtime 为 null。
- 设置仍显示总音量、音乐音量、音效音量、环境音量四项，设置面板不存在旧 file input。

## RED 证据

首轮命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/e2e/classic-support/scenario.test.ts --maxWorkers=1
```

首轮结果：`1 failed file`，`3 failed | 1 passed`。失败分别为：

- floor 实际 `y=59`，预期 `y=30`；
- `v1Slice` 为 `undefined`；
- `classic-support/v1-slice.ts` 不存在。

## 最终验证

以下命令均各自完整运行在默认 `benchmark-window` 全机锁内，没有用 `&&` 让尾部命令逸出锁。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/e2e/classic-support/scenario.test.ts apps/web/tests/unit/app/game-harness-observability.test.ts --maxWorkers=1
```

结果：`2 passed files`，`8 passed tests`。场景测试覆盖统一 y、完整 route/v1Slice 坐标、门跨 Chunk、C0-C5 coverage 以及 baseline 后禁止 Harness 写口；共享 oracle 测试覆盖正式 `worldEpoch` 绑定。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
```

结果：PASS，无诊断。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint apps/web/tests/e2e/classic-support/scenario.ts apps/web/tests/e2e/classic-support/scenario.test.ts apps/web/tests/e2e/classic-support/harness.ts apps/web/tests/e2e/classic-support/v1-slice.ts apps/web/tests/e2e/classic-runtime.spec.ts
```

结果：PASS，无诊断。首轮曾发现 `classic-runtime.spec.ts` 与 `harness.ts` 超过 `max-lines`，已仅通过 V1 helper/窄签名收口；未压缩或搬移历史领域逻辑。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check playbooks/classic/scenarios/canonical-runtime-v11.json apps/web/tests/e2e/classic-support/scenario.ts apps/web/tests/e2e/classic-support/scenario.test.ts apps/web/tests/e2e/classic-support/harness.ts apps/web/tests/e2e/classic-support/v1-slice.ts apps/web/tests/e2e/classic-runtime.spec.ts
```

结果：PASS，`All matched files use Prettier code style!`

## 文件身份

- `6b75ae07f5498a621bc403089bfd50ca135c7d56f5554231d52a15312e521e6e` `playbooks/classic/scenarios/canonical-runtime-v11.json`
- `5bc63cd8657bdd9239e1a6cab8c28f8c906eca5878bd5a88beed27f2fea486d0` `apps/web/tests/e2e/classic-support/scenario.ts`
- `8d0174089452bc5c3e68cc8b2db194ca3c9812a980fbbc5deb2028eb8fa17a4a` `apps/web/tests/e2e/classic-support/scenario.test.ts`
- `c63d3831216a7910a40131a42bb6c15cab5e397909a6534c548f730ac15e4f1e` `apps/web/tests/e2e/classic-support/harness.ts`
- `73366c2eaa06ff2ab17dc97aecdd8574e0632392d4ff1079555464c2d0c0f4d6` `apps/web/tests/e2e/classic-support/v1-slice.ts`
- `4525f142dff506f269da62bd032969e5a085d2a3f4246b3875f617b92aaff47b` `apps/web/tests/e2e/classic-runtime.spec.ts`

上述 SHA256 为最终源码身份；evidence 文件自身在写入完成后单独计算，避免自引用。

## 未执行项

- 未获得 root 的唯一 browser lease，因此未运行 Playwright、Chromium、Cua、真实 WebGL/audio/PointerLock 旅程；本阶段不宣称 browser GREEN。
- 按阶段禁令未运行 build、dev server、CI、全仓测试、部署、Git commit 或 push。
- Cloudflare preview、主观音质、多浏览器/mobile 与性能采样均不在本阶段执行范围。

## GIT-07 类型接缝收口

最终 `tsconfig.classic-tests.json` 首轮发现两个类型壳缺口：E2E `HarnessApi` 未声明产品 Harness 已有的 optional `getFluidCell`，且 `ClassicWindow` 未包含现有 `__seedlandsAudio.snapshot()`。只补这两个声明，并在 `v1-slice.ts` 对 `window` 使用同一 `ClassicWindow` 类型；未修改旅程步骤、断言、720秒预算或产品实现。复验 `tsconfig.classic-tests.json --noEmit` PASS。更新后的文件 SHA-256：

```text
d2113385cd1ec64f804c5c8321ef6d6e7cfcd87f9bcbbebd9d4a569e4a7352aa  apps/web/tests/e2e/classic-support/harness.ts
fdc0a3dd4b9bf2abe6046e25464bd51d610e614f9790c08a24d73441ce3b29ed  apps/web/tests/e2e/classic-support/v1-slice.ts
```
