# 真实基线派生公开参考语料进度

## 状态

r1 因共享 `pageBytes` Map 的并发归属风险已保留作废；已完成并冻结 `/tmp/seedlands-network-baseline-reference-projected-v1-r2`。它是从 r2 已冻结真实 Authority capture 派生的 reference 对象语料，不是网络 wire 或浏览器安装证据。

## 输入与身份

- 固定读取 r2 `manifest.json` SHA-256 `0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad`、`frames.jsonl` SHA-256 `2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91`。
- 先调用原始 reader，再逐一复核三条 frame 和 110 个 canonical/fluid sidecar。每条 capture 的 `captureGeneration` 直接取自 `producerOutput`，没有从 `captureId` 推断。
- canonical 以 `DataView.getUint16(..., true)` 读取 LE 值并重建独立 native `Uint16Array`；投影后的 LE bytes、长度和 SHA-256 与 r2 sidecar 全等。
- 生产 reference 七个 source 已按冻结 SHA-256 门禁；派生 runner/raw/type/config 五个 producer source 也进入 artifact manifest。

## 派生结果

| 原始场景         | captureGeneration | bundleId | entries | 实际 lazy pages |
| ---------------- | ----------------: | -------: | ------: | --------------: |
| unmodified mesh  |                 0 |        0 |      27 |             162 |
| edited main mesh |                 1 |        1 |      27 |             162 |
| collision-resync |                 2 |        2 |       1 |               6 |

候选页 payload 为 16 KiB。每页在 publication handle 的 `materializePage()` 中才产生，随后以固定、可复核的 `coprime-step-37/v1` 乱序提交 reassembler。输出共有 330 个实际页 sidecar，publication claim 已清理。每个 bundle 只完成一次，重组 block 与原始 sidecar 强等价。

artifact 的 manifest 文件 SHA-256 为 `9d590ded6a1b050f9b7c42cdf3638ca957509f888a2e89de909ee264b6f85dfb`，frames 文件 SHA-256 为 `4320c31fd0c46b58c4bf158f4d94cd59991f9f810abd8a09dc3ada3fbb0b766d`。详细 hash、来源、每条 frame 和验证记录见 `network-baseline-reference-corpus-evidence.json`。

## 验证

初始专用 Vitest RED 是 recorder module 尚不存在。实现后：

- Node 22 专用 Vitest：1/1 通过。
- `tsc -p tsconfig.test.json --noEmit`：通过。
- 新增 runner 文件的 Prettier 与 ESLint：通过。
- 写盘后以 Vite SSR 直接调用默认 recheck：通过，仅读 artifact，不重写 generation。

## 未覆盖边界

本语料没有证明认证 interest/session、transport/ACK、正式 codec、socket backpressure、浏览器 Remote adapter、mesh/collision 游戏端实际安装或性能。16 KiB 是该次 reference 候选配置，不能据此冻结协议帧或推导性能结论。
