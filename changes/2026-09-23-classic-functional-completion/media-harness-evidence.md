# Media Harness 只读观测证据

状态：`V1-HARNESS-MEDIA-01` 私有 Web seam 已完成 GREEN，等待 shared Harness owner 组合。本文不宣称浏览器、播放器或 Harness 整体已验收。

## 接口与语义

`GameMediaController.snapshot()` 返回：

```ts
Readonly<{
  worldEpoch: string | null;
  projections: readonly MediaPlaybackProjectionV1[];
  lastForwardedBatch: MediaPlaybackCommittedBatchV1 | null;
}>;
```

- `projections` 是 controller 当前正式 `pendingProjection` 的 detached、deep-frozen clone。它仍由 authority projection callback 提供，不从 fact 或播放器状态合成。
- `lastForwardedBatch` 只在当前 epoch 的完整 batch 通过正式 protocol clone、资源锁校验，并且 `GlobalAudio.consumeMediaFacts()` 同步返回后更新。`beginWorld()` 内转交匹配 epoch 的 pending batch也走同一入口。
- receipt 只保留最后一批，不新增历史队列；既有 pending 上限仍为 64 批，协议单 batch fact上限仍由正式 validator 管理。
- receipt 证明“已转交 audio consumer”，不证明异步资源读取、decode、gesture恢复或播放器已经 `playing`。shared Harness 必须另读 `GlobalAudio.snapshot().worldMedia` 判断 player状态和错误。
- 错 epoch、资源锁失败、无 audio、loader 未 ready均不会新增 receipt。若此前已有成功 receipt，拒绝的新 batch不会覆盖它。
- `beginWorld`、`beginRestore`、`endWorld`、`dispose` 清旧 receipt；`beginWorld` 仅在 audio+loader ready后安装 epoch。restore后的旧 world fact不复活 receipt。

## RED 与实现

首轮 `game-media-controller.test.ts`：`4 failed / 3 passed`，四项均因 `snapshot is not a function`，证明观测接口此前不存在。

实现使用公开 `cloneMediaPlaybackProjectionsV1` 与 `cloneMediaPlaybackCommittedBatchV1` 生成 detached、deep-frozen输出；pending flush与直接 fact共用 `forward()`。资源校验异常沿用既有中文失败反馈，`consumeMediaFacts` 自身异常不伪装成资源锁错误。

新增可执行覆盖：

- 当前 epoch正常 batch转交后记录最后一批，后续成功 batch覆盖为最新值。
- startup pending 在无 loader时不记录；`load + beginWorld` 重新校验并实际转交后才记录。
- 无 audio、loader 未 ready、错 epoch和坏资源均不冒充新转交。
- restore清旧 receipt，旧 world late fact不写；新 world fact可写；end/dispose归零。
- snapshot顶层、projection/device position、batch/fact/resource均冻结且与输入/内部不共享引用，外部修改失败并不改变后续 snapshot。

## 验证

所有重命令分别经默认 `benchmark-window` 全机锁执行，Vitest固定 `--maxWorkers=1`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/unit/app/game-media-controller.test.ts --maxWorkers=1
```

最终结果：`1 file / 7 tests PASS`。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/unit/app/browser-media-audio-consumer.test.ts --maxWorkers=1
```

结果：`1 file / 5 tests PASS`。正式 BrowserAuthority frontier、projection/fact去重、重建与 audio runtime消费语义未回归。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
```

结果：均 PASS；Web Svelte检查为 `0 errors / 0 warnings`。

Targeted ESLint、Prettier和 scoped `git diff --check` 均 PASS。

## 文件 Manifest

```text
f9ada640ff78884ab238b1833eb6b1f8169763ffedec3dc4ce9c00722ff736a7  apps/web/src/app/audio/game-media-controller.ts
8e6088a86ebb5e322b47c2e34915abacd37e303123e7a38e88d73823b42dfd32  apps/web/tests/unit/app/game-media-controller.test.ts
```

本 evidence 自身 SHA-256 在最终格式检查后单独回报。

## 未执行

- 未修改 `game.ts`、Harness contracts、`GlobalAudio`、BrowserAuthority、stdlib、Pack或Classic。
- 未运行 build、browser、dev server、CI、Git commit/push或部署。
