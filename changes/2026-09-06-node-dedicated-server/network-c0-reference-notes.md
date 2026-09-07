# C0 原始二进制参考组校正

主线复审发现，早期 `/tmp/seedlands-network-probe-codec/real-fixture-validate.mjs` 的 C0 将二进制转 base64 放进 JSON，不能代表本合同的「JSON 元数据 + raw 二进制块」。该探索结果只保留历史功能意义，不能进入 C0 的体积、编解码或带宽比较；此前也没有将它作为有效 N2 采用证据。

新的可丢弃原型为 `/tmp/seedlands-network-probe-codec/c0-raw-reference.mjs`，验证入口为 `c0-raw-validate.mjs`，均不导入生产代码。C0 元数据保存完整 category/metadata 与块名，原始 LE canonical 和 fluid 按长度前缀原样写入同一分配的输出 buffer。base64 只用于解码结果文件给离线 oracle 读取，不在编码后的 frame 内。

## 参考格式与边界

- 12 字节外层头：magic、参考版本、reserved、payload 字节长；payload 包含元数据字节长、UTF-8 JSON、按块名顺序的长度前缀/raw block。只允许当前六类 reference 消息、最多两个具名块。
- 探索上限为 4 MiB payload 和 64 KiB 元数据，与本轮候选探针配置对齐；它不是正式 session/frame 上限，也不改变已批准的产品预算。
- JSON 元数据保留原来的数字语义；编码拒绝非有限数值。解码检查头、长度、UTF-8、JSON、类别、块数/名称、截断与尾随字节。字段语义、实际 Chunk hash/版本和资源调度仍由共享校验/接收应用验证承担。
- C0 返回 raw block 的 frame view，接收 oracle 在异步 hash 前复制。后续计时必须分别记 codec、校验、所有权转移/复制与实际应用，不能把少复制或少校验伪装成纯 codec 改善。

## 功能证据

Node 22.23.2 执行：

```sh
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node /tmp/seedlands-network-probe-codec/c0-raw-validate.mjs
```

九条同一真实 Host corpus 全部 metadata/raw 强等价。每条实际 parser 拒绝截断、尾随、未知版本、损坏 JSON 和超长 metadata，另拒绝超长 frame。`c0-raw-decoded-fixture.json` 带原始 corpus/manifest identity，供与 C1/C2 相同的实际碰撞/预测 oracle 应用。`c0-raw-validation.json` 明确 `timing: NOT_COLLECTED`。

本次原型源码 SHA-256 为 `c4165a34ecbc6d95c3fa8de337826b4b76d2f57f5fc836a5e3b274a7341c51d1`，验证入口 SHA-256 为 `9a65d089483a16916adc59e77328688f283628d7426a9e9b3948cdcc57606a88`。这些识别可丢弃原型版本，不把临时路径当作永久构建来源。

完整应用 oracle 的结果以 [网络应用记录](network-codec-application-evidence.md)为准；如果该路径尚未记录 GREEN，本段不能替代它。没有压缩、网络发送、性能采样或正式 wire 采用。原型为可丢弃本地内容，后续正式实现必须按冻结后的合同重建，不能直接将 `/tmp` 加入生产入口。
