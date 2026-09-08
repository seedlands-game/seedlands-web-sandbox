# C1 Reader 借用视图改造记录

## 目标

将 C1 参考验证脚本中会复制字节的 Reader 操作替换为独立的 `fixed-schema-reader.mjs`：Reader 持有输入的一个 `DataView`，标量直接按 offset 读取，`take`、`string` 与 `raw` 返回输入的借用子视图。语义归一化和哈希阶段仍由调用方决定是否复制。

## RED

先添加独立 smoke，导入尚不存在的 Reader 模块。Node 22 命令实际以 `ERR_MODULE_NOT_FOUND` 失败，证明 smoke 未把待测实现内联。

```sh
/tmp/seedlands-node-22/node-v22.23.2-darwin-arm64/bin/node \
  /tmp/seedlands-network-probe-codec/fixed-schema-reader-smoke.mjs
```

## GREEN

实现后同一 smoke 覆盖 Buffer 非零 `byteOffset`、截断、NaN、非安全整数、负确认序号、非法 bool、严格 UTF-8、尾随字节、raw 长度及 raw 借用别名。Node 22 实际输出 `fixed-schema-reader smoke: 8 groups passed`。没有性能计时或主验证脚本变更。

## 交接接口

主验证脚本可在 import 区增加：

```js
import { FixedSchemaReader as Reader } from './fixed-schema-reader.mjs';
```

然后删除其内联 `Reader` class；已有 `new Reader(bytes)` 调用不需改形。`take()` 与 `raw()` 返回借用的 `Uint8Array.subarray()`，保留数据的归一化或哈希调用方必须自行复制。
