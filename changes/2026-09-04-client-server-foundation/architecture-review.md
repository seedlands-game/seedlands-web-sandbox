# 第一次架构复核记录

**复核结果：** 未通过原 spec，必须在新 hash 获批后再实施。

## 已识别缺口

- `Uint16Array` 没有运行时只读保护；不得把 canonical buffer 传输给 Worker 或将类型上的只读误写成隔离保证。
- 快照缺少 seed、Chunk 身份、长度、体素 ID、损坏处理和旧存档迁移合同。
- 网格边界依赖相邻 Chunk 当前数据；只以历史 changes 或 procedural base 采样会在 materialized Chunk 重载后产生错误边面与 AO。
- 浏览器验收没有证明服务端实体 / 时钟驱动客户端显示。
- 服务端纯逻辑边界没有静态门禁，刷新后只检查 mutation count 而没有读取目标 voxel。

## 修订结论

本 change 的 spec 与预置测试已据此补齐：可信同进程读取边界、快照验证和失败保脏、旧存档单次迁移、相邻 Chunk halo、服务端 Player / 时钟读回、`seedlands/server-purity` 规则，以及精确 voxel 刷新断言。旧 hash 不再有效。
