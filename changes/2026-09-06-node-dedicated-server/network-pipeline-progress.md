# CODEC9 应用 pipeline 记录

## 目标

为可丢弃的 CODEC9 原型定义统一阶段：`validate`、`encode`、`parse`、`own`、`hash`，以及只在校验、所有权复制和 binary hash 全部成功后才调用 consumer 的 `receive`。它不选择正式 wire，不引入生产依赖或计时。

## RED

先添加独立 Node 22 smoke，导入尚不存在的 `codec-application-pipeline.mjs`。实际得到 `ERR_MODULE_NOT_FOUND`，避免把待测行为内联进 smoke。

## GREEN

以真实 C0 source corpus 九条测试阶段组合；验证 raw bit flip 与 schema 无效帧均不交付 consumer，并在 digest 暂停期间改写 wire buffer，证明 consumer 收到的 binary 已独立持有。Node 22 实际输出 `codec-application-pipeline smoke: 4 groups passed`。

公开的临时接口为：

```js
createCodecApplicationPipeline({
  codec: { encode(record), decode(bytes) },
  digest: { digest(bytes) },
});
```

返回 `validate(record)`、`encode(record)`、`parse(bytes)`、`own(record)`、`hash(record)` 与 `receive(bytes, consumer)`。`receive` 固定按 parse、共享 semantic validate、独立所有权复制、hash、consumer 顺序执行；任何前序失败均不会调用 consumer。
