# 真实基线到公开参考对象的派生语料计划

## 目标与范围

本任务只从冻结的 `/tmp/seedlands-network-baseline-corpus-v1-r2` 读取三条真实 Authority capture，派生并冻结“真实 capture → reference descriptor → lazy page → 乱序 reassembly”的独立语料。r1 因 writer 共享页集合归属问题保留作废，不覆写；当前输出目录固定为 `/tmp/seedlands-network-baseline-reference-projected-v1-r2`，存在即失败，采用独立 publish claim，绝不重写 r2。

它不重跑 Host、不修改原始 sidecar、不实现 wire、网络 listener、浏览器安装或性能计时。所有 descriptor/page 保持 `wireStatus: 'not-adopted'`，16 KiB 只是本次显式候选 page 配置，不是正式帧大小或 codec 采用。

## 输入绑定与准出

1. 先通过 `readNetworkBaselineCorpus({ sourcePaths })` 核验 r2 的 manifest payload、frames、记录内容及 110 个 block sidecar；派生器还会固定核对 `manifest.json` SHA-256 为 `0d2959e728f73a30efec8c9bac0f58269b9d0b51f3c73c23b0640fbbb1b7b0ad`、`frames.jsonl` SHA-256 为 `2d3a0a9fd1670c087367fbb1c9330eda9e2484d9e7facd665892c6128e5f3b91`，并保存 r2 `manifestPayloadSha256`、`corpusSha256`、三条 frame identity 和全部 sidecar 路径/hash/长度。
2. 从每条 `producerOutput.captureGeneration` 恢复真实 capture identity，不能由 `captureId` 推断 generation。canonical 文件按 `DataView.getUint16(offset, true)` 数值读取，重建 native `Uint16Array` 后再交 projector；fluid 独立复制。
3. 三条输入分别为 unmodified mesh、edited-main mesh、collision-resync。mesh 27 entries 使用 16 KiB page，固定为 162 页；collision 使用 6 页。descriptor 先出队，所有实际 page 都由 lazy `materializePage()` 获得并记录 sidecar、顺序、消息候选计量和 hash。
4. 每个 bundle 用确定性乱序送入 reassembler。重组块必须与原始 r2 LE sidecar 的长度、SHA-256 和 bytes 全等；不能以 native buffer 或 r2 metadata 猜测字节序。
5. 派生 manifest 保存 Node 22、Git SHA、tracked diff SHA-256、reference 七个生产 source 与派生 runner/raw/type/config 五个 source 的路径/hash、limits、page config、digest/sizer 身份；来源或任一 source hash 变化均在 projector 前拒绝。

## RED、执行与冻结门

初始 RED 是派生 recorder 不存在，专用 Vitest config 无法加载。实现后，默认运行只验证已存在 generation，绝不写入；尚未采集时明确失败并提示等待冻结。显式 `SEEDLANDS_CAPTURE_BASELINE_REFERENCE=1` 才能申请 claim 并写新 generation。

正式写盘前必须由实现 owner 声明 production reference source 冻结，并由本 runner 重新取得七个 source hash。当前只实现 runner、执行缺模块 RED 和聚焦功能检查；不执行最终写盘。

## 已知不证明的事项

派生语料不证明 interest/session 授权、可靠 transport、真实 codec、浏览器/mesh/collision adapter 安装、socket 4 MiB backpressure 或性能。它只证明冻结真实 Authority capture 对公开 reference projector 和 bounded reassembler 的输入保真。
